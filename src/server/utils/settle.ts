/**
 * Awaits a promise on a decision path without handing the decision to code a host can replace.
 *
 * Layer: server. A verdict that is read from `Promise.race`, from `.catch` or from an `await` on a promise
 * whose constructor was swapped is a verdict that whoever replaced those built-ins writes: a `quit` that
 * rejects reads as a clean close, a failed `PING` reads as `PONG`. Everything here uses the intrinsic
 * promise captured when the library loads, awaits it (an `await` on a native promise never calls its
 * `then`), settles through an object without a prototype, and checks, synchronously and immediately
 * before each `await` a decision reads, that nothing the `await` consults was replaced or planted.
 *
 * Known limit: code that runs concurrently, plants a `then` and removes it again between the check and
 * the resolution of the awaited work cannot be seen afterwards.
 */
import { guardRefusal } from '../connection/guard-refusal'
import {
  createObject,
  defineProperty,
  freeze,
  getOwnPropertyDescriptor,
  getPrototypeOf,
  hasOwn,
  objectPrototype
} from '../connection/intrinsics'

/** Why the guard refused when the promise machinery of the language was replaced or planted on. */
export const PROMISE_REASON =
  'Promise built-ins the library relies on were replaced after it loaded'

/** The intrinsic `Promise`, read from an async function's promise; the global binding may be a wrapper. */
export const IntrinsicPromise = (
  getPrototypeOf((async (): Promise<undefined> => undefined)()) as {
    constructor: PromiseConstructor
  }
).constructor
const PROMISE_PROTOTYPE = IntrinsicPromise.prototype
const ARRAY_PROTOTYPE = Array.prototype
const FUNCTION_PROTOTYPE = Function.prototype

const noop = (): void => undefined

/** The descriptor that gives a promise its own `constructor`; it has no prototype and is frozen. */
const OWN_CONSTRUCTOR = ((): Readonly<Record<string, unknown>> => {
  const descriptor = createObject(null)
  descriptor['value'] = IntrinsicPromise
  descriptor['writable'] = false
  descriptor['enumerable'] = false
  descriptor['configurable'] = false
  return freeze(descriptor)
})()

/**
 * Gives a promise an own, non-writable, non-configurable `constructor`, so that neither attaching a
 * handler nor awaiting it reads `Promise.prototype.constructor`, and nothing can change it afterwards.
 * Pinning twice is harmless: the same descriptor is accepted again.
 *
 * @param promise - A promise about to get a handler or an `await`.
 * @throws {CacheException} `INVALID_OPTIONS` when the promise cannot take the property (frozen, sealed or
 *   exotic): such a promise is never treated as pinned, so a caller fails closed rather than resolve.
 */
export function pinConstructor(promise: object): void {
  try {
    defineProperty(promise, 'constructor', OWN_CONSTRUCTOR)
  } catch {
    throw guardRefusal(PROMISE_REASON, 1)
  }
}

/**
 * Counts what an `await` on a native promise would consult and a host replaced: the constructor of the
 * intrinsic promise (an `await` on a promise whose `constructor` differs calls its `then`), and a `then`
 * planted on the prototypes every resolution with an object value reads it from.
 *
 * @returns How many of them are not as they were when the library loaded.
 */
function countPromiseDefects(): number {
  let count = 0
  const own = getOwnPropertyDescriptor(PROMISE_PROTOTYPE, 'constructor')
  if (own === undefined || own.value !== IntrinsicPromise) count += 1
  if (hasOwn(objectPrototype, 'then')) count += 1
  if (hasOwn(ARRAY_PROTOTYPE, 'then')) count += 1
  if (hasOwn(FUNCTION_PROTOTYPE, 'then')) count += 1
  return count
}

/**
 * Refuses, synchronously, when the promise machinery is not as it was when the library loaded.
 *
 * @throws {CacheException} `INVALID_OPTIONS` with a count and no value, built without a replaceable built-in.
 */
export function assertPromiseIntrinsics(): void {
  const count = countPromiseDefects()
  if (count > 0) throw guardRefusal(PROMISE_REASON, count)
}

/**
 * Whether a value is a native promise (the intrinsic one or a subclass), without `instanceof`, which
 * reads `Symbol.hasInstance` off a replaceable `Function.prototype`.
 *
 * @param value - Anything.
 * @returns True when the intrinsic promise prototype is on its prototype chain.
 */
export function isNativePromise(value: unknown): value is Promise<unknown> {
  if (typeof value !== 'object' || value === null) return false
  let prototype = getPrototypeOf(value)
  while (prototype !== null && prototype !== undefined) {
    if (prototype === PROMISE_PROTOTYPE) return true
    prototype = getPrototypeOf(prototype)
  }
  return false
}

/** How a settlement ended: the value, the rejection, or the deadline. Never has a prototype. */
export interface Settlement<T> {
  readonly kind: 'value' | 'error' | 'timeout'
  readonly value?: T | undefined
  readonly error?: unknown
}

