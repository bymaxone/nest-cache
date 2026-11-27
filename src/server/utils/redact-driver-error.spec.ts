/**
 * Unit tests of the driver error rewrite.
 *
 * Layer: server.
 */
import { redactDriverError } from './redact-driver-error'

/** An error as the driver builds one for a server reply: its name and the command it answers. */
function replyError(message: string): Error {
  return Object.assign(new Error(message), {
    name: 'ReplyError',
    command: { name: 'set', args: ['key', 'secret'] }
  })
}

describe('redactDriverError', () => {
  it('keeps the reply code and drops the rest of a server error, on the same object', () => {
    const error = replyError("OOM command not allowed, 'secret'")
    void error.stack

    const result = redactDriverError(error)

    expect(result).toBe(error)
    expect(error.message).toBe('OOM (server error text withheld)')
    expect(error).not.toHaveProperty('command')
    expect(error.stack).not.toContain('secret')
  })

  it.each([
    ["ERR unknown command 'AUTH', with args beginning with: 'secret' ", 'ERR'],
    ['WRONGPASS invalid password secret', 'WRONGPASS'],
    ['NOAUTH', 'NOAUTH'],
    ['secret is not allowed', 'ERR'],
    ['Secret is not allowed', 'ERR'],
    ['SECRET1 is not allowed', 'ERR'],
    ['x SECRET', 'ERR'],
    [`${'S'.repeat(33)} too long`, 'ERR']
  ])('reads the code of %j as %s', (message, code) => {
    const error = replyError(message)

    redactDriverError(error)

    expect(error.message).toBe(`${code} (server error text withheld)`)
  })

  it('rewrites a server error that has no stack', () => {
    const error = replyError('ERR secret')
    Reflect.deleteProperty(error, 'stack')

    redactDriverError(error)

    expect(error.message).toBe('ERR (server error text withheld)')
    expect(error.stack).toBeUndefined()
  })

  it.each([
    'All sentinels are unreachable. Retrying from scratch after 10ms. Last error: ERR secret',
    'Too many Cluster redirections. Last error: ReplyError: ERR\nsecret',
    'Command queue state error. Please report it. Last reply: secret'
  ])('cuts the quoted tail from %j and from its stack', (message) => {
    const error = new Error(message)

    redactDriverError(error)

    expect(error.message).toBe(message.slice(0, message.indexOf(' Last ')))
    expect(error.stack).toContain(error.message)
    expect(error.stack).not.toContain('secret')
  })

  it('keeps the message of an error the driver wrote, and removes its command', () => {
    const error = Object.assign(new Error('Command aborted due to connection close'), {
      command: { name: 'set', args: ['secret'] }
    })

    redactDriverError(error)

    expect(error.message).toBe('Command aborted due to connection close')
    expect(error).not.toHaveProperty('command')
  })

  it('writes neither message nor stack when there is nothing to withhold', () => {
    const written = jest.fn()
    const error = new Error('x')
    for (const key of ['message', 'stack']) {
      Object.defineProperty(error, key, { get: () => 'x', set: written, configurable: true })
    }

    redactDriverError(error)

    expect(written).not.toHaveBeenCalled()
  })

  it('drops the raw reply a protocol error keeps', () => {
    const error = Object.assign(new Error('Protocol error'), { buffer: 'secret', offset: 3 })

    redactDriverError(error)

    expect(error).not.toHaveProperty('buffer')
    expect(error).toHaveProperty('offset', 3)
  })

  it('reaches the errors of an aborted transaction and of a cluster failure, once each', () => {
    const queued = replyError('OOM secret')
    const node = replyError('NOAUTH secret')
    const error = Object.assign(new Error('Failed to refresh slots cache.'), {
      previousErrors: [queued, queued],
      lastNodeError: node
    })
    Object.assign(node, { lastNodeError: error })

    redactDriverError(error)

    expect(queued.message).toBe('OOM (server error text withheld)')
    expect(node.message).toBe('NOAUTH (server error text withheld)')
    for (const inner of [queued, node]) {
      expect(inner).not.toHaveProperty('command')
    }
  })

  it.each([undefined, null, 'text', 7])('returns %p as it is', (value) => {
    expect(redactDriverError(value)).toBe(value)
  })

  it('leaves a thrown value that is not an Error untouched', () => {
    const value = { command: { args: ['a'] } }

    expect(redactDriverError(value)).toBe(value)
    expect(value.command.args).toStrictEqual(['a'])
  })

  it('reads only the errors the error itself carries', () => {
    const inherited = replyError('ERR secret')
    const error = Object.create(
      Object.assign(Object.create(Error.prototype) as object, { lastNodeError: inherited })
    ) as Error

    redactDriverError(error)

    expect(inherited.message).toBe('ERR secret')
  })

  it('does not throw on an error it cannot rewrite', () => {
    const error = Object.freeze(replyError('ERR secret'))

    expect(() => redactDriverError(error)).not.toThrow()
  })
})
