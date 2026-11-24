/**
 * The helpers that decide on a promise do not depend on the slots they guard.
 *
 * Layer: server. Covers two shapes a host can write: a `Promise.prototype.constructor` that throws, which
 * must not leave a rejection of a promise the library started unhandled (a Node 24 crash), and a hooked
 * `setTimeout` that swaps the constructor, plants an answering `then` and restores both, which must not
 * change the verdict of `closeClient`.
 */
import type { ChainableCommander } from 'ioredis'

import { closeClient } from './close-client'
import { execTransaction } from './exec-transaction'
import { guardClient } from './guard-client'
import { IntrinsicPromise, onRejection, pinConstructor } from './settle'
import {
  forgedThen,
  RealPromise,
  realConstructor,
  realThen,
  restoreBuiltins,
  underForgery
} from '../../test-helpers/forge-promise'

/** A rejection nobody handled yet, as a client returns for a command or a `QUIT`. */
const bareRejection = (): Promise<never> => RealPromise.reject(new Error('ECONNRESET'))

/** Makes reading `Promise.prototype.constructor` throw, as a hostile host can. */
function hostileConstructor(): void {
  Object.defineProperty(Promise.prototype, 'constructor', {
    get() {
      throw new Error('hostile')
    },
    configurable: true
  })
}

function repairConstructor(): void {
  Object.defineProperty(Promise.prototype, 'constructor', {
    value: realConstructor,
    writable: true,
    configurable: true
  })
}

/**
 * Counts the unhandled rejections raised while `run` executes under a constructor that throws, and calls
 * `done` with the count once the built-ins are repaired. It takes a callback and returns no promise: the
 * runner reads `constructor` off any promise a test returns, which would throw while the getter is live.
 */
function unhandledDuring(run: () => unknown, done: (unhandled: number) => void): void {
  let count = 0
  const listener = (): void => {
    count += 1
  }
  process.on('unhandledRejection', listener)
  hostileConstructor()
  try {
    run()
  } catch {
    // the call refusing is part of the outcome; only unhandled rejections are counted
  }
  setTimeout(() => {
    repairConstructor()
    restoreBuiltins()
    setImmediate(() => {
      process.off('unhandledRejection', listener)
      done(count)
    })
  }, 30)
}

afterEach(() => {
  repairConstructor()
  restoreBuiltins()
})

describe('promise helpers under a hostile promise built-in', () => {
  // The rejection of the QUIT the library started got its handler through the prototype's constructor.
  it('leaves no rejection unhandled when the constructor throws and the quit rejects', (finish) => {
    const client = { status: 'ready', quit: jest.fn(bareRejection), disconnect: jest.fn() }

    unhandledDuring(
      () => closeClient(client, 50, jest.fn()),
      (unhandled) => {
        try {
          expect(unhandled).toBe(0)
          expect(client.disconnect).toHaveBeenCalledTimes(1)
          finish()
        } catch (error) {
          finish(error)
        }
      }
    )
  })

  // The rejection of a command the guarded client forwarded got its handler the same way.
  it('leaves no rejection unhandled when the constructor throws and a command rejects', (finish) => {
    const guarded = guardClient({ ping: bareRejection })

    unhandledDuring(
      () => {
        // The caller's own promise is handled here: only the library's rejections are counted.
        const returned = guarded.ping()
        Object.defineProperty(returned, 'constructor', { value: RealPromise })
        realThen.call(returned, undefined, () => undefined)
      },
      (unhandled) => {
        try {
          expect(unhandled).toBe(0)
          finish()
        } catch (error) {
          finish(error)
        }
      }
    )
  })

  // execTransaction's own check threw before the rejected EXEC had a handler.
  it('leaves no rejection unhandled when the constructor throws and the exec rejects', (finish) => {
    const transaction = { exec: bareRejection } as unknown as ChainableCommander

    unhandledDuring(
      () => {
        // The caller's own promise is handled here: only the library's rejections are counted.
        const returned = execTransaction(transaction)
        Object.defineProperty(returned, 'constructor', { value: RealPromise })
        realThen.call(returned, undefined, () => undefined)
      },
      (unhandled) => {
        try {
          expect(unhandled).toBe(0)
          finish()
        } catch (error) {
          finish(error)
        }
      }
    )
  })

  // A rejection handler that throws must not turn into a rejection of the promise `then` derives.
  it('leaves no rejection unhandled when the handler given to onRejection throws', (finish) => {
    let count = 0
    const listener = (): void => {
      count += 1
    }
    process.on('unhandledRejection', listener)
    onRejection(bareRejection(), () => {
      throw new Error('handler boom')
    })
    setTimeout(() => {
      setImmediate(() => {
        process.off('unhandledRejection', listener)
        try {
          expect(count).toBe(0)
          finish()
        } catch (error) {
          finish(error)
        }
      })
    }, 30)
  })

  // A hooked setTimeout runs while closeClient arms its deadline; what it forges must not reach the verdict.
  it('keeps the close forced when setTimeout swaps the constructor, plants a then and restores both', async () => {
    const client = { status: 'ready', quit: jest.fn(bareRejection), disconnect: jest.fn() }
    const forced = jest.fn()
    const realSetTimeout = globalThis.setTimeout

    const outcome = await underForgery(
      () => {
        globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
          Promise.prototype.then = forgedThen as typeof Promise.prototype.then
          const timer = realSetTimeout(...args)
          Promise.prototype.then = RealPromise.prototype.then
          Promise.prototype.constructor = realConstructor
          return timer
        }) as typeof setTimeout
      },
      () => closeClient(client, 50, forced)
    )
    globalThis.setTimeout = realSetTimeout

    expect(outcome.settled).toBe('resolved')
    expect(forced).toHaveBeenCalledTimes(1)
    expect(client.disconnect).toHaveBeenCalledTimes(1)
  })
})

describe('pinConstructor', () => {
  // A frozen promise cannot hold the property: the pin refuses, never reports success.
  it('refuses a frozen promise and watches it all the same', (finish) => {
    const frozen = Object.freeze(
      new IntrinsicPromise((_resolve, reject) => setTimeout(reject, 5, 'x'))
    )
    let handled = 0
    expect(() => onRejection(frozen, () => (handled += 1))).toThrow()
    setTimeout(() => {
      try {
        expect(handled).toBe(1)
        finish()
      } catch (error) {
        finish(error)
      }
    }, 30)
  })

  // The pin cannot be removed or rewritten once it is in place.
  it('cannot be changed after the promise was pinned', () => {
    const pinned = new IntrinsicPromise<void>((resolve) => resolve())
    pinConstructor(pinned)

    expect(() => Object.defineProperty(pinned, 'constructor', { value: Object })).toThrow()
    expect(Reflect.deleteProperty(pinned, 'constructor')).toBe(false)
    expect(() => pinConstructor(pinned)).not.toThrow()
  })
})
