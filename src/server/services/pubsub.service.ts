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
import type { OnApplicationShutdown } from '@nestjs/common'
import type { Cluster, Redis } from 'ioredis'

import {
  BYMAX_CACHE_EVENTS,
  BYMAX_CACHE_OPTIONS,
  BYMAX_CACHE_SERIALIZER
} from '../bymax-cache.constants'
import type { ResolvedOptions } from '../config/resolved-options'
import { ConnectionManager } from '../connection/connection.manager'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import type { ICacheEvents } from '../interfaces/cache-events.interface'
import type { IPubSubHandler, IPubSubPatternHandler } from '../interfaces/pubsub-handler.interface'
import type { ReadOptions } from '../interfaces/read-options.interface'
import type { ISerializer } from '../interfaces/serializer.interface'
import { callHook, fireEvent } from '../utils/call-hook'
import { closeClient } from '../utils/close-client'
import { describeError } from '../utils/describe-error'
import { guardClient } from '../utils/guard-client'
import { guardSerializer } from '../utils/guard-serializer'
import { HandlerGate } from '../utils/handler-gate'
import { KeyBuilder } from '../utils/key-builder'
import { resolveSerializer } from '../utils/resolve-serializer'
import { validateRead } from '../utils/validate-read'

/** Detaches a subscription's listener and unsubscribes its channel/pattern. */
export type Unsubscribe = () => Promise<void>

/**
 * Starts one handler on one message. The handler's own failure, and a failure to decode the
 * message for it, are reported and end there, so they reach neither another handler nor the next
 * message.
 */
type Dispatch = (channel: string, raw: string) => void

/** One subscribed handler: what starts it on a message, and what ends its subscription. */
interface Entry {
  readonly dispatch: Dispatch
  readonly stop: () => void
}

/** How long drops of messages are summed up before the next report. */
const DROP_REPORT_WINDOW_MS = 10_000

/**
 * Live-listener counter for one namespaced channel or pattern, with the SUBSCRIBE /
 * PSUBSCRIBE that put it on the server. Every listener that joins awaits `ready`, so a
 * caller is told it is subscribed only once the server accepted the command.
 */
interface SubscriptionRef {
  count: number
  ready: Promise<unknown>
}

@Injectable()
export class PubSubService implements OnApplicationShutdown {
  /** Lazily-created dedicated subscriber connection (null until first subscribe). */
  /**
   * The dedicated subscriber connection.
   *
   * Private for the same reason as the manager's client: an ioredis instance
   * carries `options.password` as a plain field.
   */
  #subscriber: Redis | Cluster | null = null

  /** Set once shutdown begins, so no subscriber is opened that nothing would close. */
  #shutDown = false

  /** Live-listener ref-count per namespaced channel; UNSUBSCRIBE fires on the last. */
  private readonly channelRefs = new Map<string, SubscriptionRef>()

  /** Live-listener ref-count per namespaced pattern; PUNSUBSCRIBE fires on the last. */
  private readonly patternRefs = new Map<string, SubscriptionRef>()

  /** The handlers of each namespaced channel; one `message` listener on the subscriber serves them all. */
  private readonly channelHandlers = new Map<string, Set<Dispatch>>()

  /** The handlers of each namespaced pattern; one `pmessage` listener on the subscriber serves them all. */
  private readonly patternHandlers = new Map<string, Set<Dispatch>>()

  /** Resolved serializer: explicit option wins, then injected token, then JSON. */
  private readonly serializer: ISerializer

  /** How long the subscriber's graceful quit may take at shutdown. */
  private readonly shutdownTimeoutMs: number

  /** Bounds the handlers in flight; `null` when the options bound nothing. */
  private readonly gate: HandlerGate | null

  /** The drops since the last report, and the timer that ends the window they are summed in. */
  private drops: { count: number; channel: string; timer: ReturnType<typeof setTimeout> } | null =
    null

