/**
 * Redis Pub/Sub facade.
 *
 * Layer: server. `publish` runs on the singleton main client (PUBLISH is a normal
 * command); `subscribe` / `psubscribe` lazily open a single dedicated subscriber
 * connection (a connection in subscriber mode cannot run other commands). Every
 * channel/pattern is namespaced through {@link KeyBuilder}, and the channel /
 * pattern handed to a handler is the full namespaced form ioredis reports.
 *
 * Reconnection: ioredis re-subscribes automatically, but messages published
 * DURING an offline window are lost — Redis Pub/Sub is fire-and-forget
 * (technical_specification.md §8). Handler errors are swallowed so a faulty
 * consumer callback can never crash the shared subscriber connection.
 *
 * @see `docs/technical_specification.md` §8 — Pub/Sub
 */
import { Inject, Injectable, Optional } from '@nestjs/common'
import type { OnModuleDestroy } from '@nestjs/common'
import type { Cluster, Redis } from 'ioredis'

import {
  BYMAX_CACHE_EVENTS,
  BYMAX_CACHE_OPTIONS,
  BYMAX_CACHE_SERIALIZER
} from '../bymax-cache.constants'
import type { ResolvedOptions } from '../config/resolved-options'
import { ConnectionManager } from '../connection/connection.manager'
import type { ICacheEvents } from '../interfaces/cache-events.interface'
import type { IPubSubHandler, IPubSubPatternHandler } from '../interfaces/pubsub-handler.interface'
import type { ISerializer } from '../interfaces/serializer.interface'
import { KeyBuilder } from '../utils/key-builder'
import { resolveSerializer } from '../utils/resolve-serializer'

/** Detaches a subscription's listener and unsubscribes its channel/pattern. */
export type Unsubscribe = () => Promise<void>

@Injectable()
export class PubSubService implements OnModuleDestroy {
  /** Lazily-created dedicated subscriber connection (null until first subscribe). */
  private subscriber: Redis | Cluster | null = null

  /** Resolved serializer: explicit option wins, then injected token, then JSON. */
  private readonly serializer: ISerializer

  /**
   * @param options - Resolved module options. Supplies the serializer.
   * @param connection - Owns the main client and mints subscriber connections.
   *   Explicit `@Inject` — the published bundle is built without
   *   emitDecoratorMetadata, so type-only DI cannot resolve a class provider
   *   (CLAUDE.md §5).
   * @param keyBuilder - Namespaces every channel/pattern.
   * @param injectedSerializer - Optional `BYMAX_CACHE_SERIALIZER` provider.
   * @param events - Optional consumer observability callback bag; a swallowed
   *   handler/deserialization failure is forwarded to it instead of vanishing.
   */
  constructor(
    @Inject(BYMAX_CACHE_OPTIONS) options: ResolvedOptions,
    @Inject(ConnectionManager) private readonly connection: ConnectionManager,
    @Inject(KeyBuilder) private readonly keyBuilder: KeyBuilder,
    @Optional() @Inject(BYMAX_CACHE_SERIALIZER) injectedSerializer?: ISerializer,
    @Optional() @Inject(BYMAX_CACHE_EVENTS) private readonly events?: ICacheEvents
  ) {
    this.serializer = resolveSerializer(options, injectedSerializer)
  }

  /**
   * Publishes a serialized message to a namespaced channel via the main client.
   *
   * @typeParam T - The message payload type.
   * @param channel - Bare channel name (namespaced before publishing).
   * @param message - Payload, encoded through the configured serializer.
   * @returns The number of subscribers that received the message.
   * @throws {CacheException} `SERIALIZATION_FAILED` when `message` cannot be encoded.
   */
  async publish<T>(channel: string, message: T): Promise<number> {
    const fullChannel = this.keyBuilder.applyNamespace(channel)
    const raw = this.serializer.serialize(message)
    return this.connection.getClient().publish(fullChannel, raw)
  }

