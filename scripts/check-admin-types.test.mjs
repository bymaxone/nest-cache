/**
 * @fileoverview Tests for the type-aware admin gate: it must exit non-zero and say why for every way
 * a client or a write command could reach the `./admin` subpath, and pass the code that reads
 * through the reader contract.
 * @layer scripts
 *
 * Each case runs the real command over a throwaway project that links this repository's
 * `node_modules`, so the fixtures import the real ioredis types.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, 'check-admin-types.mjs')
const MODULES = resolve(HERE, '..', 'node_modules')
const roots = []

const READER = (commands) => `export type AdminReadCommand = ${commands}
export interface IRedisReader {
  call(command: AdminReadCommand, ...args: (string | number)[]): Promise<unknown>
  get(key: string): Promise<string | null>
}
`

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    strict: true,
    noEmit: true,
    skipLibCheck: true
  },
  include: ['src/**/*']
})

/**
 * Runs the gate over a throwaway project.
 *
 * @param files - Paths under `src/admin` to file text, added to the reader contract.
 * @param commands - The text of the `AdminReadCommand` union.
 * @returns The command's exit status and combined output.
 */
function run(files, commands = "'GETRANGE' | 'HSCAN' | 'SSCAN' | 'ZRANGE'") {
  const root = mkdtempSync(join(tmpdir(), 'admin-types-'))
  roots.push(root)
  symlinkSync(MODULES, join(root, 'node_modules'))
  writeFileSync(join(root, 'tsconfig.json'), TSCONFIG)
  const all = { 'interfaces/redis-reader.interface.ts': READER(commands), ...files }
  for (const [path, text] of Object.entries(all)) {
    const target = join(root, 'src', 'admin', path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, text)
  }
  const result = spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

/** A service whose body is `body`, with the reader and the ioredis types in scope. */
const service = (body) => ({
  'service.ts': `import type { Redis, Cluster, Pipeline } from 'ioredis'
import type { IRedisReader } from './interfaces/redis-reader.interface'
${body}
`
})

after(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('admin type gate, what passes', () => {
  // Scenario: a service that reads through the reader with literal commands.
  // Rule: it passes and the gate reports how many files it read.
  it('passes code that reads through the reader contract', () => {
    const result = run(
      service(
        "export async function read(reader: IRedisReader, key: string) {\n  return [await reader.call('GETRANGE', key, 0, 9), await reader.get(key)]\n}"
      )
    )
    assert.equal(result.status, 0, result.output)
    assert.match(result.output, /admin type gate passed \(2 files checked\)/)
  })
})

describe('admin type gate, the command handed to call', () => {
  // Scenario: a write command spelled as a literal.
  // Rule: it is not in the union, so the program reports a type error and the gate fails.
  it('fails a literal command outside the union', () => {
    const result = run(service("export const f = (r: IRedisReader) => r.call('DEL', 'k')"))
    assert.equal(result.status, 1)
    assert.match(result.output, /type error/)
  })

  // Scenario: the command comes from a variable of type string.
  // Rule: a name the checker cannot narrow to the union fails.
  it('fails a command computed at run time', () => {
    const result = run(
      service(
        "export const f = (r: IRedisReader, names: string[]) => names.map((n) => r.call(n, 'k'))"
      )
    )
    assert.equal(result.status, 1)
    assert.match(result.output, /type error/)
  })

  // Scenario: the union itself lists a write.
  // Rule: the allowlist is held to the command table, so it fails and names the command.
  it('fails a union that names a write command', () => {
    const result = run({}, "'GETRANGE' | 'DEL'")
    assert.equal(result.status, 1)
    assert.match(result.output, /names the write command "DEL"/)
  })

  // Scenario: the union is not declared.
  // Rule: with no allowlist there is nothing to hold the subpath to, so it fails.
  it('fails when the union is missing', () => {
    const result = run({
      'interfaces/redis-reader.interface.ts': 'export interface IRedisReader {}\n'
    })
    assert.equal(result.status, 1)
    assert.match(result.output, /AdminReadCommand is missing/)
  })
})

describe('admin type gate, an ioredis client in the subpath', () => {
  // Scenario: a parameter typed as the client, and the same through a type alias.
  // Rule: the type is what counts, so the alias fails the same as the name.
  it('fails a client-typed parameter, aliased or not', () => {
    const plain = run(service('export const f = (c: Redis) => c.status'))
    const aliased = run(service('type Client = Redis\nexport const f = (c: Client) => c.status'))
    for (const result of [plain, aliased]) {
      assert.equal(result.status, 1, result.output)
      assert.match(result.output, /is an ioredis client/)
    }
  })

  // Scenario: the cluster and pipeline types, which are not `Redis` but send commands too.
  // Rule: each fails.
  it('fails the cluster and the pipeline types', () => {
    const cluster = run(service('export const f = (c: Cluster) => c.status'))
    const pipeline = run(service('export const f = (c: Pipeline) => c.length'))
    for (const result of [cluster, pipeline]) {
      assert.equal(result.status, 1, result.output)
      assert.match(result.output, /is an ioredis client/)
    }
  })

  // Scenario: a reader cast to the client, through unknown.
  // Rule: the cast expression has the client's type, so it fails wherever the cast is written.
  it('fails a cast to the client', () => {
    const result = run(service('export const f = (r: IRedisReader) => (r as unknown as Redis)'))
    assert.equal(result.status, 1)
    assert.match(result.output, /is an ioredis client/)
  })

  // Scenario: a reader re-typed as a looser shape the subpath declares itself, which no list of
  // member names sees because nothing in it is named after a command.
  // Rule: taking a value out of the reader contract fails, direct or through unknown.
  it('fails a reader cast out of its contract', () => {
    const shape = 'interface Loose { go(k: string): Promise<number> }\n'
    const direct = run(service(`${shape}export const f = (r: IRedisReader) => (r as Loose)`))
    const twice = run(
      service(`${shape}export const f = (r: IRedisReader) => (r as unknown as Loose)`)
    )
    for (const result of [direct, twice]) {
      assert.equal(result.status, 1, result.output)
      assert.match(result.output, /cast to another type/)
    }
  })

  // Scenario: a client reached through a field of a looser type the subpath declares itself.
  // Rule: the field's type is the client's, so reading it fails.
  it('fails a client held in a field', () => {
    const result = run(service('export class Holder { constructor(readonly inner: Redis) {} }'))
    assert.equal(result.status, 1)
    assert.match(result.output, /is an ioredis client/)
  })
})

describe('admin type gate, any', () => {
  // Scenario: a value of type any that is called through.
  // Rule: the checker cannot see what it holds, so reaching into it fails.
  it('fails an any-typed receiver', () => {
    const result = run(service("export const f = (x: any) => x.del('k')"))
    assert.equal(result.status, 1)
    assert.match(result.output, /spells "any"/)
    assert.match(result.output, /of type any and is reached into/)
  })

  // Scenario: a narrowing that yields any without the code spelling it (`Array.isArray`).
  // Rule: reaching into the result fails; the read through unknown passes.
  it('fails an element reached through Array.isArray and passes the unknown form', () => {
    const bad = run(
      service('export const f = (v: unknown) => (Array.isArray(v) ? v.map((e) => e[0]) : [])')
    )
    assert.equal(bad.status, 1)
    const good = run(
      service(
        'export const f = (v: unknown): unknown[] => (Array.isArray(v) ? (v as unknown[]) : [])'
      )
    )
    assert.equal(good.status, 0, good.output)
  })

  // Scenario: an any that is only assigned, as `Reflect.get` returns.
  // Rule: it is not reached into, so it passes.
  it('passes an any that is only assigned to unknown', () => {
    const result = run(service("export const f = (o: object): unknown => Reflect.get(o, 'code')"))
    assert.equal(result.status, 0, result.output)
  })
})
