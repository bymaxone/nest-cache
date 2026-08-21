import { applyDefaults } from '../../server/config/default-options'
import { CacheStatusService } from './cache-status.service'
import { resolveAdminOptions } from '../config/resolved-admin-options'

import type { ISerializer } from '../../server/interfaces/serializer.interface'
import type { CacheScope } from '../interfaces/cache-scope.interface'
import type { BymaxCacheModuleOptions } from '../../server/interfaces/cache-module-options.interface'

const SCOPES: readonly CacheScope[] = [
  { id: 'cache', label: 'Cache', pattern: 'app:*', isReadable: true, origin: 'the namespace' }
]

/** The default serializer stands in for any consumer-supplied one. */
class JsonLike implements ISerializer {
  serialize(): string {
    return ''
  }
  deserialize<T>(): T {
    return undefined as T
  }
}

/** Builds the service over a fake probe, so no test opens a connection. */
const build = (
  probe: { ping: jest.Mock; info: jest.Mock },
  moduleOptions: BymaxCacheModuleOptions = { connection: { host: 'h' } },
  adminOverrides: Partial<Parameters<typeof resolveAdminOptions>[0]> = {}
): CacheStatusService =>
  new CacheStatusService(
    probe,
    applyDefaults(moduleOptions),
    resolveAdminOptions({ scopes: SCOPES, ...adminOverrides }),
    new JsonLike()
  )

/** A probe whose PING answers after `ms` of simulated elapsed time. */
const answeringIn = (ms: number): { ping: jest.Mock; info: jest.Mock } => {
  // Deliberately NOT starting at zero: `performance.now()` is monotonic from an
  // arbitrary origin, and with a zero base `end - start` and `end + start` agree,
  // so an inverted operator would go unnoticed.
  let now = 1_000
  jest.spyOn(performance, 'now').mockImplementation(() => {
    const value = now
    now += ms
    return value
  })
  return { ping: jest.fn().mockResolvedValue('PONG'), info: jest.fn().mockResolvedValue('') }
}

