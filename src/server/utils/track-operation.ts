/**
 * Reporting of how a cache command ended, to the host's `events.onOperation`.
 *
 * Layer: server. The outcome is one of a closed set, and an observer that fails never changes what
 * the command returned or threw.
 */
import type {
  CacheOperationName,
  CacheOperationOutcome
} from '../../shared/types/cache-event.types'
import type { ICacheEvents } from '../interfaces/cache-events.interface'
import { callHook } from './call-hook'
import { assertPromiseIntrinsics, ignoreRejection, pinned } from './settle'

/** The outcome of a command that completed and has no absence to report. */
export const completed = (): CacheOperationOutcome => 'ok'

/** `hit` when a read found something, `miss` when it found nothing. */
export const found = (hit: boolean): CacheOperationOutcome => (hit ? 'hit' : 'miss')

/**
 * Hands an operation's outcome to `events.onOperation`, absorbing anything it throws or rejects
 * with: a faulty observer must never fail the command it observes.
 *
 * @param events - The host's callbacks.
 * @param operation - The command's name.
 * @param outcome - How it ended.
 */
export function reportOperation(
  events: ICacheEvents | undefined,
  operation: CacheOperationName,
  outcome: CacheOperationOutcome
): void {
  callHook('onOperation', () => events?.onOperation?.(operation, outcome))
}

/**
 * Whether the host set an operation hook, read inside a guard: a getter or a proxy trap on the
 * host's `events` object can throw, and that must never fail the command it would observe.
 *
 * @param events - The host's callbacks.
 * @returns True when there is a hook to call.
 */
function isObserved(events: ICacheEvents | undefined): boolean {
  try {
    return events?.onOperation !== undefined
  } catch {
    return false
  }
}

/**
 * Runs one command and reports how it ended to `events.onOperation`, when that is set.
 *
 * @typeParam T - What the command resolves to.
 * @param events - The host's callbacks.
 * @param operation - The command's name.
 * @param run - Runs the command.
 * @param classify - Names the outcome of a completed command; `ok` when omitted.
 * @returns What the command resolved to.
 * @throws Whatever the command threw, after reporting `error`.
 */
export async function trackOperation<T>(
  events: ICacheEvents | undefined,
  operation: CacheOperationName,
  run: () => Promise<T>,
  classify: (result: T) => CacheOperationOutcome = completed
): Promise<T> {
  const pending = run()
  ignoreRejection(pending)
  if (!isObserved(events)) {
    assertPromiseIntrinsics()
    const value = await pinned(pending)
    assertPromiseIntrinsics()
    return value
  }
  let result: T
  try {
    assertPromiseIntrinsics()
    result = await pinned(pending)
  } catch (error) {
    reportOperation(events, operation, 'error')
    throw error
  }
  reportOperation(events, operation, classify(result))
  // The observer ran host code: a `then` it planted on a prototype would be read when `result` is returned.
  assertPromiseIntrinsics()
  return result
}
