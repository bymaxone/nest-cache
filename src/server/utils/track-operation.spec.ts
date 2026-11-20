/**
 * Unit tests for {@link trackOperation} and {@link reportOperation}.
 *
 * Layer: server. The outcome reaches `events.onOperation` exactly once per command, a failing
 * command still fails the caller, and a faulty observer never changes what the command returned.
 */
import { completed, found, reportOperation, trackOperation } from './track-operation'

describe('trackOperation', () => {
  // Scenario: a command that resolves, with no classifier.
  // Rule: it is reported as `ok` once, and its value reaches the caller.
  it('reports ok for a command that completes and returns its value', async () => {
    const onOperation = jest.fn()

    const result = await trackOperation({ onOperation }, 'set', async () => 7)

    expect(result).toBe(7)
    expect(onOperation.mock.calls).toEqual([['set', 'ok']])
  })

  it('reports what the classifier names', async () => {
    const onOperation = jest.fn()

    await trackOperation(
      { onOperation },
      'get',
      async () => null,
      (value) => found(value !== null)
    )

    expect(onOperation.mock.calls).toEqual([['get', 'miss']])
  })

  // Scenario: the command rejects.
  // Rule: `error` is reported once and the caller sees the same error object.
  it('reports error once and rethrows the same error', async () => {
    const onOperation = jest.fn()
    const failure = new Error('boom')

    await expect(
      trackOperation({ onOperation }, 'del', async () => Promise.reject(failure))
    ).rejects.toBe(failure)

    expect(onOperation.mock.calls).toEqual([['del', 'error']])
  })

  // Scenario: no observer is set.
  // Rule: the command runs and nothing is classified.
  it.each([undefined, {}])('runs the command untouched when the hooks are %p', async (events) => {
    const classify = jest.fn(() => 'hit' as const)

    const result = await trackOperation(events, 'get', async () => 'v', classify)

    expect(result).toBe('v')
    expect(classify).not.toHaveBeenCalled()
  })

  // Scenario: the observer throws, synchronously or by rejecting.
  // Rule: the command's value is unchanged and nothing escapes.
  it.each([
    [
      'throws',
      (): never => {
        throw new Error('sink')
      }
    ],
    ['rejects', async (): Promise<never> => Promise.reject(new Error('sink'))]
  ])('returns the value when the observer %s', async (_how, onOperation) => {
    await expect(trackOperation({ onOperation }, 'get', async () => 3)).resolves.toBe(3)
  })

  it('names the two outcomes of a command with nothing to report', () => {
    expect([completed(), found(true), found(false)]).toEqual(['ok', 'hit', 'miss'])
  })
})

describe('reportOperation', () => {
  it('does nothing when there are no events', () => {
    expect(() => reportOperation(undefined, 'get', 'hit')).not.toThrow()
  })
})
