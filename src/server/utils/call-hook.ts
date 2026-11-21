/**
 * Calls the hooks of the host's `events` so that nothing they do reaches the caller.
 *
 * Layer: server.
 */
import { Logger } from '@nestjs/common'

import type { CacheEventName } from '../../shared/types/cache-event.types'
import type { ICacheEvents } from '../interfaces/cache-events.interface'

/** The hooks of `ICacheEvents`, the only names a failure is logged under. */
export type CacheHookName = 'onEvent' | 'onOperation' | 'onQueue'

/** The hooks whose first failure has been logged. */
const LOGGED = new Set<CacheHookName>()

/** Where the failure of a hook is logged. */
const LOGGER = new Logger('BymaxCache')

/** The `event` code of the line written when a hook fails. */
export const HOOK_FAILED_EVENT = 'CACHE_HOOK_FAILED'

/**
 * Whether Nest would write a `warn` line now. The static `Logger.staticInstanceRef` is protected, not
 * part of Nest's contract, so it is read inside a guard and any doubt counts as writable: the cost of
 * a wrong yes is the budget spent on a line nobody sees, the old behaviour. The public static
 * `Logger.isLevelEnabled` alone cannot tell, so this reads both; measured on `@nestjs/common` 11.0.16,
 * 11.2.11 and 12.6.0, where `overrideLogger(false)` leaves it false and the instance undefined.
 *
 * @returns False only when the application disabled Nest's logging (`logger: false`) or left `warn`
 *   out of an explicit list of levels.
 */
function writable(): boolean {
  try {
    return (
      Reflect.get(Logger, 'staticInstanceRef') !== undefined &&
      (Reflect.get(Logger, 'logLevels') === undefined || Logger.isLevelEnabled('warn'))
    )
  } catch {
    return true
  }
}

/** Logs the first failure of a hook, absorbing a logger that fails in turn. */
function failed(hook: CacheHookName): void {
  if (LOGGED.has(hook) || !writable()) {
    return
  }
  LOGGED.add(hook)
  try {
    LOGGER.warn({ event: HOOK_FAILED_EVENT, message: 'A host hook failed', hook })
  } catch {
    // A faulty logger must not fail what it observes.
  }
}

/**
 * Calls a host-supplied observability hook so that nothing it does reaches the caller.
 *
 * A hook typed `=> void` still accepts an async function, and a `try`/`catch` alone misses the
 * rejected promise such a function returns: the process would then die on an unhandled rejection.
 * A synchronous throw, a rejected promise and a thenable that throws are all absorbed here. The first
 * failure of each hook is logged once as `CACHE_HOOK_FAILED` with the hook's name and nothing the
 * hook threw; the ones after it are absorbed silently, so a hook that fails on every command cannot
 * flood the log.
 *
 * @param hook - The hook's name.
 * @param call - Invokes the hook.
 */
export function callHook(hook: CacheHookName, call: () => unknown): void {
  try {
    // Adopts a promise or any thenable, so a rejection (or a `then` that throws) is handled here.
    void Promise.resolve(call()).then(undefined, () => failed(hook))
  } catch {
    failed(hook)
  }
}

/**
 * Hands a lifecycle event to `events.onEvent` with a frozen copy of its data made for this call, so
 * a hook that writes to it can alter neither what the library holds nor what another hook receives.
 *
 * @param events - The host's callbacks.
 * @param event - The event name.
 * @param data - The payload, copied shallowly.
 */
export function fireEvent(
  events: ICacheEvents | undefined,
  event: CacheEventName,
  data: Record<string, unknown>
): void {
  callHook('onEvent', () => events?.onEvent?.(event, Object.freeze({ ...data })))
}
