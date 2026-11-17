#!/usr/bin/env node
/**
 * @fileoverview Type-aware read-only gate for the `./admin` subpath.
 * @layer scripts
 *
 * `check-admin-readonly.mjs` reads syntax: it refuses the routes it names, so each route nobody
 * thought of is a hole. This gate reads types, which turns the question around. The subpath may
 * reach Redis only through the `IRedisReader` contract, whose `call` takes a literal union of read
 * commands, so what it can send is what the type says and nothing else.
 *
 * It builds a TypeScript program over the project's `tsconfig.json` and, for every non-spec file
 * under `src/admin`, fails when:
 *
 *   1. The program reports a type error in it. A command name that is not in the union, or that is
 *      a `string` a caller computed, is such an error, so a write cannot be passed to `call`.
 *   2. An expression has the type of an ioredis client (`Redis`, `Cluster`, `Pipeline`,
 *      `ChainableCommander`, or a type derived from one), however it was named, aliased or cast
 *      to. The subpath holds a reader, never the client the reader came from.
 *   3. A type assertion takes a value out of the reader contract: `reader as Loose`, or
 *      `reader as unknown as Loose`. A value of `IRedisReader`, `IRedisPipeline` or
 *      `IRedisReaderSource` keeps its type for as long as it is used, so the contract is what the
 *      code can do with it.
 *   4. An expression of type `any` is used as the receiver of a member access, an element access or
 *      a call, or the code spells `any`: a value the checker cannot see into can be anything,
 *      including a client.
 *   5. The union `AdminReadCommand`, declared in `interfaces/redis-reader.interface.ts`, is missing
 *      or names a command the installed ioredis flags as a write. The union is the allowlist, so it
 *      is held to the same table the syntax gate reads.
 *
 * What it does not do: judge code outside `src/admin`, or a caller in plain JavaScript that ignores
 * the types. The end-to-end suite runs the whole admin API as a Redis user that may not write,
 * which is the proof that does not depend on a checker.
 *
 * Run as `pnpm check:admin-types`, optionally with a project directory to read instead of this one
 * (the tests do); wired into `prepublishOnly` and the CI verify job.
 */

import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT = process.argv[2] ? resolve(process.argv[2]) : ROOT

/** Declared names of the ioredis types that are, or send through, a client. */
const CLIENT_TYPES = new Set(['Redis', 'Cluster', 'Pipeline', 'ChainableCommander'])

const READER_FILE = join('src', 'admin', 'interfaces', 'redis-reader.interface.ts')
const ALLOWLIST_TYPE = 'AdminReadCommand'

const ioredisCommands = createRequire(createRequire(import.meta.url).resolve('ioredis'))(
  '@ioredis/commands'
)

/**
 * @param file - An absolute path.
 * @returns Whether it is a production source file of the subpath.
 */
function isAdminSource(file) {
  const path = file.split(sep).join('/')
  return path.includes('/src/admin/') && !path.endsWith('.spec.ts') && !path.includes('/__tests__/')
}

/**
 * @param type - A checker type.
 * @param checker - The program's checker.
 * @param depth - Recursion guard.
 * @returns Whether the type is an ioredis client, in a union or intersection, or derived from one.
 */
function isClient(type, checker, depth = 0) {
  if (depth > 4) {
    return false
  }
  if (type.isUnionOrIntersection()) {
    return type.types.some((member) => isClient(member, checker, depth + 1))
  }
  const named = [type.symbol, type.aliasSymbol]
    .filter(Boolean)
    .some(
      (symbol) =>
        CLIENT_TYPES.has(symbol.name) &&
        (symbol.declarations ?? []).some((declaration) =>
          /[\\/]ioredis[\\/]/.test(declaration.getSourceFile().fileName)
        )
    )
  if (named) {
    return true
  }
  const bases = type.isClassOrInterface() ? checker.getBaseTypes(type) : []
  return bases.some((base) => isClient(base, checker, depth + 1))
}

/** The reader contracts whose values must not be re-typed. */
const READER_TYPES = new Set(['IRedisReader', 'IRedisPipeline', 'IRedisReaderSource'])

/**
 * @param type - A checker type.
 * @returns Whether it is one of the reader contracts, alone or inside a union.
 */
function isReader(type) {
  if (type.isUnion()) {
    return type.types.some(isReader)
  }
  return [type.symbol, type.aliasSymbol].some((symbol) => symbol && READER_TYPES.has(symbol.name))
}

