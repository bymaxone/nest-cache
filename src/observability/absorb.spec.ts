/**
 * Unit tests for {@link absorb}.
 *
 * Layer: observability. A host function's throw, rejection or throwing thenable never reaches the
 * caller or the process.
 */
import { absorb } from './absorb'

describe('absorb', () => {
  const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

  it('calls the function once and returns nothing', () => {
    const call = jest.fn(() => 42)

    expect(absorb(call)).toBeUndefined()
    expect(call).toHaveBeenCalledTimes(1)
  })

  it.each([
    [
      'throws',
      (): never => {
        throw new Error('sink')
      }
    ],
    ['rejects', async (): Promise<never> => Promise.reject(new Error('sink'))],
    [
      'returns a throwing thenable',
      (): unknown => ({
        then: (): never => {
          throw new Error('sink')
        }
      })
    ]
  ])('absorbs a function that %s', async (_how, call) => {
    const unhandled: unknown[] = []
    const record = (reason: unknown): void => void unhandled.push(reason)
    process.on('unhandledRejection', record)

    expect(() => absorb(call)).not.toThrow()
    await settle()
    process.off('unhandledRejection', record)

    expect(unhandled).toEqual([])
  })
})
