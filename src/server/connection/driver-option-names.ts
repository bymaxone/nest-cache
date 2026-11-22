/**
 * The guard on `Object.prototype` that stands in front of every ioredis client the library builds.
 *
 * Layer: server. ioredis reads names off objects it creates itself, and `for...in` over the options it is
 * given visits an enumerable key planted on `Object.prototype` and copies its value into any option that
 * holds `undefined`, so no shape of the options object protects a client: the library refuses to build
 * or connect one while `Object.prototype` holds a key it does not hold by default.
 */
import { types } from 'node:util'

import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'

/**
 * The string keys `Object.prototype` holds in every Node version the library supports. Anything else is a
 * key another part of the process planted there.
 */
export const STANDARD_KEYS: ReadonlySet<string> = new Set([
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  '__proto__',
  'constructor',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  'toString',
  'valueOf'
])

/** `Object.hasOwn` as it was when this module loaded. */
const hasOwn = Object.hasOwn

/** The six fields of a property descriptor, each present (`undefined` when the descriptor lacks it). */
interface IDescriptorFields {
  readonly value: unknown
  readonly get: unknown
  readonly set: unknown
  readonly writable: unknown
  readonly enumerable: unknown
  readonly configurable: unknown
}

/**
 * Copies the fields a descriptor holds of its own into an object without a prototype. A descriptor is an
 * ordinary object, so reading `get`, `set` or `value` off a data descriptor would find, and run, an
 * accessor planted on `Object.prototype` under that name.
 */
function fieldsOf(descriptor: PropertyDescriptor | undefined): IDescriptorFields | undefined {
  if (descriptor === undefined) return undefined
  const fields = Object.create(null) as Record<string, unknown>
  for (const field of ['value', 'get', 'set', 'writable', 'enumerable', 'configurable']) {
    fields[field] = hasOwn(descriptor, field)
      ? (descriptor as unknown as Record<string, unknown>)[field]
      : undefined
  }
  return fields as unknown as IDescriptorFields
}

/** The property descriptors of the standard keys as they were when this module loaded. */
const STANDARD_DESCRIPTORS: ReadonlyMap<string, IDescriptorFields | undefined> = new Map(
  [...STANDARD_KEYS].map((name) => [
    name,
    fieldsOf(Object.getOwnPropertyDescriptor(Object.prototype, name))
  ])
)

/** `Function.prototype.toString` as it was when this module loaded. */
const fnToString = Function.prototype.toString

/**
 * Whether `value` is a function the engine implements, not one written in JavaScript and not a proxy,
 * which `Function.prototype.toString` also reports as native.
 */
function isNative(value: unknown): boolean {
  return (
    typeof value === 'function' &&
    !types.isProxy(value) &&
    /\{\s*\[native code\]\s*\}\s*$/.test(fnToString.call(value))
  )
}

/**
 * Whether what a standard key holds is what the language gives it: a native function with the key's own
 * name (`constructor` holds `Object`), and for `__proto__` a native getter and setter.
 */
function hasExpectedKind(name: string, descriptor: IDescriptorFields | undefined): boolean {
  if (descriptor === undefined) return false
  if (name === '__proto__') return isNative(descriptor.get) && isNative(descriptor.set)
  const expectedName = name === 'constructor' ? 'Object' : name
  return isNative(descriptor.value) && (descriptor.value as { name: string }).name === expectedName
}

/**
 * The standard keys that were not what the language gives them when this module loaded: the process was
 * already polluted before the library was imported, which the snapshot below cannot see.
 */
const BASELINE_DEFECTS: ReadonlySet<string> = new Set(
  [...STANDARD_KEYS].filter((name) => !hasExpectedKind(name, STANDARD_DESCRIPTORS.get(name)))
)

/**
 * Whether a standard key of `Object.prototype` is not what it was when this module loaded: replaced,
 * redefined as an accessor, made writable or enumerable, or deleted.
 */
function isOverwritten(name: string): boolean {
  const was = STANDARD_DESCRIPTORS.get(name)
  const now = fieldsOf(Object.getOwnPropertyDescriptor(Object.prototype, name))
  if (was === undefined || now === undefined) return was !== now
  return (
    !Object.is(was.value, now.value) ||
    was.get !== now.get ||
    was.set !== now.set ||
    was.writable !== now.writable ||
    was.enumerable !== now.enumerable ||
    // Stryker disable next-line EqualityOperator,ConditionalExpression: a standard property made non-configurable cannot be put back, and a test would freeze it for every other spec of the realm
    was.configurable !== now.configurable
  )
}

/**
 * Refuses to go on while `Object.prototype` holds a string key it does not hold by default, or a
 * standard key that is not what the language gives it, or not what it was when this module loaded.
 *
 * ioredis reads names off objects it creates itself (a client, a cluster, a connector, a pipeline, a
 * command, a subscriber) that those objects do not hold when they are built, through `this`, through an
 * alias of `this` and through other objects, so a key planted on `Object.prototype` is what the read
 * finds. The library cannot give those objects an own key and no list of the names can be complete, so a
 * polluted `Object.prototype` is refused as a whole. A symbol key is not a name the driver reads. A
 * standard name that was overwritten (`hasOwnProperty`, `toString`, `constructor`) counts as planted: the
 * names are an allowlist, so a replaced value would otherwise keep the count at zero, and so does a standard
 * name that was already replaced when this module loaded (not a native function with its own name, or
 * `__proto__` without a native getter and setter): the refusal is the same at every use, not a throw at
 * import, so a host that only imports the types is not affected. A script that impersonates the engine
 * before the import (a replaced `Function.prototype.toString`) is out of reach of this check.
 *
 * It runs when the manager is built, when each client is built and in the tick that opens every socket,
 * on the first connect and on every reconnect (the connector). It does not cover `Array.prototype`,
 * `Function.prototype` or `Buffer`'s prototype, and a key planted after the last of those runs is still
 * read by the objects the driver builds later (a command, a pipeline).
 *
 * @throws {CacheException} `INVALID_OPTIONS` with the count of the keys, never a key or a value.
 */
export function assertDriverUnshadowed(): void {
  const added = Object.getOwnPropertyNames(Object.prototype).filter(
    (name) => !STANDARD_KEYS.has(name)
  )
  const replaced = [...STANDARD_KEYS].filter(
    (name) => BASELINE_DEFECTS.has(name) || isOverwritten(name)
  )
  const count = added.length + replaced.length
  if (count > 0) {
    throw new CacheException(CACHE_ERROR_CODES.INVALID_OPTIONS, {
      reason: 'Object.prototype holds keys the driver would read as its own',
      count
    })
  }
}
