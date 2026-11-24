/**
 * Unit tests for the first-rejection rule of `awaitAll`.
 *
 * Layer: server. The aggregate settles as soon as any input rejects, whatever order the inputs are in
 * and whether an earlier one is still pending, and no input's rejection is left unhandled afterwards.
 */
import { awaitAll } from './settle'

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('awaitAll first rejection', () => {
  // Scenario: an earlier input never settles and a later one rejects; the aggregate must reject.
  it('rejects as soon as any input rejects, while an earlier one is still pending', async () => {
    const failure = new Error('later')
    const aggregate = awaitAll<unknown>([
      new Promise<void>(() => undefined),
      Promise.reject(failure)
    ])

    const outcome = await Promise.race([
      aggregate.then(
        () => 'resolved',
        (error: unknown) => error
      ),
      tick().then(() => 'pending')
    ])

    expect(outcome).toBe(failure)
  })

  // Scenario: two inputs reject; the aggregate carries one of them and the other is handled.
  it('leaves no unhandled rejection once the aggregate has settled', async () => {
    const unhandled: unknown[] = []
    const record = (reason: unknown): void => void unhandled.push(reason)
    process.on('unhandledRejection', record)
    const late = new Promise<void>((_resolve, reject) =>
      setTimeout(() => reject(new Error('b')), 5)
    )

    await expect(awaitAll<unknown>([Promise.reject(new Error('a')), late])).rejects.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 20))
    process.off('unhandledRejection', record)

    expect(unhandled).toEqual([])
  })

  // Scenario: success keeps the order of the inputs, whichever settles first.
  it('resolves with the values in the order given', async () => {
    const slow = new Promise<number>((resolve) => setTimeout(() => resolve(1), 5))

    await expect(awaitAll([slow, Promise.resolve(2)])).resolves.toEqual([1, 2])
  })
})
