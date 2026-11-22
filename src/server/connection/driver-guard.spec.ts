/**
 * The refusal to build a manager or a client while `Object.prototype` holds a key it does not hold by default.
 *
 * Layer: server. ioredis reads names off objects it creates itself (a client, a cluster, a connector, a
 * pipeline, a command, a subscriber) that those objects do not hold when they are built: through `this`,
 * through an alias of `this` (`const _this = this`) and through other objects. The library cannot give those
 * objects an own key, and a list of the names can never be shown complete, so a polluted `Object.prototype`
 * is refused as a whole, whichever name is planted.
 */
import { resolveOptions } from '../config/default-options'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import { ConnectionManager } from './connection.manager'
import type * as DriverNames from './driver-option-names'
import { STANDARD_KEYS } from './driver-option-names'

const build = (): ConnectionManager =>
  new ConnectionManager(
    resolveOptions({
      connection: { host: 'h', lazyConnect: true }
    } as unknown as BymaxCacheModuleOptions)
  )

/** Plants `name` on `Object.prototype` for the length of `run`. */
function planted<T>(name: string | symbol, run: () => T, enumerable = false): T {
  Object.defineProperty(Object.prototype, name, {
    value: 'PLANTED-VALUE',
    configurable: true,
    writable: true,
    enumerable
  })
  try {
    return run()
  } finally {
    Reflect.deleteProperty(Object.prototype, name)
  }
}

/** The exception `run` throws, or undefined. */
function thrownBy(
  run: () => unknown
): { code?: string; details?: Record<string, unknown> } | undefined {
  try {
    run()
  } catch (error) {
    return error as { code?: string; details?: Record<string, unknown> }
  }
  return undefined
}

