/**
 * The throwaway certificate helper leaves nothing behind and reports the failure that happened.
 *
 * Layer: server. It runs `openssl` in a directory of its own. The failure cases replace the child process
 * so no key is made, and check that the directory it was given is gone.
 */
import * as childProcess from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'

import { selfSignedCertificate } from './self-signed-certificate'

jest.mock('node:child_process', () => {
  const actual = jest.requireActual<typeof import('node:child_process')>('node:child_process')
  return { ...actual, execFileSync: jest.fn(actual.execFileSync) }
})

const execFileSync = childProcess.execFileSync as jest.MockedFunction<
  typeof childProcess.execFileSync
>

/** The directory the last call told openssl to write into, read from its `-keyout` argument. */
function lastWorkingDirectory(): string {
  const call = execFileSync.mock.calls.at(-1)
  const args = call?.[1] as readonly string[]
  return dirname(args[args.indexOf('-keyout') + 1] as string)
}

describe('selfSignedCertificate', () => {
  afterEach(() => {
    execFileSync.mockClear()
  })

  // Scenario: openssl runs for real.
  // Rule: a PEM certificate and a PEM key come back, openssl is told to print nothing, and the directory
  // it wrote into is gone.
  it('returns a certificate and a key, silences openssl and removes its directory', () => {
    const made = selfSignedCertificate()

    expect(made.certificate).toContain('BEGIN CERTIFICATE')
    expect(made.key).toContain('PRIVATE KEY')
    expect(execFileSync).toHaveBeenCalledWith('openssl', expect.any(Array), { stdio: 'ignore' })
    expect(existsSync(lastWorkingDirectory())).toBe(false)
  })

  // Scenario: openssl fails before it writes either file.
  // Rule: the caller sees openssl's own error, not an ENOENT from removing a file that was never made,
  // and the directory is still removed.
  it('surfaces the failure of openssl and removes its directory', () => {
    const failure = new Error('openssl failed')
    execFileSync.mockImplementationOnce(() => {
      throw failure
    })

    expect(() => selfSignedCertificate()).toThrow(failure)
    expect(existsSync(lastWorkingDirectory())).toBe(false)
  })
})
