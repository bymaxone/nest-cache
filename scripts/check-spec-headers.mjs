/**
 * @fileoverview Spec-header gate — every `*.spec.ts` under `src` opens with a block comment that
 * states what the file tests and which layer it belongs to.
 * @layer scripts
 *
 * The review bots read a spec cold, without the source open next to it, and keep reporting a spec
 * that does not say what it covers or where it sits. The header is the one place a reader finds
 * that, so it is a gate and not a habit: the comment must come before the first statement, carry
 * a layer marker (`Layer: server.` or `@layer server`), and say something besides the marker.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Shortest text, outside the layer marker, that can still state a purpose. */
const MIN_PURPOSE_LENGTH = 20

/** A `Layer: x` sentence or an `@layer x` tag; the first word after it names the layer. */
const LAYER_MARKER = /(?:\bLayer:|@layer)\s+([A-Za-z-]+)/i

/** The layers a spec may declare: the subpaths of the package the shared test helpers and the repository-level checks of the built package and its docs. `tests` is the family's spelling of `test`. */
export const LAYERS = [
  'server',
  'admin',
  'metrics',
  'observability',
  'idempotency',
  'shared',
  'test',
  'tests',
  'repository'
]

/**
 * Why `source` has no valid header, or `null` when it has one.
 *
 * @param source - The spec file's text.
 * @returns The problem in one sentence, or `null`.
 */
export function headerProblem(source) {
  const text = source.trimStart() // trimStart also drops a byte-order mark
  const end = text.startsWith('/**') ? text.indexOf('*/') : -1
  if (end === -1) {
    return 'does not open with a /** */ block comment'
  }
  const body = text
    .slice(3, end)
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, ''))
    .join(' ')
  const marker = LAYER_MARKER.exec(body)
  if (marker === null) {
    return 'header has no layer marker (`Layer: <layer>.` or `@layer <layer>`)'
  }
  const layer = (marker[1] ?? '').toLowerCase()
  if (!LAYERS.includes(layer)) {
    return `header names the layer "${layer}", which is not one of ${LAYERS.join(', ')}`
  }
  const purpose = body
    .replace(LAYER_MARKER, '')
    .replace(/@fileoverview/gi, '')
    .trim()
  if (purpose.length < MIN_PURPOSE_LENGTH) {
    return 'header states a layer but not what the file tests'
  }
  return null
}

/**
 * Every spec file below `dir`, depth first.
 *
 * @param dir - Directory to walk.
 * @returns Absolute paths, sorted.
 */
function specFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        return specFiles(path)
      }
      return entry.name.endsWith('.spec.ts') ? [path] : []
    })
    .sort()
}

/**
 * Runs the gate over `src` and exits non-zero when any header is bad.
 *
 * @param rootArg - Repository root to check; the package root when omitted.
 */
function main(rootArg) {
  const root = rootArg ?? join(fileURLToPath(new URL('.', import.meta.url)), '..')
  const failures = specFiles(join(root, 'src'))
    .map((file) => [relative(root, file), headerProblem(readFileSync(file, 'utf8'))])
    .filter(([, problem]) => problem !== null)
  if (failures.length > 0) {
    for (const [file, problem] of failures) {
      console.error(`${file}: ${problem}`)
    }
    console.error(`\n${failures.length} spec file(s) without a purpose and layer header.`)
    process.exit(1)
  }
  console.log('Every spec file opens with a purpose and layer header.')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv[2])
}
