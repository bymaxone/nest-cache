/**
 * The module refuses a polluted process before it reads an option.
 *
 * Layer: server. `forRoot` and the factory of `forRootAsync` resolve the options of the host with code that
 * calls built-ins of the language (`Object.keys`, `Array.isArray`, `Reflect.get`) and reads keys off objects:
 * a built-in replaced after the library was imported, or a key planted on `Object.prototype`, would answer for
 * those reads. The guard on `Object.prototype` runs first, at `forRoot` and at the factory, and refuses.
 */
import { types } from 'node:util'

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

describe('forRoot, with util.types.isProxy replaced after the import', () => {
  // Scenario: `isProxy` is replaced by a function that says yes, which sends every source to the branch that
  // reads through a prototype.
  // Rule: the guard refuses before an option is read.
  it('refuses with the reason of built-ins', () => {
    const original = types.isProxy
    ;(types as unknown as Record<string, unknown>)['isProxy'] = () => true
    try {
      const error = thrownBy(() => BymaxCacheModule.forRoot(OPTIONS))

      expect(error?.details).toEqual({ reason: BUILTINS_REASON, count: 1 })
    } finally {
      ;(types as unknown as Record<string, unknown>)['isProxy'] = original
    }
  })
})

describe('forRoot, with an iterator planted on Object.prototype', () => {
  // Scenario: a generator that yields one value is planted under Symbol.iterator, and the host wrote a
  // `tls.ca` of three entries (the plant used to decide that one survived).
  // Rule: the guard refuses the process before the entries are copied.
  it('refuses, counting the symbol', () => {
    Object.defineProperty(Object.prototype, Symbol.iterator, {
      value: function* (): Generator<number> {
        yield 1
      },
      configurable: true,
      writable: true
    })
    try {
      const error = thrownBy(() =>
        BymaxCacheModule.forRoot({
          connection: { host: 'h', tls: { ca: ['a', 'b', 'c'] } }
        } as never)
      )

      expect(error?.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
      expect(error?.details).toEqual(expect.objectContaining({ count: 1 }))
    } finally {
      Reflect.deleteProperty(Object.prototype, Symbol.iterator)
    }
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
