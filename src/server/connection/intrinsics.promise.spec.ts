/**
 * The `Promise` the library takes as its baseline when it loads.
 *
 * Layer: server. A global `Promise` replaced before the import must not become the constructor every later
 * check compares against, so the import is refused unless that constructor is the intrinsic one.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'

const RealPromise = Promise
const realConstructor = Promise.prototype.constructor

const realSpecies = Object.getOwnPropertyDescriptor(Promise, Symbol.species) as PropertyDescriptor

const BASELINE_REASON = 'The global Promise is not the Promise of the language'
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

  it('refuses a global Promise with a prototype of its own', () => {
    // Arrange
    class Wrapped<T> extends RealPromise<T> {}
    globalThis.Promise = Wrapped as unknown as PromiseConstructor

    // Act
    const refusal = refusalOf(loadIntrinsics)

    // Assert
    expect(refusal).toMatchObject({
      response: { error: { code: CACHE_ERROR_CODES.INVALID_OPTIONS } }
    })
  })

  it('refuses a global Promise that is not the constructor of the intrinsic prototype', () => {
    // Arrange
    function Imposter(): void {}
    Imposter.prototype = RealPromise.prototype
    globalThis.Promise = Imposter as unknown as PromiseConstructor

    // Act
    const refusal = refusalOf(loadIntrinsics)

    // Assert: the baseline check refuses it, not the species check that would refuse any Imposter later.
    expect(refusal).toMatchObject({
      details: { reason: BASELINE_REASON },
      response: { error: { code: CACHE_ERROR_CODES.INVALID_OPTIONS } }
    })
  })

  // Scenario: a global Promise whose own prototype is not the intrinsic one but which the intrinsic prototype
  // names as its constructor. Rule: the prototype comparison refuses it by itself, so it is not left to the
  // constructor comparison alone.
  it('refuses a global Promise that the intrinsic prototype names but that has a prototype of its own', () => {
    // Arrange
    function Imposter(): void {}
    Imposter.prototype = {}
    Promise.prototype.constructor = Imposter as unknown as PromiseConstructor
    globalThis.Promise = Imposter as unknown as PromiseConstructor

    // Act
    const refusal = refusalOf(loadIntrinsics)

    // Assert: the baseline check refuses it, not the species check that would refuse any Imposter later.
    expect(refusal).toMatchObject({
      details: { reason: BASELINE_REASON },
      response: { error: { code: CACHE_ERROR_CODES.INVALID_OPTIONS } }
    })
  })

  // Scenario: the refusal names why, with the exact text a host reads in `details`.
  it('names the baseline as the reason of the refusal', () => {
    // Arrange
    class Wrapped<T> extends RealPromise<T> {}
    globalThis.Promise = Wrapped as unknown as PromiseConstructor

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
