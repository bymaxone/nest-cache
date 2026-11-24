/**
 * Merges several `ICacheEvents` bags into one, because the module accepts a single `events`.
 *
 * Layer: observability, an optional subpath. Every bag is called, in the order given, with a copy of
 * its own, whatever an earlier one threw or rejected with: a faulty observer must not hide the event
 * from the others, and one that writes to its data must not alter what the next one receives. The
 * first failure is then raised to the module, which logs it as `CACHE_HOOK_FAILED` and absorbs it.
 */
import { awaitAll, onRejection } from '@bymax-one/nest-cache'
import type { ICacheEvents } from '@bymax-one/nest-cache'

/**
 * Calls one callback of every bag and raises the first failure only after every bag has run.
 *
 * @param bags - The bags to call.
 * @param call - Invokes the callback of one bag, with that bag's own copy of the arguments.
 * @returns A promise that rejects when a bag's callback rejects, so the caller can adopt it.
 * @throws The first synchronous failure.
 */
function fanOut(
  bags: readonly ICacheEvents[],
  call: (bag: ICacheEvents) => unknown
): Promise<void> {
  let failure: { error: unknown } | undefined
  const pending = bags.map((bag): unknown => {
    try {
      return call(bag)
    } catch (error) {
      failure ??= { error }
      return undefined
    }
  })
  const settled = (async (): Promise<void> => {
    await awaitAll(pending as Promise<unknown>[])
  })()
  if (failure !== undefined) {
    onRejection(settled, () => undefined)
    throw failure.error
  }
  return settled
}

/**
 * Builds the bag that forwards each callback to every given bag.
 *
 * @param bags - The bags to combine, for example a connection tally's and the observability's.
 * @returns One bag to hand to `BymaxCacheModule` as `events`.
 */
export function combineCacheEvents(...bags: readonly ICacheEvents[]): ICacheEvents {
  return {
    onEvent: (event, data) =>
      fanOut(bags, (bag) => bag.onEvent?.(event, Object.freeze({ ...data }))),
    onOperation: (operation, outcome) =>
      fanOut(bags, (bag) => bag.onOperation?.(operation, outcome)),
    onQueue: (queued) => fanOut(bags, (bag) => bag.onQueue?.(queued))
  }
}
