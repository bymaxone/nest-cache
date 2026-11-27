/**
 * Error cause hygiene: no error that leaves the library repeats a command argument.
 *
 * Layer: observability, through the server entry.
 *
 * The server is a loopback stand-in that speaks just enough RESP to refuse a command with an error
 * reply, which is what makes the driver attach the command to the error.
 */
import { createServer, type Server, type Socket } from 'node:net'
import { inspect } from 'node:util'

import { Test, type TestingModule } from '@nestjs/testing'

import { BymaxCacheModule, CacheService, PubSubService } from '@bymax-one/nest-cache'

import { CacheObservability } from './cache-observability'

import type { BymaxCacheModuleOptions, ICacheEvents } from '@bymax-one/nest-cache'

/** A dummy value standing for anything a command is sent with. */
const MARKER = 'DUMMY-ARGUMENT-7f3a'

const OOM = "-OOM command not allowed when used memory > 'maxmemory'.\r\n"
const WRONGPASS = '-WRONGPASS invalid username-password pair or user is disabled.\r\n'

/** Answers one command by its lower-case name. */
type Reply = (command: string) => string

const servers: Server[] = []
const modules: TestingModule[] = []
const sockets: Socket[] = []

afterEach(async () => {
  await Promise.all(modules.splice(0).map((module) => module.close().catch(() => undefined)))
  sockets.splice(0).forEach((socket) => socket.destroy())
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve)))
  )
})

/** The first whole command of `input` (an array of ASCII bulk strings), or nothing yet. */
function take(input: string): { name: string; length: number } | undefined {
  const head = /^\*(\d+)\r\n/.exec(input)
  if (head === null) return undefined
  const words: string[] = []
  let at = head[0].length
  while (words.length < Number(head[1])) {
    const end = input.indexOf('\r\n', at)
    if (end === -1) return undefined
    const size = Number(input.slice(at + 1, end))
    if (input.length < end + 4 + size) return undefined
    words.push(input.slice(end + 2, end + 2 + size))
    at = end + 4 + size
  }
  return { name: (words[0] as string).toLowerCase(), length: at }
}

