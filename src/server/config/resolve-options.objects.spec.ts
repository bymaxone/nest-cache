/**
 * The object entries of `tls.key` and `tls.pfx`, a script given as an array, a `natMap` of the wrong
 * kind, and a script text made of invisible characters.
 *
 * Layer: server. The driver merges the `tls` object into the connection options on every reconnect, so
 * a `{ pem, passphrase }` entry left by reference lets a host that swaps its bytes later change the
 * identity the client presents. Each such entry is copied by name, and a form the library cannot hold
 * to a rule is refused as INVALID_OPTIONS when the options are resolved.
 */
import { createSecretKey } from 'node:crypto'

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

  // Scenario: the host leaves the passphrase out, as most keys do.
  // Rule: the held entry is accepted and carries no passphrase key at all, not an undefined one.
  it('accepts an entry without a passphrase and holds none', () => {
    const held = heldTls({ [key]: [{ [bytes]: 'x' }] })[key] as Array<Record<string, unknown>>

    expect(Object.keys(held[0] as object)).toEqual([bytes])
  })

  // Scenario: the entry has no prototype, as Object.create(null) or a parsed config gives.
  // Rule: it is a plain object like any other: copied, so a later change of it does not reach the held tls.
  it('copies an entry with a null prototype', () => {
    const entry: Record<string, unknown> = Object.assign(Object.create(null) as object, {
      [bytes]: 'first',
      passphrase: 'p'
    })
    const held = heldTls({ [key]: [entry] })[key] as Array<Record<string, unknown>>
    entry[bytes] = 'later'

    expect(held[0]).not.toBe(entry)
    expect(held[0]).toEqual({ [bytes]: 'first', passphrase: 'p' })
  })

  // Scenario: the entry is a class instance or an object with a prototype, its fields served by getters.
  // Rule: only a real KeyObject stays by reference; every other object is read by name and copied, so
  // a getter that answers differently on a later reconnect never reaches the driver.
  it.each([
    [
      'a class instance',
      (live: () => string): object =>
        new (class {
          get [bytes](): string {
            return live()
          }
          get passphrase(): string {
            return 'p'
          }
        })()
    ],
    [
      'an object made over a prototype',
      (live: () => string): object =>
        Object.create(
          Object.defineProperties(
            {},
            { [bytes]: { get: live }, passphrase: { get: () => 'p' } }
          ) as object
        ) as object
    ]
  ])('copies %s whose fields are getters', (_label, make) => {
    let answer = 'first'
    const entry = make(() => answer)
    const held = heldTls({ [key]: [entry] })[key] as Array<Record<string, unknown>>
    answer = 'later'

    expect(held[0]).not.toBe(entry)
    expect(held[0]).toEqual({ [bytes]: 'first', passphrase: 'p' })
  })

  // Scenario: an entry has no bytes: only a passphrase, or a proxy over a key object (which no check can see through).
  // Rule: it is refused at boot, naming the entry, rather than held as an entry with undefined bytes that
  // the driver would refuse late.
  it('refuses an entry that holds no bytes', () => {
    const throughProxy = new Proxy(createSecretKey(Buffer.from('secret')), {})

    for (const entry of [{ passphrase: 'p' }, {}, new Map(), new Date(0), throughProxy]) {
      expect(() => heldTls({ [key]: [entry] })).toThrow(refusing(`tls.${key}[0] has no ${bytes}`))
    }
  })

  // Scenario: a list of key material holds a list.
  // Rule: it is refused naming the entry: the driver takes bytes, a string or an object there, not a list.
  it('refuses a list inside the list', () => {
    expect(() => heldTls({ [key]: [['nested']] })).toThrow(
      refusing(`tls.${key}[0] must not be a list`)
    )
  })

  // Scenario: the bytes of an entry are not bytes: null, a number, an object, a boolean.
  // Rule: refused naming the field, as only bytes or a string reach the driver there.
  it.each([null, 5, {}, true, [1]])('refuses %p as the bytes of an entry', (value) => {
    expect(() => heldTls({ [key]: [{ [bytes]: value }] })).toThrow(
      refusing(`tls.${key}[0].${bytes} must be bytes or a string`)
    )
  })

  it('keeps a key object as it is', () => {
    const entry = createSecretKey(Buffer.from('secret'))

    expect((heldTls({ [key]: [entry] })[key] as unknown[])[0]).toBe(entry)
  })
})

