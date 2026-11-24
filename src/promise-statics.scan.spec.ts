/**
 * No decision path of the library reads a verdict from code a host can replace on `Promise`.
 *
 * Layer: repository (a scan of the library sources). A verdict read from `Promise.race`, `Promise.all`, `.catch`, `.finally`
 * or a `.then(` call is a verdict whoever replaced those built-ins writes. This spec reads every source
 * file from disk and fails on any such construct that is not listed in `EXEMPT` with a reason, and on any
 * listed exemption that no longer matches (the list fails both ways). It is excluded from the Stryker run
 * (`jest.stryker.config.ts`) because the sandbox copies of the sources are instrumented.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = __dirname

const SKIPPED = /\.spec\.ts$|[\\/]test-helpers[\\/]|\.d\.ts$/

/** The constructs a verdict must never be read from, as the text of a source with its comments removed. */
const FORBIDDEN: ReadonlyArray<[string, RegExp]> = [
  [
    'Promise static',
    /\bPromise\s*\.\s*(?:race|all|any|allSettled|resolve|reject|try|withResolvers)\b/g
  ],
  ['Promise static by bracket', /\bPromise\s*\[/g],
  [
    'Promise static by destructuring',
    /\{[^{}]*\b(?:race|all|any|allSettled|resolve|reject|try|withResolvers)\b[^{}]*\}\s*=\s*Promise\b/g
  ],
  ['.catch(', /\.\s*catch\s*\(/g],
  ['.finally(', /\.\s*finally\s*\(/g],
  ['.then(', /\.\s*then\s*\(/g],
  ['then.call', /\bthen\s*\.\s*(?:call|apply|bind)\b/g],
  ['new Promise', /\bnew\s+Promise\b/g]
]

/**
 * Sites that are allowed to keep a construct, per file and construct, with how many times and why.
 * Empty: no site of the library may keep a construct; the guarded helpers in `server/utils/settle.ts` replace them.
 */
const EXEMPT: ReadonlyArray<{ file: string; construct: string; count: number; reason: string }> = []

/** Removes block and line comments, so documentation that names a construct is not a use of it. */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

/**
 * Counts each forbidden construct in a source text.
 *
 * @param text - The source.
 * @returns The count per construct, only for the ones present.
 */
export function scanSource(text: string): Record<string, number> {
  const stripped = stripComments(text)
  const found: Record<string, number> = {}
  for (const [name, pattern] of FORBIDDEN) {
    const count = [...stripped.matchAll(pattern)].length
    if (count > 0) found[name] = count
  }
  return found
}

function sources(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...sources(path))
    else if (path.endsWith('.ts') && !SKIPPED.test(path)) files.push(path)
  }
  return files
}

describe('promise statics on a decision path', () => {
  // Scenario: every source file of the library is read from disk.
  // Rule: what remains after the exemptions is empty, and each exemption is used exactly as stated.
  it('finds none outside the listed exemptions, and every exemption still matches', () => {
    const unexpected: string[] = []
    const used = new Set<string>()
    for (const file of sources(ROOT)) {
      const name = relative(ROOT, file)
      for (const [construct, count] of Object.entries(scanSource(readFileSync(file, 'utf8')))) {
        const exemption = EXEMPT.find((e) => e.file === name && e.construct === construct)
        if (exemption?.count === count) used.add(`${name}:${construct}`)
        else unexpected.push(`${name}: ${construct} x${count}`)
      }
    }
    const stale = EXEMPT.filter((e) => !used.has(`${e.file}:${e.construct}`)).map(
      (e) => `${e.file}: ${e.construct}`
    )

    expect(unexpected).toEqual([])
    expect(stale).toEqual([])
  })

  // Scenario: a known positive for every construct the scan bans.
  // Rule: each is found, and a comment that merely names one is not.
  it.each([
    ['Promise static', 'await Promise.race([a, b])'],
    ['Promise static', 'await Promise.all(x)'],
    ['Promise static', 'Promise.resolve(1)'],
    ['Promise static by bracket', "Promise['race'](x)"],
    ['Promise static by destructuring', 'const { race } = Promise'],
    ['.catch(', 'p.catch(() => 1)'],
    ['.finally(', 'p.finally(() => 1)'],
    ['.then(', 'p . then (a)'],
    ['then.call', 'then.call(p, a)'],
    ['new Promise', 'new Promise((r) => r())']
  ])('detects %s in `%s`', (construct, text) => {
    expect(Object.keys(scanSource(text))).toContain(construct)
  })

  it('ignores a construct named in a comment', () => {
    expect(scanSource('// Promise.race(x) and .catch(y)\n/* new Promise */\nconst a = 1')).toEqual(
      {}
    )
  })
})
