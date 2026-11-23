/**
 * A REAL ioredis client, built by the manager with an own `undefined` key for every driver option name,
 * connecting to a real socket and to a real TLS server.
 *
 * Layer: server. An own `undefined` is what ioredis reads as an absent option, but it overwrites a value
 * the driver would have set itself after merging, and Node validates some TLS options, so a name that
 * should not be in the list would break a connection that the construction-only specs never open. The
 * server answers the few commands the client sends while it connects and a PING; the driver is real.
 */
import { createServer as netServer } from 'node:net'
import type { Server, Socket } from 'node:net'
import { createServer as tlsServer } from 'node:tls'

import { resolveOptions } from '../config/default-options'
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'
import { selfSignedCertificate } from '../../test-helpers/self-signed-certificate'
import { ConnectionManager } from './connection.manager'

/** The commands of one RESP request, from the bytes received so far; the rest stays buffered. */
function takeCommands(state: { buffer: Buffer }): string[][] {
  const commands: string[][] = []
  for (;;) {
    const text = state.buffer.toString('latin1')
    if (!text.startsWith('*')) {
      return commands
    }
    const head = text.indexOf('\r\n')
    const count = Number(text.slice(1, head))
    let at = head + 2
    const parts: string[] = []
    for (let index = 0; index < count; index += 1) {
      const lengthEnd = text.indexOf('\r\n', at)
      if (lengthEnd === -1) {
        return commands
      }
      const length = Number(text.slice(at + 1, lengthEnd))
      const start = lengthEnd + 2
      if (text.length < start + length + 2) {
        return commands
      }
      parts.push(text.slice(start, start + length))
      at = start + length + 2
    }
    commands.push(parts)
    state.buffer = state.buffer.subarray(at)
  }
}

/** Answers what a connecting client asks, and PING. */
function answer(socket: Socket): void {
  const state = { buffer: Buffer.alloc(0) }
  socket.on('error', () => undefined)
  socket.on('data', (chunk: Buffer) => {
    state.buffer = Buffer.concat([state.buffer, chunk])
    for (const [name] of takeCommands(state)) {
      const command = (name ?? '').toUpperCase()
      if (command === 'INFO') {
        const info = '# Server\r\nredis_version:7.2.0\r\nloading:0\r\n'
        socket.write(`$${info.length}\r\n${info}\r\n`)
      } else if (command === 'PING') {
        socket.write('+PONG\r\n')
      } else {
        socket.write('+OK\r\n')
      }
    }
  })
}

const closers: Array<() => void> = []
let certificate = ''
let key = ''

beforeAll(() => {
  ;({ certificate, key } = selfSignedCertificate())
})

afterEach(() => {
  for (const close of closers.splice(0)) {
    close()
  }
})

/** Starts a server and returns its port; it is closed after the test. */
async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  closers.push(() => server.close())
  return (server.address() as { port: number }).port
}

/**
 * Builds the client for `connection` through the manager, waits until it is ready (the library refuses a
 * command while the client is not, `enableOfflineQueue` being off) and answers a PING; rejects with the
 * first error of the connection.
 */
async function pingThrough(connection: Record<string, unknown>): Promise<string> {
  const manager = new ConnectionManager(
    resolveOptions({ connection } as unknown as BymaxCacheModuleOptions)
  )
  const client = manager.getClient() as unknown as {
    ping: () => Promise<string>
    disconnect: () => void
    once: (event: string, listener: (error?: Error) => void) => void
  }
  closers.push(() => client.disconnect())
  await new Promise<void>((resolve, reject) => {
    client.once('ready', () => resolve())
    client.once('error', (error) => reject(error))
  })
  return client.ping()
}

describe('a real ioredis client built with an own key for every driver option name', () => {
  // Scenario: the client connects to a plain socket and to a TLS server, through the manager.
  // Rule: it becomes ready and answers a PING: an own `undefined` broke neither the merge nor the TLS
  // options Node validates.
  it('has a certificate and a key to serve', () => {
    expect(certificate).toContain('BEGIN CERTIFICATE')
    expect(key).toContain('BEGIN PRIVATE KEY')
  })

  it('connects to a plain socket and answers a PING', async () => {
    const port = await listen(netServer(answer))

    expect(await pingThrough({ host: '127.0.0.1', port })).toBe('PONG')
  })

  it('connects over TLS and answers a PING', async () => {
    const port = await listen(tlsServer({ key, cert: certificate }, answer))

    expect(
      await pingThrough({
        host: '127.0.0.1',
        port,
        tls: { ca: certificate, servername: 'localhost' }
      })
    ).toBe('PONG')
  })

  it('does not trust a TLS server whose certificate it was not given', async () => {
    const port = await listen(tlsServer({ key, cert: certificate }, answer))

    await expect(
      pingThrough({
        host: '127.0.0.1',
        port,
        tls: { servername: 'localhost' },
        maxRetriesPerRequest: 0
      })
    ).rejects.toBeDefined()
  })
})
