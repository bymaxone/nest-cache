/**
 * What a key planted on `Object.prototype` does to the options of a REAL ioredis client.
 *
 * Layer: server. ioredis merges the options it is given into an ordinary object of its own and reads
 * names the library did not set from it, so a planted `host`, `port`, `tls`, `password`, `username`,
 * `sentinels` or `natMap` would configure the connection. The library gives every driver option name an
 * own key. Nothing here mocks the driver: a client is built through the manager (lazyConnect, never
 * connected), each name is planted afterwards and the options the driver holds must not change. The list
 * of names is checked against the source of the pinned ioredis.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { resolveOptions } from '../config/default-options'
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import { ConnectionManager } from './connection.manager'
import { DRIVER_OPTION_NAMES } from './driver-option-names'

type Raw = Record<string, unknown>

const SHAPES: Record<string, () => Raw> = {
  standalone: () => ({ connection: { host: 'h', lazyConnect: true } }),
  standaloneUrl: () => ({ connection: { url: 'redis://h:6379', lazyConnect: true } }),
  sentinel: () => ({
    mode: 'sentinel',
    connection: { lazyConnect: true },
    sentinel: { sentinels: [{ host: 's', port: 26379 }], name: 'm' }
  }),
  cluster: () => ({
    mode: 'cluster',
    cluster: { nodes: [{ host: 'a', port: 7000 }], options: { lazyConnect: true } }
  })
}

/** A client of the options `make` builds, through the manager, and what it holds for every driver option name. */
function clientOf(make: () => Raw): {
  client: { options: Record<string, unknown>; disconnect: () => void }
  held: () => string
} {
  const manager = new ConnectionManager(
    resolveOptions(make() as unknown as BymaxCacheModuleOptions)
  )
  const client = manager.getClient() as unknown as {
    options: Record<string, unknown>
    disconnect: () => void
  }
  const read = (object: unknown): Record<string, unknown> =>
    Object.fromEntries(
      DRIVER_OPTION_NAMES.map((name) => [
        name,
        (object as Record<string, unknown> | undefined)?.[name]
      ])
    )
  return {
    client,
    held: () =>
      JSON.stringify(
        { options: read(client.options), nodes: read(client.options['redisOptions']) },
        (_key, value: unknown) => (typeof value === 'function' ? '[function]' : value)
      )
  }
}

describe.each(Object.keys(SHAPES))('a real ioredis client of the %s options', (shape) => {
  const make = SHAPES[shape] as () => Raw

  // Scenario: a driver option name is planted on Object.prototype AFTER the client was built (the manager
  // refuses to build one while any key is planted, so what is left is what the driver reads from the
  // options it keeps, later, when it reconnects or builds a node client).
  // Rule: the driver holds exactly what it held before, because each of those names has an own key.
  it.each(DRIVER_OPTION_NAMES)('holds the same options when %s is planted later', (name) => {
    const { client, held } = clientOf(make)
    const before = held()
    Object.defineProperty(Object.prototype, name, {
      value: 'PLANTED',
      configurable: true,
      writable: true
    })
    try {
      expect([name, held()]).toEqual([name, before])
    } finally {
      Reflect.deleteProperty(Object.prototype, name)
      client.disconnect()
    }
  })
})

/** Every `.js` file under `directory`. */
function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    return statSync(path).isDirectory() ? sources(path) : path.endsWith('.js') ? [path] : []
  })
}

/**
 * Names the driver reads off an `options` object that are not client options: the options of a single
 * command or of the one-off helpers (`callback`, `errorStack`, `monitor`, `pipeline`, `replyEncoding`,
 * `stringNumbers`), and the pipelining switches of a command queue.
 */
const NOT_CLIENT_OPTIONS = new Set([
  'callback',
  'errorStack',
  'monitor',
  'pipeline',
  'replyEncoding',
  'stringNumbers'
])

describe('the driver option names', () => {
  // Scenario: the pinned ioredis reads a name off its options that the list does not hold (a version
  // that adds an option). Rule: this fails, naming it, until the name is listed.
  it('hold every name the pinned ioredis reads off its options', () => {
    const root = dirname(require.resolve('ioredis/package.json'))
    const read = new Set<string>()
    for (const file of sources(join(root, 'built'))) {
      for (const match of readFileSync(file, 'utf8').matchAll(/\boptions\.([A-Za-z_]+)/g)) {
        read.add(match[1] as string)
      }
    }
    const missing = [...read].filter(
      (name) => !DRIVER_OPTION_NAMES.includes(name) && !NOT_CLIENT_OPTIONS.has(name)
    )

    expect(missing).toEqual([])
  })
})
