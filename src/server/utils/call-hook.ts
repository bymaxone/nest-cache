/**
 * Calls a host-supplied observability hook so that nothing it does reaches the caller.
 *
 * A hook typed `=> void` still accepts an async function, and a `try`/`catch` alone misses the
 * rejected promise such a function returns: the process would then die on an unhandled rejection.
 * A synchronous throw, a rejected promise and a thenable that throws are all absorbed here.
 *
 * @param call - Invokes the hook.
 */
export function callHook(call: () => unknown): void {
  try {
    const result = call()
    if (typeof (result as { then?: unknown } | null | undefined)?.then === 'function') {
      ;(result as PromiseLike<unknown>).then(undefined, () => undefined)
    }
  } catch {
    // A faulty observer must never fail what it observes.
  }
}
