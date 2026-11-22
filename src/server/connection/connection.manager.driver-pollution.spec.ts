/**
 * What a key planted on `Object.prototype` does to the options of a REAL ioredis client.
 *
 * Layer: server. ioredis merges the options it is given into an ordinary object of its own and reads
 * names the library did not set from it, so a planted `host`, `port`, `tls`, `password`, `username`,
 * `sentinels` or `natMap` would configure the connection. The library gives every driver option name an
 * own key. Nothing here mocks the driver: each name is planted, a client is built through the manager
 * (lazyConnect, never connected) and the options the driver holds must equal those of a build without it.
 * The list of names is checked against the source of the pinned ioredis.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { resolveOptions } from '../config/default-options'
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import { ConnectionManager } from './connection.manager'
import { DRIVER_INSTANCE_NAMES, DRIVER_OPTION_NAMES } from './driver-option-names'

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

/** What the driver holds for every driver option name, on its options and on a cluster's node options. */
function held(make: () => Raw): string {
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
  const text = JSON.stringify(
    { options: read(client.options), nodes: read(client.options['redisOptions']) },
    (_key, value: unknown) => (typeof value === 'function' ? '[function]' : value)
  )
  client.disconnect()
  return text
}

describe.each(Object.keys(SHAPES))('a real ioredis client of the %s options', (shape) => {
  const make = SHAPES[shape] as () => Raw

  // Scenario: another part of the process plants a driver option the library did not set.
  // Rule: the driver holds exactly what it holds without it.
  // A name that is also read off an object the driver creates is refused by the manager when it is
  // planted (see driver-instance-names.spec.ts), so it is not built here.
  it.each(DRIVER_OPTION_NAMES.filter((name) => !DRIVER_INSTANCE_NAMES.includes(name)))(
    'holds the same options when %s is planted',
    (name) => {
      const base = held(make)
      Object.defineProperty(Object.prototype, name, {
        value: 'PLANTED',
        configurable: true,
        writable: true
      })
      try {
        expect([name, held(make)]).toEqual([name, base])
      } finally {
        Reflect.deleteProperty(Object.prototype, name)
      }
    }
  )
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
