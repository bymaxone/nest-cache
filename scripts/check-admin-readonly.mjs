#!/usr/bin/env node
/**
 * @fileoverview Read-only gate for the `./admin` subpath.
 * @layer scripts
 *
 * The administration surface holds a Redis client that can delete, expire and
 * flush. A comment saying "every command here is read-only" is an assertion
 * nobody re-checks after the third edit, so this turns it into a build failure.
 *
 * The rules are read from the TypeScript syntax tree of every non-spec source file, not from its
 * text, so quoting, layout, line breaks and comments do not matter:
 *
 *   1. `call`. The escape hatch `client.call('NAME', ...)` is the one place a command name is a
 *      string rather than a method. Every direct call of `call` (dot or `['call']` access) must
 *      pass a string literal, or a template literal without substitutions, naming a command on the
 *      allowlist. A name the gate cannot read, whether a variable, a concatenation, a spread or no
 *      argument, fails: an unreadable name cannot be shown to be on the list. This holds for any
 *      object, so `Function.prototype.call` fails too; the subpath has no use for it.
 *   2. A reference to `call` that is not a direct call fails: `call.apply`, `call.bind`,
 *      `Reflect.apply(client.call, ...)`, `const { call } = client`, `const send = client.call`. The
 *      first argument is out of sight in each of them.
 *   3. A member named after a mutating Redis command fails wherever it is used: `reader.del(k)`,
 *      `reader['del'](k)`, `(reader as Loose).del(k)`, `reader?.hset?.()`, `reader.pipeline().del()`,
 *      `const { unlink } = reader`. Names that ordinary JavaScript collections share (`set`, `sort`,
 *      `copy`, `append`) are exempt from this rule alone, since without types a `Map.set` cannot be
 *      told from a client; rule 4 still refuses them.
 *   4. The reader contracts must not DECLARE a member named after a mutating command: a method or
 *      property signature, a class member, a type-literal member, quoted or not, at any indent.
 *      Every Redis access in the subpath goes through those interfaces, so an interface that cannot
 *      express a write is a surface that cannot perform one.
 *   5. The client's own raw command senders, `sendCommand`, `send_command` and `new Command(...)`,
 *      fail.
 *   6. The subpath must not bring `ioredis` in as a value: no `import` that is not `import type`, no
 *      `export ... from`, no `import x = require()`, no `require('ioredis')`, no `import('ioredis')`.
 *      A value import would let a module construct its own client and bypass the rules above.
 *
 * Run as `pnpm check:admin-readonly`, optionally with a directory to read instead of `src/admin`
 * (the tests do); wired into `prepublishOnly` and the CI verify job.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ADMIN_DIR = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, 'src', 'admin')

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

/**
 * Write commands a method named after them could reach that the list above does not cover: scripts,
 * publishing, consumer groups, persistence and server control. Added to the same set.
 */
const MORE_MUTATING_COMMANDS = [
  'bgrewriteaof',
  'bgsave',
  'eval',
  'evalsha',
  'failover',
  'fcall',
  'migrate',
  'publish',
  'replicaof',
  'save',
  'shutdown',
  'slaveof',
  'spublish',
  'xack',
  'xautoclaim',
  'xclaim',
  'xgroup',
  'xsetid'
]
for (const name of MORE_MUTATING_COMMANDS) {
  MUTATING_COMMANDS.add(name)
}

/**
 * Mutating command names that ordinary JavaScript values also have (`Map.set`, `Array.sort`,
 * `Buffer.copy`, `FormData.append`). A MEMBER ACCESS of these names is allowed, since without types
 * the gate cannot tell a collection from a client; a DECLARATION of them is still refused, because the
 * reader contract has no reason to name them, and the typed contract is what every Redis access in the
 * subpath goes through.
 */
const COLLECTION_NAMES = new Set(['append', 'copy', 'set', 'sort'])

/** Command names the `call(...)` escape hatch may send. */
const ALLOWED_CALL_COMMANDS = new Set(['ZRANGE', 'GETRANGE', 'HSCAN', 'SSCAN'])

/** Raw senders of the client that take a command by name. */
const RAW_SENDERS = new Set(['sendCommand', 'send_command'])

/** Source files of the subpath, excluding specs and their `__tests__` helpers — a test may name anything. */
function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(path)
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : []
  })
}

