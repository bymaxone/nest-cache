/**
 * Process-level test of {@link closeClient}: what is queued on a down client must not keep the
 * process alive after the application closes.
 *
 * Layer: server. A child process closes a real ioredis client that is in its retry delay with a
 * command queued on it, then does nothing more; the test measures how long the child takes to exit
 * on its own. No Redis server is needed: the client points at a port nothing listens on.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const COMMAND_TIMEOUT_MS = 4_000

/** The child, its client created with the short `disconnectTimeout` every client of the library has: queue a command on a reconnecting client, close it, and leave the rest to the event loop. */
const CHILD = `
const { Redis } = require('ioredis')
const { closeClient } = require('./close-client.cjs')
const client = new Redis({
  host: '127.0.0.1',
  port: 1,
  retryStrategy: () => 600000,
  commandTimeout: ${COMMAND_TIMEOUT_MS},
  disconnectTimeout: 1,
  enableOfflineQueue: true
})
client.on('error', () => undefined)
client.once('reconnecting', async () => {
  client.get('k').catch(() => undefined)
  await closeClient(client, 1000, () => undefined)
  console.log('closed')
})
`

/** Runs the child and resolves with how long it ran after reporting `closed`. */
function msToExitAfterClose(): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), 'close-client-exit-'))
  const script = join(dir, 'child.js')
  writeFileSync(script, CHILD)
  // The helper is bundled to CommonJS so the child needs no TypeScript loader; ioredis stays external.
  const built = spawnSync(
    'pnpm',
    [
      'exec',
      'tsup',
      join(__dirname, 'close-client.ts'),
      '--config',
      'false',
      '--format',
      'cjs'
    ].concat(['--out-dir', dir, '--external', 'ioredis', '--silent']),
    { cwd: process.cwd(), encoding: 'utf8' }
  )
  if (built.status !== 0) {
    throw new Error(`bundling the helper failed: ${built.stderr}`)
  }
  return new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, NODE_PATH: join(process.cwd(), 'node_modules') },
      stdio: ['ignore', 'pipe', 'inherit']
    })
    let closedAt = 0
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('closed')) {
        closedAt = Date.now()
      }
    })
    child.on('error', reject)
    child.on('exit', () => {
      rmSync(dir, { recursive: true, force: true })
      resolve(closedAt === 0 ? Number.NaN : Date.now() - closedAt)
    })
  })
}

describe('closeClient and the process lifetime', () => {
  // Scenario: Redis is down, a command is queued on the reconnecting client, and the client is closed.
  // Rule: the process then exits on its own within a small margin, far short of the command timeout
  // the queued command's timer would otherwise hold it for.
  it('lets a process exit promptly after closing a down client with a command queued', async () => {
    const ms = await msToExitAfterClose()

    expect(ms).toBeLessThan(COMMAND_TIMEOUT_MS / 4)
  }, 30_000)
})
