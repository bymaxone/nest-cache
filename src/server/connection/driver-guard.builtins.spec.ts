/**
 * The guard on `Object.prototype` against a built-in of the language that is replaced AFTER the library was
 * imported.
 *
 * Layer: server. Two defences. The guard calls built-ins (`Object.getOwnPropertyNames`,
 * `Object.getOwnPropertyDescriptor`, `Object.is`, `Object.create`, `Array.prototype.filter`, the iteration of an
 * array and of a `Set`, `Set.prototype.has`) through references captured when the library loads, so a
 * replacement does not blind it: the first rows replace one after the import with a function that would hide
 * the defect they plant, and the planted key is still counted. And a baseline of the built-ins the paths that
 * read the options call (`BASELINE_BUILTINS`) is compared by identity inside the guard: the last rows replace
 * each of them and expect a refusal, and on a clean realm, none.
 */
import util from 'node:util'

import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { assertDriverUnshadowed } from './driver-option-names'
import { BUILTINS_REASON, KEYS_REASON } from './guard-refusal'
import { BASELINE_BUILTINS } from './intrinsics'

type Thrown = { code?: string; details?: { reason?: string; count?: number } }

/** The error the guard throws now, or undefined. */
function guardThrows(): Thrown | undefined {
  try {
    assertDriverUnshadowed()
  } catch (error) {
    return error as Thrown
  }
  return undefined
}

/** Runs `run` with `owner[name]` replaced by `replacement` (an assignment, which needs no built-in). */
function replacing<T>(owner: object, name: string | symbol, replacement: unknown, run: () => T): T {
  const slot = owner as Record<string | symbol, unknown>
  const original = slot[name]
  slot[name] = replacement
  try {
    return run()
  } finally {
    slot[name] = original
  }
}

/** Plants a key beyond the standard ones for the length of `run`. */
function withPlantedKey<T>(run: () => T): T {
  Object.defineProperty(Object.prototype, 'aKeyPlantedByTheTest', {
    value: 1,
    configurable: true,
    writable: true
  })
  try {
    return run()
  } finally {
    Reflect.deleteProperty(Object.prototype, 'aKeyPlantedByTheTest')
  }
}

/** Replaces `hasOwnProperty` by a copy of it, for the length of `run`. */
function withOverwrittenKey<T>(run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(
    Object.prototype,
    'hasOwnProperty'
  ) as PropertyDescriptor
  Object.defineProperty(Object.prototype, 'hasOwnProperty', {
    ...original,
    value: function (this: unknown, ...args: unknown[]): unknown {
      return (original.value as (...a: unknown[]) => unknown).apply(this, args)
    }
  })
  try {
    return run()
  } finally {
    Object.defineProperty(Object.prototype, 'hasOwnProperty', original)
  }
}

/** `Object.getOwnPropertyDescriptor` as it was when this spec loaded. */
const REAL_DESCRIPTOR = Object.getOwnPropertyDescriptor
const ITERATOR: symbol = Symbol.iterator
const EMPTY_ITERATOR = function (): unknown {
  return { next: () => ({ done: true, value: undefined }) }
}

type Hiding = [label: string, owner: object, name: string | symbol, replacement: unknown]
type HidingOf = [
  label: string,
  owner: object,
  name: string | symbol,
  make: (pristine: PropertyDescriptor) => unknown
]

describe('a key planted on Object.prototype, with a built-in the guard calls replaced after the import', () => {
  // Scenario: the built-in is replaced by a function that hides the planted key.
  // Rule: the guard counts the planted key all the same, with the reason of keys and a count of one.
  const hiding: Hiding[] = [
    ['Object.getOwnPropertyNames', Object, 'getOwnPropertyNames', () => []],
    ['Array.prototype.filter', Array.prototype, 'filter', () => []],
    ['Set.prototype.has', Set.prototype, 'has', () => true],
    ['Array.prototype[Symbol.iterator]', Array.prototype, ITERATOR, EMPTY_ITERATOR],
    ['Set.prototype[Symbol.iterator]', Set.prototype, ITERATOR, EMPTY_ITERATOR]
  ]
  it.each(hiding)('counts it when %s hides it', (_label, owner, name, replacement) => {
    const error = withPlantedKey(() => replacing(owner, name, replacement, guardThrows))

    expect(error?.details).toEqual({ reason: KEYS_REASON, count: 1 })
  })
})

