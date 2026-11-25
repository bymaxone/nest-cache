/**
 * Unit tests for `CACHE_ERROR_CODES`: every code is namespaced under `cache.`, the values are
 * unique, and the codes consumers match on keep their wire value.
 *
 * Layer: shared.
 */
import { CACHE_ERROR_CODES } from './error-codes'

describe('CACHE_ERROR_CODES', () => {
  // Every code must be namespaced under `cache.` so consumers can distinguish
  // cache failures from other domains by prefix.
  it('namespaces every code under "cache."', () => {
    for (const code of Object.values(CACHE_ERROR_CODES)) {
      expect(code).toMatch(/^cache\./)
    }
  })

  // Code values must be unique — a duplicate would make two distinct failure
  // modes indistinguishable to a consumer switching on the code.
  it('has unique code values', () => {
    const values = Object.values(CACHE_ERROR_CODES)
    expect(new Set(values).size).toBe(values.length)
  })

  // The read-validation code is part of the public contract and must stay stable.
  it('maps VALIDATION_FAILED to its stable wire value', () => {
    expect(CACHE_ERROR_CODES.VALIDATION_FAILED).toBe('cache.validation_failed')
  })

  // A refused configuration option has its own code, so it is not read as a network failure.
  it('maps INVALID_OPTIONS to its stable wire value', () => {
    expect(CACHE_ERROR_CODES.INVALID_OPTIONS).toBe('cache.invalid_options')
  })

  // Lock the most common code's wire value explicitly (it is part of the
  // public contract and must stay stable across minor versions).
  it('maps CONNECTION_FAILED to its stable wire value', () => {
    expect(CACHE_ERROR_CODES.CONNECTION_FAILED).toBe('cache.connection_failed')
  })

  // Every wire value is part of the public contract; a rename must be a deliberate, visible edit
  // here, not a change the spec follows because it reads the same constant.
  it('keeps the literal wire value of every code', () => {
    expect(CACHE_ERROR_CODES).toEqual({
      CONNECTION_FAILED: 'cache.connection_failed',
      COMMAND_TIMEOUT: 'cache.command_timeout',
      CONNECTION_LOST: 'cache.connection_lost',
      SERIALIZATION_FAILED: 'cache.serialization_failed',
      DESERIALIZATION_FAILED: 'cache.deserialization_failed',
      INVALID_NAMESPACE: 'cache.invalid_namespace',
      INVALID_KEY: 'cache.invalid_key',
      SCRIPT_NOT_REGISTERED: 'cache.script_not_registered',
      SCRIPT_EXECUTION_FAILED: 'cache.script_execution_failed',
      SCRIPT_REGISTRY_MISSING: 'cache.script_registry_missing',
      FLUSH_DISABLED_IN_PRODUCTION: 'cache.flush_disabled_in_production',
      CLUSTER_MISCONFIGURED: 'cache.cluster_misconfigured',
      SENTINEL_MISCONFIGURED: 'cache.sentinel_misconfigured',
      SHUTDOWN_TIMEOUT: 'cache.shutdown_timeout',
      UNSUPPORTED_IN_CLUSTER: 'cache.unsupported_in_cluster',
      INVALID_SCOPE: 'cache.invalid_scope',
      SCOPE_NOT_FOUND: 'cache.scope_not_found',
      SCOPE_NOT_READABLE: 'cache.scope_not_readable',
      KEY_NOT_IN_SCOPE: 'cache.key_not_in_scope',
      INVALID_TTL: 'cache.invalid_ttl',
      VALIDATION_FAILED: 'cache.validation_failed',
      INVALID_OPTIONS: 'cache.invalid_options'
    })
  })
})
