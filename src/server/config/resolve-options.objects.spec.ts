/**
 * The object entries of `tls.key` and `tls.pfx`, a script given as an array, a `natMap` of the wrong
 * kind, and a script text made of invisible characters.
 *
 * Layer: server. The driver merges the `tls` object into the connection options on every reconnect, so
 * a `{ pem, passphrase }` entry left by reference lets a host that swaps its bytes later change the
 * identity the client presents. Each such entry is copied by name, and a form the library cannot hold
 * to a rule is refused as INVALID_OPTIONS when the options are resolved.
 */
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import { resolveOptions } from './default-options'

type Tls = Record<string, unknown>

const resolve = (options: Record<string, unknown>): BymaxCacheModuleOptions =>
  resolveOptions(options as unknown as BymaxCacheModuleOptions) as BymaxCacheModuleOptions

/** The tls object the options hand on for a standalone `tls`. */
const heldTls = (tls: unknown): Tls =>
  (resolve({ connection: { host: 'h', tls } }).connection as { tls: Tls }).tls

/** The refusal a call is expected to throw: the exact reason. */
const refusing = (reason: string): Error =>
  expect.objectContaining({
    code: 'cache.invalid_options',
    details: expect.objectContaining({ reason })
  }) as Error

describe.each([
  ['key', 'pem'],
  ['pfx', 'buf']
])('an object entry of tls.%s', (key, bytes) => {
  // Scenario: the host swaps the bytes, or the entry's fields, after the options are resolved.
  // Rule: the entry the driver holds is a copy with the bytes that were read.
  it('keeps the bytes and the passphrase that were read', () => {
    const material = Buffer.from('identity')
    const entry: Record<string, unknown> = { [bytes]: material, passphrase: 'first' }
    const held = heldTls({ [key]: [entry] })
    material.fill(0)
    entry[bytes] = 'attacker'
    entry['passphrase'] = 'later'
    const heldEntry = (held[key] as Array<Record<string, unknown>>)[0] as Record<string, unknown>

    expect(heldEntry).not.toBe(entry)
    expect(Buffer.from(heldEntry[bytes] as Buffer).toString()).toBe('identity')
    expect(heldEntry['passphrase']).toBe('first')
  })

  it('is read once per field, by name, from a get-only proxy over an empty target', () => {
    const reads: string[] = []
    const entry = new Proxy(
      {},
      {
        get: (_t, name) => {
          reads.push(String(name))
          return ({ [bytes]: 'pem-text', passphrase: 'p' } as Record<string, unknown>)[String(name)]
        }
      }
    )

    const held = heldTls({ [key]: [entry] })[key] as Array<Record<string, unknown>>

    expect(held[0]).toEqual({ [bytes]: 'pem-text', passphrase: 'p' })
    expect(reads.filter((name) => name === bytes)).toHaveLength(1)
    expect(reads.filter((name) => name === 'passphrase')).toHaveLength(1)
  })

  // Scenario: an entry carries a key the driver does not read, or a passphrase that is not a string.
  it('refuses another key and a passphrase that is not a string', () => {
    expect(() => heldTls({ [key]: [{ [bytes]: 'x', extra: 1 }] })).toThrow(
      refusing(`tls.${key}[0] has a key that is not ${bytes} or passphrase`)
    )
    expect(() => heldTls({ [key]: [{ [bytes]: 'x', passphrase: 5 }] })).toThrow(
      expect.objectContaining({
        details: expect.objectContaining({
          reason: `tls.${key}[0].passphrase must be a string`,
          received: 'a number'
        })
      })
    )
  })

  it('keeps an entry that is not a plain object, such as a key object, as it is', () => {
    class KeyObjectLike {}
    const entry = new KeyObjectLike()

    expect((heldTls({ [key]: [entry] })[key] as unknown[])[0]).toBe(entry)
  })
})

describe('a script given as an array', () => {
  it('is refused, even with a name and a source on it', () => {
    const entry = Object.assign([], { name: 'a', lua: 'return 1' })

    for (const definition of [[], entry]) {
      expect(() => resolve({ connection: { host: 'h' }, scripts: [definition] })).toThrow(
        refusing('scripts[0] must be an object')
      )
    }
  })
})

describe('a natMap of the wrong kind', () => {
  const map = (natMap: unknown): Record<string, unknown> => ({
    mode: 'sentinel',
    sentinel: { sentinels: [{ host: 's', port: 1 }], name: 'm', natMap }
  })
  const where: Array<[string, (natMap: unknown) => Record<string, unknown>]> = [
    ['sentinel.natMap', map],
    [
      'cluster.options.natMap',
      (natMap) => ({
        mode: 'cluster',
        cluster: { nodes: [{ host: 'a', port: 7000 }], options: { natMap } }
      })
    ],
    [
      'cluster.options.redisOptions.natMap',
      (natMap) => ({
        mode: 'cluster',
        cluster: { nodes: [{ host: 'a', port: 7000 }], options: { redisOptions: { natMap } } }
      })
    ]
  ]

  it.each(where)('%s accepts an object, a function and nothing', (_option, make) => {
    expect(() => resolve(make({ 'a:1': { host: 'b', port: 2 } }))).not.toThrow()
    expect(() => resolve(make((): void => undefined))).not.toThrow()
    expect(() => resolve(make(undefined))).not.toThrow()
  })

  it.each(where)('%s refuses an array, a string and a number', (option, make) => {
    for (const natMap of [[], 'a:1', 5]) {
      expect(() => resolve(make(natMap))).toThrow(
        refusing(`${option} must be an object or a function`)
      )
    }
  })
})

describe('a script text made of invisible characters', () => {
  it.each([
    ['a zero-width space', '​'],
    ['a zero-width joiner among blanks', ' ‍ ⁠﻿ '],
    ['a word joiner', '⁠']
  ])('refuses %s as a name or a source', (_label, blank) => {
    expect(() =>
      resolve({ connection: { host: 'h' }, scripts: [{ name: blank, lua: 'return 1' }] })
    ).toThrow(refusing('scripts[0].name must be a non-empty string'))
    expect(() =>
      resolve({ connection: { host: 'h' }, scripts: [{ name: 'a', lua: blank }] })
    ).toThrow(refusing('scripts[0].lua must be a non-empty string'))
  })

  it('accepts a text with a visible character among them', () => {
    expect(() =>
      resolve({ connection: { host: 'h' }, scripts: [{ name: '​a', lua: 'return 1' }] })
    ).not.toThrow()
  })
})
