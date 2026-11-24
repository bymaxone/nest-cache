import { absorbCall } from '@bymax-one/nest-cache'

/**
 * Calls a host-supplied function so that nothing it does reaches the caller.
 *
 * Layer: observability. A hook or a logger method typed `=> void` still accepts an async function,
 * and a `try`/`catch` alone misses the rejected promise such a function returns: the process would
 * then die on an unhandled rejection. A synchronous throw, a rejected promise and a thenable that
 * throws are all absorbed here.
 *
 * @param call - Invokes the host's function.
 */
export function absorb(call: () => unknown): void {
  try {
    // Awaits a promise or any thenable, so a rejection (or a `then` that throws) is handled here.
    absorbCall(call, () => undefined)
  } catch {
    // A faulty host function must never fail what it observes.
  }
}
