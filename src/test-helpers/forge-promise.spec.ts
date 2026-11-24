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

describe('restoreBuiltins', () => {
  // Scenario: a row planted `get` on Object.prototype, as the species read would find it.
  // Rule: restoring removes it, so no later descriptor read finds an inherited accessor.
  it('removes a get planted on Object.prototype', () => {
    Object.defineProperty(Object.prototype, 'get', { value: () => undefined, configurable: true })

    try {
      restoreBuiltins()

      expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'get')).toBe(false)
    } finally {
      Reflect.deleteProperty(Object.prototype, 'get')
    }
  })
})

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

describe('handledRejection', () => {
  // Scenario: the default error. Rule: it reads as a dropped connection, the text the specs look for.
  it('rejects with a connection reset when no error is given', async () => {
    await expect(handledRejection()).rejects.toThrow('ECONNRESET')
  })
})

describe('forgedThen', () => {
  afterEach(restoreBuiltins)

  // Scenario: the forged then is asked to wait. Rule: it answers 'PONG' to whoever adopts it.
  it("answers 'PONG' to the resolver it is given", () => {
    const answers: unknown[] = []

    forgedThen.call(Promise.resolve(), (answer) => answers.push(answer))

    expect(answers).toEqual(['PONG'])
  })

  // Scenario: the forged then swaps the constructor and schedules the repair. Rule: the repair is what the
  // scheduled job does, so the runner's own await is not left reading the forged constructor.
  it('swaps the constructor and puts it back in the job it schedules', () => {
    const jobs: Array<() => void> = []
    const schedule = jest.spyOn(globalThis, 'queueMicrotask').mockImplementation((job) => {
      jobs.push(job)
    })

    try {
      forgedThen.call(Promise.resolve())
      const swapped = Promise.prototype.constructor
      jobs.forEach((job) => job())

      expect(swapped).toBe(Object)
      expect(Promise.prototype.constructor).toBe(realConstructor)
    } finally {
      schedule.mockRestore()
    }
  })
})

describe('plantSelfRestoring', () => {
  afterEach(restoreBuiltins)

  // Scenario: both accessors are read, once each, with nothing awaited while they are live.
  // Rule: each read forges its slot, counts, and puts the original back, so the runner is never forged.
  it('forges each slot once, counts the reads and restores the originals', () => {
    const planted = plantSelfRestoring('forged')
    const plantedFlags = (['constructor', 'then'] as const).map(
      (key) => Object.getOwnPropertyDescriptor(Promise.prototype, key)?.enumerable
    )
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
    expect(plantedFlags).toEqual([false, false])
  })

  // Scenario: each slot has fired once. Rule: the original is back as a hidden property, not an enumerable one.
  it('puts the originals back as non-enumerable properties', () => {
    plantSelfRestoring('forged')
    void Promise.prototype.constructor
    void Promise.prototype.then

    const flags = (['constructor', 'then'] as const).map(
      (key) => Object.getOwnPropertyDescriptor(Promise.prototype, key)?.enumerable
    )

    expect(flags).toEqual([false, false])
  })
})
