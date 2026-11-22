/**
 * Reads a key of the host's options only where the host put it.
 *
 * Layer: server. A property access on a plain object also finds what another part of the process
 * planted on `Object.prototype`, so an option the host left out would take the planted value: a `url`
 * that redirects the connection, a `namespace`, a `serializer`, a list of `scripts`. The root of a
 * prototype chain is recognised by its shape and never by a property it holds: an object with no
 * prototype that the key was reached through, not the object itself. So the root of this realm and the
 * root of another realm are both skipped, whatever `constructor` or any other key of theirs was
 * overwritten with, while an own key, a class getter, a prototype between the object and its root, and
 * an object without a prototype that holds the key itself are read as before.
 */
import { types } from 'node:util'

// Captured when the module loads, so that a later overwrite of these built-ins is not what decides.
const hasOwn = Object.hasOwn
const prototypeOf = Reflect.getPrototypeOf
const get = Reflect.get

/**
 * Reads `key` of `source`, or `undefined` when the first object of its prototype chain that holds the
 * key is a root: not `source` itself, and without a prototype. A proxy answers for itself, as the host
 * wrote it.
 *
 * @param source - The object the host supplied.
 * @param key - The option name.
 * @returns What a property access answers, when the key is the host's.
 */
export function readKey(source: object, key: string): unknown {
  if (types.isProxy(source)) {
    return get(source, key)
  }
  for (let holder: object | null = source; holder !== null; holder = prototypeOf(holder)) {
    if (hasOwn(holder, key)) {
      return holder !== source && prototypeOf(holder) === null ? undefined : get(source, key)
    }
  }
  return undefined
}

/**
 * Whether a value is a plain object: made on this realm's root prototype (a literal, `{}` or
 * `Object.fromEntries`) or without any prototype (a copy the library already made).
 *
 * @param value - Any value.
 * @returns True for a plain object of this realm.
 */
function isRootPlain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const proto: unknown = Reflect.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
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

/**
 * Copies an object's own enumerable keys into one without a prototype, one level deep: what the library
 * hands to ioredis then holds only what the library set, and a key planted on `Object.prototype` is not
 * inherited by the driver's reads.
 *
 * @param source - The object to copy.
 * @returns A prototype-less shallow copy.
 */
export function shallowBare<T extends object>(source: T): T {
  return Object.assign(Object.create(null) as T, source)
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
