/**
 * Execution of a `MULTI` transaction with its failures reported.
 *
 * Layer: server. `EXEC` resolves with one `[error, reply]` pair per queued command instead of rejecting
 * when one of them fails, and with `null` when the transaction was aborted, so a caller that reads only
 * the replies would take a failed write for a success.
 */
import type { ChainableCommander } from 'ioredis'

import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { guardClient, mapCommandFailure } from './guard-client'

/**
 * The command failure behind a discarded transaction. When a command is refused as it is queued (an
 * `OOM` for one, say), `EXEC` rejects with a generic `EXECABORT` and ioredis keeps the refusals on
 * `previousErrors`; the first of them is what the caller must see, not the generic abort.
 *
 * @param error - What `EXEC` rejected with.
 * @returns The first queued command's error, or `error` itself when there is none.
 */
function firstQueued(error: unknown): unknown {
  const previous: unknown =
    error instanceof Error ? Reflect.get(error, 'previousErrors') : undefined
  return Array.isArray(previous) && previous.length > 0 ? (previous[0] as unknown) : error
}

/**
 * Runs a transaction and returns the reply of each queued command.
 *
 * @param transaction - The transaction, with its commands already queued.
 * @returns The replies, in the order the commands were queued.
 * @throws {CacheException} `CONNECTION_LOST` (`reason: 'transaction_aborted'`) when `EXEC` answers
 *   nothing, and otherwise the first failing command's error, where only a timeout or an offline
 *   connection is mapped to a coded error and any other refusal is the driver's own: a command refused as
 *   it was queued reports its own refusal, not the `EXECABORT` that followed it.
 */
export async function execTransaction(transaction: ChainableCommander): Promise<unknown[]> {
  const replies = await guardClient(transaction)
    .exec()
    .catch((error: unknown) => {
      throw mapCommandFailure(firstQueued(error))
    })
  if (replies === null) {
    throw new CacheException(CACHE_ERROR_CODES.CONNECTION_LOST, { reason: 'transaction_aborted' })
  }
  return replies.map(([error, reply]) => {
    if (error !== null) {
      throw mapCommandFailure(error)
    }
    return reply
  })
}