async function listen(reply: Reply): Promise<number> {
  const server = createServer((socket) => {
    sockets.push(socket)
    socket.on('error', () => undefined)
    let pending = ''
    socket.on('data', (chunk) => {
      pending += chunk.toString()
      for (let command = take(pending); command !== undefined; command = take(pending)) {
        pending = pending.slice(command.length)
        socket.write(reply(command.name))
      }
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as { port: number }).port
}

/** Everything a logger could print of a value, hidden and nested properties included. */
function everything(value: unknown): string {
  return `${inspect(value, { depth: Infinity, showHidden: true })}\n${JSON.stringify(value)}`
}

async function boot(
  reply: Reply,
  events: ICacheEvents,
  connection: Record<string, unknown> = {}
): Promise<TestingModule> {
  const port = await listen(reply)
  const options: BymaxCacheModuleOptions = {
    namespace: 'hygiene',
    connection: {
      host: '127.0.0.1',
      port,
      enableReadyCheck: false,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
      ...connection
    },
    scripts: [{ name: 'touch', lua: 'return 1' }],
    events
  }
  const module = await Test.createTestingModule({
    imports: [BymaxCacheModule.forRoot(options)]
  }).compile()
  modules.push(module)
  await module.init()
  return module
}

async function rejectionOf(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work()
  } catch (error) {
    return error
  }
  throw new Error('expected a rejection')
}

describe('a refused handshake', () => {
  it.each([2, 3])('keeps the arguments out of every exit under RESP%s', async (protocol) => {
    const payloads: unknown[] = []
    const lines: unknown[] = []
    const write = (line: unknown): void => void lines.push(line)
    const observability = new CacheObservability({
      logger: { log: write, warn: write, error: write, debug: write }
    })
    const events: ICacheEvents = {
      onEvent: (event, data) => {
        if (event === 'error') payloads.push(data)
        observability.events.onEvent?.(event, data)
      }
    }
    const refused: Reply = (command) =>
      command === 'auth' || command === 'hello' ? WRONGPASS : '-NOAUTH Authentication required.\r\n'

    const failure = await rejectionOf(() => boot(refused, events, { password: MARKER, protocol }))

    expect(failure).toMatchObject({ code: 'cache.connection_failed' })
    expect(payloads).not.toHaveLength(0)
    expect(lines).not.toHaveLength(0)
    expect((failure as { cause: Error }).cause.message).toBe(
      'WRONGPASS (server error text withheld)'
    )
    expect((failure as { cause: unknown }).cause).not.toHaveProperty('command')
    for (const exit of [failure, (failure as { cause: unknown }).cause, ...payloads, ...lines]) {
      expect(everything(exit)).not.toContain(MARKER)
    }
  })

  it.each([
    `-ERR unknown command 'AUTH', with args beginning with: '${MARKER}' \r\n`,
    `-ERR AUTH ${MARKER} is not supported by this proxy\r\n`
  ])('keeps only the reply code when a server answers %j', async (echo) => {
    const payloads: unknown[] = []
    const lines: unknown[] = []
    const write = (line: unknown): void => void lines.push(line)
    const observability = new CacheObservability({
      logger: { log: write, warn: write, error: write, debug: write }
    })
    const events: ICacheEvents = {
      onEvent: (event, data) => {
        if (event === 'error') payloads.push(data)
        observability.events.onEvent?.(event, data)
      }
    }

    const failure = (await rejectionOf(() =>
      boot(
        (command) => (command === 'auth' ? echo : '-NOAUTH Authentication required.\r\n'),
        events,
        { password: MARKER, protocol: 2 }
      )
    )) as { cause: unknown }

    expect(payloads).not.toHaveLength(0)
    expect(lines).not.toHaveLength(0)
    for (const exit of [failure, failure.cause, ...payloads, ...lines]) {
      expect(everything(exit)).not.toContain(MARKER)
    }
  })
})

describe('a refused command', () => {
  const refusing =
    (...names: string[]): Reply =>
    (command) =>
      names.includes(command) ? OOM : '+OK\r\n'

  it.each<[string, (module: TestingModule) => Promise<unknown>]>([
    ['set', (m) => m.get(CacheService).set('p', 'id', MARKER)],
    ['get', (m) => m.get(CacheService).get('p', MARKER)],
    ['del', (m) => m.get(CacheService).del('p', MARKER)],
    ['mset', (m) => m.get(CacheService).mset('p', [['id', MARKER]])],
    ['keys', (m) => m.get(CacheService).keys('p', MARKER)],
    [
      'scan',
      async (m) => {
        for await (const key of m.get(CacheService).scan('p', MARKER)) void key
      }
    ],
    ['evalsha', (m) => m.get(CacheService).eval('touch', ['k'], [MARKER])],
    ['publish', (m) => m.get(PubSubService).publish('c', MARKER)]
  ])('keeps the arguments out of a refused %s', async (command, act) => {
    const module = await boot(refusing(command), {})

    const failure = (await rejectionOf(() => act(module))) as { cause?: unknown }

    expect(failure.cause ?? failure).toMatchObject({ message: 'OOM (server error text withheld)' })
    expect(failure.cause ?? failure).not.toHaveProperty('command')
    expect(everything(failure)).not.toContain(MARKER)
    expect(everything(failure.cause)).not.toContain(MARKER)
  })

  // More pairs than one MSET takes, so the write runs as a transaction.
  const many = Array.from({ length: 5_001 }, (_, i): [string, string] => [`id${i}`, MARKER])

  it.each<[string, string, string]>([
    ['refused as it is queued', OOM, '-EXECABORT Transaction discarded.\r\n'],
    ['refused inside EXEC', '+QUEUED\r\n', `*2\r\n${OOM}+OK\r\n`]
  ])('keeps the arguments out of a write %s', async (_label, queued, executed) => {
    let writes = 0
    const module = await boot((command) => {
      if (command === 'exec') return executed
      if (command !== 'mset') return '+OK\r\n'
      writes += 1
      return writes === 1 ? queued : '+QUEUED\r\n'
    }, {})

    const failure = await rejectionOf(() => module.get(CacheService).mset('p', many))

    expect(writes).toBe(2)
    expect((failure as Error).message).toBe('OOM (server error text withheld)')
    expect(everything(failure)).not.toContain(MARKER)
  })

  it('keeps only the reply code of an error inside EXEC', async () => {
    const module = await boot((command) => {
      if (command === 'exec') return `*2\r\n-ERR rejected ${MARKER}\r\n+OK\r\n`
      return command === 'mset' ? '+QUEUED\r\n' : '+OK\r\n'
    }, {})

    const failure = await rejectionOf(() => module.get(CacheService).mset('p', many))

    expect((failure as Error).message).toBe('ERR (server error text withheld)')
    expect(everything(failure)).not.toContain(MARKER)
  })
})

describe('the driver reads its own errors first', () => {
  it('hands reconnectOnError the whole server text, and resends when it asks to', async () => {
    const read: string[] = []
    let writes = 0
    const module = await boot(
      (command) => {
        if (command !== 'set') return '+OK\r\n'
        writes += 1
        return writes === 2
          ? '+OK\r\n'
          : "-READONLY You can't write against a read only replica.\r\n"
      },
      {},
      {
        retryStrategy: () => 1,
        // The resend happens while the client is reconnecting.
        enableOfflineQueue: true,
        maxRetriesPerRequest: 1,
        reconnectOnError: (error: Error) => {
          read.push(error.message)
          return read.length === 1 ? 2 : false
        }
      }
    )
    const cache = module.get(CacheService)

    await cache.set('p', 'resent', 'value')
    const failure = await rejectionOf(() => cache.set('p', 'refused', 'value'))

    expect(read).toStrictEqual(
      Array(2).fill("READONLY You can't write against a read only replica.")
    )
    expect(writes).toBe(3)
    expect((failure as Error).message).toBe('READONLY (server error text withheld)')
  })
})

describe('a reply nothing was waiting for', () => {
  it('reaches the error event without the reply it quotes', async () => {
    const payloads: unknown[] = []
    // One reply for the command, and one more that answers nothing.
    const doubled: Reply = (command) =>
      command === 'get' ? `$-1\r\n$${MARKER.length}\r\n${MARKER}\r\n` : '+OK\r\n'
    const module = await boot(doubled, {
      onEvent: (event, data) => {
        if (event === 'error') payloads.push(data)
      }
    })

    await module.get(CacheService).get('p', 'id')
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(everything(payloads)).toContain('Command queue state error')
    expect(everything(payloads)).not.toContain(MARKER)
  })
})
