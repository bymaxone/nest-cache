/**
 * The throwaway certificate helper leaves nothing behind and reports the failure that happened.
 *
 * Layer: server. It runs `openssl` in a directory of its own. The failure cases replace the child process
 * so no key is made, and read the real temporary directory to see what is left.
 */
import * as childProcess from 'node:child_process'
import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { selfSignedCertificate } from './self-signed-certificate'

jest.mock('node:child_process', () => {
  const actual = jest.requireActual<typeof import('node:child_process')>('node:child_process')
  return { ...actual, execFileSync: jest.fn(actual.execFileSync) }
})

const execFileSync = childProcess.execFileSync as jest.MockedFunction<
  typeof childProcess.execFileSync
>

/** The directories this helper makes in the temporary directory. */
function certificateDirectories(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith('bymax-cache-cert-'))
}

describe('selfSignedCertificate', () => {
  afterEach(() => {
    execFileSync.mockClear()
  })

  // Scenario: openssl runs for real.
  // Rule: a PEM certificate and a PEM key come back, openssl is told to print nothing, and the directory
  // it wrote into is gone.
  it('returns a certificate and a key, silences openssl and removes its directory', () => {
    const before = certificateDirectories()

    const made = selfSignedCertificate()

    expect(made.certificate).toContain('BEGIN CERTIFICATE')
    expect(made.key).toContain('PRIVATE KEY')
    expect(execFileSync).toHaveBeenCalledWith('openssl', expect.any(Array), { stdio: 'ignore' })
    expect(certificateDirectories()).toEqual(before)
  })

  // Scenario: openssl fails before it writes either file.
  // Rule: the caller sees openssl's own error, not an ENOENT from removing a file that was never made,
  // and the directory is still removed.
  it('surfaces the failure of openssl and removes its directory', () => {
    const before = certificateDirectories()
    const failure = new Error('openssl failed')
    execFileSync.mockImplementationOnce(() => {
      throw failure
    })

    expect(() => selfSignedCertificate()).toThrow(failure)
    expect(certificateDirectories()).toEqual(before)
  })
})
