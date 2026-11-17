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
 * text, so quoting, layout, line breaks and comments do not matter. Parentheses and the `as`,
 * `satisfies`, `!` and `<T>` wrappers around a callee are looked through.
 *
 *   1. `call` and `callBuffer`. Both send any command by name. Every direct call must pass a string
 *      literal, or a template literal without substitutions, naming a command on the allowlist. A name
 *      the gate cannot read, whether a variable, a concatenation, a spread or no argument, fails: an
 *      unreadable name cannot be shown to be on the list. This holds for any object, so
 *      `Function.prototype.call` fails too; the subpath has no use for it.
 *   2. A reference to `call` or `callBuffer` that is not a direct call fails: `call.apply`,
 *      `call.bind`, `Reflect.apply(client.call, ...)`, `const { call } = client`,
 *      `const send = client.call`. The first argument is out of sight in each of them.
 *   3. A member named after a mutating Redis command fails wherever it is used: `reader.del(k)`,
 *      `reader['del'](k)`, `(reader as Loose).del(k)`, `reader?.hset?.()`, `reader.pipeline().del()`,
 *      `const { unlink } = reader`. The names are every command the installed ioredis flags as a
 *      write, read from its own command table, plus a short list for the dangerous commands it does
 *      not flag. There is no exemption for names that ordinary collections also have (`set`, `sort`,
 *      `copy`, `append`): without types a `Map.set` cannot be told from a client, so the subpath
 *      builds a `Map` from its entries instead of calling `set`. Methods that have write subcommands
 *      or change the connection (`config`, `client`, `module`, `cluster`, `subscribe`, `auth`, ...)
 *      fail as members however they are used, called or only referenced; `memory` passes only as a
 *      direct `memory('USAGE', ...)`.
 *   4. Nothing in the subpath may DECLARE a member named after a mutating command: a method or
 *      property signature, a class member, an accessor, a member of an object literal, quoted or not,
 *      at any indent.
 *      Every Redis access in the subpath goes through those interfaces, so an interface that cannot
 *      express a write is a surface that cannot perform one.
 *   5. The client's other ways to send a command by name fail: `sendCommand`, `send_command`,
 *      `new Command(...)`, commands passed to `pipeline(...)` or `multi(...)`, and `defineCommand`;
 *      so do `eval`, `Function` and `createRequire`, which run or load what the gate cannot read.
 *   6. A member that cannot be read from the text fails, and so does reaching one by reference:
 *      `apply` and `bind` members, `__proto__`, `prototype`, `Object.getPrototypeOf` and the other
 *      descriptor and prototype reflection, `Proxy`, and a constructor called through a member
 *      (`x.constructor('code')`; reading `x.constructor.name` is fine). Also: an element access or a destructuring with a
 *      computed name, a `Reflect.get`, `Reflect.has` or `Reflect.set` with a key that is not a string
 *      literal, and any `Reflect.apply` or `Reflect.construct`. A literal `Reflect` key is judged like
 *      a member access.
 *   7. The subpath must not bring `ioredis`, anything under it, or `child_process`, `cluster`,
 *      `module`, `vm` or `worker_threads` (with or without `node:`) in as a value: no `import` that is
 *      not `import type`, no `export ... from`, no `import x = require()`, no `require` or `import()`
 *      of it, and no `require` or `import()` of a name that is not a string literal, nor any use of
 *      `require` other than a direct call. A value import would let a module construct its own client
 *      and bypass the rules above.
 *
 * The gate reads syntax, not types: it cannot know what a variable holds, which is why the rules
 * refuse what they cannot read instead of guessing. It is a tripwire for the routes it lists, not a
 * proof: what keeps a write out is that every Redis access goes through the typed reader contracts,
 * and a rule that no call resolves to a method declared by ioredis would need a type checker.
 *
 * Run as `pnpm check:admin-readonly`, optionally with a directory to read instead of `src/admin`
 * (the tests do); wired into `prepublishOnly` and the CI verify job.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
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
  'acl_setuser',
  'bgrewriteaof',
  'bgsave',
  'bitop',
  'definecommand',
  'eval',
  'evalsha',
  'failover',
  'fcall',
  'georadius',
  'georadiusbymember',
  'geosearchstore',
  'hmset',
  'migrate',
  'move',
  'publish',
  'replicaof',
  'restoreasking',
  'save',
  'shutdown',
  'slaveof',
  'spublish',
  'xack',
  'xautoclaim',
  'xclaim',
  'xgroup',
  'xreadgroup',
  'xsetid'
]
for (const name of MORE_MUTATING_COMMANDS) {
  MUTATING_COMMANDS.add(name)
}

/**
 * Every command the installed ioredis knows with the `write` flag, read from its own command table
 * (`@ioredis/commands`, a dependency of ioredis), so a write command a later Redis adds is refused
 * without anyone editing a list. The lists above stay for the dangerous commands that table does not
 * flag as writes (scripting, publishing, server control).
 */
