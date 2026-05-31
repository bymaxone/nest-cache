/**
 * Singleton Redis connection lifecycle manager.
 *
 * Layer: server. Owns the underlying ioredis client(s): builds `RedisOptions`
 * from the resolved module options (URL parse + defaults), opens the main client
 * on `OnModuleInit`, hands out lazy subscriber clients, forwards lifecycle events
 * to the optional `ICacheEvents.onEvent` callback (swallowing consumer errors),
 * and quits gracefully on `OnModuleDestroy` with a `disconnect()` fallback.
 *
 * @see `docs/technical_specification.md` §11 — Connection Strategy
 */
import { Inject, Injectable, Optional } from '@nestjs/common'
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Cluster, Redis } from 'ioredis'
import type { RedisOptions } from 'ioredis'

import type { CacheEventName } from '../../shared/types/cache-event.types'
import { BYMAX_CACHE_EVENTS, BYMAX_CACHE_OPTIONS } from '../bymax-cache.constants'
import type { ResolvedOptions } from '../config/resolved-options'
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES_PER_REQUEST,
  DEFAULT_RETRY_BASE_MS,
  DEFAULT_RETRY_MAX_MS
} from '../constants/default-timeouts'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import type { ICacheEvents } from '../interfaces/cache-events.interface'
import { parseRedisUrl } from '../utils/parse-redis-url'

/** The two client flavors this manager can produce. */
type AnyRedis = Redis | Cluster

/** The roles a managed client can play, surfaced in event payloads. */
type ClientRole = 'main' | 'subscriber'

@Injectable()
export class ConnectionManager implements OnModuleInit, OnModuleDestroy {
  private client: AnyRedis | null = null
  private readonly redisOptionsResolved: RedisOptions

  /** Default backoff: grow 50 ms per attempt, capped at 2 s. */
  private readonly defaultRetryStrategy = (times: number): number =>
    Math.min(times * DEFAULT_RETRY_BASE_MS, DEFAULT_RETRY_MAX_MS)

  /** Default reconnect policy: reconnect only on a `READONLY` replica failover. */
  private readonly defaultReconnectOnError = (err: Error): boolean =>
    err.message.includes('READONLY')

  /**
   * @param options - Resolved module options (frozen).
   * @param events - Optional consumer event callbacks; `@Optional()` so the
   *   module can provide `null` when the consumer omits `events`.
   */
  constructor(
    @Inject(BYMAX_CACHE_OPTIONS) private readonly options: ResolvedOptions,
    @Optional() @Inject(BYMAX_CACHE_EVENTS) private readonly events?: ICacheEvents
  ) {
    this.redisOptionsResolved = this.buildRedisOptions(options)
  }

  /** Opens the main client and waits for readiness unless `lazyConnect`. */
  async onModuleInit(): Promise<void> {
    this.client = this.createClient()
    this.registerListeners(this.client, 'main')
    if (!this.options.connection?.lazyConnect) {
      await this.waitUntilReady(this.client)
    }
  }

  /**
   * Returns the singleton main client, creating it on first access if the
   * module init has not run yet.
   *
   * @returns The shared main client.
   */
  getClient(): AnyRedis {
    if (!this.client) {
      this.client = this.createClient()
      this.registerListeners(this.client, 'main')
    }
    return this.client
  }

  /**
   * Creates a brand-new dedicated connection for subscriber mode (a subscriber
   * connection cannot run normal commands), inheriting the main options.
   *
   * Ownership of the returned client transfers to the caller: `onModuleDestroy`
   * quits only the main client, so a subscriber client must be quit/disconnected
   * by its owner (the Pub/Sub service, Phase 3).
   *
   * The subscriber is a control-plane connection (only SUBSCRIBE / UNSUBSCRIBE),
   * so its offline queue is enabled — a subscribe issued before the socket is
   * ready buffers until connected instead of failing fast like the data-plane
   * main client (whose offline queue stays disabled to avoid silent buffering).
   *
   * @returns A fresh client wired with `subscriber`-role event listeners.
   */
  createSubscriberClient(): AnyRedis {
    const client = this.createClient({ enableOfflineQueue: true })
    this.registerListeners(client, 'subscriber')
    return client
  }