describe('CacheStatusService.health', () => {
  // A fast PONG is up, and carries the measurement that justifies saying so.
  it('reports up with a latency when the ping answers quickly', async () => {
    const health = await build(answeringIn(5)).health()
    // The exact value matters: the clock base is non-zero, so a latency computed
    // by adding rather than subtracting would land far from 5.
    expect(health).toMatchObject({ status: 'up', latencyMs: 5 })
  })

  // Above the threshold the cache is answering but not well. Three states, not
  // two: collapsing this into `up` hides the state an operator most wants to
  // catch early, and into `down` claims an outage that is not happening.
  it('reports degraded above the configured threshold', async () => {
    const health = await build(answeringIn(400)).health()
    expect(health).toMatchObject({ status: 'degraded', latencyMs: 400 })
  })

  // The threshold is a boundary, not a range: exactly at it is still up.
  it('treats a latency exactly at the threshold as up', async () => {
    const health = await build(answeringIn(250)).health()
    expect(health.status).toBe('up')
  })

  // One millisecond past the threshold flips the verdict, which pins the comparison
  // as strictly-greater rather than greater-or-equal.
  it('reports degraded one millisecond above the threshold', async () => {
    const health = await build(answeringIn(251)).health()
    expect(health.status).toBe('degraded')
  })

  // The threshold is reported alongside the verdict so a surface can say WHY it
  // called the cache degraded, rather than asserting a number it cannot source.
  it('reports the threshold that produced the verdict', async () => {
    const health = await build(answeringIn(5), undefined, { degradedAboveMs: 42 }).health()
    expect(health.degradedAboveMs).toBe(42)
  })

  // A throwing ping is down, and the payload carries NO latency at all — the
  // union makes a confident status without a measurement unrepresentable.
  it('reports down without a latency when the ping throws', async () => {
    const probe = {
      ping: jest.fn().mockRejectedValue(Object.assign(new Error('nope'), { code: 'ECONNREFUSED' })),
      info: jest.fn()
    }
    const health = await build(probe).health()
    expect(health).toMatchObject({ status: 'down', reason: 'error', code: 'ECONNREFUSED' })
    expect(health).not.toHaveProperty('latencyMs')
  })

  // An error with no syscall code still reports down; the code is absent, not
  // invented.
  it('reports a null code when the driver reported none', async () => {
    const probe = { ping: jest.fn().mockRejectedValue(new Error('nope')), info: jest.fn() }
    expect(await build(probe).health()).toMatchObject({ status: 'down', code: null })
  })

  // A non-Error rejection must not crash the probe — a health route that throws
  // is the failure it exists to report.
  it('survives a non-Error rejection', async () => {
    const probe = { ping: jest.fn().mockRejectedValue('string failure'), info: jest.fn() }
    expect(await build(probe).health()).toMatchObject({ status: 'down', code: null })
  })

  // A server that answers something other than PONG is answering, but it is not
  // this cache. Treated as down rather than as a fast success.
  it('reports down when the reply is not PONG', async () => {
    const probe = { ping: jest.fn().mockResolvedValue('WAT'), info: jest.fn() }
    expect(await build(probe).health()).toMatchObject({ status: 'down', reason: 'error' })
  })

  // A ping that never settles must not hang the caller. Without the timeout, the
  // failure mode a health route exists to report becomes the one it exhibits.
  it('reports down with reason timeout when the ping never settles', async () => {
    jest.useFakeTimers()
    const probe = { ping: jest.fn().mockReturnValue(new Promise(() => {})), info: jest.fn() }
    const pending = build(probe, undefined, { probeTimeoutMs: 1000 }).health()
    await jest.advanceTimersByTimeAsync(1000)
    expect(await pending).toMatchObject({ status: 'down', reason: 'timeout', code: null })
    jest.useRealTimers()
  })

  // The probe deadline must be CLEARED once the ping answers. An uncleared timer
  // keeps the event loop alive for the whole timeout after every health check —
  // invisible in the payload, and the reason a process refuses to exit.
  it('clears the deadline timer once the ping answers', async () => {
    jest.useFakeTimers()
    const probe = { ping: jest.fn().mockResolvedValue('PONG'), info: jest.fn() }
    await build(probe, undefined, { probeTimeoutMs: 5000 }).health()
    expect(jest.getTimerCount()).toBe(0)
    jest.useRealTimers()
  })

  // `mode` and `isScanSupported` sit outside the discriminated part: a cluster
  // deployment that is DOWN should still report that scanning was never going to
  // work.
  it('reports mode and scan support even when down', async () => {
    const probe = { ping: jest.fn().mockRejectedValue(new Error('x')), info: jest.fn() }
    const health = await build(probe, {
      mode: 'cluster',
      cluster: { nodes: [{ host: 'c', port: 6379 }] }
    }).health()
    expect(health).toMatchObject({ status: 'down', mode: 'cluster', isScanSupported: false })
  })

  // Standalone supports SCAN, so the flag must not be inverted — a console that
  // trusted a wrong value would hide a working explorer.
  it('reports scan support in standalone mode', async () => {
    expect((await build(answeringIn(1)).health()).isScanSupported).toBe(true)
  })
})

describe('CacheStatusService.stats', () => {
  // The reading is parsed from INFO, not passed through as text.
  it('parses the INFO reply into a typed reading', async () => {
    const probe = {
      ping: jest.fn(),
      info: jest.fn().mockResolvedValue('# Memory\r\nused_memory:1024\r\nmaxmemory:0\r\n')
    }
    const stats = await build(probe).stats()
    expect(stats.memory.usedBytes).toBe(1024)
    expect(stats.memory.max).toEqual({ kind: 'unbounded' })
    expect(typeof stats.readAt).toBe('string')
  })
})

