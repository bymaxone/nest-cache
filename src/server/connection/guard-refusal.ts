/**
 * The refusal of the guard on `Object.prototype`, built without a built-in that is looked up when it runs.
 *
 * Layer: server. `new CacheException(...)` reaches `HttpException`, which builds the message with a regular
 * expression, so a `RegExp.prototype.exec` replaced after the import would turn the refusal into a `TypeError`.
 * One exception is built when the library loads; a refusal is a copy of its own fields, with the count of
 * that refusal, made with the references captured in `intrinsics`. It is always the typed exception with a
 * count and no value of a key.
 */
import { CACHE_ERROR_CODES, CACHE_ERROR_MESSAGES } from '../errors/cache-error-codes'
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

const REASON = 'Object.prototype holds keys the driver would read as its own'
const CODE = CACHE_ERROR_CODES.INVALID_OPTIONS
const MESSAGE = CACHE_ERROR_MESSAGES.get(CODE) ?? 'Cache error'

/** A data descriptor of its own fields only: `defineProperty` reads `get` and `set` through a prototype. */
function dataDescriptor(
  value: unknown,
  writable: boolean,
  enumerable: boolean
): PropertyDescriptor {
  const descriptor = createObject(null)
  descriptor['value'] = value
  descriptor['writable'] = writable
  descriptor['enumerable'] = enumerable
  descriptor['configurable'] = true
  return descriptor as PropertyDescriptor
}

const TEMPLATE = new CacheException(CODE, { reason: REASON, count: 0 })
const FIELDS = getOwnPropertyNames(TEMPLATE)
const PROTOTYPE = getPrototypeOf(TEMPLATE) as object
const DESCRIPTORS = createObject(null)
for (let index = 0; index < FIELDS.length; index += 1) {
  const field = FIELDS[index] as string
  const original = getOwnPropertyDescriptor(TEMPLATE, field) as PropertyDescriptor
  DESCRIPTORS[field] = dataDescriptor(original.value, true, original.enumerable === true)
}

/**
 * Builds the refusal of a guard that counted `count` keys or built-ins.
 *
 * @param count - How many the guard counted.
 * @returns A {@link CacheException} with `INVALID_OPTIONS` and `{ reason, count }` as details.
 */
export function guardRefusal(count: number): CacheException {
  const error = createObject(null)
  for (let index = 0; index < FIELDS.length; index += 1) {
    const field = FIELDS[index] as string
    defineProperty(error, field, DESCRIPTORS[field] as PropertyDescriptor)
  }
  const details = { reason: REASON, count }
  defineProperty(error, 'details', dataDescriptor(details, true, true))
  defineProperty(
    error,
    'response',
    dataDescriptor({ error: { code: CODE, message: MESSAGE, details } }, true, true)
  )
  setPrototypeOf(error, PROTOTYPE)
  captureStackTrace(error, guardRefusal)
  return error as unknown as CacheException
}
