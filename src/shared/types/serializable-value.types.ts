/**
 * JSON-serializable value type.
 *
 * Layer: shared — zero-dependency. Describes exactly what the default
 * `JsonSerializer` can round-trip through `JSON.stringify`/`JSON.parse`.
 */

/**
 * A value that survives a JSON round-trip without loss.
 *
 * Deliberately excludes `Date`, `Map`, `Set`, `BigInt`, `undefined`, functions,
 * and class instances — these either throw, silently drop, or change type under
 * `JSON.stringify`. A consumer that needs them must supply a custom
 * `ISerializer`; the typed `get<T>`/`set<T>` API does not constrain `T` to this
 * type so a custom serializer stays unrestricted.
 *
 * @example
 * ```ts
 * const ok: SerializableValue = { id: 1, tags: ['a'], active: true, parent: null }
 * // const bad: SerializableValue = { when: new Date() } // WRONG: Date is not serializable
 * ```
 */
export type SerializableValue =
  | string
  | number
  | boolean
  | null
  | SerializableValue[]
  | { [key: string]: SerializableValue }