  /**
   * @param options - Resolved module options. Supplies the serializer and the shutdown timeout.
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
    this.serializer = guardSerializer(resolveSerializer(options, injectedSerializer))
    this.shutdownTimeoutMs = options.shutdownTimeoutMs
    this.gate =
      options.pubsubMaxConcurrentHandlers === undefined
        ? null
        : new HandlerGate(
            options.pubsubMaxConcurrentHandlers,
            options.pubsubMaxQueuedMessages,
            (queued) => this.emitQueued(queued)
          )
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
    return guardClient(this.connection.getClient()).publish(fullChannel, raw)
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
   * @param options - Optional read options. With `validate`, a message that does not satisfy it is
   *   not delivered: it takes the handler-error path (an `error` event with the catalog text and no
   *   part of the payload).
   * @returns An {@link Unsubscribe} that detaches THIS listener; the channel is
   *   only UNSUBSCRIBE'd once its last listener is removed, so unsubscribing one
   *   handler never breaks others subscribed to the same channel.
   */
  async subscribe<T>(
    channel: string,
    handler: IPubSubHandler<T>,
    options?: ReadOptions<T>
  ): Promise<Unsubscribe> {
    const fullChannel = this.keyBuilder.applyNamespace(channel)
    const subscriber = this.ensureSubscriber()
    const ref = await this.retainSubscription(this.channelRefs, fullChannel, () =>
      subscriber.subscribe(fullChannel)
    )

    const entry = this.makeEntry<T>(options, (message, incoming) => handler(message, incoming))

    return this.makeUnsubscribe(this.addHandler(this.channelHandlers, fullChannel, entry), () =>
      this.releaseSubscription(this.channelRefs, fullChannel, ref, () =>
        subscriber.unsubscribe(fullChannel)
      )
    )
  }

  /**
   * Pattern-subscribes to a namespaced glob (e.g. `'users:*'`). Lazily opens the
   * subscriber connection, shared with {@link PubSubService.subscribe}.
   *
   * @typeParam T - The expected message payload type.
   * @param pattern - Bare glob pattern (namespaced before subscribing).
   * @param handler - Invoked per message with `(message, channel, pattern)`,
   *   both in their full namespaced form.
   * @param options - Optional read options; `validate` is applied as in {@link PubSubService.subscribe}.
   * @returns An {@link Unsubscribe} that detaches THIS listener; the pattern is
   *   only PUNSUBSCRIBE'd once its last listener is removed.
   */
  async psubscribe<T>(
    pattern: string,
    handler: IPubSubPatternHandler<T>,
    options?: ReadOptions<T>
  ): Promise<Unsubscribe> {
    const fullPattern = this.keyBuilder.applyNamespace(pattern)
    const subscriber = this.ensureSubscriber()
    const ref = await this.retainSubscription(this.patternRefs, fullPattern, () =>
      subscriber.psubscribe(fullPattern)
    )

    const entry = this.makeEntry<T>(options, (message, channel) =>
      handler(message, channel, fullPattern)
    )

    return this.makeUnsubscribe(this.addHandler(this.patternHandlers, fullPattern, entry), () =>
      this.releaseSubscription(this.patternRefs, fullPattern, ref, () =>
        subscriber.punsubscribe(fullPattern)
      )
    )
  }

  /**
   * Closes the subscriber connection gracefully within `shutdownTimeoutMs`, forcing a disconnect
   * when the quit fails or is too slow. Runs on `onApplicationShutdown`, after the HTTP server has
   * stopped, like the main client.
   */
  async onApplicationShutdown(): Promise<void> {
    this.#shutDown = true
    this.gate?.clear()
    if (this.drops !== null) {
      clearTimeout(this.drops.timer)
      this.drops = null
    }
    const subscriber = this.#subscriber
    if (!subscriber) {
      return
    }
    this.#subscriber = null
    await closeClient(subscriber, this.shutdownTimeoutMs, () => this.emitForcedDisconnect())
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
    if (!this.#subscriber) {
      if (this.#shutDown) {
        throw new CacheException(CACHE_ERROR_CODES.CONNECTION_LOST, { reason: 'shutdown' })
      }
      const subscriber = guardClient(this.connection.createSubscriberClient())
      // One listener of each kind however many handlers there are: an emitter warns of a leak past
      // ten listeners of one event, and every message would otherwise be offered to each in turn.
      subscriber.on('message', (channel: string, raw: string) =>
        this.fanOut(this.channelHandlers.get(channel), channel, raw)
      )
      subscriber.on('pmessage', (pattern: string, channel: string, raw: string) =>
        this.fanOut(this.patternHandlers.get(pattern), channel, raw)
      )
      this.#subscriber = subscriber
    }
    return this.#subscriber
  }

