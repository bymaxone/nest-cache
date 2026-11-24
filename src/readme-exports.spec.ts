/**
 * Documentation-contract test for the public export list.
 *
 * Layer: repository root (reads `README.md` and the entry files). Every name an entry exports is
 * written in the README, so a consumer reading the published page can find what the package gives them;
 * a name added to an entry without a line in the README fails here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const README = readFileSync(join(ROOT, 'README.md'), 'utf8')

const ENTRIES = [
  'src/server/index.ts',
  'src/admin/index.ts',
  'src/metrics/index.ts',
  'src/observability/index.ts',
  'src/idempotency/index.ts',
  'src/shared/index.ts'
] as const

/** Names an entry file exports publicly, from its `export { … }` and `export type { … }` lists. */
function exportedNames(entry: string): string[] {
  // An export marked `@internal` is stripped from the published declarations, so it is not documented.
  const source = readFileSync(join(ROOT, entry), 'utf8').replace(
    /\/\*\*\s*@internal\s*\*\/\s*export[^;\n]*/g,
    ''
  )
  const names: string[] = []
  for (const block of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of (block[1] ?? '').split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.replace(/^type\s+/, '')
        .trim()
      if (name) names.push(name)
    }
  }
  return names
}

describe('README export coverage', () => {
  it.each(ENTRIES)('names every export of %s', (entry) => {
    const names = exportedNames(entry)
    const missing = names.filter((name) => !new RegExp(`\\b${name}\\b`).test(README))

    expect(names.length).toBeGreaterThan(0)
    expect(missing).toEqual([])
  })
})
