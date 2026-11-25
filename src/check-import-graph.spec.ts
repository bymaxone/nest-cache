/**
 * Pins `scripts/check-import-graph.mjs`, the scan of the built bundles behind the README's claim
 * about which entries load `@bymax-one/nest-core` and `prom-client`. It is plain Node, so each case
 * runs it the way `check:published` does, as a child process against a throwaway `dist` directory,
 * and asserts the exit code and the printed problems.
 *
 * Layer: repository tooling, tests.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCRIPT = resolve(__dirname, '..', 'scripts', 'check-import-graph.mjs')

const dirs: string[] = []

/** A `dist` directory holding `bundles` (entry to the text of both its .mjs and .cjs bundle). */
function dist(bundles: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'import-graph-spec-'))
  dirs.push(root)
  for (const [entry, text] of Object.entries(bundles)) {
    mkdirSync(join(root, entry), { recursive: true })
    writeFileSync(join(root, entry, 'index.mjs'), text)
    writeFileSync(join(root, entry, 'index.cjs'), text)
  }
  return root
}

/** The bundles of a package whose imports are all allowed. */
const CLEAN: Record<string, string> = {
  server: "import { Module } from '@nestjs/common'\nimport { Redis } from 'ioredis'\n",
  admin:
    "import { CacheService } from '@bymax-one/nest-cache'\nimport { Injectable } from '@nestjs/common'\n",
  shared: 'export const X = 1\n',
  idempotency: "import { Redis } from 'ioredis'\n",
  metrics:
    "import { Counter } from 'prom-client'\nimport { x } from '@bymax-one/nest-core/metrics'\n",
  observability:
    "import { Gauge } from 'prom-client'\nimport { y } from '@bymax-one/nest-core/health'\n"
}

/** Runs the script on `root` and returns its exit status and combined output. */
function run(root: string): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

afterAll(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('check-import-graph', () => {
  it('passes when only metrics and observability load the optional peers', () => {
    const result = run(dist(CLEAN))

    expect(result.status).toBe(0)
  })

  // Scenario: an entry the README says never loads the optional peers imports one, in any spelling.
  // Rule: every static, dynamic and CommonJS import of nest-core (any subpath) or prom-client fails.
  it.each([
    ['a static import of nest-core', "import { a } from '@bymax-one/nest-core/metrics'\n"],
    ['a bare import of prom-client', "import 'prom-client'\n"],
    ['a dynamic import of prom-client', "const m = await import('prom-client')\n"],
    ['a require of nest-core', "const m = require('@bymax-one/nest-core')\n"],
    ['a bundler require shim of prom-client', "const m = __require('prom-client')\n"]
  ])('fails when the main entry has %s', (_name, text) => {
    const result = run(dist({ ...CLEAN, server: `${CLEAN['server']}${text}` }))

    expect(result.status).toBe(1)
    expect(result.output).toContain('server')
  })

  it.each(['admin', 'shared', 'idempotency'])('fails when %s loads prom-client', (entry) => {
    const result = run(dist({ ...CLEAN, [entry]: `${CLEAN[entry]}import 'prom-client'\n` }))

    expect(result.status).toBe(1)
    expect(result.output).toContain(entry)
  })

  // Rule: /admin never lands in the main bundle, by import or by inlined code.
  it.each([
    ['an import of the admin subpath', "import { A } from '@bymax-one/nest-cache/admin'\n"],
    ['the admin service inlined', 'class CacheAdminService {}\n']
  ])('fails when the main entry has %s', (_name, text) => {
    const result = run(dist({ ...CLEAN, server: `${CLEAN['server']}${text}` }))

    expect(result.status).toBe(1)
    expect(result.output).toContain('admin')
  })

  // Rule: /shared holds types and constants only, so it loads no package at all.
  it('fails when the shared entry imports any package', () => {
    const result = run(dist({ ...CLEAN, shared: "import { Module } from '@nestjs/common'\n" }))

    expect(result.status).toBe(1)
    expect(result.output).toContain('shared')
  })

  it('fails when a bundle is missing', () => {
    const { shared: _shared, ...rest } = CLEAN
    const result = run(dist(rest))

    expect(result.status).toBe(1)
    expect(result.output).toContain('shared')
  })

  // Scenario: the script is started through a symbolic link to it.
  // Rule: the scan still runs and reports, rather than printing nothing and exiting 0.
  it('reports a problem when started through a symbolic link', () => {
    const link = join(mkdtempSync(join(tmpdir(), 'import-graph-link-')), 'check.mjs')
    dirs.push(resolve(link, '..'))
    symlinkSync(SCRIPT, link)
    const root = dist({ ...CLEAN, shared: "import 'prom-client'\n" })

    const result = spawnSync(process.execPath, [link, root], { encoding: 'utf8' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('shared')
  })

  // A package whose name only starts like the peer is not the peer.
  it('does not take a package with a similar prefix for a peer', () => {
    const result = run(dist({ ...CLEAN, server: `${CLEAN['server']}import 'prom-client-extra'\n` }))

    expect(result.status).toBe(0)
  })
})
