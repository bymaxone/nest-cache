/**
 * @fileoverview Tests for the admin read-only gate: it must exit non-zero and say why for every way
 * a write could reach the `./admin` subpath, and pass the code that is read-only.
 * @layer scripts
 *
 * A gate that never fails proves nothing, so each case runs the real command over a throwaway tree
 * of source files and reads its exit status and its output.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-admin-readonly.mjs')
const roots = []

/**
 * Runs the gate over a temporary directory holding `files`.
 *
 * @param files - Relative path to file text.
 * @returns The command's exit status and combined output.
 */
function run(files) {
  const root = mkdtempSync(join(tmpdir(), 'admin-readonly-'))
  roots.push(root)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  const result = spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

/** A service body that sends `command` through `call` in the way `snippet` spells it. */
const sending = (snippet) => ({
  'service.ts': `export async function read(client: Reader, key: string) {\n  ${snippet}\n}\n`
})

describe('admin read-only gate, command names handed to call', () => {
  // Scenario: the allowed commands, each spelled as a plain literal.
  // Rule: they pass, and the gate reports how many files it read.
  it('passes the commands on the allowlist', () => {
    const result = run(
      sending("await client.call('ZRANGE', key, 0, 1)\n  await client.call('GETRANGE', key, 0, 9)")
    )
    assert.equal(result.status, 0, result.output)
    assert.match(result.output, /passed \(1 files? checked\)/)
  })

  // Scenario: a mutating command spelled every way a regex looking for a single-quoted literal misses.
  // Rule: each one fails and the output names the file and says the command is not allowed.
  for (const [label, snippet] of [
    ['single quotes', "await client.call('DEL', key)"],
    ['double quotes', 'await client.call("DEL", key)'],
    ['a template literal', 'await client.call(`DEL`, key)'],
    ['lower case', "await client.call('del', key)"],
    ['an element access', "await client['call']('DEL', key)"],
    ['a line break after the parenthesis', "await client.call(\n    'DEL',\n    key\n  )"]
  ]) {
    it(`fails a mutating command sent with ${label}`, () => {
      const result = run(sending(snippet))
      assert.notEqual(result.status, 0, result.output)
      assert.match(result.output, /service\.ts/)
      assert.match(result.output, /DEL/i)
    })
  }

  // Scenario: a command name the gate cannot read: a variable, an expression, a spread, no argument.
  // Rule: it fails, saying the name is not a literal, since an unreadable name cannot be on the list.
  for (const [label, snippet] of [
    ['a variable', "const command = 'ZRANGE'\n  await client.call(command, key)"],
    ['a concatenation', "await client.call('ZR' + 'ANGE', key)"],
    ['a template with a substitution', 'await client.call(`ZRANGE${suffix}`, key)'],
    ['a spread', 'await client.call(...args)'],
    ['no argument', 'await client.call()']
  ]) {
    it(`fails a command name that is ${label}`, () => {
      const result = run(sending(snippet))
      assert.notEqual(result.status, 0, result.output)
      assert.match(result.output, /not a (string )?literal/i)
    })
  }
})

describe('admin read-only gate, other routes to a write', () => {
  // Scenario: `call` used without being called directly, so the first argument is never in view.
  // Rule: every reference to `call` that is not a direct call with a literal name fails.
  for (const [label, snippet] of [
    ['apply', "await client.call.apply(client, ['DEL', key])"],
    ['bind', "const send = client.call.bind(client)\n  await send('DEL', key)"],
    ['Reflect.apply', "await Reflect.apply(client.call, client, ['DEL', key])"],
    ['a destructured call', "const { call } = client\n  await call('DEL', key)"],
    ['an alias', "const send = client.call\n  await send('DEL', key)"],
    ['an optional call', "await client?.call?.('DEL', key)"]
  ]) {
    it(`fails call used through ${label}`, () => {
      const result = run(sending(snippet))
      assert.notEqual(result.status, 0, result.output)
      assert.match(result.output, /service\.ts/)
    })
  }

  // Scenario: the client's own raw command senders.
  // Rule: `sendCommand`, `send_command` and a `Command` built from ioredis fail.
  for (const [label, snippet] of [
    ['sendCommand', "await client.sendCommand(new Cmd('DEL', [key]))"],
    ['send_command', "await client.send_command('del', [key])"],
    ['a Command', "await client.call(new Command('DEL', [key]))"],
    ['a Command by name', "const cmd = new Command('DEL', [key])"]
  ]) {
    it(`fails ${label}`, () => {
      const result = run(sending(snippet))
      assert.notEqual(result.status, 0, result.output)
    })
  }

  // Scenario: a mutating command CALLED, where the declarations rule cannot see it: through a cast,
  // an element access, an optional chain, a destructuring or a bare reference.
  // Rule: any member access named after a mutating command fails, call or not.
  for (const [label, snippet] of [
    ['a cast', 'await (reader as Loose).del(key)'],
    ['an element access', "await reader['del'](key)"],
    ['an optional chain', 'await reader?.hset?.(key, f, v)'],
    ['a destructuring', 'const { unlink } = reader\n  await unlink(key)'],
    ['a reference', 'const remove = reader.expire\n  await remove(key, 1)'],
    ['a pipeline', 'await reader.pipeline().del(key).exec()']
  ]) {
    it(`fails a mutating command used through ${label}`, () => {
      const result = run(sending(snippet))
      assert.notEqual(result.status, 0, result.output)
      assert.match(result.output, /service\.ts/)
    })
  }

  // Scenario: names that collide with ordinary JavaScript collections, on receivers the file builds
  // itself as collections.
  // Rule: they pass; a `Map.set` or `Array.sort` on a local collection is not a Redis write.
  it('passes ordinary collection calls on receivers the file declares as collections', () => {
    const result = run({
      'service.ts':
        'const seen = new Map<string, number>()\nconst list = [3, 1]\n' +
        'export class S {\n  private readonly found = new Set<string>()\n  run() {\n    this.found.add("a")\n    return list.sort()\n  }\n}\n' +
        'seen.set("a", 1)\n"a".concat("b")\n'
    })
    assert.equal(result.status, 0, result.output)
  })

  // Scenario: the same names on the client, on a parameter, on a call result, and destructured.
  // Rule: they fail, since only a receiver the file declares as a collection is exempt.
  for (const [label, snippet] of [
    ['a parameter', 'await client.set(key, "v")'],
    ['a call result', 'await getClient().sort(key)'],
    ['an element', 'await clients[0].copy(key, "b")'],
    ['a destructuring', 'const { set } = client\n  await set(key, "v")'],
    ['append', 'await client.append(key, "v")']
  ]) {
    it(`fails a collection-named command on ${label}`, () => {
      const result = run(sending(snippet))
      assert.notEqual(result.status, 0, result.output)
    })
  }

  // Scenario: other ways ioredis sends a command by name.
  // Rule: `callBuffer` is judged like `call`, commands passed to `pipeline` or `multi` by name fail,
  // and so do `defineCommand` and the commands a reviewer found missing from the list.
  for (const [label, snippet] of [
    ['callBuffer with a write', "await client.callBuffer('SET', key, 'v')"],
    ['callBuffer by reference', 'const send = client.callBuffer\n  await send("SET", key)'],
    ['callBuffer with a variable', 'await client.callBuffer(name, key)'],
    ['a pipeline of named commands', "await client.pipeline([['set', 'a', 'b']]).exec()"],
    ['a multi of named commands', "await client.multi([['del', 'a']]).exec()"],
    [
      'defineCommand',
      "client.defineCommand('x', { lua: 'return redis.call(\"SET\", KEYS[1], 1)' })"
    ],
    ['hmset', 'await client.hmset(key, { a: 1 })'],
    ['move', 'await client.move(key, 1)'],
    ['bitop', 'await client.bitop("AND", key, key)'],
    ['xreadgroup', 'await client.xreadgroup("GROUP", "g", "c", "STREAMS", key, ">")'],
    ['georadius', 'await client.georadius(key, 0, 0, 1, "km")'],
    ['geosearchstore', 'await client.geosearchstore(key, key)'],
    ['config', "await client.config('SET', 'maxmemory', '1')"],
    ['client', "await client.client('KILL', 'ID', '1')"],
    ['acl', "await client.acl('SETUSER', 'x')"],
    ['function', "await client.function('LOAD', 'code')"],
    ['debug', "await client.debug('SLEEP', '1')"]
  ]) {
    it(`fails ${label}`, () => {
      const result = run(sending(snippet))
      assert.notEqual(result.status, 0, result.output)
    })
  }

  // Scenario: members reached by a name the gate cannot read.
  // Rule: a computed name, a Reflect lookup with a variable or a mutating literal, and a computed
  // destructuring all fail, while a Reflect.get of a harmless literal passes.
  for (const [label, snippet] of [
    ['a variable key', "const m = 'del'\n  const f = client[m]\n  await f(key)"],
    ['Reflect.get with a mutating literal', "await Reflect.get(client, 'del')(key)"],
    ['Reflect.get with a variable', 'await Reflect.get(client, name)(key)'],
    ['a computed destructuring', 'const { [name]: f } = client\n  await f(key)']
  ]) {
    it(`fails ${label}`, () => {
      const result = run(sending(snippet))
      assert.notEqual(result.status, 0, result.output)
    })
  }

  it('passes a Reflect.get of a harmless literal and a numeric index', () => {
    const result = run(
      sending(
        "const code: unknown = Reflect.get(error, 'code')\n  const first = rows[0]\n  return [code, first]"
      )
    )
    assert.equal(result.status, 0, result.output)
  })
})

describe('admin read-only gate, declarations', () => {
  // Scenario: a mutating command declared as a member of the reader contract, however it is written.
  // Rule: each one fails naming the command, whatever its indent or shape.
  for (const [label, text] of [
    ['a method at two spaces', 'export interface R {\n  del(key: string): Promise<number>\n}\n'],
    ['a method at four spaces', 'export interface R {\n    del(key: string): Promise<number>\n}\n'],
    [
      'a function-typed property',
      'export interface R {\n  del: (key: string) => Promise<number>\n}\n'
    ],
    ['a member of a type literal', 'export type R = {\n  hset(key: string): Promise<number>\n}\n'],
    ['a class method', 'export class R {\n  async expire(key: string) {\n    return 1\n  }\n}\n'],
    ['a quoted name', "export interface R {\n  'flushdb'(): Promise<void>\n}\n"]
  ]) {
    it(`fails a mutating command declared as ${label}`, () => {
      const result = run({ 'reader.ts': text })
      assert.notEqual(result.status, 0, result.output)
      assert.match(result.output, /reader\.ts/)
      assert.match(result.output, /declares/i)
    })
  }

  // Scenario: members that merely share a word with a command, or are not named after one.
  // Rule: they pass; a `Map.set` or `Set.add` call is not a declaration of a write.
  it('passes a reader contract of read commands and ordinary collection calls', () => {
    const result = run({
      'reader.ts':
        'export interface R {\n  get(key: string): Promise<string | null>\n  lrange(k: string): Promise<string[]>\n}\n' +
        'const seen = new Map<string, string>()\nseen.set("a", "b")\nnew Set<string>().add("a")\n'
    })
    assert.equal(result.status, 0, result.output)
  })
})

describe('admin read-only gate, ioredis', () => {
  // Scenario: ioredis brought in as a value, by every route.
  // Rule: each one fails: a private client would bypass the other rules.
  for (const [label, text] of [
    ['an import', "import { Redis } from 'ioredis'\n"],
    ['a double-quoted import', 'import { Redis } from "ioredis"\n'],
    ['a multi-line import', "import {\n  Redis,\n  Cluster\n} from 'ioredis'\n"],
    ['a default import', "import Redis from 'ioredis'\n"],
    ['a require', "const { Redis } = require('ioredis')\n"],
    ['a dynamic import', "export const load = () => import('ioredis')\n"],
    ['an import-equals', "import redis = require('ioredis')\n"],
    ['a subpath import', "import Redis from 'ioredis/built/Redis'\n"],
    ['a subpath require', "const Redis = require('ioredis/built/Redis')\n"],
    ['an aliased require', "const load = require\nconst Redis = load('ioredis')\n"],
    ['a computed dynamic import', "export const load = () => import('io' + 'redis')\n"]
  ]) {
    it(`fails ioredis as a value through ${label}`, () => {
      const result = run({ 'client.ts': text })
      assert.notEqual(result.status, 0, result.output)
      assert.match(result.output, /ioredis|module/)
    })
  }

  // Scenario: ioredis used for types only.
  // Rule: it passes, since a type import creates no client.
  it('passes a type-only import', () => {
    const result = run({ 'types.ts': "import type { Redis } from 'ioredis'\n" })
    assert.equal(result.status, 0, result.output)
  })
})

describe('admin read-only gate, which files it reads', () => {
  // Scenario: a test helper in a `__tests__` directory that names a write.
  // Rule: it is skipped like a spec, since a fake client has to name whatever it fakes.
  it('skips a __tests__ directory', () => {
    const result = run({ '__tests__/fixtures.ts': "await client.call('DEL', key)\n" })
    assert.equal(result.status, 0, result.output)
  })

  // Scenario: a write in a spec file and in a nested source file.
  // Rule: a spec may name anything; a nested source file is read like any other.
  it('skips specs and reads nested sources', () => {
    const spec = run({ 'a.spec.ts': "await client.call('DEL', key)\n" })
    assert.equal(spec.status, 0, spec.output)
    const nested = run({ 'deep/er/b.ts': "await client.call('DEL', key)\n" })
    assert.notEqual(nested.status, 0, nested.output)
    assert.match(nested.output, /b\.ts/)
  })

  // Scenario: a failure in two files.
  // Rule: one run reports both, so a fix does not take one run per file.
  it('reports every failing file in one run', () => {
    const result = run({
      'one.ts': "await client.call('DEL', key)\n",
      'two.ts': "await client.call('SET', key, 1)\n"
    })
    assert.notEqual(result.status, 0)
    assert.match(result.output, /one\.ts/)
    assert.match(result.output, /two\.ts/)
  })
})

after(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true })
  }
})
