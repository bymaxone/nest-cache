/**
 * A host that replaces a promise built-in after the import cannot turn a failed `QUIT` into a clean close
 * or a failed command into a reply.
 *
 * Layer: server. Covers `closeClient` (its verdict never comes from `Promise.race`) and
 * `guardClient` (its rejection mapping never goes through `.catch`), under the four forgeries a host can
 * write: a replaced static or prototype method, a replace-and-restore of `Promise.prototype.constructor`
 * from a replaced `then`, and a `then` planted on `Object.prototype`, `Array.prototype` or `Function.prototype`.
 */
import { closeClient } from './close-client'
import {
  forgedThen,
  handledRejection,
  realRace,
  realThen,
  restoreBuiltins,
  underForgery
} from '../../test-helpers/forge-promise'
import { execTransaction } from './exec-transaction'
import { guardClient } from './guard-client'
import { HandlerGate } from './handler-gate'

/** A client whose `QUIT` rejects: the close is not clean, whatever a host does to the built-ins. */
const failingQuit = (): { status: string; quit: jest.Mock; disconnect: jest.Mock } => ({
  status: 'ready',
  quit: jest.fn(() => handledRejection()),
  disconnect: jest.fn()
})

/** A client whose `PING` rejects. */
const failingPing = (): { ping: () => Promise<string> } => ({
  ping: () => handledRejection()
})

afterEach(restoreBuiltins)

describe('closeClient under a forged promise built-in', () => {
  // A replaced Promise.race that always resolves read as a clean quit, so disconnect never ran.
  it('disconnects when Promise.race is replaced and the quit rejects', async () => {
    const client = failingQuit()
    const forced = jest.fn()

    await underForgery(
      () => {
        Promise.race = (() => realRace.call(Promise, [Promise.resolve()])) as typeof Promise.race
      },
      () => closeClient(client, 50, forced)
    )

    expect(forced).toHaveBeenCalledTimes(1)
    expect(client.disconnect).toHaveBeenCalledTimes(1)
  })

  // H1: a replaced then that swaps the constructor while an await reads it, and puts it back afterwards.
  it('disconnects when a replaced then swaps the constructor and restores it (H1)', async () => {
    const client = failingQuit()
    const forced = jest.fn()

    await underForgery(
      () => {
        Promise.prototype.then = forgedThen as typeof Promise.prototype.then
      },
      () => closeClient(client, 50, forced)
    )

    expect(forced).toHaveBeenCalledTimes(1)
    expect(client.disconnect).toHaveBeenCalledTimes(1)
  })

  // H2: a then planted before the call is refused at entry, which fails closed: the disconnect still runs.
  it.each([
    ['Object.prototype', Object.prototype],
    ['Array.prototype', Array.prototype],
    ['Function.prototype', Function.prototype]
  ])('disconnects when a then is planted on %s (H2)', async (_name, owner) => {
    const client = { ...failingQuit(), quit: jest.fn().mockResolvedValue('OK') }
    const forced = jest.fn()

    await underForgery(
      () => {
        Object.defineProperty(owner, 'then', { value: () => undefined, configurable: true })
      },
      () => closeClient(client, 50, forced)
    )

    expect(forced).toHaveBeenCalledTimes(1)
    expect(client.quit).not.toHaveBeenCalled()
    expect(client.disconnect).toHaveBeenCalledTimes(1)
  })

  // The clean path stays clean: an APM-style wrapped then that forwards, with no forgery, is not a refusal.
  it('closes cleanly when a then wrapper forwards faithfully', async () => {
    const client = { ...failingQuit(), quit: jest.fn().mockResolvedValue('OK') }
    const forced = jest.fn()

    await underForgery(
      () => {
        Promise.prototype.then = function wrapped(
          this: Promise<unknown>,
          ...args: Parameters<typeof realThen>
        ) {
          return realThen.apply(this, args)
        } as typeof Promise.prototype.then
      },
      () => closeClient(client, 50, forced)
    )

    expect(forced).not.toHaveBeenCalled()
    expect(client.disconnect).not.toHaveBeenCalled()
  })
})

