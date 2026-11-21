/**
 * Single read of every option block, with a getter that answers differently on each read.
 *
 * Layer: server. A host option can be a getter: a secret that is wiped after its first use, a lazy
 * loader. The library must read each such property once and build the client from that value, or a
 * later read that answers `undefined` silently drops a credential, a tls setting or a url. Every row
 * puts a getter on one option that answers with its real value on the first read and with nothing on
 * every later one, builds the client through `createConnectionManager`, and asserts the client holds
 * the first answer.
 */
import { Redis } from 'ioredis'
import type { Cluster } from 'ioredis'

import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import { createConnectionManager } from '../connection/create-connection-manager'

/** A plain object whose `key` answers `good` once and `decoy` (default `undefined`) ever after. */
function flipping<T extends object>(target: T, key: string, good: unknown, decoy?: unknown): T {
  let reads = 0
  Object.defineProperty(target, key, {
    enumerable: true,
    configurable: true,
    get: (): unknown => (reads++ === 0 ? good : decoy)
  })
  return target
}

/** Builds the client the options describe, without connecting. */
function clientOf(options: Record<string, unknown>): Redis | Cluster {
  return createConnectionManager(options as BymaxCacheModuleOptions).getClient()
}

/** The options a standalone or sentinel client holds. */
function redisOptions(client: Redis | Cluster): Record<string, unknown> {
  return client.options as unknown as Record<string, unknown>
}

/** The options a cluster hands to each node. */
function nodeOptions(client: Redis | Cluster): Record<string, unknown> {
  return (client.options as unknown as { redisOptions: Record<string, unknown> }).redisOptions
}

const TLS = { servername: 'redis.internal' }
const NODES = [{ host: 'a', port: 7000 }]
const SENTINELS = [{ host: 's', port: 26379 }]

/** A standalone set whose `connection` carries `key` as a flipping getter. */
const standalone = (key: string, good: unknown): Record<string, unknown> => ({
  connection: flipping({ host: 'h', port: 6379, lazyConnect: true }, key, good)
})

/** A sentinel set whose `sentinel` block carries `key` as a flipping getter. */
const sentinel = (key: string, good: unknown): Record<string, unknown> => ({
  mode: 'sentinel',
  connection: { password: 'data-node-password', lazyConnect: true },
  sentinel: flipping({ sentinels: SENTINELS, name: 'master' }, key, good)
})

/** A cluster set whose `cluster.options.redisOptions` carries `key` as a flipping getter. */
const clusterNode = (key: string, good: unknown): Record<string, unknown> => ({
  mode: 'cluster',
  cluster: {
    nodes: NODES,
    options: { lazyConnect: true, redisOptions: flipping({}, key, good) }
  }
})

