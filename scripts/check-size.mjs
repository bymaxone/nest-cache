#!/usr/bin/env node
// Zero-dependency bundle-size gate. Measures every published subpath's ESM
// bundle (raw + brotli-compressed) and fails when any subpath exceeds the
// hard-coded budget below.
//
// Why zero deps: this is a cache library that ships `"dependencies": {}` on
// purpose. The CI/release runner must stay free of third-party tooling so a
// compromised devDep cannot tamper with the bundle before `pnpm publish`.
// `node:zlib`'s brotli matches what npm/CDN compression produces on the wire.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { brotliCompressSync, constants } from 'node:zlib'

import { resolvePackageRoot } from './lib/package-root.mjs'

// The bundles are read from the working tree, or from the unpacked tarball when `PACKAGE_TARBALL`
// names one, so the release gate measures the file that is published.
const pkg = resolvePackageRoot()
const ROOT = pkg.root

// Budgets are in bytes (KiB units, `n * 1024`, matching the table's ÷1024
// display) measured against the brotli'd .mjs bundle — what a consumer's
// bundler/CDN ships. Brotli, not gzip, to match real wire compression.
//
// Bymax bundle-size convention (canonical: Obsidian → 03 - Resources/NestJS/
// Bymax-Conventions.md → "Bundle-size budgets"):
//   1. The .mjs ships UNMINIFIED, without comments (tsup `minify: false`, then
//      scripts/strip-bundle-comments.mjs) on purpose — readable stack traces /
//      source inside a consumer's node_modules outweigh a few KB on a backend lib
//      that never reaches a browser, and the documentation lives in the .d.ts.
//      We do NOT minify a lib just to satisfy a size budget.
//   2. The budget is CALIBRATED to the real built artifact + MODEST headroom:
//      enough to absorb normal inter-release growth, tight enough to catch
//      accidental bloat (e.g. a peer dep leaking into the bundle). It is a
//      bloat tripwire, NOT a hard design ceiling — when real growth is
//      legitimate, raise it (and say why here); when the artifact shrinks,
//      tighten it. Avoid >2x headroom: it silently lets bloat through.
//
// Calibration: each budget is the size measured on the built artifact plus a margin of about 30 B,
// not an estimate. A margin that small is intended: growth past it is raised in review, with the
// reason stated here. Measured sizes are taken after the comments are stripped. A comment that
// explains a suppression lives in the source next to the code, where it ships with the bundle.
//
// The server budget (13 466 B) covers the key escape (the token writer and decoder, the escape sets
// and the `KeyBuilder` helpers), the read-validation routing, the timer-delay checks, the
// command-failure mapping, the scan hint clamp, the shared client guard and the error catalog, the
// refusal of a client after a failed boot, the short `disconnectTimeout` every client is created
// with, and the fixed text that replaces a third party's message in `details`. It covers the
// shutdown that bounds the main client and the Pub/Sub subscriber alike: the shared `closeClient`
// helper, the subscriber's forced-disconnect event, the stored `shutdownTimeoutMs`, and the release
// of a client already down, with the flush of what is queued on it. It covers the Pub/Sub
// dispatcher (the two listeners on the subscriber, the handler registries and the fan-out) and the
// handler bounds (the gate with its queue, the window that sums up dropped messages, the entry flag
// that skips a removed subscription, and the two options with their validation). It covers the
// check of the numeric connection options in both blocks, with the reason each refusal carries, and
// the helper through which every refusal of an option value reports its type, never the value. It covers the unset rule: the helper that tells an unset option from a set one, the
// known cluster keys that fall back to their defaults, and the refusal of a `null` credential. It also covers the typed key lists of the cluster options and of the options each node
// gets, with the copy that reads them by property access. The copy also forwards every own key the lists do not name. The null option group is read as absent, and the `why` that only the two refusals with a
// distinct cause carry. It also covers the refusal of a namespace, a separator or a key escaping
// mode through the same helper, which reports the option and the type received and never the value.
// It also covers the sending of a host-sized array in parts (the chunker, the one transaction a long
// `mset` runs in and the reporting of its failures) and the refusal of an `eval` with more keys and
// arguments than a call can carry.
//
// The admin budget (5 977 B, measured 5 947) is far smaller than the server's because the admin entry does NOT
// bundle one: `@bymax-one/nest-cache` is external in the admin tsup entry, so the subpath imports
// the package rather than inlining a second copy of `CacheService` and the DI tokens. That is a
// correctness requirement, not a size trick: duplicated class objects would make
// `@Inject(CacheService)` in an admin provider name a different class than the one
// `BymaxCacheModule` registered. If this number ever jumps toward the server's, the externalisation
// has broken and DI is about to fail at a consumer's runtime. The budget covers the bounded value
// reveal: the ranged string read, the scan loop with its call cap, the parser of the scan replies
// and their constants, and the reveal's per-type readers with the rule that a finished read of nothing
// is a deleted key and the cut that never splits a surrogate pair. It also covers the helper that refuses a scope or a
// threshold by option name and received type, which restates the server's describing rule because the
// admin entry reaches the server only through its public surface.
// It also covers the guard that withholds the status screen's endpoint when the connection block cannot be read.
// The server budget (18 070 B, measured 18 032) covers the operation tracking: the 31 command names
// reported to `events.onOperation` with a hit/miss/ok/error outcome, the Pub/Sub backlog callback,
// and the one caller that absorbs a throwing or rejecting host hook at every observability site, logs the
// first failure of each hook once, and hands each hook a frozen copy of the event data, and keeps that log line's one allowance when Nest's
// logging is off. It also covers the option-read guard, which passes only the library's own refusals through,
// and the single read of every option block and of the tls, sentinels, nodes, natMap and scripts values under it: the key records, the complete tls option record and the copies built from them, and the validation of the tls kind and profile and of the script definitions, `register` included, the copy of the tls key material, the check of the entries of the lists the driver walks, the copy of every view of bytes in the key material, and of the object entries of `key` and `pfx`.
// The observability entry (2 400 B, measured 2 373) is the optional subpath that publishes them, and
// the fan-out of `combineCacheEvents` that raises its first failure to the module; the
// main entry imports neither `@bymax-one/nest-core` nor `prom-client`.
const BUDGETS = [
  { name: 'server (NestJS module)', path: 'dist/server/index.mjs', brotli: 18_070 },
  { name: 'admin (administration surface)', path: 'dist/admin/index.mjs', brotli: 5_977 },
  { name: 'metrics (connection metrics)', path: 'dist/metrics/index.mjs', brotli: 1.5 * 1024 },
  {
    name: 'observability (operations, health, logs)',
    path: 'dist/observability/index.mjs',
    brotli: 2_400
  },
  { name: 'shared (types + constants)', path: 'dist/shared/index.mjs', brotli: 0.5 * 1024 }
]

