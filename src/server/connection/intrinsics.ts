/**
 * The built-ins of the language that the guard on `Object.prototype` and the paths it protects call, captured
 * when the library loads.
 *
 * Layer: server. A call such as `Object.getOwnPropertyNames(...)` looks the function up when it runs, so a
 * built-in that was replaced after the library was imported blinds the guard that calls it: the replacement
 * answers for the guard. Every built-in the guard needs is read once here, as a reference, and methods are
 * made into plain functions that take their receiver as the first argument, so that no lookup on a prototype
 * happens afterwards. The code that uses them walks arrays with an index and keeps its tables in objects
 * without a prototype: the iteration of an array or of a `Set` and the methods of an array are built-ins too.
 *
 * What is captured here is what the library holds when it loads: a process that replaced a built-in before
 * the import is out of reach of this (the same limit as a polluted `Function.prototype.toString`).
 */
import util, { types } from 'node:util'

const { bind, call } = Function.prototype

/** Turns a method into a function that takes the receiver as its first argument. */
const uncurryThis = bind.bind(call) as <A extends unknown[], R>(
  method: (...args: A) => R
) => (self: unknown, ...args: A) => R

/** `Object.prototype`, read when the library loads. */
export const objectPrototype = Object.prototype
/** The symbol Jest keeps, non-enumerable, on `Object.prototype` of every test realm. */
export const JEST_PROTECT_SYMBOL = Symbol.for('$$jest-protect-from-deletion')
/** `Object.getOwnPropertyNames`, as it was when the library loaded. */
export const getOwnPropertyNames = Object.getOwnPropertyNames
/** `Object.getOwnPropertySymbols`, as it was when the library loaded. */
export const getOwnPropertySymbols = Object.getOwnPropertySymbols
/** `Object.getOwnPropertyDescriptor`, as it was when the library loaded. */
export const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor
/** `Object.defineProperty`, as it was when the library loaded. */
export const defineProperty = Object.defineProperty
/** `Object.hasOwn`, as it was when the library loaded. */
export const hasOwn = Object.hasOwn
/** `Object.is`, as it was when the library loaded. */
export const objectIs = Object.is
/** `Object.create`, narrowed to the one call the library makes: an object without a prototype. */
export const createObject = Object.create as (prototype: null) => Record<string, unknown>
/** `Object.assign`, as it was when the library loaded. */
export const assign = Object.assign
/** `Object.freeze`, as it was when the library loaded. */
export const freeze = Object.freeze
/** `Reflect.setPrototypeOf`, as it was when the library loaded. */
export const setPrototypeOf = Reflect.setPrototypeOf
/** `Reflect.getPrototypeOf`, as it was when the library loaded. */
export const getPrototypeOf = Reflect.getPrototypeOf
/** `util.types.isProxy`, as it was when the library loaded. */
export const isProxy = types.isProxy
/** `Function.prototype.toString` as a function of its receiver: `functionToString(fn)`. */
export const functionToString = uncurryThis(Function.prototype.toString)
/** `String.prototype.endsWith` as a function of its receiver: `stringEndsWith(text, suffix)`. */
export const stringEndsWith = uncurryThis(String.prototype.endsWith)
/** `Function.prototype.bind` as a function of its receiver: `bindFunction(fn, thisArg)`. */
export const bindFunction = uncurryThis(Function.prototype.bind)
/** `process.nextTick`, as it was when the library loaded. */
export const nextTick = process.nextTick
/** `Error.captureStackTrace`, as it was when the library loaded. */
export const captureStackTrace = Error.captureStackTrace
/** The `Promise` of the language as it was when the library loaded; a host may wrap the global one later. */
export const NativePromise = Promise

const arrayIterator = getPrototypeOf([][Symbol.iterator]()) as object
const setIterator = getPrototypeOf(new Set()[Symbol.iterator]()) as object
const stringIterator = getPrototypeOf(''[Symbol.iterator]()) as object

/**
 * The global bindings the paths name (`Object`, `Reflect`, ...): a call such as `Object.keys(x)` finds the
 * binding when it runs, so `globalThis.Object = fake` would hand the call to the fake whatever `Object.keys` is.
 */
