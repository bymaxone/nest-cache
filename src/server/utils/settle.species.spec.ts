/**
 * Unit tests for the species baseline, the pin of a promise's constructor and the refusals of `awaitAll`.
 *
 * Layer: server. `Promise[Symbol.species]` is read by every `then` call a dependency makes on a library promise,
 * so a replaced accessor is refused like a replaced constructor; the pin gives a promise an own constructor
 * with exactly one descriptor; `awaitAll` fails as a whole when a member is refused, at once and without
 * waiting for an earlier member.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { realSpecies, restoreBuiltins } from '../../test-helpers/forge-promise'
import {
  assertPromiseIntrinsics,
  assertNoThen,
  awaitAll,
  IntrinsicPromise,
  PROMISE_REASON,
  pinConstructor,
  pinned,
  settleWithin
} from './settle'

class FakeConstructor {}

/** Installs a species accessor that answers a fake constructor on every read and stays in place. */
function plantPersistentSpecies(): void {
  Object.defineProperty(Promise, Symbol.species, {
    configurable: true,
    get: () => FakeConstructor
  })
}

/** What `run` threw, or `undefined`. */
function thrownBy(run: () => void): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  return undefined
}

/** A null-prototype copy, which a `then` planted on Object.prototype cannot turn into a thenable. */
function box(fields: object): object {
  return Object.assign(Object.create(null) as object, fields)
}

/** Whether a promise settled within a short wait, as `pending` otherwise. */
async function outcomeWithin(promise: Promise<unknown>): Promise<unknown> {
  const wait = new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 80))
  return await Promise.race([
    promise.then(
      (value) => box({ resolved: value }),
      (error: unknown) => box({ rejected: error })
    ),
    wait
  ])
}

describe('the species baseline', () => {
  afterEach(() => {
    restoreBuiltins()
  })

  // Scenario: a species accessor that hands a host constructor to every `then` call stays in place.
  it('refuses while a persistent species accessor answers another constructor', () => {
    plantPersistentSpecies()

    const refusal = thrownBy(assertPromiseIntrinsics)
    restoreBuiltins()

    expect(refusal).toMatchObject({
      details: { reason: PROMISE_REASON, count: 1 },
      response: { error: { code: CACHE_ERROR_CODES.INVALID_OPTIONS } }
    })
  })

  // Scenario: a library promise that is awaited while that accessor is in place. The call starts under the
  // plant and is awaited after it is removed, because the test runner awaits through the same species.
  it('refuses a wait on a library promise while the species accessor is replaced', async () => {
    plantPersistentSpecies()
    const running = settleWithin(Promise.resolve('up'), 50)
    restoreBuiltins()

    await expect(running).rejects.toMatchObject({
      response: { error: { code: CACHE_ERROR_CODES.INVALID_OPTIONS } }
    })
  })

  // Scenario: the species is a data property, and Object.prototype supplies the `get` of the original accessor.
  // Rule: the `get` is read as an own field of the descriptor only, so inheritance cannot give a data property
  // the original accessor's function.
  it('refuses a data species when Object.prototype supplies the original get', () => {
    Object.defineProperty(Promise, Symbol.species, { value: IntrinsicPromise, configurable: true })
    Object.defineProperty(Object.prototype, 'get', {
      value: realSpecies.get,
      configurable: true,
      writable: true
    })

    const refusal = thrownBy(assertPromiseIntrinsics)
    Reflect.deleteProperty(Object.prototype, 'get')
    restoreBuiltins()

    expect(refusal).toMatchObject({ details: { reason: PROMISE_REASON, count: 1 } })
  })

  // Scenario: nothing was replaced.
  it('accepts the species accessor of the language', () => {
    expect(thrownBy(assertPromiseIntrinsics)).toBeUndefined()
  })
})