  /**
   * Subscribes to a namespaced channel. Opens the subscriber connection lazily;
   * subsequent subscriptions reuse the same connection.
   *
   * The handler receives the deserialized message and the full namespaced
   * channel. A throw inside the handler (or a malformed payload) is swallowed so
   * it cannot tear down the shared subscriber.
   *
   * @typeParam T - The expected message payload type.
   * @param channel - Bare channel name (namespaced before subscribing).
   * @param handler - Invoked per message with `(message, channel)`.
   * @returns An {@link Unsubscribe} that detaches this listener and unsubscribes
   *   the channel.
   */
  async subscribe<T>(channel: string, handler: IPubSubHandler<T>): Promise<Unsubscribe> {
    const fullChannel = this.keyBuilder.applyNamespace(channel)
    const subscriber = this.ensureSubscriber()
    await subscriber.subscribe(fullChannel)

    const listener = async (incoming: string, raw: string): Promise<void> => {
      if (incoming !== fullChannel) {
        return
      }
      try {
        await handler(this.serializer.deserialize<T>(raw), incoming)
      } catch (error) {
        // A consumer handler (or a malformed payload) must never crash the shared
        // subscriber connection — surface the failure to observability instead.
        this.emitHandlerError(incoming, error)
      }
    }
    subscriber.on('message', listener)

    return async (): Promise<void> => {
      subscriber.off('message', listener)
      await subscriber.unsubscribe(fullChannel)
    }
  }

  /**
   * Pattern-subscribes to a namespaced glob (e.g. `'users:*'`). Lazily opens the
   * subscriber connection, shared with {@link PubSubService.subscribe}.
   *
   * @typeParam T - The expected message payload type.
   * @param pattern - Bare glob pattern (namespaced before subscribing).
   * @param handler - Invoked per message with `(message, channel, pattern)`,
   *   both in their full namespaced form.
   * @returns An {@link Unsubscribe} that detaches this listener and
   *   pattern-unsubscribes.
   */
  async psubscribe<T>(pattern: string, handler: IPubSubPatternHandler<T>): Promise<Unsubscribe> {
    const fullPattern = this.keyBuilder.applyNamespace(pattern)
    const subscriber = this.ensureSubscriber()
    await subscriber.psubscribe(fullPattern)

    const listener = async (
      matchedPattern: string,
      channel: string,
      raw: string
    ): Promise<void> => {
      if (matchedPattern !== fullPattern) {
        return
      }
      try {
        await handler(this.serializer.deserialize<T>(raw), channel, matchedPattern)
      } catch (error) {
        // Forwarded for the same reason as subscribe() — protect the connection.
        this.emitHandlerError(channel, error)
      }
    }
    subscriber.on('pmessage', listener)

    return async (): Promise<void> => {
      subscriber.off('pmessage', listener)
      await subscriber.punsubscribe(fullPattern)
    }
  }

  /** Closes the subscriber connection gracefully, forcing disconnect on failure. */
  async onModuleDestroy(): Promise<void> {
    if (!this.subscriber) {
      return
    }
    const subscriber = this.subscriber
    this.subscriber = null
    try {
      await subscriber.quit()
    } catch {
      subscriber.disconnect()
    }
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  /**
   * Returns the dedicated subscriber connection, creating it on first use.
   *
   * Reused for the lifetime of the module; ioredis transparently reconnects and
   * re-subscribes, so a single connection is kept rather than recreated. Typed as
   * the `Redis | Cluster` union the connection manager mints — `subscribe` /
   * `psubscribe` exist on both, so no cast is needed (cluster Pub/Sub is an
   * experimental passthrough per the spec).
   */
  private ensureSubscriber(): Redis | Cluster {
    if (!this.subscriber) {
      this.subscriber = this.connection.createSubscriberClient()
    }
    return this.subscriber
  }

  /**
   * Forwards a swallowed handler / deserialization failure to the optional
   * observability callback, itself swallowing any throw from `onEvent` — a
   * faulty consumer (handler OR callback) must never tear down the subscriber.
   * The error surfaces as an `'error'` event with `reason: 'handler_error'`.
   *
   * @param channel - The full namespaced channel the failed message arrived on.
   * @param error - The caught handler / deserialization failure.
   */
  private emitHandlerError(channel: string, error: unknown): void {
    try {
      this.events?.onEvent?.('error', {
        role: 'subscriber',
        reason: 'handler_error',
        channel,
        error: error instanceof Error ? error.message : String(error)
      })
    } catch {
      // Observability must never crash the subscriber connection.
    }
  }
}
