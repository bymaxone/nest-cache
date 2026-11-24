/**
 * Unit tests for the promise forgeries of the specs.
 *
 * Layer: test helper. A forgery must be removed when the call under test ends.
 */
import {
  forgedThen,
  handledRejection,
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