/** The text of a string literal or a template literal without substitutions, else `null`. */
function literalText(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null
}

/**
 * The member name a property access or element access spells out, or `null` when it is not a
 * member access or the key is computed.
 */
function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text
  }
  if (ts.isElementAccessExpression(node)) {
    return literalText(node.argumentExpression)
  }
  return null
}

/** The name a declaration or a destructured element is given, or `null` when it is computed. */
function declaredName(name) {
  if (!name) {
    return null
  }
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text
  }
  return ts.isComputedPropertyName(name) ? literalText(name.expression) : null
}

const failures = []
/** Record a failure without stopping, so one run reports every problem. */
const fail = (file, source, node, detail) => {
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
  failures.push(`${relative(ROOT, file)}:${line + 1}: ${detail}`)
}

/** Checks one source file against every rule. */
function check(file) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  /** `call` accesses that are the callee of a direct call, already judged by rule 1. */
  const judged = new Set()

  const visit = (node) => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = ts.isParenthesizedExpression(node.expression)
        ? node.expression.expression
        : node.expression
      const name = memberName(callee)
      if (ts.isCallExpression(node) && name === 'call') {
        judged.add(callee)
        const command = literalText(node.arguments[0])
        if (command === null) {
          fail(
            file,
            source,
            node,
            'sends a command through call() whose name is not a string literal'
          )
        } else if (!ALLOWED_CALL_COMMANDS.has(command)) {
          fail(
            file,
            source,
            node,
            `sends "${command}" through call(); not on the read-only allowlist`
          )
        }
      }
      if (ts.isNewExpression(node) && ts.isIdentifier(callee) && callee.text === 'Command') {
        fail(file, source, node, 'builds a raw Command')
      }
      if (ts.isCallExpression(node) && ts.isElementAccessExpression(callee) && name === null) {
        fail(file, source, node, 'calls a member whose name is computed, so it cannot be checked')
      }
      if (
        ts.isCallExpression(node) &&
        ((ts.isIdentifier(callee) && callee.text === 'require') ||
          callee.kind === ts.SyntaxKind.ImportKeyword) &&
        literalText(node.arguments[0]) === 'ioredis'
      ) {
        fail(file, source, node, 'brings ioredis in as a value (require or dynamic import)')
      }
    }

    const name = memberName(node)
    if (name !== null) {
      if (name === 'call' && !judged.has(node)) {
        fail(
          file,
          source,
          node,
          'uses call without calling it directly, so its command is out of view'
        )
      }
      if (RAW_SENDERS.has(name)) {
        fail(file, source, node, `uses the raw sender "${name}"`)
      }
      if (MUTATING_COMMANDS.has(name.toLowerCase()) && !COLLECTION_NAMES.has(name.toLowerCase())) {
        fail(file, source, node, `uses a member named after the mutating command "${name}"`)
      }
    }

    if (ts.isBindingElement(node)) {
      const bound = declaredName(node.propertyName ?? node.name)
      if (
        bound === 'call' ||
        RAW_SENDERS.has(bound) ||
        MUTATING_COMMANDS.has(bound?.toLowerCase())
      ) {
        if (!COLLECTION_NAMES.has(bound.toLowerCase())) {
          fail(file, source, node, `destructures "${bound}" out of a client`)
        }
      }
    }

    if (
      ts.isMethodSignature(node) ||
      ts.isPropertySignature(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isPropertyDeclaration(node)
    ) {
      const declared = declaredName(node.name)
      if (declared !== null && MUTATING_COMMANDS.has(declared.toLowerCase())) {
        fail(file, source, node, `declares a member named after the mutating command "${declared}"`)
      }
    }

    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const typeOnly = ts.isImportDeclaration(node)
        ? node.importClause?.isTypeOnly
        : node.isTypeOnly
      if (literalText(node.moduleSpecifier) === 'ioredis' && !typeOnly) {
        fail(file, source, node, 'imports ioredis as a value')
      }
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference) &&
      literalText(node.moduleReference.expression) === 'ioredis'
    ) {
      fail(file, source, node, 'imports ioredis as a value (import = require)')
    }

    ts.forEachChild(node, visit)
  }
  visit(source)
}

const files = sourceFiles(ADMIN_DIR)
for (const file of files) {
  check(file)
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

console.log(`admin read-only gate passed (${files.length} files checked)`)