const ioredisCommands = createRequire(createRequire(import.meta.url).resolve('ioredis'))(
  '@ioredis/commands'
)
for (const name of ioredisCommands.list) {
  if (ioredisCommands.hasFlag(name, 'write')) {
    MUTATING_COMMANDS.add(name.toLowerCase())
  }
}

/**
 * Names of client methods that change state or the server's mode without being writes in the command
 * table: a command with write subcommands (`CONFIG SET`, `CLIENT KILL`, `MODULE LOAD`, `CLUSTER RESET`,
 * `MEMORY PURGE`, `ACL SETUSER`, `FUNCTION LOAD`, `SLOWLOG RESET`, `LATENCY RESET`), or one that changes
 * what the connection is (`SUBSCRIBE`, `MONITOR`, `AUTH`, `QUIT`, `RESET`, `WATCH`, `SELECT`). A member
 * access of any of them fails, called or not, because a reference can be called later where the gate
 * cannot see it. The one use the subpath has, `memory('USAGE', key)`, is allowed when it is called
 * directly with that literal.
 */
const DENIED_MEMBERS = new Set([
  'acl',
  'auth',
  'client',
  'cluster',
  'config',
  'debug',
  'function',
  'hello',
  'hotkeys',
  'latency',
  'memory',
  'module',
  'monitor',
  'psubscribe',
  'quit',
  'reset',
  'select',
  'slowlog',
  'ssubscribe',
  'subscribe',
  'touch',
  'watch'
])

/** The subcommand literal a denied member may be called with, where the subpath needs one. */
const ALLOWED_SUBCOMMANDS = new Map([['memory', 'USAGE']])

/** Node modules that run code, load modules or start other processes, which hides what is reached. */
const DENIED_MODULES = new Set(['child_process', 'cluster', 'module', 'vm', 'worker_threads'])

/** Whether a module specifier is ioredis, anything under it, or a denied Node module. */
const isDeniedModule = (specifier) => {
  const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier
  return (
    specifier === 'ioredis' ||
    specifier.startsWith('ioredis/') ||
    DENIED_MODULES.has(bare) ||
    [...DENIED_MODULES].some((name) => bare.startsWith(`${name}/`))
  )
}

/** Reflection that reaches a method without naming it. */
const REFLECTION = new Set([
  '__proto__',
  'defineProperty',
  'getOwnPropertyDescriptor',
  'getOwnPropertyDescriptors',
  'getOwnPropertyNames',
  'getPrototypeOf',
  'prototype',
  'setPrototypeOf'
])

/** Command names the `call(...)` escape hatch may send. */
const ALLOWED_CALL_COMMANDS = new Set(['ZRANGE', 'GETRANGE', 'HSCAN', 'SSCAN'])

/** Identifiers that build code or modules from text, or a `require` from somewhere else. */
const DYNAMIC_LOADERS = new Set(['createRequire', 'eval', 'Function', 'Proxy'])

/** Methods that send a command by name, so the command must be a literal on the allowlist. */
const CALL_METHODS = new Set(['call', 'callBuffer'])

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

