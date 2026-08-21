/**
 * Reports whether the cache is answering, what it is doing, and how it is wired.
 *
 * Layer: admin. Three read-only questions an operator asks during an incident,
 * answered without touching a single key.
 */
import { Inject, Injectable } from '@nestjs/common'

import {
  BYMAX_CACHE_OPTIONS,
  BYMAX_CACHE_SERIALIZER,
  CacheService,
  DEFAULT_REDIS_PORT
} from '@bymax-one/nest-cache'
import type { ISerializer, ResolvedOptions } from '@bymax-one/nest-cache'

import { BYMAX_CACHE_ADMIN_OPTIONS } from '../bymax-cache-admin.constants'
import type { ResolvedAdminOptions } from '../config/resolved-admin-options'
import type { CacheConfig, CacheHealth, CacheMode, CacheProbe } from '../types/cache-health.types'
import type { RedisStats } from '../types/redis-stats.types'
import { readRedisStats } from '../utils/parse-info'

/**
 * The cache capabilities this service reads through.
 *
 * A `Pick` of the real facade rather than the class itself: Nest still injects
 * the concrete `CacheService`, while a test supplies a plain object with two
 * methods and no cast. A cast would be a blocking finding under this
 * repository's suppression policy, so the narrow type is not a convenience.
 */
export type ICacheProbe = Pick<CacheService, 'ping' | 'info'>

/** The reply a healthy Redis sends to `PING`. */
const PONG = 'PONG'

/** The one mode in which the library refuses `SCAN`. */
const SCAN_UNSUPPORTED_MODE: CacheMode = 'cluster'

/** The URL scheme that means the transport is encrypted. */
const TLS_PROTOCOL = 'rediss:'

/** Resolves when the probe's deadline passes, distinguishable from any reply. */
const PROBE_TIMEOUT = Symbol('probe-timeout')

/**
 * Races a probe against its deadline.
 *
 * Resolves to {@link PROBE_TIMEOUT} rather than rejecting, so a deadline is not
 * signalled through the same channel as a connection failure — the two produce
 * different `reason`s and must not be recovered by inspecting an error. The
 * timer is always cleared, including when the work rejects first, so a probe
 * never keeps the process alive.
 *
 * @param work - The in-flight probe.
 * @param timeoutMs - How long to wait.
 * @returns The probe's value, or the timeout marker.
 */
async function raceDeadline<T>(
  work: Promise<T>,
  timeoutMs: number
): Promise<T | typeof PROBE_TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<typeof PROBE_TIMEOUT>((resolve) => {
    timer = setTimeout(() => {
      resolve(PROBE_TIMEOUT)
    }, timeoutMs)
  })
  try {
    return await Promise.race([work, deadline])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Reads a driver's syscall code from a thrown value.
 *
 * Only the code, never the message: an error message is free-form and may carry
 * connection detail the library is careful never to echo (CLAUDE.md §4), while a
 * syscall code is a bounded token an operator acts on.
 *
 * @param error - Whatever was thrown.
 * @returns The code, or `null` when the thrown value carries none.
 */
function readErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null
  }
  const code: unknown = Reflect.get(error, 'code')
  return typeof code === 'string' ? code : null
}

/**
 * Reads a connection's endpoint without letting its credentials reach a caller.
 *
 * A URL that will not parse yields nulls rather than throwing: a config route
 * that refuses because one field is malformed denies an operator the screen they
 * opened precisely to find out that the field is malformed.
 *
 * @param options - The resolved module options.
 * @returns Host, port and whether the transport is encrypted.
 */