const fmt = (n) => `${(n / 1024).toFixed(2)} kB`

const BROTLI_OPTS = {
  params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY }
}

let failed = 0
const rows = []

for (const { name, path, brotli: limit } of BUDGETS) {
  const abs = resolve(ROOT, path)
  // Read directly and handle the error from the read itself — no stat-then-read
  // check, which would be a TOCTOU file-system race (CodeQL js/file-system-race).
  let raw
  try {
    raw = readFileSync(abs)
  } catch {
    console.error(`Missing build artifact: ${path} — run \`pnpm build\` first.`)
    pkg.cleanup()
    process.exit(2)
  }
  const compressed = brotliCompressSync(raw, BROTLI_OPTS).length
  const ok = compressed <= limit
  if (!ok) failed += 1
  rows.push({
    name,
    raw: raw.length,
    brotli: compressed,
    limit,
    delta: compressed - limit,
    ok
  })
}

const pad = (s, n) => String(s).padEnd(n)
const padL = (s, n) => String(s).padStart(n)

console.log('')
console.log(
  `  ${pad('Subpath', 38)}${padL('Raw', 12)}${padL('Brotli', 12)}${padL('Budget', 12)}  Status`
)
console.log(`  ${'-'.repeat(38)}${'-'.repeat(12)}${'-'.repeat(12)}${'-'.repeat(12)}  ------`)
for (const r of rows) {
  const status = r.ok ? 'PASS' : `FAIL +${fmt(r.delta)}`
  console.log(
    `  ${pad(r.name, 38)}${padL(fmt(r.raw), 12)}${padL(fmt(r.brotli), 12)}${padL(fmt(r.limit), 12)}  ${status}`
  )
}
console.log('')

pkg.cleanup()

if (failed > 0) {
  console.error(`${failed} subpath(s) exceeded the brotli budget.`)
  process.exit(1)
}