function box<T>(
  kind: Settlement<T>['kind'],
  value?: T | undefined,
  error?: unknown
): Settlement<T> {
  const result = createObject(null)
  result['kind'] = kind
  result['value'] = value
  result['error'] = error
  return result as unknown as Settlement<T>
}

/** Attaches a no-op rejection handler, so an early rejection is never unhandled while another promise waits. */
export function ignoreRejection(promise: Promise<unknown>): void {
  onRejection(promise, noop)
}

/**
 * Waits for `work` for at most `timeoutMs` and reports how it ended, through a settlement that has no
 * prototype. It never rejects: a rejection and a deadline are values, so no `catch` stands between the
 * decision and a replaced built-in.
 *
 * @param work - The in-flight work; a promise that is not native is awaited through an async function first.
 * @param timeoutMs - The deadline; a non-positive or non-finite value fires on the next timer tick.
 * @returns How the work ended.
 * @throws {CacheException} `INVALID_OPTIONS` when the promise machinery was replaced or planted on, before
 *   the work is awaited. The caller treats that as a failure of the operation, never as an outcome.
 */
export async function settleWithin<T>(work: Promise<T>, timeoutMs: number): Promise<Settlement<T>> {
  const awaited = isNativePromise(work)
    ? work
    : (async (): Promise<T> => await (work as Promise<T>))()
  // The work has a handler before the check can refuse, so a refusal never leaves its rejection unhandled.
  ignoreRejection(awaited)
  assertPromiseIntrinsics()
  let finish: (settlement: Settlement<T>) => void = noop
  const outcome = new IntrinsicPromise<Settlement<T>>((resolve) => {
    finish = resolve
  })
  // The inner wait starts first, and its check runs immediately before its own await.
  const inner = (async (): Promise<void> => {
    try {
      assertPromiseIntrinsics()
      finish(box('value', await awaited))
    } catch (error) {
      finish(box<T>('error', undefined, error))
    }
  })()
  ignoreRejection(inner)
  const timer = setTimeout(() => finish(box<T>('timeout')), timeoutMs)
  assertPromiseIntrinsics()
  const settlement = await outcome
  clearTimeout(timer)
  assertPromiseIntrinsics()
  return settlement
}

/**
 * Watches a promise for its rejection with a native `await` of the promise after it has its own
 * `constructor`, so neither `.catch` nor `then` is looked up and `Symbol.species` is never read: a
 * `then` call would read the species of the constructor, and a throwing one would leave the rejection
 * unhandled. The wait starts before this returns, so the promise has a handler before anything else runs.
 *
 * @param promise - The promise to watch.
 * @param handler - Called with the rejection; its own throw is dropped.
 * @throws {CacheException} `INVALID_OPTIONS` when the promise cannot be pinned; it is still watched.
 */
export function onRejection(promise: Promise<unknown>, handler: (error: unknown) => void): void {
  let refusal: unknown
  try {
    pinConstructor(promise)
  } catch (error) {
    refusal = error
  }
  void (async (): Promise<void> => {
    try {
      await promise
    } catch (error) {
      try {
        handler(error)
      } catch {
        // The handler's own failure is dropped, so no rejection of this watcher is left unhandled.
      }
    }
  })()
  // The promise is watched either way; a promise that could not be pinned is refused to the caller.
  if (refusal !== undefined) throw refusal
}

/**
 * Starts `call` and absorbs whatever it does: a throw, a rejection, or a thenable that throws. A failure is
 * reported once to `onFailure`; nothing reaches the caller and no promise static is read.
 *
 * @param call - Invokes the host's function.
 * @param onFailure - Told that `call` failed, with no detail of the failure.
 */
export function absorbCall(call: () => unknown, onFailure: () => void): void {
  onRejection(
    (async (): Promise<void> => {
      try {
        await call()
      } catch {
        onFailure()
      }
    })(),
    noop
  )
}

/**
 * Awaits every promise, in the order given, and rejects with the first rejection in that order. Every
 * promise has a handler before anything can refuse or await, so no rejection is left unhandled, and each
 * await is preceded by a synchronous check.
 *
 * @param promises - Work already in flight.
 * @returns The values, in the order given.
 * @throws {CacheException} `INVALID_OPTIONS` when the promise machinery was replaced or planted on.
 */
export async function awaitAll<T>(promises: readonly Promise<T>[]): Promise<T[]> {
  const awaited: Promise<T>[] = []
  let refusal: unknown
  for (let index = 0; index < promises.length; index += 1) {
    const work = promises[index] as Promise<T>
    const native = isNativePromise(work)
      ? work
      : (async (): Promise<T> => await (work as Promise<T>))()
    try {
      ignoreRejection(native)
    } catch (error) {
      // A promise that cannot be pinned is still watched; the others are watched before this refuses.
      if (refusal === undefined) refusal = error
    }
    awaited[index] = native
  }
  assertPromiseIntrinsics()
  if (refusal !== undefined) throw refusal
  const values: T[] = []
  for (let index = 0; index < awaited.length; index += 1) {
    assertPromiseIntrinsics()
    values[index] = await (awaited[index] as Promise<T>)
  }
  assertPromiseIntrinsics()
  return values
}