/** Strips parentheses and the `as`, `satisfies`, `!` and `<T>` wrappers around an expression. */
function unwrap(node) {
  let current = node
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression
  }
  return current
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
      const callee = unwrap(node.expression)
      const name = memberName(callee)
      if (ts.isCallExpression(node) && name !== null && CALL_METHODS.has(name)) {
        judged.add(callee)
        const command = literalText(node.arguments[0])
        if (command === null) {
          fail(
            file,
            source,
            node,
            `sends a command through ${name}() whose name is not a string literal`
          )
        } else if (!ALLOWED_CALL_COMMANDS.has(command)) {
          fail(
            file,
            source,
            node,
            `sends "${command}" through ${name}(); not on the read-only allowlist`
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
        name !== null &&
        ['pipeline', 'multi'].includes(name) &&
        node.arguments.length > 0
      ) {
        fail(file, source, node, `passes commands by name to ${name}()`)
      }
      if (ts.isCallExpression(node)) {
        const isRequire = ts.isIdentifier(callee) && callee.text === 'require'
        if (isRequire || callee.kind === ts.SyntaxKind.ImportKeyword) {
          const target = literalText(node.arguments[0])
          if (target === null) {
            fail(file, source, node, 'loads a module whose name is not a string literal')
          } else if (isDeniedModule(target)) {
            fail(file, source, node, `loads "${target}", which the subpath must not use`)
          }
        }
        // `Reflect` reads and calls members by name: a literal key is judged like a member access,
        // anything else, and `apply` and `construct`, fail.
        if (
          ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === 'Reflect'
        ) {
          const method = callee.name.text
          const key = literalText(node.arguments[1])
          if (method === 'apply' || method === 'construct') {
            fail(
              file,
              source,
              node,
              `uses Reflect.${method}, which calls what it is given by reference`
            )
          } else if ((method === 'get' || method === 'has' || method === 'set') && key === null) {
            fail(
              file,
              source,
              node,
              `uses Reflect.${method} with a key that is not a string literal`
            )
          } else if (
            key !== null &&
            (MUTATING_COMMANDS.has(key.toLowerCase()) ||
              CALL_METHODS.has(key) ||
              RAW_SENDERS.has(key))
          ) {
            fail(file, source, node, `reaches the member "${key}" through Reflect.${method}`)
          }
        }
      }
    }

    if (ts.isIdentifier(node) && node.text === 'require') {
      const parent = node.parent
      const direct = ts.isCallExpression(parent) && parent.expression === node
      if (
        !direct &&
        !ts.isImportEqualsDeclaration(parent.parent ?? parent) &&
        !ts.isExternalModuleReference(parent)
      ) {
        fail(
          file,
          source,
          node,
          'uses require other than as a direct call, so its module is out of view'
        )
      }
    }

    // Code and module loaders that hide what they reach from the rules above.
    if (ts.isIdentifier(node) && REFLECTION.has(node.text) && memberName(node.parent) === null) {
      fail(file, source, node, `uses "${node.text}", which reaches a method without naming it`)
    }
    if (ts.isIdentifier(node) && DYNAMIC_LOADERS.has(node.text)) {
      fail(file, source, node, `uses "${node.text}", which runs or loads what the gate cannot read`)
    }

    if (ts.isElementAccessExpression(node)) {
      const key = node.argumentExpression
      if (
        literalText(key) === null &&
        !ts.isNumericLiteral(key) &&
        !(ts.isPrefixUnaryExpression(key) && ts.isNumericLiteral(key.operand))
      ) {
        fail(
          file,
          source,
          node,
          'reads a member by a computed name, so the member cannot be checked'
        )
      }
    }

    const name = memberName(node)
    if (name !== null) {
      if (CALL_METHODS.has(name) && !judged.has(node)) {
        fail(
          file,
          source,
          node,
          `uses ${name} without calling it directly, so its command is out of view`
        )
      }
      if (RAW_SENDERS.has(name)) {
        fail(file, source, node, `uses the raw sender "${name}"`)
      }
      if (name === 'apply' || name === 'bind') {
        fail(file, source, node, `uses ${name}, which calls a member by reference`)
      }
      if (REFLECTION.has(name)) {
        fail(file, source, node, `uses "${name}", which reaches a method without naming it`)
      }
      if (DENIED_MEMBERS.has(name.toLowerCase())) {
        const parent = node.parent
        const direct = ts.isCallExpression(parent) && unwrap(parent.expression) === node
        const allowed = ALLOWED_SUBCOMMANDS.get(name.toLowerCase())
        if (!(direct && allowed !== undefined && literalText(parent.arguments[0]) === allowed)) {
          fail(
            file,
            source,
            node,
            `uses "${name}", which has write subcommands or changes the connection`
          )
        }
      }
      if (name === 'constructor') {
        const parent = node.parent
        if (
          (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
          unwrap(parent.expression) === node
        ) {
          fail(
            file,
            source,
            node,
            'calls a constructor reached through a member, which builds code or objects unseen'
          )
        }
      }
      if (MUTATING_COMMANDS.has(name.toLowerCase())) {
        fail(file, source, node, `uses a member named after the mutating command "${name}"`)
      }
    }

    if (ts.isBindingElement(node)) {
      if (
        node.propertyName &&
        ts.isComputedPropertyName(node.propertyName) &&
        literalText(node.propertyName.expression) === null
      ) {
        fail(
          file,
          source,
          node,
          'destructures a member by a computed name, so the member cannot be checked'
        )
      }
      const bound = declaredName(node.propertyName ?? node.name)
      if (
        bound !== null &&
        (CALL_METHODS.has(bound) ||
          RAW_SENDERS.has(bound) ||
          MUTATING_COMMANDS.has(bound.toLowerCase()))
      ) {
        fail(file, source, node, `destructures "${bound}" out of a client`)
      }
    }

    if (
      ts.isMethodSignature(node) ||
      ts.isPropertySignature(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isPropertyAssignment(node) ||
      ts.isShorthandPropertyAssignment(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
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
      const target = literalText(node.moduleSpecifier)
      if (target !== null && isDeniedModule(target) && !typeOnly) {
        fail(file, source, node, `imports "${target}" as a value, which the subpath must not use`)
      }
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const target = literalText(node.moduleReference.expression)
      if (target === null || isDeniedModule(target)) {
        fail(file, source, node, 'imports a module the subpath must not use (import = require)')
      }
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