// Scenario: the tls option holds session material the driver reads again on every reconnect.
// Rule: every byte option is copied, so a change of the host's buffer afterwards changes nothing.
describe.each(['ticketKeys', 'session', 'dhparam', 'ALPNProtocols'])('tls.%s', (name) => {
  it('is copied when it is a buffer', () => {
    const material = Buffer.from('material')
    const held = heldTls({ [name]: material })[name] as Buffer
    material.fill(0)

    expect(held).not.toBe(material)
    expect(Buffer.from(held).toString()).toBe('material')
  })

  it('is kept when it is a string', () => {
    expect(heldTls({ [name]: 'text' })[name]).toBe('text')
  })
})

// Scenario: the host hands a SharedArrayBuffer, which another thread can write to after boot.
// Rule: it is copied into a Buffer of its own, like any other view of bytes.
describe.each(['ca', 'cert', 'ticketKeys', 'key', 'pfx'])(
  'a SharedArrayBuffer given as tls.%s',
  (name) => {
    it('is copied', () => {
      const shared = new SharedArrayBuffer(4)
      new Uint8Array(shared).set([1, 2, 3, 4])
      const held = heldTls({ [name]: shared })[name] as Buffer
      new Uint8Array(shared).fill(0)

      expect(Buffer.isBuffer(held)).toBe(true)
      expect([...held]).toEqual([1, 2, 3, 4])
    })
  }
)

