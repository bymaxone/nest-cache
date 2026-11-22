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
  String
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

describe('the load baseline against the calls of the code it protects', () => {
  const code = sources().join('\n')
  const staticCalls = new Set<string>()
  for (const match of code.matchAll(
    /\b(Object|Reflect|Array|ArrayBuffer|Number|Buffer|JSON|Math|String)\.([A-Za-z]+)\(/g
  )) {
    staticCalls.add(`${match[1]}.${match[2]}`)
  }
  const instanceCalls = new Set<string>()
  for (const match of code.matchAll(
    /(?<!\b(?:Object|Reflect|Array|ArrayBuffer|Number|Buffer|JSON|Math|String))\.([A-Za-z]+)\(/g
  )) {
    instanceCalls.add(match[1] as string)
  }

  it('finds calls to check', () => {
    expect(staticCalls.size).toBeGreaterThan(10)
    expect(instanceCalls.size).toBeGreaterThan(10)
  })

  it.each([...staticCalls].sort())('holds the static call %s', (call) => {
    const [owner, key] = call.split('.') as [string, string]

    // `Object.keys` and the like are in the baseline; a static the global does not have is not a built-in call.
    const target = STATICS[owner] as Record<string, unknown>
    if (typeof target[key] !== 'function') return
    expect(inBaseline(STATICS[owner] as object, key)).toBe(true)
  })

  it.each([...instanceCalls].sort())(
    'holds every built-in prototype that has the method %s',
    (name) => {
      const missing = PROTOTYPES.filter(
        ([, prototype]) => Object.hasOwn(prototype, name) && !inBaseline(prototype, name)
      ).map(([label]) => `${label}.${name}`)

      expect(missing).toEqual([])
    }
  )
})
