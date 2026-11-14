/**
 * Opt-in read validation contract.
 *
 * Layer: server. A stored value is decoded as `T`, but `T` does not exist at runtime, so the library
 * cannot check a value's shape by itself. The host passes the rule: a type predicate, or any
 * Standard Schema validator (zod, valibot and arktype implement it). The Standard Schema shape is
 * declared here structurally, so the library imports no validator and has no new dependency.
 */

/** What a Standard Schema validator returns: the value on success, the issues on failure. */
export type StandardSchemaResult<T> =
  { readonly value: T; readonly issues?: undefined } | { readonly issues: readonly unknown[] }

/**
 * A Standard Schema validator, as the `~standard` property of a schema object.
 *
 * Only the members this library calls are declared; a real schema has more and still satisfies it.
 *
 * @typeParam T - The type a successful validation produces.
 */
export interface StandardSchemaLike<T = unknown> {
  readonly '~standard': {
    readonly version: 1
    readonly validate: (
      value: unknown
    ) => StandardSchemaResult<T> | Promise<StandardSchemaResult<T>>
  }
}

/**
 * The rule a read applies to a decoded value: a type predicate, or a Standard Schema validator.
 *
 * @typeParam T - The type the value has once it passes.
 */
export type ReadValidator<T> = ((value: unknown) => value is T) | StandardSchemaLike<T>

/**
 * Options of a read that decodes a stored value.
 *
 * @typeParam T - The type the value has once it passes.
 */
export interface ReadOptions<T> {
  /**
   * The rule the decoded value must satisfy. When it is absent the value is returned as decoded,
   * and no validator runs. A value that fails throws `CacheException` `VALIDATION_FAILED`, with the
   * entry left in place.
   */
  readonly validate?: ReadValidator<T>
}