describe('a standard key that was overwritten, with a built-in the guard calls replaced after the import', () => {
  // Scenario: hasOwnProperty is replaced by a copy, and the built-in that compares what it was with what it is
  // is replaced by one that says nothing changed.
  // Rule: the guard counts the overwritten key all the same.
  const hidingOverwrite: HidingOf[] = [
    [
      'Object.getOwnPropertyDescriptor',
      Object,
      'getOwnPropertyDescriptor',
      (pristine: PropertyDescriptor) => (owner: object, name: string) =>
        name === 'hasOwnProperty' ? pristine : REAL_DESCRIPTOR(owner, name)
    ],
    ['Object.is', Object, 'is', () => () => true],
    ['Array.prototype.filter', Array.prototype, 'filter', () => () => []],
    ['Array.prototype[Symbol.iterator]', Array.prototype, ITERATOR, () => EMPTY_ITERATOR],
    ['Set.prototype[Symbol.iterator]', Set.prototype, ITERATOR, () => EMPTY_ITERATOR],
    ['Object.create', Object, 'create', () => () => new Proxy({}, { set: () => true })]
  ]
  it.each(hidingOverwrite)('counts it when %s hides it', (_label, owner, name, make) => {
    const pristine = REAL_DESCRIPTOR(Object.prototype, 'hasOwnProperty') as PropertyDescriptor
    const error = withOverwrittenKey(() => replacing(owner, name, make(pristine), guardThrows))

    expect(error?.details).toEqual({ reason: KEYS_REASON, count: 1 })
  })
})

describe('the baseline of the built-ins the paths that read the options call', () => {
  // Scenario: one built-in of the baseline is replaced after the import, by a function that returns nothing.
  // Rule: the guard refuses, counting exactly that one; on a clean realm it does not refuse.
  const OWNERS: Array<[object, string]> = [
    [globalThis, 'globalThis'],
    [Object, 'Object'],
    [Reflect, 'Reflect'],
    [Array, 'Array'],
    [ArrayBuffer, 'ArrayBuffer'],
    [Number, 'Number'],
    [Math, 'Math'],
    [Buffer, 'Buffer'],
    [JSON, 'JSON'],
    [util, 'util'],
    [Array.prototype, 'Array.prototype'],
    [Set.prototype, 'Set.prototype'],
    [WeakSet.prototype, 'WeakSet.prototype'],
    [Function.prototype, 'Function.prototype'],
    [String.prototype, 'String.prototype'],
    [RegExp.prototype, 'RegExp.prototype']
  ]
  const labelOf = (owner: object, name: string | symbol): string => {
    for (const [candidate, label] of OWNERS)
      if (candidate === owner) return `${label}.${String(name)}`
    return `iterator.${String(name)}`
  }

  it('has built-ins in it, each with an owner and a name', () => {
    expect(BASELINE_BUILTINS.length).toBeGreaterThan(30)
  })

  // Rule: the methods of Function, String and RegExp the paths call, and the global bindings they name, are in
  // the baseline (each has its own row below).
  it('names the methods of Function, String and RegExp and the global bindings the paths call', () => {
    const labels = BASELINE_BUILTINS.map((entry) => labelOf(entry[0], entry[1]))

    expect(labels).toEqual(
      expect.arrayContaining([
        'Function.prototype.call',
        'Function.prototype.apply',
        'Function.prototype.bind',
        'String.prototype.replace',
        'String.prototype.trim',
        'String.prototype.includes',
        'String.prototype.Symbol(Symbol.iterator)',
        'RegExp.prototype.test',
        'RegExp.prototype.exec',
        'RegExp.prototype.Symbol(Symbol.replace)',
        'globalThis.Object',
        'globalThis.Reflect',
        'globalThis.Array',
        'globalThis.JSON',
        'globalThis.Number',
        'globalThis.Set',
        'globalThis.Buffer'
      ])
    )
  })

  it.each(
    BASELINE_BUILTINS.map((entry) => [labelOf(entry[0], entry[1]), entry[0], entry[1]] as const)
  )('refuses it when %s was replaced', (_label, owner, name) => {
    const error = replacing(owner, name, () => undefined, guardThrows)

    expect(error?.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    expect(error?.details).toEqual({ reason: BUILTINS_REASON, count: 1 })
    expect(error).toBeInstanceOf(CacheException)
  })

  // Rule: a planted key and a replaced built-in are refused with their own reasons, and the key comes first.
  it('refuses a planted key with the reason of keys, whatever else was replaced', () => {
    const error = withPlantedKey(() => replacing(Object, 'keys', () => undefined, guardThrows))

    expect(error?.details).toEqual({ reason: KEYS_REASON, count: 1 })
  })

  it('refuses a replaced built-in with the reason of built-ins', () => {
    const error = replacing(Object, 'keys', () => undefined, guardThrows)

    expect(error?.details).toEqual({ reason: BUILTINS_REASON, count: 1 })
  })

  it('does not name the global Promise: a host may wrap it after the library loads', () => {
    const labels = BASELINE_BUILTINS.map((entry) => labelOf(entry[0], entry[1]))

    expect(labels).not.toContain('globalThis.Promise')
    expect(replacing(globalThis, 'Promise', class Wrapped {}, guardThrows)).toBeUndefined()
  })

  it('does not refuse when none was replaced', () => {
    expect(guardThrows()).toBeUndefined()
  })
})
