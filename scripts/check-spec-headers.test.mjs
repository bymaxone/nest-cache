/**
 * @fileoverview Tests for the spec-header gate: it must exit non-zero and name the file for a spec
 * with no header or a layer outside the enum, and pass a correct one.
 * @layer scripts
 *
 * A gate that never fails proves nothing, so each case runs the real command against a throwaway
 * `src` tree and reads its exit status and its output.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-spec-headers.mjs')
const roots = []

/**
 * Runs the gate over a temporary repository holding `files`.
 *
 * @param files - Relative path to file text.
 * @returns The command's exit status and combined output.
 */
function run(files) {
  const root = mkdtempSync(join(tmpdir(), 'spec-headers-'))
  roots.push(root)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  const result = spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

const GOOD = `/**
 * Unit tests for the key builder: namespaced keys and the errors for an empty prefix.
 *
 * Layer: server.
 */
describe('x', () => {})
`

describe('check-spec-headers', () => {
  after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })))

  it('passes a spec with a purpose and a layer', () => {
    const { status } = run({ 'src/server/a.spec.ts': GOOD })

    assert.equal(status, 0)
  })

  it('fails a spec with no header and names the file', () => {
    const { status, output } = run({
      'src/server/a.spec.ts': GOOD,
      'src/server/bare.spec.ts': "import { x } from './x'\n\ndescribe('x', () => {})\n"
    })

    assert.equal(status, 1)
    assert.match(
      output,
      /src\/server\/bare\.spec\.ts: does not open with a \/\*\* \*\/ block comment/
    )
    assert.doesNotMatch(output, /a\.spec\.ts:/)
  })

  it('fails a layer outside the enum and names the file and the layer', () => {
    const { status, output } = run({
      'src/server/odd.spec.ts': GOOD.replace('Layer: server.', 'Layer: backend.')
    })

    assert.equal(status, 1)
    assert.match(output, /src\/server\/odd\.spec\.ts: header names the layer "backend"/)
  })

  it('fails a header that has a layer and no purpose', () => {
    const { status, output } = run({
      'src/server/thin.spec.ts': '/**\n * Layer: server.\n */\ndescribe("x", () => {})\n'
    })

    assert.equal(status, 1)
    assert.match(output, /src\/server\/thin\.spec\.ts: header states a layer but not what/)
  })

  it('fails a header that has a purpose and no layer', () => {
    const { status, output } = run({
      'src/server/nolayer.spec.ts':
        '/**\n * Unit tests for the key builder and its errors.\n */\ndescribe("x", () => {})\n'
    })

    assert.equal(status, 1)
    assert.match(output, /src\/server\/nolayer\.spec\.ts: header has no layer marker/)
  })

  it('accepts the @layer tag form', () => {
    const { status } = run({
      'src/test-helpers/t.spec.ts': GOOD.replace('Layer: server.', '@layer test utilities')
    })

    assert.equal(status, 0)
  })
})
