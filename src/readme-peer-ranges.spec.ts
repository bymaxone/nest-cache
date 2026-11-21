/**
 * Documentation-contract test for the peer ranges the README states.
 *
 * Layer: repository root (reads `README.md` and `package.json`). A range written in the README next to
 * a peer's name is the one `package.json` declares, and the peers the README calls optional are marked
 * optional there, so the page a consumer reads cannot drift from what npm enforces.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const README = readFileSync(join(ROOT, 'README.md'), 'utf8')
const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  peerDependencies: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

/** `name` `^range` pairs the README writes, with line breaks read as spaces. */
function statedRanges(readme: string): Array<[string, string]> {
  const flat = readme.replace(/\s+/g, ' ')
  return [...flat.matchAll(/`((?:@[\w.-]+\/)?[\w.-]+)` `(\^[\d.]+)`/g)].map((match) => [
    match[1] ?? '',
    match[2] ?? ''
  ])
}

/** A caret range with its omitted minor and patch written out, so `^15` and `^15.0.0` compare equal. */
function full(range: string): string {
  const [major = '0', minor = '0', patch = '0'] = range.slice(1).split('.')
  return `^${major}.${minor}.${patch}`
}

/** The stated ranges that name a peer, as `name range`, and those that differ from `package.json`. */
function drifted(readme: string, peers: Record<string, string>): string[] {
  return statedRanges(readme)
    .filter(([name]) => Object.hasOwn(peers, name))
    .filter(([name, range]) => full(peers[name] ?? '') !== full(range))
    .map(([name, range]) => `${name} ${range} (package.json: ${peers[name]})`)
}

describe('README peer ranges', () => {
  it('states the ranges of the optional peers it names, and they are the declared ones', () => {
    const named = statedRanges(README)
      .map(([name]) => name)
      .filter((name) => Object.hasOwn(PACKAGE.peerDependencies, name))

    expect(new Set(named)).toEqual(new Set(['@bymax-one/nest-core', 'prom-client']))
    expect(drifted(README, PACKAGE.peerDependencies)).toEqual([])
  })

  it('calls optional only the peers package.json marks optional', () => {
    expect(README).toContain('both optional peers')
    expect(PACKAGE.peerDependenciesMeta?.['@bymax-one/nest-core']?.optional).toBe(true)
    expect(PACKAGE.peerDependenciesMeta?.['prom-client']?.optional).toBe(true)
  })

  // Scenario: a range changes in package.json, or in the README, and not in the other.
  // Rule: the comparison reports it, so the test above can fail.
  it('reports a README range that differs from the declared one', () => {
    const stale = README.replace('`prom-client` `^15`', '`prom-client` `^14`')

    expect(drifted(stale, PACKAGE.peerDependencies)).toEqual([
      `prom-client ^14 (package.json: ${PACKAGE.peerDependencies['prom-client']})`
    ])
  })

  it('ignores a pair whose name is not a peer', () => {
    expect(drifted('`left-pad` `^1.0.0`', PACKAGE.peerDependencies)).toEqual([])
  })
})
