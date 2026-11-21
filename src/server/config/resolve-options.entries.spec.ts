/**
 * The entries of the lists the driver walks, the text of a script, and a null sentinel-side tls.
 *
 * Layer: server. An array given as an entry of `sentinels`, `cluster.nodes`, a `natMap` or `scripts` is
 * neither an address nor a definition and would reach the driver or the registry as it is; a name or a
 * source made of blanks is as empty as an empty one; a `null` sentinel-side tls reaches the driver as
 * no tls at all, like a `null` tls. Each is refused as INVALID_OPTIONS when the options are resolved.
 */
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import { resolveOptions } from './default-options'

const resolve = (options: Record<string, unknown>): unknown =>
  resolveOptions(options as unknown as BymaxCacheModuleOptions)

/** The refusal a call is expected to throw: the exact reason. */
const refusing = (reason: string): Error =>
  expect.objectContaining({
    code: 'cache.invalid_options',
    details: expect.objectContaining({ reason })
  }) as Error

const sentinel = (sentinels: unknown[]): Record<string, unknown> => ({
  mode: 'sentinel',
  sentinel: { sentinels, name: 'master' }
})
const cluster = (nodes: unknown[]): Record<string, unknown> => ({
  mode: 'cluster',
  cluster: { nodes }
})

describe('the entries of sentinels and cluster.nodes', () => {
  // Scenario: an entry is an address, a host and port as a string, or a port number.
  it.each([
    ['a sentinel address', sentinel([{ host: 's', port: 26379 }])],
    ['a node address', cluster([{ host: 'a', port: 7000 }])],
    ['a node as a string', cluster(['a:7000'])],
    ['a node as a port number', cluster([7000])]
  ])('accepts %s', (_label, options) => {
    expect(() => resolve(options)).not.toThrow()
  })

  // Scenario: an entry is an array, a function, a boolean or null.
  // Rule: it is refused naming the entry, so it never reaches the driver.
  it.each([
    ['an array', []],
    ['a function', (): void => undefined],
    ['a boolean', true],
    ['null', null]
  ])('refuses %s as an entry', (_label, entry) => {
    expect(() => resolve(sentinel([entry]))).toThrow(
      refusing('sentinel.sentinels[0] must be an address')
    )
    expect(() => resolve(cluster([{ host: 'a', port: 7000 }, entry]))).toThrow(
      refusing('cluster.nodes[1] must be an address')
    )
  })
})

describe('the entries of a natMap', () => {
  const map = (natMap: unknown): Record<string, unknown> => ({
    mode: 'sentinel',
    sentinel: { sentinels: [{ host: 's', port: 1 }], name: 'master', natMap }
  })

  it('accepts an object entry and a function map', () => {
    expect(() => resolve(map({ 'a:1': { host: 'b', port: 2 } }))).not.toThrow()
    expect(() => resolve(map((): void => undefined))).not.toThrow()
  })

  it.each([
    ['an array', []],
    ['a string', 'b:2'],
    ['null', null]
  ])('refuses %s as an entry', (_label, entry) => {
    expect(() => resolve(map({ 'a:1': entry }))).toThrow(
      refusing('sentinel.natMap[0] must be an address')
    )
  })
})

describe('the text of a script', () => {
  // Scenario: a name or a source made of blanks.
  it.each([
    ['name', { name: '  ', lua: 'return 1' }],
    ['lua', { name: 'a', lua: ' \n\t ' }]
  ])('refuses a %s made of blanks', (field, definition) => {
    expect(() => resolve({ connection: { host: 'h' }, scripts: [definition] })).toThrow(
      refusing(`scripts[0].${field} must be a non-empty string`)
    )
  })

  it('accepts a source with blanks around it', () => {
    expect(() =>
      resolve({ connection: { host: 'h' }, scripts: [{ name: 'a', lua: ' return 1 ' }] })
    ).not.toThrow()
  })
})

describe('a null sentinelTLS', () => {
  it('is refused like a null tls', () => {
    expect(() =>
      resolve({
        mode: 'cluster',
        cluster: {
          nodes: [{ host: 'a', port: 7000 }],
          options: { redisOptions: { sentinelTLS: null } }
        }
      })
    ).toThrow(refusing('cluster.options.redisOptions.sentinelTLS must not be null'))
  })
})