/**
 * @param node - A syntax node.
 * @returns Whether the checker should read it as an expression of the program: not a type, not
 *   an import or export.
 */
function isReadable(node) {
  return !(
    (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node)) ||
    ts.isImportDeclaration(node) ||
    ts.isExportDeclaration(node)
  )
}

/**
 * @param node - A syntax node.
 * @returns Whether an `any`-typed `node` would be used as something that is reached into.
 */
function isReachedInto(node) {
  const parent = node.parent
  return (
    (ts.isPropertyAccessExpression(parent) && parent.expression === node) ||
    (ts.isElementAccessExpression(parent) && parent.expression === node) ||
    ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node)
  )
}

/**
 * @param node - An assertion expression.
 * @returns Whether it is `as const`, which does not change what a value is.
 */
function isConst(node) {
  return ts.isTypeReferenceNode(node.type) && node.type.typeName.getText() === 'const'
}

/**
 * @param sourceFile - A source file of the subpath.
 * @param checker - The program's checker.
 * @returns The problems in it, as `file:line: reason`.
 */
function checkFile(sourceFile, checker) {
  const problems = []
  const where = (node) => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart())
    return `${relative(PROJECT, sourceFile.fileName)}:${line + 1}`
  }
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      problems.push(`${where(node)}: spells "any"`)
    }
    if (!isReadable(node)) {
      return
    }
    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && !isConst(node)) {
      if (isReader(checker.getTypeAtLocation(node.expression))) {
        problems.push(`${where(node)}: a value of the reader contract is cast to another type`)
      }
    }
    if (ts.isIdentifier(node) || ts.isExpression(node)) {
      const type = checker.getTypeAtLocation(node)
      if (isClient(type, checker)) {
        problems.push(`${where(node)}: "${node.getText().slice(0, 40)}" is an ioredis client`)
      } else if (type.flags & ts.TypeFlags.Any && isReachedInto(node)) {
        problems.push(
          `${where(node)}: "${node.getText().slice(0, 40)}" is of type any and is reached into`
        )
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return problems
}

/**
 * @param program - The program.
 * @param checker - Its checker.
 * @returns The problems with the `AdminReadCommand` union.
 */
function checkAllowlist(program, checker) {
  const file = program.getSourceFile(join(PROJECT, READER_FILE))
  const alias = file?.statements.find(
    (statement) => ts.isTypeAliasDeclaration(statement) && statement.name.text === ALLOWLIST_TYPE
  )
  if (!alias) {
    return [`${READER_FILE}: the type ${ALLOWLIST_TYPE} is missing`]
  }
  const type = checker.getTypeAtLocation(alias.name)
  const members = type.isUnion() ? type.types : [type]
  const problems = []
  for (const member of members) {
    if (!member.isStringLiteral()) {
      problems.push(`${READER_FILE}: ${ALLOWLIST_TYPE} has a member that is not a string literal`)
    } else if (ioredisCommands.hasFlag(member.value.toLowerCase(), 'write')) {
      problems.push(`${READER_FILE}: ${ALLOWLIST_TYPE} names the write command "${member.value}"`)
    }
  }
  return problems
}

const config = ts.getParsedCommandLineOfConfigFile(
  join(PROJECT, 'tsconfig.json'),
  {},
  {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    }
  }
)
const program = ts.createProgram(config.fileNames, config.options)
const checker = program.getTypeChecker()
const files = program.getSourceFiles().filter((file) => isAdminSource(file.fileName))

const problems = [...checkAllowlist(program, checker)]
for (const file of files) {
  for (const diagnostic of program.getSemanticDiagnostics(file)) {
    const { line } = file.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
    problems.push(
      `${relative(PROJECT, file.fileName)}:${line + 1}: type error: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`
    )
  }
  problems.push(...checkFile(file, checker))
}

if (problems.length > 0) {
  console.error('admin type gate FAILED:\n')
  for (const problem of problems) {
    console.error(`  ✗ ${problem}`)
  }
  console.error(
    '\nThe ./admin subpath reaches Redis only through IRedisReader, whose `call` takes the\n' +
      'AdminReadCommand union. A command outside it is a design decision, not a list edit.'
  )
  process.exit(1)
}

console.log(`admin type gate passed (${files.length} files checked)`)
