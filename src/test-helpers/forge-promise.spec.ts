/**
 * Unit tests for the promise forgeries of the specs.
 *
 * Layer: test helper. A forgery must be removed when the call under test ends.
 */
import {
  forgedThen,
  handledRejection,
  plantSelfRestoring,
  realConstructor,
  realThen,
  restoreBuiltins,
  underForgery
} from './forge-promise'

describe('underForgery', () => {
  afterEach(restoreBuiltins)

  // Scenario: a row replaces `then` and the call resolves.
  // Rule: the verdict is reported and the real `then` is back afterwards.
  it('reports a resolution and restores the replaced built-in', async () => {
    const outcome = await underForgery(
      () => {
        Promise.prototype.then = forgedThen as typeof Promise.prototype.then
      },
      () => Promise.resolve(1)
    )

    expect(outcome.settled).toBe('resolved')
    expect(Promise.prototype.then).toBe(realThen)
  })

  // Scenario: the call rejects.
  // Rule: the rejection is reported, not thrown, and a handled rejection raises nothing.
  it('reports a rejection', async () => {
    const outcome = await underForgery(
      () => undefined,
      () => handledRejection(new Error('x'))
    )

    expect(outcome).toMatchObject({ settled: 'rejected', value: expect.any(Error) })
  })
})

describe('plantSelfRestoring', () => {
  afterEach(restoreBuiltins)

  // Scenario: both accessors are read, once each, with nothing awaited while they are live.
  // Rule: each read forges its slot, counts, and puts the original back, so the runner is never forged.
  it('forges each slot once, counts the reads and restores the originals', () => {
    const planted = plantSelfRestoring('forged')
    const forgedConstructor = Promise.prototype.constructor
    const forgedThenSlot = Promise.prototype.then as unknown as (
      resolve?: (v: unknown) => void
    ) => void
    const answers: unknown[] = []
    forgedThenSlot((answer) => answers.push(answer))
    forgedThenSlot()

    expect(forgedConstructor).toBe(Object)
    expect(answers).toEqual(['forged'])
    expect(planted.reads()).toBe(2)
    expect(Promise.prototype.constructor).toBe(realConstructor)
    expect(Promise.prototype.then).toBe(realThen)
  })
})
