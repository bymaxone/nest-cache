/**
 * The refusal of the guard on `Object.prototype`, built without a built-in that is looked up when it runs.
 *
 * Layer: server. `new CacheException(...)` reaches `HttpException`, which builds the message with a regular
 * expression, so a `RegExp.prototype.exec` replaced after the import would turn the refusal into a `TypeError`.
 * One exception is built when the library loads; a refusal is a copy of its own fields, with the count of
 * that refusal, made with the references captured in `intrinsics`. It is always the typed exception with a
 * count and no value of a key.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import {
  captureStackTrace,
  createObject,
  defineProperty,
  getOwnPropertyDescriptor,
  getOwnPropertyNames,
  getPrototypeOf,
  setPrototypeOf
} from './intrinsics'

/** Why the guard refused when `Object.prototype` holds a key that is not a standard one. */
export const KEYS_REASON = 'Object.prototype holds keys the driver would read as its own'
/** Why the guard refused when a built-in the library relies on was replaced after it loaded. */
export const BUILTINS_REASON = 'Built-ins the library relies on were replaced after it loaded'
const CODE = CACHE_ERROR_CODES.INVALID_OPTIONS

/** A data descriptor of its own fields only: `defineProperty` reads `get` and `set` through a prototype. */
function dataDescriptor(value: unknown): PropertyDescriptor {
  const descriptor = createObject(null)
  descriptor['value'] = value
  descriptor['writable'] = true
  descriptor['enumerable'] = true
  descriptor['configurable'] = true
  return descriptor as PropertyDescriptor
}

const TEMPLATE = new CacheException(CODE, {})
const MESSAGE = TEMPLATE.message
const FIELDS = getOwnPropertyNames(TEMPLATE)
const PROTOTYPE = getPrototypeOf(TEMPLATE) as object
const DESCRIPTORS = createObject(null)
for (let index = 0; index < FIELDS.length; index += 1) {
  const field = FIELDS[index] as string
  const original = getOwnPropertyDescriptor(TEMPLATE, field) as PropertyDescriptor
  DESCRIPTORS[field] = dataDescriptor(original.value)
}

/**
 * Builds the refusal of a guard that counted `count` keys or built-ins.
 *
 * @param reason - {@link KEYS_REASON} or {@link BUILTINS_REASON}.
 * @param count - How many the guard counted.
 * @returns A {@link CacheException} with `INVALID_OPTIONS` and `{ reason, count }` as details.
 */
export function guardRefusal(reason: string, count: number): CacheException {
  const error = createObject(null)
  for (let index = 0; index < FIELDS.length; index += 1) {
    const field = FIELDS[index] as string
    defineProperty(error, field, DESCRIPTORS[field] as PropertyDescriptor)
  }
  const details = { reason, count }
  defineProperty(error, 'details', dataDescriptor(details))
  defineProperty(
    error,
    'response',
    dataDescriptor({ error: { code: CODE, message: MESSAGE, details } })
  )
  setPrototypeOf(error, PROTOTYPE)
  captureStackTrace(error, guardRefusal)
  return error as unknown as CacheException
}
