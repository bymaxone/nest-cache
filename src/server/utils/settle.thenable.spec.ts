/**
 * `settleWithin` and `awaitAll` accept work that is a thenable rather than a native promise.
 *
 * Layer: server. A client double or a wrapped promise may hand back a thenable; it is adopted through an
 * async function first, so its value, its rejection and its timeout are reported like a native promise's.
 */
import { awaitAll, settleWithin } from './settle'

/** A thenable that is not a promise. */
function thenable<T>(
  settle: (resolve: (value: T) => void, reject: (error: unknown) => void) => void
): Promise<T> {
  return {
    then(resolve: (value: T) => void, reject: (error: unknown) => void) {
      settle(resolve, reject)
    }
  } as unknown as Promise<T>
}

describe('settleWithin on a thenable', () => {
  it('reports the value of a thenable that resolves', async () => {
    // Arrange
    const work = thenable<string>((resolve) => resolve('ok'))

    // Act
    const settlement = await settleWithin(work, 1000)

    // Assert
    expect(settlement.kind).toBe('value')
    expect(settlement.value).toBe('ok')
  })

  it('reports the rejection of a thenable that rejects', async () => {
    // Arrange
    const failure = new Error('boom')
    const work = thenable<string>((_resolve, reject) => reject(failure))

    // Act
    const settlement = await settleWithin(work, 1000)

    // Assert
    expect(settlement.kind).toBe('error')
    expect(settlement.error).toBe(failure)
  })

  it('reports a timeout for a thenable that never settles', async () => {
    // Arrange
    const work = thenable<string>(() => undefined)

    // Act
    const settlement = await settleWithin(work, 5)

    // Assert
    expect(settlement.kind).toBe('timeout')
  })
})

describe('awaitAll on thenables', () => {
  it('returns the values of thenables in the order given', async () => {
    // Arrange
    const first = thenable<number>((resolve) => resolve(1))
    const second = thenable<number>((resolve) => resolve(2))

    // Act
    const values = await awaitAll([first, second])

    // Assert
    expect(values).toEqual([1, 2])
  })
})
