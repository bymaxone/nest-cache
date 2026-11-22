/**
 * The module refuses a polluted process before it reads an option.
 *
 * Layer: server. `forRoot` and the factory of `forRootAsync` resolve the options of the host with code that
 * calls built-ins of the language (`Object.keys`, `Array.isArray`, `Reflect.get`) and reads keys off objects:
 * a built-in replaced after the library was imported, or a key planted on `Object.prototype`, would answer for
 * those reads. The guard on `Object.prototype` runs first, at `forRoot` and at the factory, and refuses.
 */
import type { Provider } from '@nestjs/common'

import { findProvider } from '../test-helpers/provider.helpers'
import { BYMAX_CACHE_OPTIONS } from './bymax-cache.constants'
import { BymaxCacheModule } from './bymax-cache.module'
import { BUILTINS_REASON } from './connection/guard-refusal'
import { CACHE_ERROR_CODES } from './errors/cache-error-codes'

const OPTIONS = { connection: { host: 'h', lazyConnect: true } }

/** The error `run` throws, or undefined. */
function thrownBy(run: () => unknown): { code?: string; details?: unknown } | undefined {
  try {
    run()
  } catch (error) {
    return error as { code?: string; details?: unknown }
  }
  return undefined
}

/** Runs `run` with a key planted on Object.prototype, and takes it off with a delete. */
function withPlantedKey<T>(run: () => T): T {
  Object.defineProperty(Object.prototype, 'aKeyPlantedByTheTest', {
    value: 1,
    configurable: true,
    writable: true
  })
  try {
    return run()
  } finally {
    Reflect.deleteProperty(Object.prototype, 'aKeyPlantedByTheTest')
  }
}

/** Runs `run` with `Object.keys` replaced, and puts it back. */
function withReplacedBuiltin<T>(run: () => T): T {
  const original = Object.keys
  ;(Object as unknown as Record<string, unknown>)['keys'] = () => []
  try {
    return run()
  } finally {
    ;(Object as unknown as Record<string, unknown>)['keys'] = original
  }
}

/** Runs `run` with `String.prototype.includes` saying no to everything, and puts it back. */
function withBlindIncludes<T>(run: () => T): T {
  const original = String.prototype.includes
  ;(String.prototype as unknown as Record<string, unknown>)['includes'] = () => false
  try {
    return run()
  } finally {
    ;(String.prototype as unknown as Record<string, unknown>)['includes'] = original
  }
}

/** The factory forRootAsync gives the resolved options. */
function asyncFactory(): (raw: unknown) => unknown {
  const module = BymaxCacheModule.forRootAsync({ useFactory: () => OPTIONS })
  const provider = findProvider((module.providers ?? []) as Provider[], BYMAX_CACHE_OPTIONS)
  return (provider as unknown as { useFactory: (raw: unknown) => unknown }).useFactory
}

describe('forRoot', () => {
  it('registers on a clean process', () => {
    expect(BymaxCacheModule.forRoot(OPTIONS).module).toBe(BymaxCacheModule)
  })

  it('refuses a key planted on Object.prototype', () => {
    const error = withPlantedKey(() => thrownBy(() => BymaxCacheModule.forRoot(OPTIONS)))

    expect(error?.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
  })

  it('refuses a built-in the option reading calls that was replaced after the import', () => {
    const error = withReplacedBuiltin(() => thrownBy(() => BymaxCacheModule.forRoot(OPTIONS)))

    expect(error?.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
  })
})

describe('forRoot, with the check of a namespace blinded', () => {
  // Scenario: `String.prototype.includes` is replaced after the import by a function that finds nothing, so
  // the namespace `a:b` would pass the check that it holds the separator `:`.
  // Rule: the guard refuses before the namespace is read.
  it('refuses as a polluted process, where a clean one refuses the namespace itself', () => {
    const options = {
      namespace: 'a:b',
      separator: ':',
      connection: { host: 'h', lazyConnect: true }
    }

    const error = withBlindIncludes(() => thrownBy(() => BymaxCacheModule.forRoot(options)))
    const clean = thrownBy(() => BymaxCacheModule.forRoot(options))

    expect(error?.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    expect(clean?.code).toBe(CACHE_ERROR_CODES.INVALID_NAMESPACE)
    expect(error?.details).toEqual({ reason: BUILTINS_REASON, count: 1 })
  })
})

describe('the factory of forRootAsync', () => {
  it('resolves the options on a clean process', () => {
    expect(asyncFactory()(OPTIONS)).toBeDefined()
  })

  it('refuses a key planted on Object.prototype', () => {
    const factory = asyncFactory()

    const error = withPlantedKey(() => thrownBy(() => factory(OPTIONS)))

    expect(error?.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
  })

  it('refuses a built-in the option reading calls that was replaced after the import', () => {
    const factory = asyncFactory()

    const error = withReplacedBuiltin(() => thrownBy(() => factory(OPTIONS)))

    expect(error?.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
  })
})