const GLOBAL_NAMES = [
  'Object',
  'Reflect',
  'Array',
  'JSON',
  'Number',
  'String',
  'Set',
  'WeakSet',
  'Buffer',
  'ArrayBuffer',
  'SharedArrayBuffer',
  'Uint8Array',
  'Error',
  'Math',
  'Symbol',
  'RegExp'
]

/**
 * The built-ins the paths that read the options of the host call (`Object.keys` and the others of `Object`,
 * `Reflect`, `Array`, the methods and the iterators of arrays and sets, `JSON`, `Number`, `Buffer`, `Function.prototype`, `String.prototype`, `RegExp.prototype`, the global bindings), as the
 * owner and the key each one is found under.
 */
export const BASELINE_BUILTINS: ReadonlyArray<readonly [object, string | symbol]> = [
  [Object, 'keys'],
  [Object, 'values'],
  [Object, 'entries'],
  [Object, 'fromEntries'],
  [Object, 'create'],
  [Object, 'assign'],
  [Object, 'freeze'],
  [Object, 'defineProperty'],
  [Object, 'getOwnPropertyDescriptor'],
  [Object, 'getOwnPropertyNames'],
  [Object, 'hasOwn'],
  [Object, 'is'],
  [Reflect, 'get'],
  [Reflect, 'set'],
  [Reflect, 'getPrototypeOf'],
  [Reflect, 'setPrototypeOf'],
  [Array, 'isArray'],
  [ArrayBuffer, 'isView'],
  [Number, 'isInteger'],
  [Number, 'isFinite'],
  [Math, 'min'],
  [util, 'types'],
  [types, 'isProxy'],
  [Buffer, 'from'],
  [JSON, 'stringify'],
  [Array.prototype, 'map'],
  [Array.prototype, 'filter'],
  [Array.prototype, 'some'],
  [Array.prototype, 'includes'],
  [Array.prototype, 'forEach'],
  [Array.prototype, 'join'],
  [Array.prototype, 'slice'],
  [Array.prototype, 'push'],
  [Array.prototype, Symbol.iterator],
  [Set.prototype, 'has'],
  [Set.prototype, 'add'],
  [Set.prototype, 'delete'],
  [Set.prototype, 'forEach'],
  [WeakSet.prototype, 'add'],
  [WeakSet.prototype, 'has'],
  [WeakSet.prototype, 'delete'],
  [Function.prototype, 'call'],
  [Function.prototype, 'apply'],
  [Function.prototype, 'bind'],
  [String.prototype, 'replace'],
  [String.prototype, 'trim'],
  [String.prototype, 'includes'],
  [String.prototype, Symbol.iterator],
  [stringIterator, 'next'],
  [RegExp.prototype, 'test'],
  [RegExp.prototype, 'exec'],
  [RegExp.prototype, Symbol.replace],
  [Set.prototype, Symbol.iterator],
  [arrayIterator, 'next'],
  [setIterator, 'next'],
  ...GLOBAL_NAMES.map((name): readonly [object, string] => [globalThis, name])
]

/** What each of them was when the library loaded, in the same order. */
// Stryker disable next-line ArrayDeclaration: the loop below assigns every index from 0, so the initial content never survives
const BASELINE_VALUES: unknown[] = []
for (let index = 0; index < BASELINE_BUILTINS.length; index += 1) {
  const entry = BASELINE_BUILTINS[index] as readonly [object, string | symbol]
  BASELINE_VALUES[index] = (entry[0] as Record<string | symbol, unknown>)[entry[1]]
}

/**
 * How many of the built-ins of the baseline are not what they were when the library loaded: the paths that
 * read the options call them by name, so a replaced one answers for those paths.
 *
 * @returns The number of replaced built-ins.
 */
export function countReplacedBuiltins(): number {
  let count = 0
  for (let index = 0; index < BASELINE_BUILTINS.length; index += 1) {
    const entry = BASELINE_BUILTINS[index] as readonly [object, string | symbol]
    if ((entry[0] as Record<string | symbol, unknown>)[entry[1]] !== BASELINE_VALUES[index])
      count += 1
  }
  return count
}