function readEndpoint(options: ResolvedOptions): CacheConfig['connection'] {
  const withheld = { host: null, port: null, isTls: false }
  // Sentinel and cluster have no single endpoint to name; `mode` alongside says why.
  if (options.mode !== 'standalone') {
    return withheld
  }
  const connection = options.connection
  if (!connection) {
    return withheld
  }
  if (connection.url !== undefined) {
    try {
      // Read the URL directly rather than through `parseRedisUrl`, which decodes
      // the password into a local as part of building connect options. Nothing
      // in this module should ever hold the credential, not even briefly — the
      // three fields below are the whole of what an operator surface needs.
      const parsed = new URL(connection.url)
      return {
        // No empty-host branch: a `redis:`/`rediss:` URL without a host is a
        // parse error (measured — `new URL('redis://:6379')` throws), so it is
        // caught below rather than reaching here as a blank hostname.
        host: parsed.hostname,
        // A URL that names no port still connects, on the default — reporting
        // null here would hide the endpoint rather than describe it.
        port: parsed.port === '' ? DEFAULT_REDIS_PORT : Number.parseInt(parsed.port, 10),
        isTls: parsed.protocol === TLS_PROTOCOL
      }
    } catch {
      return withheld
    }
  }
  return {
    host: connection.host ?? null,
    port: connection.port ?? null,
    isTls: connection.tls !== undefined
  }
}

/** Reports whether the cache is answering, what it is doing, and how it is wired. */
@Injectable()
export class CacheStatusService {
  /**
   * @param cache - The cache facade this service probes through.
   * @param options - The resolved cache module options.
   * @param adminOptions - The resolved administration options.
   * @param serializer - The wired serializer, named on the config payload.
   */
  constructor(
    @Inject(CacheService) private readonly cache: ICacheProbe,
    @Inject(BYMAX_CACHE_OPTIONS) private readonly options: ResolvedOptions,
    @Inject(BYMAX_CACHE_ADMIN_OPTIONS) private readonly adminOptions: ResolvedAdminOptions,
    @Inject(BYMAX_CACHE_SERIALIZER) private readonly serializer: ISerializer
  ) {}

  /**
   * Pings Redis and reports the result in three states.
   *
   * @returns The probe outcome, plus the mode facts that hold whether or not it
   *   answered.
   */
  async health(): Promise<CacheHealth> {
    return {
      ...(await this.probe()),
      mode: this.options.mode,
      isScanSupported: this.options.mode !== SCAN_UNSUPPORTED_MODE,
      degradedAboveMs: this.adminOptions.degradedAboveMs
    }
  }

  /**
   * Reads Redis `INFO` into a typed reading.
   *
   * @returns The parsed statistics, stamped with the reading host's clock.
   */
  async stats(): Promise<RedisStats> {
    return readRedisStats(await this.cache.info(), new Date())
  }

  /**
   * Reports how this deployment is wired, with every credential withheld.
   *
   * @returns The resolved configuration, safe to serve to an operator surface.
   */
  config(): CacheConfig {
    return {
      mode: this.options.mode,
      namespace: this.options.namespace,
      keySeparator: this.options.keySeparator,
      shutdownTimeoutMs: this.options.shutdownTimeoutMs,
      isFlushAllowedInProduction: this.options.allowFlushInProduction,
      serializer: this.serializer.constructor.name,
      // Names only. A Lua body is deployment logic and has no business on an
      // operator-facing payload.
      scripts: (this.options.scripts ?? []).map((script) => script.name),
      connection: readEndpoint(this.options)
    }
  }

  /**
   * Measures one `PING`.
   *
   * `latencyMs` is produced on exactly one path — a reply that arrived. Every
   * other outcome returns the `down` branch, which has no latency field to fill
   * in, so a confident status without a measurement cannot be constructed here.
   *
   * @returns The probe outcome.
   */
  private async probe(): Promise<CacheProbe> {
    const started = performance.now()
    let reply: string | typeof PROBE_TIMEOUT
    try {
      reply = await raceDeadline(this.cache.ping(), this.adminOptions.probeTimeoutMs)
    } catch (error) {
      return { status: 'down', reason: 'error', code: readErrorCode(error) }
    }
    if (reply === PROBE_TIMEOUT) {
      return { status: 'down', reason: 'timeout', code: null }
    }
    if (reply !== PONG) {
      // Answering, but not as this cache. A fast wrong answer is not health.
      return { status: 'down', reason: 'error', code: null }
    }
    const latencyMs = Math.round(performance.now() - started)
    return latencyMs > this.adminOptions.degradedAboveMs
      ? { status: 'degraded', latencyMs }
      : { status: 'up', latencyMs }
  }
}