describe('the pin of a promise constructor', () => {
  afterEach(() => {
    restoreBuiltins()
  })

  // Scenario: the descriptor the pin leaves, read exactly.
  it('gives a promise an own constructor that is not writable, enumerable or configurable', () => {
    const promise = Promise.resolve(1)

    pinConstructor(promise)

    expect(Object.getOwnPropertyDescriptor(promise, 'constructor')).toStrictEqual({
      value: IntrinsicPromise,
      writable: false,
      enumerable: false,
      configurable: false
    })
  })

  // Scenario: the pin hands `defineProperty` the descriptor, which a handler on the promise can record.
  // Rule: the descriptor names all four fields, so no flag is left to a default.
  it('hands defineProperty a descriptor that names every field', () => {
    const received: PropertyDescriptor[] = []
    const target = {}
    const recording = new Proxy(target, {
      defineProperty(object, key, descriptor): boolean {
        received.push(descriptor)
        return Reflect.defineProperty(object, key, descriptor)
      }
    })

    pinConstructor(recording as unknown as Promise<unknown>)

    expect(received).toStrictEqual([
      { value: IntrinsicPromise, writable: false, enumerable: false, configurable: false }
    ])
  })

  // Scenario: the pin cannot hold the property, and a host reads the reason in `details`.
  // Rule: the text is the one the library documents, not only the constant it is read from.
  it('names the replaced promise built-ins as the reason of a refusal', () => {
    const frozen = Object.freeze(new IntrinsicPromise<void>((resolve) => resolve()))

    const refusal = thrownBy(() => pinConstructor(frozen))

    expect(refusal).toMatchObject({
      details: {
        reason: 'Promise built-ins the library relies on were replaced after it loaded',
        count: 1
      }
    })
  })

  // Scenario: counting accessors on Promise.prototype for `constructor` and `then`, armed only while an
  // `await` starts (it reads what it reads synchronously, before it yields).
  // Rule: an await of a pinned promise reads neither; an await of an unpinned one reads the constructor.
  it('keeps an await of a pinned promise off Promise.prototype.constructor and then', async () => {
    let armed = false
    let reads = 0
    const originals = new Map<string, PropertyDescriptor>()
    for (const key of ['constructor', 'then'] as const) {
      const original = Object.getOwnPropertyDescriptor(Promise.prototype, key) as PropertyDescriptor
      originals.set(key, original)
      Object.defineProperty(Promise.prototype, key, {
        configurable: true,
        get() {
          if (armed) reads += 1
          return original.value
        }
      })
    }
    const startAwait = (promise: Promise<unknown>): Promise<unknown> => {
      armed = true
      const running = (async (): Promise<unknown> => await promise)()
      armed = false
      return running
    }
    const pinnedPromise = Promise.resolve('real')
    pinConstructor(pinnedPromise)
    const unpinnedPromise = Promise.resolve('control')

    const pinnedRun = startAwait(pinnedPromise)
    const pinnedReads = reads
    const unpinnedRun = startAwait(unpinnedPromise)
    const unpinnedReads = reads - pinnedReads
    for (const [key, original] of originals) Object.defineProperty(Promise.prototype, key, original)

    expect(pinnedReads).toBe(0)
    expect(unpinnedReads).toBeGreaterThan(0)
    await expect(pinnedRun).resolves.toBe('real')
    await expect(unpinnedRun).resolves.toBe('control')
  })
})

describe('awaitAll refusals', () => {
  afterEach(() => {
    restoreBuiltins()
  })

  // Scenario: an earlier member never settles and a later one cannot be pinned (frozen).
  // Rule: the call fails at once with the refusal; it does not wait for the earlier member.
  it('rejects at once when a member is refused, whatever an earlier member does', async () => {
    const result = await outcomeWithin(
      awaitAll<unknown>([new Promise<void>(() => undefined), Object.freeze(Promise.resolve(2))])
    )

    expect(result).toMatchObject({
      rejected: { response: { error: { code: CACHE_ERROR_CODES.INVALID_OPTIONS } } }
    })
  })

  // Scenario: the built-ins are planted on after the first member was awaited and before the next one.
  // Rule: the call fails with the refusal instead of waiting for a settlement that nothing would write.
  it('rejects when the promise machinery is planted on between two awaited members', async () => {
    const slow = new Promise<number>((resolve) => setTimeout(() => resolve(1), 15))
    setTimeout(() => {
      Object.defineProperty(Array.prototype, 'then', {
        value: () => undefined,
        configurable: true,
        writable: true
      })
    }, 3)
    setTimeout(() => Reflect.deleteProperty(Array.prototype, 'then'), 40)

    const result = await outcomeWithin(awaitAll<number>([slow, Promise.resolve(2)]))

    expect(result).toMatchObject({
      rejected: { response: { error: { code: CACHE_ERROR_CODES.INVALID_OPTIONS } } }
    })
  })

  // Scenario: nothing is wrong.
  it('resolves with exactly the values given, and with none for no members', async () => {
    await expect(awaitAll([Promise.resolve(1), Promise.resolve(2)])).resolves.toStrictEqual([1, 2])
    await expect(awaitAll([])).resolves.toStrictEqual([])
  })
})

describe('assertNoThen', () => {
  // Scenario: a Proxy is the value, or sits anywhere above it on the chain, with a trap for every operation.
  // Rule: it is refused as one holder of a `then`, and no trap runs.
  it.each([
    ['as the value', 0],
    ['one level up', 1],
    ['two levels up', 2]
  ])('refuses a Proxy %s without running a trap', (_name, depth) => {
    const traps: string[] = []
    const record = (name: string) => (): never => {
      traps.push(name)
      throw new Error(name)
    }
    let holder: object = new Proxy(
      {},
      {
        get: record('get'),
        getPrototypeOf: record('getPrototypeOf'),
        getOwnPropertyDescriptor: record('getOwnPropertyDescriptor'),
        has: record('has')
      }
    )
    for (let level = 0; level < depth; level += 1) holder = Object.create(holder) as object

    const refusal = thrownBy(() => assertNoThen(depth === 0 ? holder : Object.create(holder)))

    expect(refusal).toMatchObject({ details: { reason: PROMISE_REASON, count: 1 } })
    expect(traps).toEqual([])
  })

  // Scenario: a plain object with a `then` on the object and on a prototype, and one with none.
  it('counts every holder of a then on a plain chain and accepts a chain without one', () => {
    const base = { then: () => undefined }
    const value = Object.assign(Object.create(base) as object, { then: () => undefined })

    expect(thrownBy(() => assertNoThen(value))).toMatchObject({ details: { count: 2 } })
    expect(thrownBy(() => assertNoThen(Object.create(null) as object))).toBeUndefined()
  })
})
