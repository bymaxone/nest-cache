/**
 * Reads a key of the host's options only where the host put it.
 *
 * Layer: server. A property access on a plain object also finds what another part of the process
 * planted on `Object.prototype`, so an option the host left out would take the planted value: a `url`
 * that redirects the connection, a `namespace`, a `serializer`, a list of `scripts`. A key counts when
 * the object, or a prototype between it and the realm's root prototype, holds it, so a class instance
 * with getters, an object made over a prototype and an object from another realm (its root prototype is
 * not this realm's) are read as before, and a value found only on `Object.prototype` is not there.
 */
import { types } from 'node:util'

/**
 * Reads `key` of `source`, or `undefined` when it is found only on the realm's root prototype or
 * nowhere. A proxy answers for itself, as the host wrote it.
 *
 * @param source - The object the host supplied.
 * @param key - The option name.
 * @returns What a property access answers, when the key is the host's.
 */
export function readKey(source: object, key: string): unknown {
  if (types.isProxy(source)) {
    return Reflect.get(source, key)
  }
  for (
    let holder: object | null = source;
    holder !== null && holder !== Object.prototype;
    holder = Reflect.getPrototypeOf(holder)
  ) {
    if (Object.hasOwn(holder, key)) {
      return Reflect.get(source, key)
    }
  }
  return undefined
}

/**
 * Whether a value is an object made on this realm's root prototype: a literal, `{}` or
 * `Object.fromEntries`.
 *
 * @param value - Any value.
 * @returns True for a plain object of this realm.
 */
function isRootPlain(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Reflect.getPrototypeOf(value) === Object.prototype
  )
}

/**
 * Copies a tree of plain objects and lists so that no object in it has a prototype: a key the tree
 * does not hold then reads as absent, whatever is planted on `Object.prototype` later. An object that
 * is not plain (a class instance, a `Buffer`, a function, an object of another realm) is kept as it
 * is, and so is anything under it.
 *
 * @param value - The tree, already copied from the host's objects.
 * @returns The same tree with every plain object replaced by a prototype-less copy.
 */
export function bare(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(bare)
  }
  if (!isRootPlain(value)) {
    return value
  }
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const key of Object.keys(value)) {
    Object.defineProperty(copy, key, {
      value: bare(value[key]),
      enumerable: true,
      writable: true,
      configurable: true
    })
  }
  return copy
}

/** The hooks of `ICacheEvents`, the only names the library calls. */
const HOOKS = ['onEvent', 'onOperation', 'onQueue'] as const

/**
 * Reads the hooks of the host's `events` once, at boot, into an object without a prototype: a hook
 * found only on `Object.prototype` is not the host's and is never called, and the ones the host put are
 * bound to its own object so that a hook which uses `this` keeps working. A value that is not an object
 * is kept for validation.
 *
 * @param events - The `events` option as the host wrote it.
 * @returns The prototype-less hooks, or the value itself when it is not an object.
 */
export function readHooks(events: unknown): unknown {
  if (typeof events !== 'object' || events === null) {
    return events
  }
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const name of HOOKS) {
    const hook: unknown = readKey(events, name)
    if (hook !== undefined) {
      Object.defineProperty(copy, name, {
        value:
          typeof hook === 'function'
            ? (hook as (...args: unknown[]) => unknown).bind(events)
            : hook,
        enumerable: true,
        writable: true,
        configurable: true
      })
    }
  }
  return copy
}
