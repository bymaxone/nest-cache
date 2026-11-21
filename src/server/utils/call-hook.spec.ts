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
      run: (callHookFresh: typeof callHook, written: unknown[]) => Promise<void> | void
    ): Promise<unknown[]> => {
      const lines: unknown[] = []
      await jest.isolateModulesAsync(async () => {
        const { Logger: Fresh } = await import('@nestjs/common')
        const spy = jest.spyOn(Fresh.prototype, 'warn').mockImplementation((line: unknown) => {
          lines.push(line)
        })
        const fresh = await import('./call-hook')
        await run(fresh.callHook, lines)
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

    it('logs a first failure that is a rejection, under a Logger named BymaxCache', async () => {
      const contexts: unknown[] = []
      const lines = await logged(async (fresh) => {
        const { Logger: Fresh } = await import('@nestjs/common')
        jest.spyOn(Fresh.prototype, 'warn').mockImplementation(function (this: object, line) {
          contexts.push(Reflect.get(this, 'context'), line)
        })
        fresh('onQueue', () => Promise.reject(new Error('x')))
      })

      expect(lines).toEqual([])
      expect(contexts).toEqual([
        'BymaxCache',
        { event: 'CACHE_HOOK_FAILED', message: 'A host hook failed', hook: 'onQueue' }
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

    // Scenario: the application turned Nest's logging off, or left `warn` out of its levels.
    // Rule: nothing is written, and the once-per-hook budget is kept for when logging is on again.
    type Nest = typeof import('@nestjs/common')
    describe.each([
      [
        'logging disabled',
        (nest: Nest) => nest.Logger.overrideLogger(false),
        (nest: Nest) => nest.Logger.overrideLogger(new nest.ConsoleLogger())
      ],
      [
        'warn left out of the levels',
        (nest: Nest) => nest.Logger.overrideLogger(['error']),
        (nest: Nest) => nest.Logger.overrideLogger(['warn', 'error'])
      ]
    ])('with %s', (_name, disable, enable) => {
      it('writes nothing and keeps the budget', async () => {
        const lines = await logged(async (fresh, written) => {
          const nest = await import('@nestjs/common')
          const fail = (): never => {
            throw new Error('x')
          }
          disable(nest)
          fresh('onEvent', fail)
          expect(written).toEqual([])
          enable(nest)
          fresh('onEvent', fail)
        })

        expect(lines).toEqual([
          { event: 'CACHE_HOOK_FAILED', message: 'A host hook failed', hook: 'onEvent' }
        ])
      })
    })

    it('writes through levels that include warn and through a custom logger', async () => {
      const lines = await logged(async (fresh) => {
        const nest = await import('@nestjs/common')
        nest.Logger.overrideLogger(['warn', 'error'])
        fresh('onEvent', () => {
          throw new Error('x')
        })
        nest.Logger.overrideLogger({
          log: () => undefined,
          warn: () => undefined,
          error: () => undefined
        })
        fresh('onQueue', () => {
          throw new Error('x')
        })
      })

      expect(lines.map((line) => (line as { hook: string }).hook)).toEqual(['onEvent', 'onQueue'])
    })

    // Scenario: the application set levels without warn, then installed its own logger (useLogger).
    // Rule: the levels filter Nest's own logger only; the custom logger receives warn, so the line is written.
    it('writes through a custom logger installed after levels without warn', async () => {
      const lines = await logged(async (fresh) => {
        const nest = await import('@nestjs/common')
        nest.Logger.overrideLogger(['error'])
        nest.Logger.overrideLogger({
          log: () => undefined,
          warn: () => undefined,
          error: () => undefined
        })
        fresh('onEvent', () => {
          throw new Error('x')
        })
      })

      expect(lines).toHaveLength(1)
    })

    // Scenario: the installed logger is a ConsoleLogger of another copy of @nestjs/common, so instanceof is false.
    // Rule: it counts as writable, as before this check existed; the line is never skipped on a guess.
    it('writes when the installed ConsoleLogger comes from another copy of Nest', async () => {
      const lines = await logged(async (fresh) => {
        const nest = await import('@nestjs/common')
        nest.Logger.overrideLogger(['error'])
        class ConsoleLogger {
          warn(): void {}
        }
        Reflect.set(nest.Logger, 'staticInstanceRef', new ConsoleLogger())
        fresh('onEvent', () => {
          throw new Error('x')
        })
      })

      expect(lines).toHaveLength(1)
    })

    // Scenario: levels without warn were set, then a console logger of Nest's was installed afresh.
    // Rule: the installed logger answers for itself (a new one logs every level), not the stale levels.
    it('asks the installed console logger, not the levels set before it', async () => {
      const lines = await logged(async (fresh) => {
        const nest = await import('@nestjs/common')
        nest.Logger.overrideLogger(['error'])
        nest.Logger.overrideLogger(new nest.ConsoleLogger())
        fresh('onEvent', () => {
          throw new Error('x')
        })
        class Quiet extends nest.ConsoleLogger {}
        nest.Logger.overrideLogger(new Quiet('', { logLevels: ['error'] }))
        fresh('onQueue', () => {
          throw new Error('x')
        })
      })

      expect(lines.map((line) => (line as { hook: string }).hook)).toEqual(['onEvent'])
    })

    it('treats a logger it cannot inspect as writable', async () => {
      const lines = await logged(async (fresh) => {
        const nest = await import('@nestjs/common')
        Object.defineProperty(nest.Logger, 'staticInstanceRef', {
          get: () => {
            throw new Error('inspect')
          },
          configurable: true
        })
        fresh('onEvent', () => {
          throw new Error('x')
        })
      })

      expect(lines).toHaveLength(1)
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
