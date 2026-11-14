/**
 * Runs a host's validator over a decoded value.
 *
 * Layer: server, pure. The rule is the host's, so whatever it reports is the host's data: a schema's
 * messages often quote the value it received. Nothing of that reaches `details`, which holds fixed
 * text and counts; the original outcome (the issues, or the value a validator threw) is kept as
 * `cause`, which the response body never carries.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import type {
  ReadValidator,
  StandardSchemaLike,
  StandardSchemaResult
} from '../interfaces/read-options.interface'

/** Fixed `details.error` of a value that does not satisfy the rule. */
const MISMATCH = 'the stored value does not match the expected shape'

/** Fixed `details.error` of a validator that threw, so the rule did not decide. */
const UNDECIDED = 'the validator could not check the stored value'

/**
 * Builds the exception of a failed read.
 *
 * @param error - The fixed text.
 * @param extra - The location of the value and the issue count, when there are any.
 * @param cause - The original outcome, kept off the response body.
 * @returns The exception to throw.
 */
function failure(error: string, extra: Record<string, unknown>, cause: unknown): CacheException {
  return new CacheException(
    CACHE_ERROR_CODES.VALIDATION_FAILED,
    { error, ...extra },
    undefined,
    cause
  )
}

/**
 * Applies a type predicate.
 *
 * @param value - The decoded value.
 * @param predicate - The host's predicate.
 * @param location - Where the value came from, copied into the details.
 * @returns The value when the predicate answers `true`.
 */
function checkPredicate<T>(
  value: unknown,
  predicate: (value: unknown) => value is T,
  location: Record<string, unknown>
): T {
  let accepted: boolean
  try {
    accepted = predicate(value)
  } catch (error) {
    throw failure(UNDECIDED, location, error)
  }
  if (accepted !== true) {
    throw failure(MISMATCH, location, undefined)
  }
  return value as T
}

/**
 * Applies a Standard Schema validator, synchronous or not.
 *
 * @param value - The decoded value.
 * @param schema - The host's schema.
 * @param location - Where the value came from, copied into the details.
 * @returns The value the schema produced, which may differ from the input when it transforms.
 */
async function checkSchema<T>(
  value: unknown,
  schema: StandardSchemaLike<T>,
  location: Record<string, unknown>
): Promise<T> {
  let result: StandardSchemaResult<T>
  try {
    result = await schema['~standard'].validate(value)
  } catch (error) {
    throw failure(UNDECIDED, location, error)
  }
  if (result.issues !== undefined) {
    throw failure(MISMATCH, { ...location, issueCount: result.issues.length }, result.issues)
  }
  return result.value
}

/** Whether `validate` is a plain predicate: a function that does not also carry `~standard`. */
function isPredicate<T>(validate: ReadValidator<T>): validate is (value: unknown) => value is T {
  return typeof validate === 'function' && !('~standard' in validate)
}

/**
 * Checks a decoded value against the host's rule.
 *
 * @typeParam T - The type the value has once it passes.
 * @param value - The decoded value.
 * @param validate - A type predicate or a Standard Schema validator.
 * @param location - Where the value came from (`{ index }`, `{ field }`), copied into the details.
 * @returns The value, typed as `T`; a schema's output when it transforms.
 * @throws {CacheException} `VALIDATION_FAILED` when the value does not satisfy the rule, or the
 *   validator threw.
 */
export async function validateRead<T>(
  value: unknown,
  validate: ReadValidator<T>,
  location: Record<string, unknown> = {}
): Promise<T> {
  // `~standard` first: an ArkType type is a function that also carries it, and as a predicate it
  // would return the data, never `true`, and refuse every value.
  return isPredicate(validate)
    ? checkPredicate(value, validate, location)
    : checkSchema(value, validate, location)
}