describe('CacheStatusService.config', () => {
  // The connection URL is NEVER on the wire. Serving the resolved options
  // directly — the obvious implementation — ships a Redis URL with its password
  // to whatever reads this. The assertion is on the SERIALIZED payload, because
  // that is what leaves the process.
  it('never serializes the connection URL or its password', () => {
    const service = build(
      { ping: jest.fn(), info: jest.fn() },
      {
        connection: { url: 'rediss://default:sup3rs3cret@redis.internal:6380/2' }
      }
    )
    const payload = JSON.stringify(service.config())
    expect(payload).not.toContain('sup3rs3cret')
    expect(payload).not.toContain('rediss://')
    expect(payload).not.toContain('default:')
  })

  // What it DOES report is enough for a panel: where it connects and whether the
  // transport is encrypted.
  it('reports host, port and TLS derived from the URL', () => {
    const service = build(
      { ping: jest.fn(), info: jest.fn() },
      {
        connection: { url: 'rediss://default:secret@redis.internal:6380/2' }
      }
    )
    expect(service.config().connection).toEqual({
      host: 'redis.internal',
      port: 6380,
      isTls: true
    })
  })

  // A plain redis:// URL is not TLS, and the flag must not be inverted.
  it('reports isTls false for a plain redis URL', () => {
    const service = build(
      { ping: jest.fn(), info: jest.fn() },
      {
        connection: { url: 'redis://redis.internal:6379' }
      }
    )
    expect(service.config().connection.isTls).toBe(false)
  })

  // Discrete fields are the fallback when no URL is configured.
  it('falls back to the discrete host and port', () => {
    const service = build(
      { ping: jest.fn(), info: jest.fn() },
      {
        connection: { host: 'discrete.host', port: 6390 }
      }
    )
    expect(service.config().connection).toEqual({
      host: 'discrete.host',
      port: 6390,
      isTls: false
    })
  })

  // Explicit TLS options without a rediss:// URL still mean TLS.
  it('reports isTls from explicit tls options', () => {
    const service = build(
      { ping: jest.fn(), info: jest.fn() },
      {
        connection: { host: 'h', tls: {} }
      }
    )
    expect(service.config().connection.isTls).toBe(true)
  })

  // Sentinel and cluster have no single endpoint to name. Reporting a null host
  // beside `mode` is honest; picking one node would imply a topology that is not
  // there.
  it('reports a null endpoint under cluster mode', () => {
    const service = build(
      { ping: jest.fn(), info: jest.fn() },
      {
        mode: 'cluster',
        cluster: { nodes: [{ host: 'c', port: 6379 }] }
      }
    )
    expect(service.config().connection).toEqual({ host: null, port: null, isTls: false })
  })

  // A non-standalone deployment that ALSO carries a connection block must still
  // report nulls. Without a connection block the mode guard is indistinguishable
  // from no guard at all — both fall through to the same empty answer — so this
  // is the only shape that proves the mode is what withholds the endpoint.
  it('withholds the endpoint under cluster mode even when a connection block is set', () => {
    const options = applyDefaults({
      mode: 'cluster',
      cluster: { nodes: [{ host: 'c', port: 6379 }] }
    })
    const service = new CacheStatusService(
      { ping: jest.fn(), info: jest.fn() },
      { ...options, connection: { host: 'must-not-leak', port: 1234 } },
      resolveAdminOptions({ scopes: SCOPES }),
      new JsonLike()
    )
    expect(service.config().connection).toEqual({ host: null, port: null, isTls: false })
  })

  // A malformed URL must withhold the endpoint even when discrete fields COULD
  // answer. Falling back to them would report an endpoint derived from a
  // configuration the library has already judged unusable — and with no discrete
  // fields present, falling back and withholding look identical.
  it('withholds rather than falling back to discrete fields on a malformed URL', () => {
    const options = applyDefaults({ connection: { host: 'h' } })
    const service = new CacheStatusService(
      { ping: jest.fn(), info: jest.fn() },
      { ...options, connection: { url: 'not a url', host: 'fallback-host', port: 1234 } },
      resolveAdminOptions({ scopes: SCOPES }),
      new JsonLike()
    )
    expect(service.config().connection).toEqual({ host: null, port: null, isTls: false })
  })

  // A malformed URL yields nulls rather than throwing. A config route that
  // refuses because one field is malformed denies an operator the screen they
  // opened precisely to discover that the field is malformed.
  it('reports nulls rather than throwing on an unparseable URL', () => {
    const options = applyDefaults({ connection: { host: 'h' } })
    const service = new CacheStatusService(
      { ping: jest.fn(), info: jest.fn() },
      { ...options, connection: { url: 'not a url' } },
      resolveAdminOptions({ scopes: SCOPES }),
      new JsonLike()
    )
    expect(service.config().connection).toEqual({ host: null, port: null, isTls: false })
  })

  // A URL naming no port still connects, on the default. Reporting null would
  // hide the endpoint rather than describe it.
  it('reports the default port when the URL names none', () => {
    const service = build(
      { ping: jest.fn(), info: jest.fn() },
      {
        connection: { url: 'redis://redis.internal' }
      }
    )
    expect(service.config().connection).toEqual({
      host: 'redis.internal',
      port: 6379,
      isTls: false
    })
  })

  // A standalone deployment with no connection block cannot be described. It is
  // rejected at wiring by `validateOptions`, so this guards the shape rather
  // than a reachable configuration — and it must report nulls, not throw.
  it('reports nulls when no connection block is present', () => {
    const options = applyDefaults({ connection: { host: 'h' } })
    const service = new CacheStatusService(
      { ping: jest.fn(), info: jest.fn() },
      { ...options, connection: undefined },
      resolveAdminOptions({ scopes: SCOPES }),
      new JsonLike()
    )
    expect(service.config().connection).toEqual({ host: null, port: null, isTls: false })
  })

  // A URL with no host does not describe an endpoint. Measured: `new URL` on a
  // redis:// URL without a host THROWS rather than yielding a blank hostname, so
  // this exercises the malformed-URL path and pins that reading.
  it('reports nulls for a URL with no host', () => {
    const service = build(
      { ping: jest.fn(), info: jest.fn() },
      {
        connection: { url: 'redis://:6379' }
      }
    )
    expect(service.config().connection).toEqual({ host: null, port: null, isTls: false })
  })

  // A discrete block naming neither host nor URL is rejected at wiring by
  // `validateOptions`, so this pins the type conversion rather than a reachable
  // configuration: an absent host becomes null, never the empty string and never
  // an invented default.
  it('maps an absent discrete host to null', () => {
    const options = applyDefaults({ connection: { host: 'h' } })
    const service = new CacheStatusService(
      { ping: jest.fn(), info: jest.fn() },
      { ...options, connection: { port: 6390 } },
      resolveAdminOptions({ scopes: SCOPES }),
      new JsonLike()
    )
    expect(service.config().connection).toEqual({ host: null, port: 6390, isTls: false })
  })

  // The serializer is named, so an operator can see which one is wired without
  // reading the deployment's source.
  it('names the wired serializer', () => {
    expect(build({ ping: jest.fn(), info: jest.fn() }).config().serializer).toBe('JsonLike')
  })

  // Scripts are reported by NAME only. A Lua body is deployment logic and has no
  // business on an operator-facing payload.
  it('reports script names without their bodies', () => {
    const service = build(
      { ping: jest.fn(), info: jest.fn() },
      {
        connection: { host: 'h' },
        scripts: [{ name: 'compareAndSet', lua: 'return redis.call("GET", KEYS[1])' }]
      }
    )
    const config = service.config()
    expect(config.scripts).toEqual(['compareAndSet'])
    expect(JSON.stringify(config)).not.toContain('redis.call')
  })

  // No registered scripts reports an empty list, never null: absence of scripts is
  // a fact, not a failure to look.
  it('reports an empty script list when none are registered', () => {
    expect(build({ ping: jest.fn(), info: jest.fn() }).config().scripts).toEqual([])
  })

  // The remaining wiring an operator asks about, passed through from the
  // resolved options.
  it('reports the namespace wiring and flush policy', () => {
    const service = build(
      { ping: jest.fn(), info: jest.fn() },
      {
        connection: { host: 'h' },
        namespace: 'community-core',
        keySeparator: '|',
        allowFlushInProduction: true
      }
    )
    expect(service.config()).toMatchObject({
      mode: 'standalone',
      namespace: 'community-core',
      keySeparator: '|',
      isFlushAllowedInProduction: true
    })
  })
})