describe('the manager with a key planted on Object.prototype', () => {
  // Scenario: another part of the process plants a key, whatever its name: one the driver reads off its own
  // objects (manuallyClosing, preferKey, length), one it reads through an alias, one nobody has listed.
  // Rule: the manager refuses to be built, reporting how many keys are planted and none of them.
  it.each(['manuallyClosing', 'preferKey', 'length', 'keys', 'stream', 'aNameNoListHolds'])(
    'refuses to be built when %s is planted',
    (name) => {
      const error = planted(name, () => thrownBy(build))

      expect(error?.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
      expect(error?.details).toEqual({
        reason: 'Object.prototype holds keys the driver would read as its own',
        count: 1
      })
      expect(JSON.stringify(error)).not.toContain('PLANTED-VALUE')
      expect(error?.details).not.toHaveProperty('name')
    }
  )

  it('refuses a key that is enumerable as well, and counts every planted key', () => {
    const error = planted('plantedOne', () => planted('plantedTwo', () => thrownBy(build), true))

    expect(error?.details).toEqual({
      reason: 'Object.prototype holds keys the driver would read as its own',
      count: 2
    })
  })

  // Scenario: the key is planted after the manager is built and before it builds a client.
  // Rule: the client is not built: the check runs when each client is created.
  it('refuses to build a client when a key is planted after the manager was built', () => {
    const manager = build()
    const error = planted('manuallyClosing', () => thrownBy(() => manager.getClient()))

    expect(error?.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    expect(error?.details).toEqual({
      reason: 'Object.prototype holds keys the driver would read as its own',
      count: 1
    })
  })

  // Scenario: a symbol key, which is no name the driver reads (the test runner plants one).
  // Rule: it is not refused.
  it('is built when a symbol is planted and when nothing is planted', () => {
    expect(planted(Symbol('planted'), build)).toBeInstanceOf(ConnectionManager)
    expect(build()).toBeInstanceOf(ConnectionManager)
  })
})

/**
 * Replaces a standard key of `Object.prototype` for the length of `run` by the descriptor `replace` makes
 * from the original one, and puts the original back.
 */
function overwritten<T>(
  name: string,
  replace: (original: PropertyDescriptor) => PropertyDescriptor,
  run: () => T
): T {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, name) as PropertyDescriptor
  Object.defineProperty(Object.prototype, name, replace(original))
  try {
    return run()
  } finally {
    Object.defineProperty(Object.prototype, name, original)
  }
}

/** A descriptor whose function behaves as the original and is not it, so the code that runs meanwhile works. */
const copyOf = (original: PropertyDescriptor): PropertyDescriptor => ({
  ...original,
  value: function (this: unknown, ...args: unknown[]): unknown {
    return (original.value as (...a: unknown[]) => unknown).apply(this, args)
  }
})

describe('a standard key of Object.prototype that was overwritten', () => {
  // Scenario: another part of the process replaces a standard name (the planted value is JSON-reachable
  // with `__proto__` or a polluting merge), which an allowlist by name alone does not see.
  // Rule: the manager refuses, counting it as planted.
  it.each(['hasOwnProperty', 'toString', 'constructor', 'valueOf', 'isPrototypeOf'])(
    'refuses to be built when %s is replaced',
    (name) => {
      const error = overwritten(name, copyOf, () => thrownBy(build))

      expect(error?.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
      expect(error?.details).toEqual({
        reason: 'Object.prototype holds keys the driver would read as its own',
        count: 1
      })
    }
  )

  // Scenario: the other ways to change a standard property: an accessor in place of the value, a value
  // made enumerable, a key deleted.
  // Rule: each is refused too, and the library's own check does not count them twice.
  it('refuses a standard key redefined as an accessor, made enumerable or deleted', () => {
    const accessor = overwritten(
      'toLocaleString',
      () => ({ get: () => undefined, configurable: true }),
      () => thrownBy(build)
    )
    const enumerable = overwritten(
      'valueOf',
      () => ({ enumerable: true }),
      () => thrownBy(build)
    )
    const deleted = (() => {
      const original = Object.getOwnPropertyDescriptor(Object.prototype, 'propertyIsEnumerable')
      Reflect.deleteProperty(Object.prototype, 'propertyIsEnumerable')
      try {
        return thrownBy(build)
      } finally {
        Object.defineProperty(
          Object.prototype,
          'propertyIsEnumerable',
          original as PropertyDescriptor
        )
      }
    })()

    for (const error of [accessor, enumerable, deleted]) {
      expect(error?.details).toEqual({
        reason: 'Object.prototype holds keys the driver would read as its own',
        count: 1
      })
    }
  })

  // Scenario: the accessor of `__proto__` gets another getter, then another setter, and a data property is
  // made read-only, each with the same value as before.
  // Rule: each is refused: the check compares the getter, the setter and the attributes, not the value only.
  it.each([
    [
      'getter',
      (o: PropertyDescriptor): PropertyDescriptor => ({
        ...o,
        get: function (this: unknown) {
          return (o.get as () => unknown).call(this)
        }
      })
    ],
    [
      'setter',
      (o: PropertyDescriptor): PropertyDescriptor => ({
        ...o,
        set: function (this: unknown, value: unknown) {
          ;(o.set as (v: unknown) => void).call(this, value)
        }
      })
    ]
  ])('refuses __proto__ with another %s', (_label, replace) => {
    const error = overwritten('__proto__', replace, () => thrownBy(build))

    expect(error?.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
  })

  it('refuses a standard value that was made read-only', () => {
    const error = overwritten(
      'valueOf',
      (original) => ({ ...original, writable: false }),
      () => thrownBy(build)
    )

    expect(error?.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
  })

  it('refuses a client that is built after a standard key was replaced', () => {
    const manager = build()
    const error = overwritten('hasOwnProperty', copyOf, () => thrownBy(() => manager.getClient()))

    expect(error?.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
  })
})

/**
 * The error the guard of a copy of the module loaded while `name` is replaced throws when it runs, with the
 * replacement still in place: the snapshot of that copy is the polluted state, so only the check of what the
 * language gives the key can see it.
 */
function loadedUnder(
  name: string,
  replace: (original: PropertyDescriptor) => PropertyDescriptor
): ReturnType<typeof thrownBy> {
  return overwritten(name, replace, () => {
    let guard: () => void = () => undefined
    jest.isolateModules(() => {
      guard = (require('./driver-option-names') as typeof DriverNames).assertDriverUnshadowed
    })
    return thrownBy(guard)
  })
}

describe('a standard key that was already replaced when the module loaded', () => {
  // Scenario: another dependency replaced a standard name before the library was imported, so the
  // snapshot of the descriptors is the polluted state and sees no change.
  // Rule: the guard refuses at every use, counting it, because the value is not what the language gives.
  it.each([
    ['hasOwnProperty', copyOf],
    ['toString', copyOf],
    [
      'valueOf',
      (o: PropertyDescriptor): PropertyDescriptor => ({ ...o, value: Object.prototype.toString })
    ],
    ['constructor', (o: PropertyDescriptor): PropertyDescriptor => ({ ...o, value: Array })],
    [
      '__proto__',
      (o: PropertyDescriptor): PropertyDescriptor => ({
        ...o,
        get: function (this: unknown) {
          return (o.get as () => unknown).call(this)
        }
      })
    ]
  ])('refuses when %s was replaced before the load', (name, replace) => {
    const error = loadedUnder(name, replace)

    expect(error?.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    expect(error?.details).toEqual({
      reason: 'Object.prototype holds keys the driver would read as its own',
      count: 1
    })
  })

  // Scenario: the replacement is written in JavaScript and carries the name of the key it replaces.
  // Rule: it is refused as well; the name alone does not make a function the one the language gives.
  it.each(['hasOwnProperty', 'toString', 'valueOf'])(
    'refuses a function of the right name written in JavaScript in place of %s',
    (name) => {
      const error = loadedUnder(name, (original) => ({
        ...original,
        value: {
          [name](this: unknown, ...args: unknown[]): unknown {
            return (original.value as (...a: unknown[]) => unknown).apply(this, args)
          }
        }[name]
      }))

      expect(error?.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    }
  )

  it('refuses an accessor in place of a standard value before the load', () => {
    const error = loadedUnder('toLocaleString', () => ({
      get: () => undefined,
      configurable: true
    }))

    expect(error?.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
  })

  it('refuses when a standard key was deleted before the load', () => {
    const original = Object.getOwnPropertyDescriptor(Object.prototype, 'propertyIsEnumerable')
    Reflect.deleteProperty(Object.prototype, 'propertyIsEnumerable')
    let error: ReturnType<typeof thrownBy>
    try {
      let guard: () => void = () => undefined
      jest.isolateModules(() => {
        guard = (require('./driver-option-names') as typeof DriverNames).assertDriverUnshadowed
      })
      error = thrownBy(guard)
    } finally {
      Object.defineProperty(
        Object.prototype,
        'propertyIsEnumerable',
        original as PropertyDescriptor
      )
    }

    expect(error?.details).toEqual({
      reason: 'Object.prototype holds keys the driver would read as its own',
      count: 1
    })
  })

  it('does not refuse a copy of the module loaded under an untouched prototype', () => {
    let guard: () => void = () => undefined
    jest.isolateModules(() => {
      guard = (require('./driver-option-names') as typeof DriverNames).assertDriverUnshadowed
    })

    expect(thrownBy(guard)).toBeUndefined()
  })
})

describe('the keys Object.prototype holds by default', () => {
  // Scenario: the runtime that runs this row holds a string key on Object.prototype that the allowlist does
  // not name, or lacks one it names.
  // Rule: this fails, naming the difference, so that an ECMAScript or V8 addition breaks the build of the
  // library on that runtime and not the hosts that start the cache. The allowlist is the set of names,
  // never a count. It checks the runtime of the lane that runs it: CI runs one Node version today, so a
  // matrix over every supported major (engines is >=24) is what would run it on each.
  it('are exactly the allowlist of the guard, by name', () => {
    const held = Object.getOwnPropertyNames(Object.prototype).sort()
    const allowed = [...STANDARD_KEYS].sort()

    expect({ unlisted: held.filter((name) => !STANDARD_KEYS.has(name)) }).toEqual({ unlisted: [] })
    expect({ missing: allowed.filter((name) => !held.includes(name)) }).toEqual({ missing: [] })
    expect(held).toEqual(allowed)
  })
})