  /**
   * Registers a handler for a channel or pattern.
   *
   * @param registry - The channel or pattern handler map.
   * @param target - The full namespaced channel/pattern.
   * @param entry - The handler to register.
   * @returns What removes the handler again, and the entry of a target left with none.
   */
  private addHandler(
    registry: Map<string, Set<Dispatch>>,
    target: string,
    entry: Entry
  ): () => void {
    const handlers = registry.get(target) ?? new Set<Dispatch>()
    handlers.add(entry.dispatch)
    registry.set(target, handlers)
    return () => {
      entry.stop()
      handlers.delete(entry.dispatch)
      if (handlers.size === 0) {
        registry.delete(target)
      }
    }
  }

  /**
   * Builds the entry of one handler. Its dispatch only schedules the work, with the Promise chain
   * making the fire-and-forget intent explicit: nothing awaits what a handler returns, so a failure
   * after the first await would be lost without the final catch. With a gate the work takes a slot
   * for decoding, validating and running the handler, or waits for one, or is dropped and reported.
   *
   * @typeParam T - The expected message payload type.
   * @param options - The read options of the subscription.
   * @param invoke - Calls the handler with the decoded message and the channel it arrived on.
   */
  private makeEntry<T>(
    options: ReadOptions<T> | undefined,
    invoke: (message: T, channel: string) => unknown
  ): Entry {
    let active = true
    const execute = (channel: string, raw: string): Promise<unknown> =>
      Promise.resolve()
        .then(() => this.decode<T>(raw, options))
        .then((message) => invoke(message, channel))
        .catch((error: unknown) => {
          this.emitHandlerError(channel, error)
        })
    const dispatch: Dispatch = (channel, raw) => {
      if (this.gate === null) {
        void execute(channel, raw)
      } else if (
        !this.gate.submit(
          () => execute(channel, raw),
          () => active
        )
      ) {
        this.reportDrop(channel)
      }
    }
    return {
      dispatch,
      stop: (): void => {
        active = false
      }
    }
  }

  /**
   * Starts every handler of a target on one message, in the order they were added. Starting a handler
   * only schedules it, so no handler can be added or removed while the loop runs.
   *
   * @param handlers - The handlers of the message's channel or pattern, if any.
   * @param channel - The full namespaced channel the message arrived on.
   * @param raw - The published string.
   */
  private fanOut(handlers: Set<Dispatch> | undefined, channel: string, raw: string): void {
    for (const dispatch of handlers ?? []) {
      dispatch(channel, raw)
    }
  }

  /**
   * Subscribes the target (channel or pattern) only when it gains its FIRST
   * listener, then returns its shared {@link SubscriptionRef} so a later release
   * knows when to issue the matching UNSUBSCRIBE / PUNSUBSCRIBE.
   *
   * Callers share one in-flight command and count as listeners from the moment they
   * join. If it fails, all of them reject and the entry is dropped, so the next call
   * sends the command again.
   *
   * @param refs - The channel or pattern ref-count map.
   * @param target - The full namespaced channel/pattern.
   * @param subscribe - Issues the SUBSCRIBE / PSUBSCRIBE for `target`.
   * @returns The shared ref for `target` (captured by the unsubscribe closure).
   */
  private async retainSubscription(
    refs: Map<string, SubscriptionRef>,
    target: string,
    subscribe: () => Promise<unknown>
  ): Promise<SubscriptionRef> {
    let ref = refs.get(target)
    if (!ref) {
      const created: SubscriptionRef = { count: 0, ready: subscribe() }
      // Registered before any caller awaits `ready`, so the entry is gone when they reject.
      created.ready.catch(() => refs.delete(target))
      refs.set(target, created)
      ref = created
    }
    ref.count += 1
    await ref.ready
    return ref
  }

  /**
   * Decrements the (closure-captured) ref and issues the UNSUBSCRIBE / PUNSUBSCRIBE
   * only when the LAST listener is removed — so unsubscribing one handler never
   * silently stops delivery to the others on the same channel/pattern.
   *
   * A rejected UNSUBSCRIBE reaches the caller while the server keeps the channel; its
   * messages find no listener, and the next subscription sends SUBSCRIBE again.
   *
   * @param refs - The channel or pattern ref-count map.
   * @param target - The full namespaced channel/pattern.
   * @param ref - The shared ref returned by {@link retainSubscription}.
   * @param unsubscribe - Issues the UNSUBSCRIBE / PUNSUBSCRIBE for `target`.
   */
  private async releaseSubscription(
    refs: Map<string, SubscriptionRef>,
    target: string,
    ref: SubscriptionRef,
    unsubscribe: () => Promise<unknown>
  ): Promise<void> {
    ref.count -= 1
    if (ref.count === 0) {
      refs.delete(target)
      await unsubscribe()
    }
  }