describe('tls.ALPNProtocols as a list', () => {
  it('is copied by position', () => {
    const list = ['h2', 'http/1.1']
    const held = heldTls({ ALPNProtocols: list })['ALPNProtocols'] as string[]
    list[0] = 'x'

    expect(held).toEqual(['h2', 'http/1.1'])
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

  it.each(where)('%s accepts an object, a function and null and nothing', (_option, make) => {
    expect(() => resolve(make({ 'a:1': { host: 'b', port: 2 } }))).not.toThrow()
    expect(() => resolve(make((): void => undefined))).not.toThrow()
    expect(() => resolve(make(undefined))).not.toThrow()
    expect(() => resolve(make(null))).not.toThrow()
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
    ['a word joiner', '⁠'],
    ['a mongolian vowel separator', '᠎'],
    ['a soft hyphen', '­'],
    ['the direction marks', '‎‏'],
    ['a hangul filler', 'ㅤ'],
    ['a braille blank', '⠀'],
    ['a next line', ''],
    ['a control character', ''],
    ['a delete and an application program command', ''],
    ['an object replacement character', '￼'],
    ['an interlinear annotation anchor', '￹'],
    ['an arabic letter mark', '؜'],
    ['an arabic number sign', '؀'],
    ['a tab, a carriage return and a line feed', '\t\r\n']
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

describe('cluster.options.scaleReads', () => {
  const cluster = (options: Record<string, unknown>): Record<string, unknown> => ({
    mode: 'cluster',
    cluster: { nodes: [{ host: 'a', port: 7000 }], options }
  })

  // Scenario: the host spells scaleReads wrong or gives it a value of another kind.
  // Rule: refused naming the option and the type only, never the driver's own message.
  it.each(['masters', 5, null, {}])(
    'refuses %p, naming the option and printing no value',
    (value) => {
      const error = (() => {
        try {
          resolve(cluster({ scaleReads: value }))
        } catch (thrown) {
          return thrown as { details: Record<string, unknown> }
        }
        throw new Error('not refused')
      })()

      expect(error.details['reason']).toBe(
        "cluster.options.scaleReads must be 'all', 'master', 'slave' or a function"
      )
      expect(JSON.stringify(error.details)).not.toContain('masters')
    }
  )

  it.each(['all', 'master', 'slave', (): string => 'all'])('accepts %p', (value) => {
    expect(() => resolve(cluster({ scaleReads: value }))).not.toThrow()
  })

  it('accepts an absent value', () => {
    expect(() => resolve(cluster({}))).not.toThrow()
  })
})

describe('cluster.options.himportFieldsets', () => {
  const cluster = (himportFieldsets: unknown): Record<string, unknown> => ({
    mode: 'cluster',
    cluster: { nodes: [{ host: 'a', port: 7000 }], options: { himportFieldsets } }
  })
  const held = (himportFieldsets: unknown): unknown[] =>
    (
      resolve(cluster(himportFieldsets)).cluster as unknown as {
        options: { himportFieldsets: unknown[] }
      }
    ).options.himportFieldsets

  // Scenario: the host gives a value that is not a list.
  // Rule: refused naming the option; only a list reaches the driver.
  it.each(['text', 5, {}, true])('refuses %p', (value) => {
    expect(() => resolve(cluster(value))).toThrow(
      refusing('cluster.options.himportFieldsets must be a list')
    )
  })

  // Scenario: the host changes the list or an entry after boot.
  // Rule: the held list is a copy read once; a change afterwards does not reach it.
  it('copies the list and each entry', () => {
    const fields = ['f1']
    const entry = { name: 'n1', fields }
    const list = [entry]
    const result = held(list)
    entry.name = 'later'
    fields[0] = 'later'
    list.push({ name: 'n2', fields: [] })

    expect(result).toEqual([{ name: 'n1', fields: ['f1'] }])
  })

  // Scenario: an entry of the list is not an object: a string, null, a list.
  // Rule: it is kept as it is, for the driver to refuse; the copy neither turns it into an object nor drops it.
  it('keeps an entry that is not an object for the driver to refuse', () => {
    const nested: unknown[] = []

    expect(held(['text', null, nested, 5])).toEqual(['text', null, nested, 5])
  })

  it('accepts an absent list', () => {
    expect(() => resolve(cluster(undefined))).not.toThrow()
  })

  /** The details of the refusal a call throws, for the bound it prints. */
  const refusedWith = (himportFieldsets: unknown): Record<string, unknown> => {
    try {
      resolve(cluster(himportFieldsets))
    } catch (thrown) {
      return (thrown as { details: Record<string, unknown> }).details
    }
    throw new Error('not refused')
  }
  const entries = (count: number): unknown[] =>
    Array.from({ length: count }, (_, index) => ({ name: `n${index}`, fields: [] }))

  // Scenario: the list, or the fields of an entry, holds more than 1 000 entries.
  // Rule: refused before any is copied, naming the list and printing the count and the bound; 1 000 pass.
  it('refuses a list of 1 001 entries, naming it and the bound', () => {
    expect(refusedWith(entries(1001))).toMatchObject({
      reason: 'cluster.options.himportFieldsets has too many entries',
      received: 1001,
      max: 1000
    })
  })

  it('refuses the fields of an entry past 1 000, naming them and the bound', () => {
    expect(refusedWith([{ name: 'n', fields: new Array(1001).fill('f') }])).toMatchObject({
      reason: 'cluster.options.himportFieldsets[].fields has too many entries',
      received: 1001,
      max: 1000
    })
  })

  it('accepts 1 000 entries and 1 000 fields', () => {
    expect(() => resolve(cluster(entries(1000)))).not.toThrow()
    expect(() => resolve(cluster([{ name: 'n', fields: new Array(1000).fill('f') }]))).not.toThrow()
  })

  // Scenario: a hole, or an undefined, in the list or in the fields.
  // Rule: refused by position, never dropped or turned into an entry the driver would skip.
  it('refuses a hole and an undefined in the list and in the fields', () => {
    const sparse: unknown[] = new Array<unknown>(3)
    sparse[0] = { name: 'a', fields: [] }
    sparse[2] = { name: 'b', fields: [] }

    expect(() => resolve(cluster(sparse))).toThrow(
      refusing('cluster.options.himportFieldsets[1] must not be empty')
    )
    expect(() => resolve(cluster([undefined]))).toThrow(
      refusing('cluster.options.himportFieldsets[0] must not be empty')
    )
    expect(() => resolve(cluster([{ name: 'a', fields: ['f', undefined] }]))).toThrow(
      refusing('cluster.options.himportFieldsets[].fields[1] must not be empty')
    )
  })
})

describe('cluster.options.scripts', () => {
  const cluster = (scripts: unknown): Record<string, unknown> => ({
    mode: 'cluster',
    cluster: { nodes: [{ host: 'a', port: 7000 }], options: { scripts } }
  })
  const definitions = (count: number): Record<string, unknown> =>
    Object.fromEntries(Array.from({ length: count }, (_, i) => [`s${i}`, { lua: 'return 1' }]))

  // Scenario: the map holds more than 1 000 scripts.
  // Rule: refused before any definition is read, naming the map and printing the count and the bound.
  it('refuses 1 001 scripts, naming the map and the bound', () => {
    const details = (() => {
      try {
        resolve(cluster(definitions(1001)))
      } catch (thrown) {
        return (thrown as { details: Record<string, unknown> }).details
      }
      throw new Error('not refused')
    })()

    expect(details).toMatchObject({
      reason: 'cluster.options.scripts has too many entries',
      received: 1001,
      max: 1000
    })
  })

  // Scenario: a definition of the map is not an object: a string, null, a number.
  // Rule: it is kept as it is, for the driver to refuse; the copy neither turns it into an object nor drops it.
  it('keeps a definition that is not an object for the driver to refuse', () => {
    const held = (
      resolve(cluster({ a: 'text', b: null, c: 5 })).cluster as unknown as {
        options: { scripts: Record<string, unknown> }
      }
    ).options.scripts

    expect(held).toEqual({ a: 'text', b: null, c: 5 })
  })

  it('accepts 1 000 scripts', () => {
    expect(() => resolve(cluster(definitions(1000)))).not.toThrow()
  })
})
