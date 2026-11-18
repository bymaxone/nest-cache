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
 * Runs a transaction and returns the reply of each queued command.
 *
 * @param transaction - The transaction, with its commands already queued.
 * @returns The replies, in the order the commands were queued.
 * @throws {CacheException} `CONNECTION_LOST` (`reason: 'transaction_aborted'`) when `EXEC` answers
 *   nothing, and otherwise the first failing command's error, mapped like any command's.
 */
export async function execTransaction(transaction: ChainableCommander): Promise<unknown[]> {
  const replies = await guardClient(transaction).exec()
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
