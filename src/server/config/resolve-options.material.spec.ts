/**
 * The key material of a `tls` object (`ca`, `cert`, `key`, `pfx`, `crl`) is copied, not shared.
 *
 * Layer: server. The driver merges the `tls` object into the connection options on every connect and
 * reconnect, so an array the host pushes into, or a `Buffer` it overwrites, after the options are
 * resolved would change the trust roots or the identity of the next reconnect. Each array is read once
 * (length first, each index once) and every `Buffer` is copied. The same rows pin that a `null` tls and
 * a few forms that must stay accepted are handled as the checks say.
 */
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import { resolveOptions } from './default-options'

type Tls = Record<string, unknown>

/** The tls object the options hand on for a standalone `tls`. */
const heldTls = (tls: unknown): Tls =>
  (
    resolveOptions({ connection: { host: 'h', tls } } as unknown as BymaxCacheModuleOptions)
      .connection as { tls: Tls }
  ).tls

/** The refusal a call is expected to throw: the exact reason. */
const refusing = (reason: string): Error =>
  expect.objectContaining({
    code: 'cache.invalid_options',
    details: expect.objectContaining({ reason })
  }) as Error

const KEYS = ['ca', 'cert', 'key', 'pfx', 'crl'] as const

describe.each(KEYS)('tls.%s', (key) => {
  // Scenario: the host pushes into the array after the options are resolved.
  // Rule: what the driver holds is the list that was read, not the host's array.
  it('keeps the list that was read when the host pushes into it later', () => {
    const list = ['first']
    const held = heldTls({ [key]: list })
    list.push('later')

    expect(held[key]).toEqual(['first'])
  })

  // Scenario: the host overwrites a Buffer after the options are resolved, as a value and as an element.
  // Rule: the bytes the driver holds are the bytes that were read.
  it('keeps the bytes of a Buffer overwritten later', () => {
    const buffer = Buffer.from('trusted')
    const element = Buffer.from('trusted')
    const held = heldTls({ [key]: buffer })
    const heldList = heldTls({ [key]: [element] })
    buffer.fill(0)
    element.fill(0)

    expect((held[key] as Buffer).toString()).toBe('trusted')
    expect(((heldList[key] as Buffer[])[0] as Buffer).toString()).toBe('trusted')
  })

  // Scenario: the host overwrites a Uint8Array, a DataView or an ArrayBuffer after the options are resolved,
  // as a value and as an element.
  // Rule: any view of bytes the driver accepts is copied, so the bytes it holds are the bytes that were read.
  it.each([
    [
      'a Uint8Array',
      (bytes: Uint8Array): unknown => bytes,
      (bytes: Uint8Array): void => {
        bytes.fill(0)
      }
    ],
    [
      'a DataView',
      (bytes: Uint8Array): unknown =>
        new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      (bytes: Uint8Array): void => {
        bytes.fill(0)
      }
    ],
    [
      'an ArrayBuffer',
      (bytes: Uint8Array): unknown =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      (): void => undefined
    ]
  ])('keeps the bytes of %s overwritten later', (label, wrap, overwrite) => {
    const text = 'trusted'
    const whole = new Uint8Array(Buffer.from(text))
    const element = new Uint8Array(Buffer.from(text))
    const wholeValue = wrap(whole)
    const elementValue = wrap(element)
    const held = heldTls({ [key]: wholeValue })
    const heldList = heldTls({ [key]: [elementValue] })
    overwrite(whole)
    overwrite(element)
    if (label === 'an ArrayBuffer') {
      new Uint8Array(wholeValue as ArrayBuffer).fill(0)
      new Uint8Array(elementValue as ArrayBuffer).fill(0)
    }

    expect(Buffer.from(held[key] as Uint8Array).toString()).toBe(text)
    expect(Buffer.from((heldList[key] as Uint8Array[])[0] as Uint8Array).toString()).toBe(text)
  })

  // Scenario: the length of the array answers 1 once and 0 afterwards, and an index answers once.
  // Rule: the length and each index are read once.
  it('reads the length and each index once', () => {
    let lengthReads = 0
    let indexReads = 0
    const list = new Proxy(['first'], {
      get: (target, name, receiver): unknown => {
        if (name === 'length') {
          return lengthReads++ === 0 ? 1 : 0
        }
        if (name === '0') {
          return indexReads++ === 0 ? 'first' : 'later'
        }
        return Reflect.get(target, name, receiver)
      }
    })

    expect(heldTls({ [key]: list })[key]).toEqual(['first'])
    expect([lengthReads, indexReads]).toEqual([1, 1])
  })

  // Scenario: the array is longer than the cap, or its length is not a count.
  it('refuses a list of 1001 entries and a length that is not a count', () => {
    expect(() => heldTls({ [key]: new Array<string>(1001).fill('x') })).toThrow(
      refusing(`tls.${key} has too many entries`)
    )
    const claiming = new Proxy(['x'], {
      get: (target, name, receiver): unknown =>
        name === 'length' ? Number.NaN : Reflect.get(target, name, receiver)
    })
    expect(() => heldTls({ [key]: claiming })).toThrow(refusing(`tls.${key} has an invalid length`))
  })

  it('accepts a string and a list of 1000 entries', () => {
    expect(heldTls({ [key]: 'pem' })[key]).toBe('pem')
    expect(heldTls({ [key]: new Array<string>(1000).fill('x') })[key]).toHaveLength(1000)
  })
})

describe('the same material in the other tls objects', () => {
  it('copies the key material of the cluster node tls and of sentinelTLS', () => {
    const ca = ['first']
    const sentinelCa = ['first']
    const resolved = resolveOptions({
      mode: 'cluster',
      cluster: {
        nodes: [{ host: 'a', port: 7000 }],
        options: { redisOptions: { tls: { ca }, sentinelTLS: { ca: sentinelCa } } }
      }
    } as unknown as BymaxCacheModuleOptions)
    ca.push('later')
    sentinelCa.push('later')
    const node = resolved.cluster?.options?.redisOptions as { tls: Tls; sentinelTLS: Tls }

    expect([node.tls['ca'], node.sentinelTLS['ca']]).toEqual([['first'], ['first']])
  })
})

describe('a null tls', () => {
  // Rule: `null` reaches the driver as no tls at all, so it is refused where the others are.
  it('is refused for connection.tls and for the cluster node tls', () => {
    expect(() =>
      resolveOptions({ connection: { host: 'h', tls: null } } as unknown as BymaxCacheModuleOptions)
    ).toThrow(refusing('connection.tls must not be null'))
    expect(() =>
      resolveOptions({
        mode: 'cluster',
        cluster: {
          nodes: [{ host: 'a', port: 7000 }],
          options: { redisOptions: { tls: null } }
        }
      } as unknown as BymaxCacheModuleOptions)
    ).toThrow(refusing('cluster.options.redisOptions.tls must not be null'))
  })
})
