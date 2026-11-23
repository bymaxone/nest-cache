/**
 * Every built-in the option-reading and connection code calls by name is in the load baseline.
 *
 * Layer: server. The baseline (`BASELINE_BUILTINS`) is a list a person keeps by reading, and a reading
 * misses what a grep cannot tell apart: `includes` is a method of arrays and of strings. This spec reads the
 * sources of `src/server/config` and `src/server/connection` and requires, for every method name called on
 * something, that each built-in prototype that has a method of that name is in the baseline, and for every
 * static call on a global (`Object.keys`, `Reflect.get`, ...) that it is. A new call to a built-in that the
 * baseline does not hold fails here, not in a review.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { types } from 'node:util'

import { BASELINE_BUILTINS } from './intrinsics'

const ROOT = join(__dirname, '..')
const FOLDERS = ['config', 'connection']
const SKIPPED = /\.spec\.ts$|intrinsics\.ts$/

const STATICS: Record<string, object> = {
  Object,
  Reflect,
  Array,
  ArrayBuffer,
  Number,
  Buffer,
  JSON,
  Math,
  String,
  types
}
// The code holds no `Map`: the first one it holds adds `Map.prototype` to this list and its methods to the baseline.
const PROTOTYPES: Array<[string, object]> = [
  ['Array.prototype', Array.prototype],
  ['String.prototype', String.prototype],
  ['Set.prototype', Set.prototype],
  ['WeakSet.prototype', WeakSet.prototype],
  ['RegExp.prototype', RegExp.prototype],
  ['Function.prototype', Function.prototype]
]

/** The source of the files under the folders, without comments and strings. */
function sources(): string[] {
  const files: string[] = []
  for (const folder of FOLDERS) {
    for (const name of readdirSync(join(ROOT, folder))) {
      if (name.endsWith('.ts') && !SKIPPED.test(name)) files.push(join(ROOT, folder, name))
    }
  }
  files.push(join(ROOT, 'bymax-cache.module.ts'))
  return files.map((file) =>
    readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
  )
}

const inBaseline = (owner: object, key: string): boolean =>
  BASELINE_BUILTINS.some((entry) => entry[0] === owner && entry[1] === key)

// What the code calls today, by name. The rows below are named after these lists, never after what a scan
// finds, so a run over instrumented sources (Stryker) runs the same tests under the same names.
const KNOWN_STATIC_CALLS = [
  'Array.isArray',
  'ArrayBuffer.isView',
  'Buffer.from',
  'Math.min',
  'Number.isFinite',
  'Number.isInteger',
  'Object.assign',
  'Object.create',
  'Object.defineProperty',
  'Object.entries',
  'Object.freeze',
  'Object.fromEntries',
  'Object.getOwnPropertyDescriptor',
  'Object.hasOwn',
  'Object.keys',
  'Object.values',
  'Reflect.get',
  'Reflect.getPrototypeOf',
  'Reflect.set',
  'types.isKeyObject',
  'types.isProxy'
]
const KNOWN_BUILTIN_METHODS = [
  'add',
  'bind',
  'delete',
  'filter',
  'forEach',
  'has',
  'includes',
  'join',
  'map',
  'replace',
  'some',
  'test',
  'trim'
]

/** The built-in prototypes that have a method of this name. */
const prototypesWith = (name: string): Array<[string, object]> =>
  PROTOTYPES.filter(([, prototype]) => Object.hasOwn(prototype, name))

describe('the load baseline against the calls of the code it protects', () => {
  const code = sources().join('\n')
  // Under Stryker the sources hold every mutant variant of the file next to the original, so the names a
  // scan finds are not the names the code calls: the scan test is meaningful on the plain sources only.
  const instrumented = code.includes('stryMutAct_')

  // Rule: a call to a built-in that the lists above do not name fails here, so the list, the baseline and the
  // code move together.
  it('finds no call to a built-in that the lists do not name', () => {
    if (instrumented) return
    const unknown: string[] = []
    for (const match of code.matchAll(
      /\b(Object|Reflect|Array|ArrayBuffer|Number|Buffer|JSON|Math|String|types)\.([A-Za-z]+)\(/g
    )) {
      const call = `${match[1]}.${match[2]}`
      const target = STATICS[match[1] as string] as Record<string, unknown>
      if (typeof target[match[2] as string] === 'function' && !KNOWN_STATIC_CALLS.includes(call)) {
        unknown.push(call)
      }
    }
    for (const match of code.matchAll(
      /(?<!\b(?:Object|Reflect|Array|ArrayBuffer|Number|Buffer|JSON|Math|String|types))\.([A-Za-z]+)\(/g
    )) {
      const name = match[1] as string
      if (prototypesWith(name).length > 0 && !KNOWN_BUILTIN_METHODS.includes(name))
        unknown.push(name)
    }

    expect(unknown).toEqual([])
  })

  it.each(KNOWN_STATIC_CALLS)('holds the static call %s', (call) => {
    const [owner, key] = call.split('.') as [string, string]
    const target = STATICS[owner] as Record<string, unknown>
    // A function that is neither writable nor configurable (`util.types.isKeyObject`) cannot be replaced.
    const slot = Object.getOwnPropertyDescriptor(target, key)
    if (slot !== undefined && slot.writable === false && slot.configurable === false) return

    expect(typeof target[key]).toBe('function')
    expect(inBaseline(STATICS[owner] as object, key)).toBe(true)
  })

  it.each(KNOWN_BUILTIN_METHODS)(
    'holds every built-in prototype that has the method %s',
    (name) => {
      const missing = prototypesWith(name)
        .filter(([, prototype]) => !inBaseline(prototype, name))
        .map(([label]) => `${label}.${name}`)

      expect(prototypesWith(name).length).toBeGreaterThan(0)
      expect(missing).toEqual([])
    }
  )
})