  /**
   * Builds an idempotent {@link Unsubscribe}: the first call detaches the listener
   * and releases the subscription; later calls are no-ops, so a double unsubscribe
   * cannot over-decrement a shared channel/pattern.
   *
   * @param detach - Removes this subscription's event listener.
   * @param release - Decrements the reference count (see {@link releaseSubscription}).
   */
  private makeUnsubscribe(detach: () => void, release: () => Promise<void>): Unsubscribe {
    let released = false
    return async (): Promise<void> => {
      if (released) {
        return
      }
      released = true
      detach()
      await release()
    }
  }

  /**
   * Decodes one message and, when the subscriber passed `validate`, checks it.
   *
   * @typeParam T - The expected message payload type.
   * @param raw - The published string.
   * @param options - The read options of the subscription.
   * @returns The decoded message; the validator's output when it transforms.
   */
  private async decode<T>(raw: string, options: ReadOptions<T> | undefined): Promise<T> {
    const message = this.serializer.deserialize<T>(raw)
    return options?.validate === undefined ? message : validateRead(message, options.validate)
  }

  /**
   * Reports a message dropped because every slot and the whole queue were taken. The first drop is
   * reported at once; the ones that follow within {@link DROP_REPORT_WINDOW_MS} are counted and
   * reported as one event carrying the count and the channel of the last, so an overload does not
   * flood the host's sink. Another window follows while drops continue. Swallows any throw from
   * `onEvent`.
   *
   * @param channel - The full namespaced channel the dropped message arrived on.
   */
  private reportDrop(channel: string): void {
    if (this.drops !== null) {
      this.drops.count += 1
      this.drops.channel = channel
      return
    }
    this.emitDrop({ channel })
    this.openDropWindow(channel)
  }

  /**
   * Starts the window the drops that follow the last report are summed in.
   *
   * @param channel - The channel of the drop just reported, the last one until another follows.
   */
  private openDropWindow(channel: string): void {
    const timer = setTimeout(() => {
      const drops = this.drops
      this.drops = null
      if (drops !== null && drops.count > 0) {
        this.emitDrop({ channel: drops.channel, dropped: drops.count })
        this.openDropWindow(drops.channel)
      }
    }, DROP_REPORT_WINDOW_MS)
    timer.unref()
    this.drops = { count: 0, channel, timer }
  }

  /**
   * Emits the `handler_queue_full` event: no part of any payload, only the channel and a count.
   *
   * @param detail - The channel, and how many drops it sums up when there is more than one.
   */
  private emitDrop(detail: { channel: string; dropped?: number }): void {
    fireEvent(this.events, 'error', { role: 'subscriber', reason: 'handler_queue_full', ...detail })
  }

  /**
   * Tells `events.onQueue` how many messages wait for a handler slot, swallowing any throw from it.
   *
   * @param queued - How many messages wait now.
   */
  private emitQueued(queued: number): void {
    callHook('onQueue', () => this.events?.onQueue?.(queued))
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
    fireEvent(this.events, 'error', {
      role: 'subscriber',
      reason: 'handler_error',
      channel,
      error: describeError(error),
      // The raw object only for a throw of the host's own handler. A failure the library wrapped
      // keeps its text and nothing else: its `cause` can quote the payload.
      ...(error instanceof CacheException ? {} : { err: error })
    })
  }

  /**
   * Reports the forced teardown of the subscriber, the same `error` event with `reason:
   * 'forced_disconnect'` the connection manager emits for the main client, so a silent teardown
   * does not sit next to a signalled one. Swallows any throw from `onEvent`.
   */
  private emitForcedDisconnect(): void {
    fireEvent(this.events, 'error', {
      role: 'subscriber',
      reason: 'forced_disconnect',
      shutdownTimeoutMs: this.shutdownTimeoutMs
    })
  }
}
