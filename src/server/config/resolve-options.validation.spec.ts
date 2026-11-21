/**
 * Validation of the tls profile and of the script definitions.
 *
 * Layer: server. `ioredis` resolves a `tls.profile` by name and takes the Lua source as given, so a
 * profile it does not know leaves the connection without the pinned authority, and a definition that
 * is not a name and a source fails far from the option. Both are refused when the options are resolved.
 */
import TLSProfiles from 'ioredis/built/constants/TLSProfiles'

import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import { resolveOptions } from './default-options'
import { KNOWN_TLS_PROFILES } from './tls-profiles'

/** Resolves a standalone setup whose `tls` is `tls`. */
const withTls = (tls: unknown): unknown =>
  resolveOptions({ connection: { host: 'h', tls } } as unknown as BymaxCacheModuleOptions)

/** Resolves a setup whose scripts are `scripts`. */
const withScripts = (scripts: unknown): unknown =>
  resolveOptions({ connection: { host: 'h' }, scripts } as unknown as BymaxCacheModuleOptions)

/** The refusal a call is expected to throw: the exact reason, and any further fixed details. */
const refusing = (reason: string, more: Record<string, unknown> = {}): Error =>
  expect.objectContaining({
    code: 'cache.invalid_options',
    details: expect.objectContaining({ reason, ...more })
  }) as Error

/** What a refused tls profile reports: the option, the problem and the accepted names. */
const unknownProfile = (option: string): Error =>
  refusing(`${option} is not a known tls profile`, {
    allowed: 'RedisCloudFixed or RedisCloudFlexible'
  })

describe('the known tls profiles', () => {
  // Rule: the list this library validates against is the list the driver resolves.
  it('equal the profiles of the driver', () => {
    expect([...KNOWN_TLS_PROFILES].sort()).toEqual(Object.keys(TLSProfiles).sort())
  })
})

describe('tls.profile', () => {
  // Scenario: the profile is one the driver knows, as an option of the object or as the whole value.
  it.each([
    ['in the object', { profile: 'RedisCloudFixed' }],
    ['as the whole value', 'RedisCloudFlexible'],
    ['unset', { profile: undefined, ca: 'c' }],
    ['not set at all, with tls enabled as a flag', true],
    ['absent', { ca: 'c' }]
  ])('accepts a known profile %s', (_label, tls) => {
    expect(() => withTls(tls)).not.toThrow()
  })

  // Scenario: the profile is a number, an unknown name, or an object whose toString throws.
  // Rule: it is refused as INVALID_OPTIONS naming the option, and the host's toString never runs.
  it.each([
    ['a number', { profile: 5 }, 'connection.tls.profile'],
    ['an unknown name', { profile: 'RedisCloudTypo' }, 'connection.tls.profile'],
    ['null', { profile: null }, 'connection.tls.profile'],
    [
      'an object whose toString throws',
      {
        profile: {
          toString: (): never => {
            throw new Error('host text secret=hunter2')
          }
        }
      },
      'connection.tls.profile'
    ],
    ['an unknown name as the whole value', 'nope', 'connection.tls'],
    ['an empty name as the whole value', '', 'connection.tls']
  ])('refuses %s', (_label, tls, option) => {
    expect(() => withTls(tls)).toThrow(unknownProfile(option))
  })

  // Scenario: the cluster node options carry an unknown profile.
  it('refuses an unknown profile in the cluster node options', () => {
    const options = {
      mode: 'cluster',
      cluster: {
        nodes: [{ host: 'a', port: 7000 }],
        options: { redisOptions: { tls: { profile: 'nope' } } }
      }
    } as unknown as BymaxCacheModuleOptions

    expect(() => resolveOptions(options)).toThrow(
      unknownProfile('cluster.options.redisOptions.tls.profile')
    )
  })
})

describe('script definitions', () => {
  // Scenario: the scripts value is unset, or is not a list at all.
  // Rule: unset is accepted; anything else that is not an array is refused naming `scripts`.
  it.each([
    ['undefined', undefined],
    ['null', null]
  ])('accepts scripts that are %s', (_label, scripts) => {
    expect(() => withScripts(scripts)).not.toThrow()
  })

  it.each([
    ['a number', 5],
    ['a string', 'return 1'],
    ['an object', { name: 'a', lua: 'return 1' }]
  ])('refuses scripts given as %s', (_label, scripts) => {
    expect(() => withScripts(scripts)).toThrow(refusing('scripts must be an array'))
  })

  // Scenario: a well-formed list.
  it('accepts definitions with a name and a source', () => {
    expect(() => withScripts([{ name: 'a', lua: 'return 1' }])).not.toThrow()
  })

  // Scenario: a definition that is not an object, or whose name or source is not a non-empty string.
  // Rule: it is refused as INVALID_OPTIONS naming the entry and the field, never at boot.
  it.each([
    ['an entry that is not an object', [5], 'scripts[0] must be an object'],
    ['a null entry', [null], 'scripts[0] must be an object'],
    ['a name that is missing', [{ lua: 'return 1' }], 'scripts[0].name must be a non-empty string'],
    [
      'an empty name',
      [{ name: '', lua: 'return 1' }],
      'scripts[0].name must be a non-empty string'
    ],
    [
      'a name that is not a string',
      [{ name: 7, lua: 'return 1' }],
      'scripts[0].name must be a non-empty string'
    ],
    ['a source that is missing', [{ name: 'a' }], 'scripts[0].lua must be a non-empty string'],
    [
      'a source that is a number',
      [{ name: 'a', lua: 12345 }],
      'scripts[0].lua must be a non-empty string'
    ],
    ['an empty source', [{ name: 'a', lua: '' }], 'scripts[0].lua must be a non-empty string'],
    [
      'the second entry broken',
      [{ name: 'a', lua: 'return 1' }, { name: 'b' }],
      'scripts[1].lua must be a non-empty string'
    ]
  ])('refuses %s', (_label, scripts, reason) => {
    expect(() => withScripts(scripts)).toThrow(refusing(reason))
  })
})