describe('guardClient under a forged promise built-in', () => {
  // A replaced Promise.prototype.catch answered for the command, so a failed PING read as PONG.
  it('rejects a failed command when Promise.prototype.catch is replaced', async () => {
    const guarded = guardClient(failingPing())

    const outcome = await underForgery(
      () => {
        Promise.prototype.catch = function forged() {
          return Promise.resolve('PONG')
        } as typeof Promise.prototype.catch
      },
      () => guarded.ping()
    )

    expect(outcome.settled).toBe('rejected')
  })

  // H1 on the command path.
  it('rejects a failed command when a replaced then swaps and restores the constructor (H1)', async () => {
    const guarded = guardClient(failingPing())

    const outcome = await underForgery(
      () => {
        Promise.prototype.then = forgedThen as typeof Promise.prototype.then
      },
      () => guarded.ping()
    )

    expect(outcome.settled).toBe('rejected')
  })

  // H2 on the command path: refused at entry, as a rejection of the command.
  it('rejects the command when a then is planted on Object.prototype (H2)', async () => {
    const guarded = guardClient({ ping: () => Promise.resolve('PONG') })

    const outcome = await underForgery(
      () => {
        Object.defineProperty(Object.prototype, 'then', {
          value: () => undefined,
          configurable: true
        })
      },
      () => guarded.ping()
    )

    expect(outcome.settled).toBe('rejected')
    expect(outcome.value).toMatchObject({ details: { reason: expect.any(String) } })
  })

  // The replies of a healthy command are unchanged when nothing is replaced.
  it('returns the reply of a healthy command', async () => {
    await expect(guardClient({ ping: () => Promise.resolve('PONG') }).ping()).resolves.toBe('PONG')
  })
})

describe('execTransaction under a forged promise built-in', () => {
  // A replaced catch answered for the MULTI, so a rejected batch read as done.
  it('rejects when Promise.prototype.catch is replaced and the EXEC rejects', async () => {
    const tx = { exec: () => handledRejection() } as never

    const outcome = await underForgery(
      () => {
        Promise.prototype.catch = function forged() {
          return Promise.resolve([])
        } as typeof Promise.prototype.catch
      },
      () => execTransaction(tx)
    )

    expect(outcome.settled).toBe('rejected')
  })
})

describe('guardClient error mapping under a replaced global Promise (A3)', () => {
  // `result instanceof Promise` read the replaced global, so the raw driver error escaped.
  it('still maps a failed command to a CacheException', async () => {
    const failed = handledRejection(new Error('Command timed out'))
    const guarded = guardClient({ ping: () => failed })

    const outcome = await underForgery(
      () => {
        globalThis.Promise = class Other {} as unknown as PromiseConstructor
      },
      () => guarded.ping()
    )

    expect(outcome.settled).toBe('rejected')
    expect(outcome.value).toMatchObject({ name: 'CacheException' })
  })
})

describe('HandlerGate under a forged then (A2)', () => {
  const settleTicks = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve))

  // A replaced then that never calls back leaked every slot: the gate stayed full.
  it('frees the slot when then is replaced and never calls back', async () => {
    const gate = new HandlerGate(1, undefined)
    const started: string[] = []
    Promise.prototype.then = function lost(this: Promise<unknown>) {
      return this
    } as typeof Promise.prototype.then
    try {
      gate.submit(
        () => {
          started.push('a')
          return Promise.resolve()
        },
        () => true
      )
    } finally {
      restoreBuiltins()
    }
    await settleTicks()

    expect(
      gate.submit(
        () => {
          started.push('b')
          return Promise.resolve()
        },
        () => true
      )
    ).toBe(true)
    await settleTicks()
    expect(started).toEqual(['a', 'b'])
  })
})
