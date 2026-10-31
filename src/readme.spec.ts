/**
 * Documentation-contract tests for the published README.
 *
 * Layer: repository root (reads `README.md`, imports the server and shared surfaces).
 * Pins the option-defaults table and the error-code table to the code.
 *
 * The README ships in the npm tarball and `check:published` only compiles its fenced
 * snippets, so a wrong default or status in a table is read by consumers as fact and
 * nothing else would catch it. Rows are parsed from the markdown itself, so editing the
 * README without the code (or the reverse) fails here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { applyDefaults } from './server/config/default-options'
import {
  MIN_CONNECT_TIMEOUT_MS,
  MIN_SHUTDOWN_TIMEOUT_MS
} from './server/constants/default-timeouts'
import { CacheException } from './server/errors/cache.exception'
import { CACHE_ERROR_CODES } from './shared'

const README = readFileSync(join(__dirname, '..', 'README.md'), 'utf8')

/** Splits a markdown table row into trimmed cells; `\|` inside a cell is not a separator. */
const cells = (row: string): string[] =>
  row
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim())

/** Rows of the first table that follows `heading`, as cell arrays (header and rule dropped). */
const tableRowsAfter = (heading: string): string[][] => {
  const start = README.indexOf(heading)
  expect(start).toBeGreaterThan(-1)
  const rows: string[][] = []
  for (const line of README.slice(start).split('\n').slice(1)) {
    if (line.startsWith('|')) {
      rows.push(cells(line))
    } else if (rows.length > 0) {
      break
    }
  }
  return rows.slice(2)
}

/** Reads a README default cell: `—` is undefined, a backticked literal is its JS value. */
const readDefault = (cell: string): unknown => {
  if (cell === '—') return undefined
  const literal = /^`(.*)`$/.exec(cell)?.[1]
  if (literal === undefined) throw new Error(`Unparseable default cell: ${cell}`)
  if (literal === 'true') return true
  if (literal === 'false') return false
  if (/^\d+$/.test(literal)) return Number(literal)
  return /^'.*'$/.test(literal) ? literal.slice(1, -1) : literal
}

describe('README option-defaults table', () => {
  const rows = tableRowsAfter('## ⚙️ Configuration')
  const resolved: Record<string, unknown> = { ...applyDefaults({}) }
  const topLevel = rows.filter(([option]) => !(option ?? '').includes('.'))

  /*
   * Arrange: the Configuration table, top-level options only (dotted rows document nested blocks).
   * Act: resolve the module options with nothing supplied.
   * Assert: every documented default equals the resolved value, and `—` means unset.
   */
  it('documents the value applyDefaults resolves for every top-level option', () => {
    const documented = topLevel
      .filter(([option]) => option !== '`serializer`')
      .map(([option, , fallback]) => [
        (option ?? '').replace(/`/g, ''),
        readDefault(fallback ?? '')
      ])

    expect(documented.length).toBeGreaterThan(0)
    for (const [option, fallback] of documented) {
      if (fallback !== undefined) expect(Object.keys(resolved)).toContain(option)
      expect({ [String(option)]: resolved[String(option)] }).toEqual({ [String(option)]: fallback })
    }
  })

  /*
   * Arrange: the `serializer` row, which names a class rather than a literal.
   * Act: resolve the options with nothing supplied.
   * Assert: the row names JsonSerializer and the resolved options leave the choice to the module.
   */
  it('names JsonSerializer as the default serializer, chosen by the module and not by applyDefaults', () => {
    const row = topLevel.find(([option]) => option === '`serializer`')

    expect(row?.[2]).toBe('`JsonSerializer`')
    expect(resolved['serializer']).toBeUndefined()
  })

  /*
   * Arrange: the documented minimums, written as "(minimum `N`)" next to the option.
   * Act: read them out of the README.
   * Assert: they equal the constants the validators enforce.
   */
  it('documents the same minimums the validators enforce', () => {
    const shutdown = /`shutdownTimeoutMs`.*?\(minimum `(\d+)`\)/.exec(README)?.[1]
    const connect = /`connectTimeout` \(minimum `(\d+)`\)/.exec(README)?.[1]

    expect(Number(shutdown)).toBe(MIN_SHUTDOWN_TIMEOUT_MS)
    expect(Number(connect)).toBe(MIN_CONNECT_TIMEOUT_MS)
  })
})

describe('README error-code table', () => {
  const rows = tableRowsAfter('## 🪪 Default Error Codes')
  const documented = rows.map(([code, status]) => ({
    code: (code ?? '').replace(/`/g, ''),
    status: Number(status)
  }))

  /*
   * Arrange: every row of the error-code table.
   * Act: compare the set of codes with CACHE_ERROR_CODES.
   * Assert: the README lists every code the library defines, and no other.
   */
  it('lists exactly the codes in CACHE_ERROR_CODES', () => {
    const defined = Object.values(CACHE_ERROR_CODES).sort()

    expect(documented.map(({ code }) => code).sort()).toEqual(defined)
  })

  /*
   * Arrange: the HTTP status each row documents.
   * Act: construct the exception for that code.
   * Assert: the documented status is the one CacheException carries.
   */
  it('documents the HTTP status CacheException carries for each code', () => {
    for (const { code, status } of documented) {
      expect({ code, status: new CacheException(code as never).getStatus() }).toEqual({
        code,
        status
      })
    }
  })
})
