/**
 * The `Promise` the library takes as its baseline when it loads.
 *
 * Layer: server. A global `Promise` replaced before the import must not become the constructor every later
 * check compares against, so the baseline is the intrinsic, read from an async function's promise, and the
 * import is refused only when that constructor and its prototype disagree.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'

const RealPromise = Promise
const realConstructor = Promise.prototype.constructor

const realSpecies = Object.getOwnPropertyDescriptor(Promise, Symbol.species) as PropertyDescriptor

const BASELINE_REASON =
  'The constructor of the promise prototype is not the Promise of the language'
const SPECIES_REASON = 'The species of the global Promise is not an accessor of the language'

type Loaded = { NativePromise: PromiseConstructor; NativeSpeciesGetter: unknown }

function loadIntrinsics(): Loaded {
  let loaded: Loaded | undefined
  jest.isolateModules(() => {
    loaded = require('./intrinsics') as Loaded
  })
  return loaded as Loaded
}

function refusalOf(load: () => unknown): { code?: string } {
  try {
    load()
  } catch (error) {
    return error as { code?: string }
  }
  return {}
}

describe('NativePromise baseline', () => {
  afterEach(() => {
    globalThis.Promise = RealPromise
    Promise.prototype.constructor = realConstructor
    Reflect.deleteProperty(Object.prototype, 'get')
    Object.defineProperty(Promise, Symbol.species, realSpecies)
  })

  it('is the intrinsic Promise when nothing was replaced', () => {
    // Arrange / Act
    const { NativePromise } = loadIntrinsics()

    // Assert
    expect(NativePromise).toBe(RealPromise)
  })

  // Scenario: a host replaced the global binding before the import (a wrapper, a polyfill, a subclass).
  // Rule: the baseline is the intrinsic, taken from the prototype an async function's promise has, so the
  // import loads and the library keeps the intrinsic, never the host's constructor.
  it('loads and keeps the intrinsic when the global Promise is a subclass', () => {
    // Arrange
    class Wrapped<T> extends RealPromise<T> {}
    globalThis.Promise = Wrapped as unknown as PromiseConstructor

    // Act
    const { NativePromise } = loadIntrinsics()

    // Assert
    expect(NativePromise).toBe(RealPromise)
    expect(NativePromise).not.toBe(Wrapped)
  })

  it('loads and keeps the intrinsic when the global Promise shares the intrinsic prototype', () => {
    // Arrange
    function Imposter(): void {}
    Imposter.prototype = RealPromise.prototype
    globalThis.Promise = Imposter as unknown as PromiseConstructor

    // Act
    const { NativePromise, NativeSpeciesGetter } = loadIntrinsics()

    // Assert
    expect(NativePromise).toBe(RealPromise)
    expect(NativeSpeciesGetter).toBe(realSpecies.get)
  })

  it('loads and keeps the intrinsic when the global Promise is a plain wrapper function', () => {
    // Arrange
    globalThis.Promise = function Bluebirdish(): void {} as unknown as PromiseConstructor

    // Act
    const { NativePromise } = loadIntrinsics()

    // Assert
    expect(NativePromise).toBe(RealPromise)
  })

  // Scenario: the constructor the intrinsic prototype names does not have that prototype. Rule: the pair is
  // inconsistent with itself, so the import is refused whatever the global binding is.
  it('refuses a constructor of the intrinsic prototype that has a prototype of its own', () => {
    // Arrange
    function Imposter(): void {}
    Imposter.prototype = {}
    Promise.prototype.constructor = Imposter as unknown as PromiseConstructor

    // Act
    const refusal = refusalOf(loadIntrinsics)

    // Assert
    expect(refusal).toMatchObject({
      details: { reason: BASELINE_REASON },
      response: { error: { code: CACHE_ERROR_CODES.INVALID_OPTIONS } }
    })
  })

  it('refuses a constructor of the intrinsic prototype that is not a function', () => {
    // Arrange
    Promise.prototype.constructor = undefined as unknown as PromiseConstructor

    // Act
    const refusal = refusalOf(loadIntrinsics)

    // Assert
    expect(refusal).toMatchObject({
      details: { reason: BASELINE_REASON },
      response: { error: { code: CACHE_ERROR_CODES.INVALID_OPTIONS } }
    })
  })

  // Scenario: the refusal names why, with the exact text a host reads in `details`.
  it('names the baseline as the reason of the refusal', () => {
    // Arrange
    function Imposter(): void {}
    Imposter.prototype = {}
    Promise.prototype.constructor = Imposter as unknown as PromiseConstructor

    // Act
    const refusal = refusalOf(loadIntrinsics)

    // Assert
    expect(refusal).toMatchObject({
      details: { reason: BASELINE_REASON }
    })
  })

  // Scenario: the species of the Promise the library loads against is read as an own accessor.
  it('takes the get of the species accessor as the baseline', () => {
    // Act
    const { NativeSpeciesGetter } = loadIntrinsics()

    // Assert
    expect(NativeSpeciesGetter).toBe(realSpecies.get)
  })

  // Scenario: the species was replaced by a data property before the import.
  it('refuses a Promise whose species is a data property', () => {
    // Arrange
    Object.defineProperty(Promise, Symbol.species, { value: RealPromise, configurable: true })

    // Act
    const refusal = refusalOf(loadIntrinsics)

    // Assert
    expect(refusal).toMatchObject({
      details: { reason: SPECIES_REASON }
    })
  })

  // Scenario: the species is an own accessor that has no getter. Rule: it is not the accessor of the
  // language, so the import is refused (an own `get` field that is not a function).
  it('refuses a Promise whose species accessor has no getter', () => {
    // Arrange
    const getterless: Record<string, unknown> = { get: undefined, configurable: true }
    Object.defineProperty(Promise, Symbol.species, getterless as PropertyDescriptor)

    // Act
    const refusal = refusalOf(loadIntrinsics)

    // Assert
    expect(refusal).toMatchObject({
      details: { reason: SPECIES_REASON },
      response: { error: { code: CACHE_ERROR_CODES.INVALID_OPTIONS } }
    })
  })
})
