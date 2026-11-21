/**
 * Unit tests for {@link describeReceived}.
 *
 * Layer: server. The phrase each kind of value is reported as, and that none of a value's content
 * reaches it.
 */
import { describeReceived } from './describe-received'

describe('describeReceived', () => {
  // Scenario: a number.
  // Rule: a finite one is itself; NaN and an infinity are named.
  it.each([
    [0, 0],
    [-3.5, -3.5],
    [NaN, 'NaN'],
    [Infinity, 'Infinity'],
    [-Infinity, '-Infinity']
  ])('reports the number %p as %p', (value, expected) => {
    expect(describeReceived(value)).toBe(expected)
  })

  // Scenario: anything that is not a number.
  // Rule: a phrase naming the type, never the content.
  it.each([
    ['secret', 'a string'],
    [Symbol('secret'), 'a symbol'],
    [() => 'secret', 'a function'],
    [true, 'a boolean'],
    [BigInt(7), 'a bigint'],
    [{ secret: 1 }, 'an object'],
    [['secret'], 'an array'],
    [null, 'null'],
    [undefined, 'undefined']
  ])('reports %p as %p', (value, expected) => {
    expect(describeReceived(value)).toBe(expected)
  })
})

describe('describeReceived for a credential', () => {
  // Scenario: the refused option holds a credential, so a number in it may be a password.
  // Rule: a number of any kind is reported as the type, and every other value as before.
  it.each([42, -3.5, NaN, Infinity])('reports the number %p as a number', (value) => {
    expect(describeReceived(value, true)).toBe('a number')
  })

  it('reports anything else as it does for any option', () => {
    expect(describeReceived('secret', true)).toBe('a string')
    expect(describeReceived(null, true)).toBe('null')
    expect(describeReceived(42, false)).toBe(42)
  })
})
