/**
 * Unit tests for {@link describeError}.
 *
 * Layer: server. The helper runs on error paths, so the invariant is that it returns a
 * string for every value a `catch` can deliver and never throws itself.
 */
import { runInNewContext } from 'node:vm'

import { describeError } from './describe-error'

describe('describeError', () => {
  // `Object.create(null)` has no `toString`, so `String()` throws a TypeError.
  it('describes a prototype-less object without throwing', () => {
    expect(describeError(Object.create(null))).toBe('unprintable error')
  })

  // `instanceof Error` is false across realms; the message must still be read.
  it('reads the message of an Error from another realm', () => {
    const foreign: unknown = runInNewContext('new Error("from another realm")')

    expect(foreign instanceof Error).toBe(false)
    expect(describeError(foreign)).toBe('from another realm')
  })

  it('reads the message of an error-shaped plain object', () => {
    expect(describeError({ message: 'shaped' })).toBe('shaped')
  })

  it('reads the message of an Error', () => {
    expect(describeError(new Error('boom'))).toBe('boom')
  })

  it('keeps an empty message instead of falling through to String()', () => {
    expect(describeError(new Error(''))).toBe('')
  })

  it('stringifies a value whose message is not a string', () => {
    expect(describeError({ message: 42, toString: () => 'custom' })).toBe('custom')
  })

  it('stringifies a string, a number and a symbol', () => {
    expect(describeError('plain')).toBe('plain')
    expect(describeError(7)).toBe('7')
    expect(describeError(Symbol('s'))).toBe('Symbol(s)')
  })

  it('stringifies null and undefined', () => {
    expect(describeError(null)).toBe('null')
    expect(describeError(undefined)).toBe('undefined')
  })

  it('returns the fixed phrase when toString throws', () => {
    const hostile = {
      toString(): never {
        throw new Error('no')
      }
    }

    expect(describeError(hostile)).toBe('unprintable error')
  })

  it('returns the fixed phrase when reading the message throws', () => {
    const hostile = {
      get message(): never {
        throw new Error('no')
      }
    }

    expect(describeError(hostile)).toBe('unprintable error')
  })
})
