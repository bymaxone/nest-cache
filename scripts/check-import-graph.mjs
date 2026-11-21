/**
 * @fileoverview Import-graph scan of the built bundles, behind the README's claims about which
 * entries load the optional peers `@bymax-one/nest-core` and `prom-client`, and about `/admin` and
 * `/shared`.
 * @layer scripts
 *
 * Every entry is one self-contained bundle, so the packages it loads are exactly the specifiers in
 * that file, in the four spellings a bundler writes: `from '...'`, a bare `import '...'`, a dynamic
 * `import('...')`, `require('...')` and the bundler's `__require('...')` shim. The rules:
 *
 * - `.` (server), `/admin` and `/shared` never load `@bymax-one/nest-core` or `prom-client`;
 * - the main entry never loads `/admin`, by an import of its subpath or by its service inlined;
 * - `/shared` loads no package at all.
 *
 * Both the ESM and the CommonJS bundle of each entry are scanned, and a missing bundle is a problem.
 *
 * Usage: node scripts/check-import-graph.mjs [distDir]   (default: ./dist)
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The four ways a bundle names a package. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|(?:\b|_)require\s*\(\s*)(['"])([^'"\n]+)\1/g

/** The optional peers only the metrics and observability entries may load. */
const PEERS = ['@bymax-one/nest-core', 'prom-client']

/** Entries that must not load a peer. */
const PEER_FREE = ['server', 'admin', 'shared']

/** The bundle formats every entry ships. */
const FORMATS = ['mjs', 'cjs']

/**
 * Whether a specifier names a package or one of its subpaths.
 *
 * @param {string} specifier - The specifier as written.
 * @param {string} name - The package name.
 * @returns {boolean} True for the package itself or a path below it.
 */
const isPackage = (specifier, name) => specifier === name || specifier.startsWith(`${name}/`)

/**
 * Lists what the built bundles break of the import-graph rules.
 *
 * @param {string} distDir - The `dist` directory.
 * @returns {string[]} One line per problem; empty when the graph holds.
 */
export function importGraphProblems(distDir) {
  const problems = []
  const entries = ['server', 'admin', 'shared', 'metrics', 'observability']
  for (const entry of entries) {
    for (const format of FORMATS) {
      const file = join(distDir, entry, `index.${format}`)
      if (!existsSync(file)) {
        problems.push(
          `${entry}: ${entry}/index.${format} is missing, so its imports cannot be checked`
        )
        continue
      }
      const text = readFileSync(file, 'utf8')
      const specifiers = [...text.matchAll(SPECIFIER)].map((match) => match[2])
      for (const specifier of specifiers) {
        if (PEER_FREE.includes(entry) && PEERS.some((peer) => isPackage(specifier, peer))) {
          problems.push(`${entry}/index.${format} loads the optional peer ${specifier}`)
        }
        if (entry === 'server' && isPackage(specifier, '@bymax-one/nest-cache/admin')) {
          problems.push(`server/index.${format} loads the admin subpath`)
        }
        if (entry === 'shared') {
          problems.push(`shared/index.${format} loads ${specifier}, and it must load no package`)
        }
      }
      if (entry === 'server' && text.includes('CacheAdminService')) {
        problems.push(`server/index.${format} has the admin service inlined`)
      }
    }
  }
  return problems
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const problems = importGraphProblems(resolve(process.argv[2] ?? 'dist'))
  if (problems.length > 0) {
    process.stderr.write(`${problems.join('\n')}\n`)
    process.exit(1)
  }
  process.stdout.write('The built entries load the packages the README says they do.\n')
}
