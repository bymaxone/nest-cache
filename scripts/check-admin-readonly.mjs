#!/usr/bin/env node
/**
 * @fileoverview Read-only gate for the `./admin` subpath.
 * @layer scripts
 *
 * The administration surface holds a Redis client that can delete, expire and
 * flush. A comment saying "every command here is read-only" is an assertion
 * nobody re-checks after the third edit, so this turns it into a build failure.
 *
 * A naive grep for mutating method names is useless here — `.set(` matches
 * `Map.set`, `.add(` matches `Set.add` — so the gate enforces three rules that
 * are actually decidable from the source:
 *
 *   1. The reader contracts (`IRedisReader`, `IRedisPipeline`) must not DECLARE
 *      a method named after a mutating Redis command. Every Redis access in the
 *      subpath goes through those interfaces, so an interface that cannot
 *      express a write is a surface that cannot perform one.
 *   2. Every command name passed to the `call(...)` escape hatch must be on the
 *      read-only allowlist. `call` is the one place a command name is a string
 *      rather than a method, and therefore the one place rule 1 cannot see.
 *   3. The subpath must not import `ioredis` as a value. Doing so would let a
 *      module construct its own client and bypass rules 1 and 2 entirely.
 *
 * Run as `pnpm check:admin-readonly`; wired into `prepublishOnly`.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ADMIN_DIR = join(ROOT, 'src', 'admin')

/** Redis commands that change state. Lowercased; matched against method names. */
const MUTATING_COMMANDS = new Set([
  'append',
  'bitfield',
  'blmove',
  'blmpop',
  'blpop',
  'brpop',
  'brpoplpush',
  'bzmpop',
  'bzpopmax',
  'bzpopmin',
  'copy',
  'decr',
  'decrby',
  'del',
  'expire',
  'expireat',
  'flushall',
  'flushdb',
  'geoadd',
  'getdel',
  'getex',
  'getset',
  'hdel',
  'hincrby',
  'hincrbyfloat',
  'hset',
  'hsetnx',
  'incr',
  'incrby',
  'incrbyfloat',
  'linsert',
  'lmove',
  'lmpop',
  'lpop',
  'lpush',
  'lpushx',
  'lrem',
  'lset',
  'ltrim',
  'mset',
  'msetnx',
  'persist',
  'pexpire',
  'pexpireat',
  'pfadd',
  'pfmerge',
  'psetex',
  'rename',
  'renamenx',
  'restore',
  'rpop',
  'rpoplpush',
  'rpush',
  'rpushx',
  'sadd',
  'script',
  'sdiffstore',
  'set',
  'setbit',
  'setex',
  'setnx',
  'setrange',
  'sinterstore',
  'smove',
  'sort',
  'spop',
  'srem',
  'sunionstore',
  'swapdb',
  'unlink',
  'xadd',
  'xdel',
  'xtrim',
  'zadd',
  'zdiffstore',
  'zincrby',
  'zinterstore',
  'zmpop',
  'zpopmax',
  'zpopmin',
  'zrangestore',
  'zrem',
  'zremrangebylex',
  'zremrangebyrank',
  'zremrangebyscore',
  'zunionstore'
])

/** Command names the `call(...)` escape hatch may send. */
const ALLOWED_CALL_COMMANDS = new Set(['ZRANGE'])

/** Source files of the subpath, excluding specs — a test may name anything. */
function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return sourceFiles(path)
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : []
  })
}

const failures = []
/** Record a failure without stopping, so one run reports every problem. */
const fail = (file, detail) => failures.push(`${relative(ROOT, file)}: ${detail}`)

for (const file of sourceFiles(ADMIN_DIR)) {
  const source = readFileSync(file, 'utf8')

  // Rule 1 — interface method declarations. Matches `name(` at the start of a
  // line inside the file, which is how a TS interface member is written here.
  for (const match of source.matchAll(/^\s{2}([a-z][a-zA-Z0-9]*)\(/gm)) {
    const name = match[1]
    if (MUTATING_COMMANDS.has(name.toLowerCase())) {
      fail(file, `declares a method named after the mutating command "${name}"`)
    }
  }

  // Rule 2 — command names handed to the `call` escape hatch.
  for (const match of source.matchAll(/\.call\(\s*'([^']+)'/g)) {
    if (!ALLOWED_CALL_COMMANDS.has(match[1])) {
      fail(file, `sends "${match[1]}" through call(); not on the read-only allowlist`)
    }
  }

  // Rule 3 — no value import of ioredis, which would allow a private client.
  for (const match of source.matchAll(/^import\s+(?!type\b)[^\n]*from\s+'ioredis'/gm)) {
    fail(file, `imports ioredis as a value (${match[0].trim()})`)
  }
}

if (failures.length > 0) {
  console.error('admin read-only gate FAILED:\n')
  for (const failure of failures) {
    console.error(`  ✗ ${failure}`)
  }
  console.error(
    '\nThe ./admin subpath is read-only by contract. If a write genuinely belongs\n' +
      'here, that is a design decision to make deliberately — not by editing this list.'
  )
  process.exit(1)
}

console.log(`admin read-only gate passed (${sourceFiles(ADMIN_DIR).length} files checked)`)
