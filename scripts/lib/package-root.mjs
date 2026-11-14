/**
 * Where a release gate reads the package from.
 *
 * With no `PACKAGE_TARBALL` the gate reads the working tree, as it does on a developer machine. With
 * it, the gate reads the unpacked tarball, so what it checks is the file that will be published and
 * not the `dist/` it was packed from. The release workflow hands each gate a COPY of the tarball.
 */
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Resolves the directory a gate reads the package from.
 *
 * @param {{ linkDependencies?: boolean }} [options] - `linkDependencies` symlinks the repository's
 *   `node_modules` next to the unpacked package, so the entries can import their peer dependencies.
 * @returns {{ root: string, tarball: string | undefined, cleanup: () => void }} The package root,
 *   the tarball path when one was given, and a function that removes the unpacked copy.
 */
export function resolvePackageRoot(options = {}) {
  const tarball = process.env.PACKAGE_TARBALL
  if (tarball === undefined || tarball === '') {
    return { root: REPO_ROOT, tarball: undefined, cleanup: () => {} }
  }
  const dir = mkdtempSync(join(tmpdir(), 'package-root-'))
  const cleanup = () => rmSync(dir, { recursive: true, force: true })
  const extracted = spawnSync('tar', ['-xzf', tarball, '-C', dir], { encoding: 'utf8' })
  if (extracted.status !== 0) {
    cleanup()
    throw new Error('Could not unpack the package tarball.')
  }
  const root = join(dir, 'package')
  if (options.linkDependencies === true) {
    symlinkSync(join(REPO_ROOT, 'node_modules'), join(root, 'node_modules'), 'dir')
  }
  return { root, tarball, cleanup }
}
