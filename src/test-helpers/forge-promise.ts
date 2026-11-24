/**
 * Forgeries of the promise built-ins, for the specs that prove a decision cannot be written by a host.
 *
 * Layer: test helper. Every forgery is installed around one call and removed before the test runner
 * awaits anything else, because the runner awaits through the same `then`.
 */

/** The intrinsic `Promise.race`, captured before any row replaces it. */
export const realRace = Promise.race
/** The intrinsic `Promise.all`, captured before any row replaces it. */
export const realAll = Promise.all
/** The intrinsic `Promise.prototype.catch`, captured so a row can restore it. */
export const realCatch = Promise.prototype.catch
/** The intrinsic `Promise.prototype.then`, for rows that call it directly or restore it. */
export const realThen = Promise.prototype.then
/** The intrinsic `Promise.prototype.constructor`, captured so a row can repair it. */
export const realConstructor = Promise.prototype.constructor
/** The intrinsic `Promise` global, captured so a row can restore a replaced binding. */
export const RealPromise = Promise

/** Puts every built-in a row replaced or planted back. */
export function restoreBuiltins(): void {
  Promise.race = realRace
  Promise.all = realAll
  Promise.prototype.catch = realCatch
  Promise.prototype.then = realThen
  Promise.prototype.constructor = realConstructor
  globalThis.Promise = RealPromise
  for (const owner of [Object.prototype, Array.prototype, Function.prototype]) {
    Reflect.deleteProperty(owner, 'then')
  }
}

/**
 * Runs `run` while `install` has replaced a built-in, and restores them before returning.
 *
 * @param install - Replaces or plants what the row forges.
 * @param run - The call under test.
 * @returns Whether `run` resolved or rejected, and with what.
 */
export async function underForgery(
  install: () => void,
  run: () => Promise<unknown>
): Promise<{ settled: 'resolved' | 'rejected'; value: unknown }> {
  install()
  try {
    return { settled: 'resolved', value: await run() }
  } catch (error) {
    return { settled: 'rejected', value: error }
  } finally {
    restoreBuiltins()
  }
}

/** A rejection already handled through the real `then`, so a forged verdict is not also a crash. */
export function handledRejection(error: Error = new Error('ECONNRESET')): Promise<never> {
  const rejected = Promise.reject(error)
  realThen.call(rejected, undefined, () => undefined)
  return rejected
}

/** A `then` that answers `'PONG'` for whatever it is asked to wait for, after swapping the constructor (H1). */
export function forgedThen(this: Promise<unknown>, resolve?: (value: unknown) => unknown): unknown {
  Promise.prototype.constructor = Object as unknown as PromiseConstructor
  queueMicrotask(() => {
    Promise.prototype.constructor = realConstructor
  })
  resolve?.('PONG')
  return undefined
}
