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
import {
  absorbCall,
  awaitAll,
  IntrinsicPromise,
  onRejection,
  pinConstructor,
  settleWithin
} from './settle'
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

/** Plants a `then` on `Array.prototype`, which a refusing check reads before an array resolves. */
function plantArrayThen(): void {
  Object.defineProperty(Array.prototype, 'then', { value: () => undefined, configurable: true })
}

/**
 * Counts the unhandled rejections raised while `run` executes under a forgery (a constructor that throws
 * unless `install` says otherwise), and calls
 * `done` with the count once the built-ins are repaired. It takes a callback and returns no promise: the
 * runner reads `constructor` off any promise a test returns, which would throw while the getter is live.
 */
function unhandledDuring(
  run: () => unknown,
  done: (unhandled: number) => void,
  install: () => void = hostileConstructor
): void {
  let count = 0
  const listener = (): void => {
    count += 1
  }
  process.on('unhandledRejection', listener)
  install()
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
  // The rejection of the QUIT the library started is handled without reading the prototype's constructor.
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

  // The rejection of a command the guarded client forwards is handled the same way.
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

  // execTransaction handles the rejected EXEC before its own check can throw.
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

describe('inputs that are already running', () => {
  /** Runs `call` under `install`, handling the promise it returns, and expects no unhandled rejection. */
  function expectNoUnhandled(
    call: () => Promise<unknown>,
    install: () => void,
    finish: (error?: unknown) => void
  ): void {
    unhandledDuring(
      () => {
        realThen.call(call(), undefined, () => undefined)
      },
      (unhandled) => {
        try {
          expect(unhandled).toBe(0)
          finish()
        } catch (error) {
          finish(error)
        }
      },
      install
    )
  }

  // The check refuses before awaiting, and the rejection of an input must already have a handler.
  it('awaitAll handles a rejecting input before a planted then makes it refuse', (finish) => {
    expectNoUnhandled(() => awaitAll([bareRejection()]), plantArrayThen, finish)
  })

  // The same holds for the work a deadline waits on.
  it('settleWithin handles a rejecting work before a planted then makes it refuse', (finish) => {
    expectNoUnhandled(() => settleWithin(bareRejection(), 1000), plantArrayThen, finish)
  })

  // One input that cannot take a pin must not leave the inputs after it without a handler.
  it('awaitAll still watches every input when one of them is frozen', (finish) => {
    const frozen = Object.freeze(
      new IntrinsicPromise<never>((_resolve, reject) => setTimeout(reject, 5, 'x'))
    )
    expectNoUnhandled(
      () => awaitAll([frozen, bareRejection()]),
      () => undefined,
      finish
    )
  })

  // Two unpinnable inputs: the call refuses once, with the guard's code, and both are watched.
  it('awaitAll refuses when two inputs are frozen', async () => {
    const frozen = (): Promise<never> =>
      Object.freeze(new IntrinsicPromise<never>((_resolve, reject) => setTimeout(reject, 5, 'x')))

    await expect(awaitAll([frozen(), frozen()])).rejects.toMatchObject({
      code: 'cache.invalid_options'
    })
  })

  // A host promise that cannot take a pin is still watched: its later rejection is absorbed, not unhandled.
  it('absorbCall watches a frozen host promise before pinned refuses it', (finish) => {
    const frozen = Object.freeze(
      new IntrinsicPromise<never>((_resolve, reject) => setTimeout(reject, 5, 'x'))
    )
    expectNoUnhandled(
      async () => {
        absorbCall(
          () => frozen,
          () => undefined
        )
      },
      () => undefined,
      finish
    )
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
