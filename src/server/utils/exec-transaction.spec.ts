/**
 * Unit tests for {@link execTransaction}.
 *
 * Layer: server. A transaction discarded because a command was refused as it was queued rejects with
 * ioredis's generic `EXECABORT`; the caller must see the refusal that caused it, not the abort.
 */
import type { ChainableCommander } from 'ioredis'

import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { execTransaction } from './exec-transaction'

/** A transaction whose `exec` settles as given. */
function transaction(exec: () => Promise<unknown>): ChainableCommander {
  return { exec } as unknown as ChainableCommander
}

/** The rejection ioredis gives `EXEC` when a queued command was refused. */
function aborted(...previous: Error[]): Error {
  return Object.assign(new Error('EXECABORT Transaction discarded because of previous errors.'), {
    previousErrors: previous
  })
}

describe('execTransaction', () => {
  it('returns the replies in order', async () => {
    const replies = await execTransaction(
      transaction(async () => [
        [null, 'OK'],
        [null, 2]
      ])
    )

    expect(replies).toEqual(['OK', 2])
  })

  // Scenario: the server refused the first queued command (memory limit) and discarded the rest.
  // Rule: the caller gets that refusal, never the generic EXECABORT that followed it.
  it('rejects with the first queued refusal, not the EXECABORT', async () => {
    const oom = new Error('OOM command not allowed when used memory > maxmemory')
    const second = new Error('OOM again')

    const failure = await execTransaction(
      transaction(async () => Promise.reject(aborted(oom, second)))
    ).catch((error: unknown) => error)

    expect(failure).toBe(oom)
  })

  it('maps a queued refusal like any command failure', async () => {
    const failure = await execTransaction(
      transaction(async () => Promise.reject(aborted(new Error('Command timed out'))))
    ).catch((error: unknown) => error)

    expect((failure as CacheException).code).toBe(CACHE_ERROR_CODES.COMMAND_TIMEOUT)
  })

  // A rejection that carries no queued refusal is passed on as it is.
  it.each([
    ['an empty list', aborted()],
    ['no list', new Error('connection reset')]
  ])('rejects with the error itself when it has %s', async (_case, error) => {
    const failure = await execTransaction(transaction(async () => Promise.reject(error))).catch(
      (thrown: unknown) => thrown
    )

    expect(failure).toBe(error)
  })

  it('rejects with CONNECTION_LOST when EXEC answers nothing', async () => {
    const failure = await execTransaction(transaction(async () => null)).catch(
      (error: unknown) => error
    )

    expect((failure as CacheException).code).toBe(CACHE_ERROR_CODES.CONNECTION_LOST)
    expect((failure as CacheException).details).toEqual({ reason: 'transaction_aborted' })
  })
})
