/**
 * Unit tests for {@link callHook}.
 *
 * Layer: server. A host hook typed `=> void` may be async; what it throws, rejects with or hands
 * back as a thenable must never reach the caller or the process.
 */
import { callHook, fireEvent } from './call-hook'

describe('callHook', () => {
  const unhandled: unknown[] = []
  const record = (reason: unknown): void => {
    unhandled.push(reason)
  }

  beforeEach(() => {
    unhandled.length = 0
    process.on('unhandledRejection', record)
  })

  afterEach(() => {
    process.off('unhandledRejection', record)
  })

  /** Lets a rejected promise that nobody handles reach the process-level event. */
  const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

  // A hook typed `=> void` may still be an async function; its rejection must not escape.
  it('swallows a rejected promise returned by the hook', async () => {
    callHook('onEvent', () => Promise.reject(new Error('sink down')))
    await settle()

    expect(unhandled).toEqual([])
  })

  it('swallows a synchronous throw', () => {
    expect(() =>
      callHook('onEvent', () => {
        throw new Error('sink down')
      })
    ).not.toThrow()
  })

  // A thenable that is not a promise is held to the same rule: its handlers must not escape either.
  it('swallows a thenable whose then throws', () => {
    const thenable = {
      then: (): never => {
        throw new Error('bad thenable')
      }
    }

    expect(() => callHook('onEvent', () => thenable)).not.toThrow()
  })

  it('swallows a rejection delivered to a thenable', async () => {
    const calls: string[] = []
    const thenable = {
      then: (_ok: unknown, fail: (reason: unknown) => void): void => {
        calls.push('then')
        fail(new Error('rejected'))
      }
    }

    callHook('onEvent', () => thenable)
    await settle()

    expect(calls).toEqual(['then'])
    expect(unhandled).toEqual([])
  })

  it('does not touch a plain return value', () => {
    const run = jest.fn(() => 42)

    callHook('onEvent', run)

    expect(run).toHaveBeenCalledTimes(1)
  })

  // The first failure of each hook is logged once, by name only; a later failure of the same hook is
  // absorbed silently, and another hook gets its own line.
  describe('the failure log', () => {
    const logged = async (
      run: (callHookFresh: typeof callHook) => Promise<void> | void
    ): Promise<unknown[]> => {
      const lines: unknown[] = []
      await jest.isolateModulesAsync(async () => {
        const { Logger: Fresh } = await import('@nestjs/common')
        const spy = jest.spyOn(Fresh.prototype, 'warn').mockImplementation((line: unknown) => {
          lines.push(line)
        })
        const fresh = await import('./call-hook')
        await run(fresh.callHook)
        await settle()
        spy.mockRestore()
      })
      return lines
    }

    it('logs the hook name once, with nothing the hook threw', async () => {
      const lines = await logged((fresh) => {
        const secret = new Error('password=hunter2')
        fresh('onOperation', () => {
          throw secret
        })
        fresh('onOperation', () => Promise.reject(secret))
      })

      expect(lines).toEqual([
        { event: 'CACHE_HOOK_FAILED', message: 'A host hook failed', hook: 'onOperation' }
      ])
    })

    it('logs each hook once', async () => {
      const lines = await logged((fresh) => {
        const fail = (): never => {
          throw new Error('x')
        }
        fresh('onEvent', fail)
        fresh('onQueue', fail)
        fresh('onEvent', fail)
      })

      expect(lines.map((line) => (line as { hook: string }).hook)).toEqual(['onEvent', 'onQueue'])
    })

    it('does not log a hook that succeeds', async () => {
      const lines = await logged((fresh) => {
        fresh('onEvent', () => 1)
      })

      expect(lines).toEqual([])
    })

    it('absorbs a logger that fails in turn', async () => {
      await jest.isolateModulesAsync(async () => {
        const { Logger: Fresh } = await import('@nestjs/common')
        const spy = jest.spyOn(Fresh.prototype, 'warn').mockImplementation(() => {
          throw new Error('logger down')
        })
        const fresh = await import('./call-hook')

        expect(() =>
          fresh.callHook('onEvent', () => {
            throw new Error('x')
          })
        ).not.toThrow()
        spy.mockRestore()
      })
    })
  })

  describe('fireEvent', () => {
    it('hands the hook a frozen copy and leaves the original alone', () => {
      const seen: Array<Record<string, unknown>> = []
      const original = { role: 'main' }

      fireEvent({ onEvent: (_event, data) => void seen.push(data) }, 'ready', original)

      expect(seen[0]).toEqual({ role: 'main' })
      expect(seen[0]).not.toBe(original)
      expect(Object.isFrozen(seen[0])).toBe(true)
      expect(Object.isFrozen(original)).toBe(false)
    })

    it('does nothing without a hook', () => {
      expect(() => fireEvent(undefined, 'ready', {})).not.toThrow()
      expect(() => fireEvent({}, 'ready', {})).not.toThrow()
    })
  })
})
