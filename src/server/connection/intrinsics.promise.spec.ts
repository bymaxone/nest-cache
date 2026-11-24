/**
 * The `Promise` the library takes as its baseline when it loads.
 *
 * Layer: server. A global `Promise` replaced before the import must not become the constructor every later
 * check compares against, so the import is refused unless that constructor is the intrinsic one.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'

const RealPromise = Promise
const realConstructor = Promise.prototype.constructor

function loadIntrinsics(): { NativePromise: PromiseConstructor } {
  let loaded: { NativePromise: PromiseConstructor } | undefined
  jest.isolateModules(() => {
    loaded = require('./intrinsics') as { NativePromise: PromiseConstructor }
  })
  return loaded as { NativePromise: PromiseConstructor }
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

    // Assert
    expect(refusal).toMatchObject({
      response: { error: { code: CACHE_ERROR_CODES.INVALID_OPTIONS } }
    })
  })
})