  /** Quits the main client gracefully, forcing `disconnect()` on timeout. */
  async onModuleDestroy(): Promise<void> {
    const client = this.client
    if (!client) {
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        client.quit(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new CacheException(CACHE_ERROR_CODES.SHUTDOWN_TIMEOUT, {
                  timeoutMs: this.options.shutdownTimeoutMs
                })
              ),
            this.options.shutdownTimeoutMs
          )
        })
      ])
    } catch {
      // Graceful quit timed out or rejected: signal the forced teardown to the
      // observability sink before severing the socket. Reuses the 'error' event
      // (the CacheEventName union has no shutdown member) with a distinguishing
      // `reason: 'forced_disconnect'` and no `error` string, so consumers can tell
      // it apart from an ioredis socket error.
      this.emit('error', {
        role: 'main',
        reason: 'forced_disconnect',
        shutdownTimeoutMs: this.options.shutdownTimeoutMs
      })
      client.disconnect()
    } finally {
      clearTimeout(timer)
      this.client = null
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  /**
   * Instantiates the client matching the configured mode.
   *
   * @param overrides - Extra `RedisOptions` merged over the resolved defaults
   *   (used to enable the subscriber's offline queue). Ignored in cluster mode,
   *   where Pub/Sub has different semantics and is out of scope.
   */
  private createClient(overrides?: Partial<RedisOptions>): AnyRedis {
    if (this.options.mode === 'sentinel') {
      const sentinel = this.options.sentinel
      if (!sentinel) {
        throw new CacheException(CACHE_ERROR_CODES.SENTINEL_MISCONFIGURED, { mode: 'sentinel' })
      }
      return new Redis({
        ...this.redisOptionsResolved,
        ...overrides,
        sentinels: sentinel.sentinels,
        name: sentinel.name,
        ...(sentinel.sentinelPassword !== undefined && {
          sentinelPassword: sentinel.sentinelPassword
        }),
        ...(sentinel.password !== undefined && { password: sentinel.password }),
        ...(sentinel.role !== undefined && { role: sentinel.role })
      })
    }
    if (this.options.mode === 'cluster') {
      const cluster = this.options.cluster
      if (!cluster) {
        throw new CacheException(CACHE_ERROR_CODES.CLUSTER_MISCONFIGURED, { mode: 'cluster' })
      }
      return new Cluster(cluster.nodes, cluster.options ?? {})
    }
    return new Redis({ ...this.redisOptionsResolved, ...overrides })
  }

  /** Merges connection options with defaults; URL fields take precedence. */
  private buildRedisOptions(opts: ResolvedOptions): RedisOptions {
    const c = opts.connection ?? {}
    const fromUrl = c.url ? parseRedisUrl(c.url) : {}
    return {
      lazyConnect: c.lazyConnect ?? false,
      connectTimeout: c.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT_MS,
      commandTimeout: c.commandTimeout ?? DEFAULT_COMMAND_TIMEOUT_MS,
      maxRetriesPerRequest: c.maxRetriesPerRequest ?? DEFAULT_MAX_RETRIES_PER_REQUEST,
      enableReadyCheck: c.enableReadyCheck ?? true,
      enableOfflineQueue: c.enableOfflineQueue ?? false,
      retryStrategy: c.retryStrategy ?? this.defaultRetryStrategy,
      reconnectOnError: c.reconnectOnError ?? this.defaultReconnectOnError,
      keepAlive: c.keepAlive ?? 0,
      noDelay: c.noDelay ?? true,
      family: c.family ?? 4,
      ...(c.host !== undefined && { host: c.host }),
      ...(c.port !== undefined && { port: c.port }),
      ...(c.password !== undefined && { password: c.password }),
      ...(c.db !== undefined && { db: c.db }),
      ...(c.username !== undefined && { username: c.username }),
      ...(c.tls !== undefined && { tls: c.tls }),
      ...fromUrl
    }
  }

  /** Forwards a lifecycle event to `events.onEvent`, swallowing consumer throws. */
  private emit(event: CacheEventName, data: Record<string, unknown>): void {
    try {
      this.events?.onEvent?.(event, data)
    } catch {
      // Observability callbacks must never crash the connection manager.
    }
  }

  /** Wires lifecycle listeners that forward to `events.onEvent`, swallowing throws. */
  private registerListeners(client: AnyRedis, role: ClientRole): void {
    client.on('connect', () => this.emit('connect', { role }))
    client.on('ready', () => this.emit('ready', { role }))
    client.on('error', (err: Error) => this.emit('error', { role, error: err.message }))
    client.on('close', () => this.emit('close', { role }))
    client.on('reconnecting', (delay: number) => this.emit('reconnecting', { role, delay }))
    client.on('end', () => this.emit('end', { role }))
  }

  /** Resolves once the client is ready; rejects (wrapped) on connection error. */
  private async waitUntilReady(client: AnyRedis): Promise<void> {
    if (client.status === 'ready') {
      return
    }
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        client.off('ready', onReady)
        client.off('error', onError)
      }
      const onReady = (): void => {
        cleanup()
        resolve()
      }
      const onError = (err: Error): void => {
        cleanup()
        reject(new CacheException(CACHE_ERROR_CODES.CONNECTION_FAILED, { error: err.message }))
      }
      client.once('ready', onReady)
      client.once('error', onError)
    })
  }
}