describe('options read once, under a getter that answers differently on each read', () => {
  // Scenario: standalone `connection.<key>` answers once, then `undefined`.
  // Rule: the client holds the first answer, so a wiped secret or url never downgrades the connection.
  it.each([
    ['tls', TLS, 'tls'],
    ['password', 'secret', 'password'],
    ['username', 'cache-user', 'username'],
    ['db', 5, 'db'],
    ['host', 'redis.internal', 'host'],
    ['port', 6380, 'port']
  ])('standalone connection.%s', (key, good, optionName) => {
    const client = clientOf(standalone(key, good))

    expect(redisOptions(client)[optionName]).toEqual(good)
    client.disconnect()
  })

  // Scenario: `connection.url` answers once, then `undefined`.
  // Rule: the url still names the endpoint, the database, the credential and the transport.
  it('standalone connection.url', () => {
    const client = clientOf(standalone('url', 'rediss://:from-url@url-host:6381/2'))

    expect(redisOptions(client)).toMatchObject({
      host: 'url-host',
      port: 6381,
      db: 2,
      password: 'from-url'
    })
    expect(redisOptions(client)['tls']).toBeDefined()
    client.disconnect()
  })

  // Scenario: standalone `connection.connectTimeout` answers once, then `undefined`.
  // Rule: the client timer is the first answer, the one the boot wait uses.
  it('standalone connection.connectTimeout', () => {
    const client = clientOf(standalone('connectTimeout', 1234))

    expect(redisOptions(client)['connectTimeout']).toBe(1234)
    client.disconnect()
  })

  // Scenario: sentinel-mode options answer once, then `undefined`.
  // Rule: each reaches the client, and none falls back to another credential.
  it.each([
    ['sentinel.password', 'password', 'sentinel-password', 'password'],
    ['sentinel.sentinelPassword', 'sentinelPassword', 'sentinels-own', 'sentinelPassword'],
    ['sentinel.natMap', 'natMap', { 'a:1': { host: 'b', port: 2 } }, 'natMap'],
    ['sentinel.name', 'name', 'master', 'name'],
    ['sentinel.sentinels', 'sentinels', SENTINELS, 'sentinels']
  ])('%s', (_label, key, good, optionName) => {
    const client = clientOf(sentinel(key, good))

    expect(redisOptions(client)[optionName]).toEqual(good)
    client.disconnect()
  })

  // Scenario: the sentinel role answers once, then `undefined`.
  // Rule: the replica role reaches the driver as its wire name.
  it('sentinel.role', () => {
    const client = clientOf(sentinel('role', 'replica'))

    expect(redisOptions(client)['role']).toBe('slave')
    client.disconnect()
  })

  // Scenario: tls for the data nodes answers once, then `undefined`, in sentinel mode.
  // Rule: the sentinels talk tls too, from the same first answer.
  it('sentinel connection.tls covers the sentinels', () => {
    const client = clientOf({
      mode: 'sentinel',
      connection: flipping({ lazyConnect: true }, 'tls', TLS),
      sentinel: { sentinels: SENTINELS, name: 'master' }
    })

    expect(redisOptions(client)).toMatchObject({
      tls: TLS,
      sentinelTLS: TLS,
      enableTLSForSentinelMode: true
    })
    client.disconnect()
  })

  // Scenario: cluster node options answer once, then `undefined`.
  // Rule: each reaches the nodes; a cluster has no other place to take a credential from.
  it.each([
    ['tls', TLS],
    ['password', 'cluster-secret'],
    ['username', 'cluster-user'],
    ['db', 3],
    ['connectTimeout', 1234]
  ])('cluster redisOptions.%s', (key, good) => {
    const client = clientOf(clusterNode(key, good))

    expect(nodeOptions(client)[key]).toEqual(good)
    client.disconnect()
  })

  // Scenario: the cluster blocks themselves answer once, then `undefined`.
  // Rule: the options, their node options and the node list are each read once.
  it.each([
    ['options', 'options'],
    ['nodes', 'nodes']
  ])('cluster.%s', (key) => {
    const good = key === 'nodes' ? NODES : { lazyConnect: true, redisOptions: { password: 'kept' } }
    const base = {
      nodes: NODES,
      options: { lazyConnect: true, redisOptions: { password: 'kept' } }
    }
    const client = clientOf({ mode: 'cluster', cluster: flipping(base, key, good) })

    expect(nodeOptions(client)['password']).toBe('kept')
    client.disconnect()
  })

  // Scenario: the node options object answers once, then `undefined`.
  // Rule: it is read once, so its credential survives.
  it('cluster.options.redisOptions as a whole', () => {
    const good = { password: 'kept', username: 'u' }
    const options = flipping({ lazyConnect: true }, 'redisOptions', good)
    const client = clientOf({ mode: 'cluster', cluster: { nodes: NODES, options } })

    expect(nodeOptions(client)).toMatchObject(good)
    client.disconnect()
  })

  // Scenario: `cluster.options.natMap` answers once, then `undefined`.
  // Rule: the address translation reaches the cluster client.
  it('cluster.options.natMap', () => {
    const natMap = { 'a:1': { host: 'b', port: 2 } }
    const options = flipping({ lazyConnect: true }, 'natMap', natMap)
    const client = clientOf({ mode: 'cluster', cluster: { nodes: NODES, options } })

    expect((client.options as unknown as { natMap: unknown }).natMap).toEqual(natMap)
    client.disconnect()
  })

  // Scenario: the `tls` object has a getter that throws, which the driver reads while it constructs.
  // Rule: the host's error never escapes raw: it ends as `CONNECTION_FAILED` with the error as cause.
  it.each([
    ['standalone', { connection: { host: 'h', lazyConnect: true } }],
    [
      'sentinel',
      {
        mode: 'sentinel',
        connection: { lazyConnect: true },
        sentinel: { sentinels: SENTINELS, name: 'master' }
      }
    ]
  ])('a throwing tls.profile in %s mode', (_mode, base) => {
    const host = new Error('host-trap secret=hunter2')
    const tls = {}
    Object.defineProperty(tls, 'profile', {
      enumerable: true,
      get: (): never => {
        throw host
      }
    })
    const options = { ...base, connection: { ...base.connection, tls } }

    const thrown = ((): unknown => {
      try {
        clientOf(options)
      } catch (error) {
        return error
      }
      return undefined
    })()

    expect(thrown).toMatchObject({
      code: 'cache.connection_failed',
      details: { reason: 'client_construction_failed' },
      cause: host
    })
  })

  // Scenario: the first answer is valid and every later one is a different, also usable value.
  // Rule: the client is built from the value that was validated, never from a later answer.
  it.each([
    ['url', 'redis://:first@first-host:6390/1', 'redis://:later@later-host:6391/2'],
    ['password', 'first', 'later'],
    ['tls', { servername: 'first' }, { servername: 'later' }]
  ])('standalone connection.%s keeps the validated value', (key, good, decoy) => {
    const connection = flipping({ host: 'h', lazyConnect: true }, key, good, decoy)
    const client = clientOf({ connection })
    const used = redisOptions(client)

    expect(key === 'url' ? used['host'] : used[key]).toEqual(key === 'url' ? 'first-host' : good)
    client.disconnect()
  })

  it.each([
    ['sentinelPassword', 'first', 'later'],
    ['natMap', { 'a:1': { host: 'first', port: 1 } }, { 'a:1': { host: 'later', port: 2 } }]
  ])('sentinel.%s keeps the validated value', (key, good, decoy) => {
    const block = flipping({ sentinels: SENTINELS, name: 'master' }, key, good, decoy)
    const client = clientOf({
      mode: 'sentinel',
      connection: { lazyConnect: true },
      sentinel: block
    })

    expect(redisOptions(client)[key]).toEqual(good)
    client.disconnect()
  })

  // Scenario: each block is a Proxy over an empty target that answers only `get`.
  // Rule: the block is read by name, so nothing is skipped for lacking own keys or a plain prototype.
  it('reads blocks by name when they are get-only proxies over empty targets', () => {
    const get = (values: Record<string, unknown>) =>
      new Proxy({}, { get: (_t, key) => values[String(key)] })
    const client = clientOf({
      mode: 'sentinel',
      connection: get({ lazyConnect: true, password: 'data' }),
      sentinel: get({ sentinels: SENTINELS, name: 'master', sentinelPassword: 'sp' })
    })

    expect(redisOptions(client)).toMatchObject({ password: 'data', sentinelPassword: 'sp' })
    client.disconnect()
  })
})
