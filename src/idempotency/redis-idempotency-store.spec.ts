/**
 * Unit tests for the Redis idempotency store against a recording script manager: which script runs
 * with which key and arguments, how each reply maps to the port's result, and which refusals leave
 * before anything is sent. The scripts themselves run only against a real Redis (e2e).
 *
 * Layer: idempotency.
 */
import { applyDefaults } from '../server/config/default-options'
import { CACHE_ERROR_CODES } from '../server/errors/cache-error-codes'
import { CacheException } from '../server/errors/cache.exception'
import { KeyBuilder } from '../server/utils/key-builder'
import {
  BEGIN_LUA,
  BEGIN_SCRIPT,
  COMPLETE_LUA,
  COMPLETE_SCRIPT,
  RELEASE_LUA,
  RELEASE_SCRIPT
} from './idempotency-scripts'
import { RedisIdempotencyStore } from './redis-idempotency-store'

import type { ScriptManagerService } from '../server/services/script-manager.service'

/** A script manager that records its calls and answers what the test queued. */
function fakeScripts(...replies: unknown[]): {
  scripts: ScriptManagerService
  register: jest.Mock
  evaluate: jest.Mock
} {
  const register = jest.fn()
  const evaluate = jest.fn()
  for (const reply of replies) evaluate.mockResolvedValueOnce(reply)
  return {
    scripts: { register, eval: evaluate } as unknown as ScriptManagerService,
    register,
    evaluate
  }
}

/** A store on the default namespace (`app`). */
function build(...replies: unknown[]): ReturnType<typeof fakeScripts> & {
  store: RedisIdempotencyStore
} {
  const fake = fakeScripts(...replies)
  const keys = new KeyBuilder(applyDefaults({ connection: { host: 'h' } }))
  return { ...fake, store: new RedisIdempotencyStore(fake.scripts, keys) }
}

/** The code of the refusal a promise rejects with. */
async function codeOf(run: Promise<unknown>): Promise<string> {
  try {
    await run
  } catch (error) {
    expect(error).toBeInstanceOf(CacheException)
    return (error as CacheException).code
  }
  throw new Error('expected a rejection')
}

describe('RedisIdempotencyStore', () => {
  it('registers its three scripts under their own names', () => {
    // Arrange / Act
    const { register } = build()

    // Assert
    expect(register.mock.calls).toEqual([
      [BEGIN_SCRIPT, BEGIN_LUA],
      [COMPLETE_SCRIPT, COMPLETE_LUA],
      [RELEASE_SCRIPT, RELEASE_LUA]
    ])
  })

  describe('begin', () => {
    it('claims a free key with a fresh token, under the idem prefix, key not hashed again', async () => {
      // Arrange
      const { store, evaluate } = build(['c'])

      // Act
      const result = await store.begin('abc123', 'fp', 30)

      // Assert
      expect(result).toEqual({ claimed: true, token: expect.stringMatching(/^[0-9a-f-]{36}$/) })
      const [name, keys, args] = evaluate.mock.calls[0] as [string, string[], unknown[]]
      expect(name).toBe(BEGIN_SCRIPT)
      expect(keys).toEqual(['app:idem:abc123'])
      expect(args).toEqual(['fp', (result as { token: string }).token, 30])
    })

    it('draws a different token for every claim', async () => {
      // Arrange
      const { store } = build(['c'], ['c'])

      // Act
      const first = await store.begin('k', 'fp', 30)
      const second = await store.begin('k', 'fp', 30)

      // Assert
      expect(first).not.toEqual(second)
    })

    it('reports the held record and never the claim it holds', async () => {
      // Arrange
      const { store } = build(['h', 5000, 'p', 'other', 'secret-token', null, null, null])

      // Act
      const result = await store.begin('k', 'fp', 30)

      // Assert
      expect(result).toEqual({
        claimed: false,
        record: { state: 'in_progress', fingerprint: 'other' }
      })
      expect(JSON.stringify(result)).not.toContain('secret-token')
    })

    it('reports a completed record with its response', async () => {
      // Arrange
      const { store } = build(['h', 5000, 'c', 'fp', null, '200', '{"a":"b"}', '{"ok":true}'])

      // Act / Assert
      expect(await store.begin('k', 'fp', 30)).toEqual({
        claimed: false,
        record: {
          state: 'completed',
          fingerprint: 'fp',
          response: { status: 200, headers: { a: 'b' }, body: '{"ok":true}' }
        }
      })
    })

    it('rejects a key that is not a record as DESERIALIZATION_FAILED, never as a claim', async () => {
      // Arrange
      const { store } = build(['x'])

      // Act / Assert
      expect(await codeOf(store.begin('k', 'fp', 30))).toBe(
        CACHE_ERROR_CODES.DESERIALIZATION_FAILED
      )
    })

    it('rejects a held record with no lifetime', async () => {
      // Arrange
      const { store } = build(['h', -1, 'p', 'fp', 'tok', null, null, null])

      // Act / Assert
      expect(await codeOf(store.begin('k', 'fp', 30))).toBe(
        CACHE_ERROR_CODES.DESERIALIZATION_FAILED
      )
    })

    it.each([[null], [undefined], ['c'], [7], [[]], [['z']]])(
      'rejects the unknown reply %p',
      async (reply) => {
        // Arrange
        const { store } = build(reply)

        // Act / Assert
        expect(await codeOf(store.begin('k', 'fp', 30))).toBe(
          CACHE_ERROR_CODES.DESERIALIZATION_FAILED
        )
      }
    )

    it('refuses a bad lease before anything is sent', async () => {
      // Arrange
      const { store, evaluate } = build()

      // Act / Assert
      expect(await codeOf(store.begin('k', 'fp', 0))).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
      expect(await codeOf(store.begin('k', 'fp', 2 ** 31))).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
      expect(evaluate).not.toHaveBeenCalled()
    })

    it('refuses an empty key', async () => {
      // Arrange
      const { store, evaluate } = build()

      // Act / Assert
      expect(await codeOf(store.begin('', 'fp', 30))).toBe(CACHE_ERROR_CODES.INVALID_KEY)
      expect(evaluate).not.toHaveBeenCalled()
    })

    it('lets a failure of the script run through unchanged', async () => {
      // Arrange
      const failure = new CacheException(CACHE_ERROR_CODES.CONNECTION_LOST)
      const { store, evaluate } = build()
      evaluate.mockRejectedValueOnce(failure)

      // Act / Assert
      await expect(store.begin('k', 'fp', 30)).rejects.toBe(failure)
    })
  })

  describe('complete', () => {
    it('sends the token, status, headers, ttl and body', async () => {
      // Arrange
      const { store, evaluate } = build(1)

      // Act
      const done = await store.complete(
        'k',
        'tok',
        { status: 201, headers: { a: 'b' }, body: 'text' },
        60
      )

      // Assert
      expect(done).toBe(true)
      expect(evaluate).toHaveBeenCalledWith(
        COMPLETE_SCRIPT,
        ['app:idem:k'],
        ['tok', 201, '{"a":"b"}', 60, 'text']
      )
    })

    it('sends no body argument when the response has none, and sends an empty one as it is', async () => {
      // Arrange
      const { store, evaluate } = build(1, 1)

      // Act
      await store.complete('k', 'tok', { status: 204, headers: {} }, 60)
      await store.complete('k', 'tok', { status: 200, headers: {}, body: '' }, 60)

      // Assert
      expect(evaluate.mock.calls[0]?.[2]).toEqual(['tok', 204, '{}', 60])
      expect(evaluate.mock.calls[1]?.[2]).toEqual(['tok', 200, '{}', 60, ''])
    })

    it("answers false when the claim is no longer the caller's", async () => {
      // Arrange
      const { store } = build(0)

      // Act / Assert
      expect(await store.complete('k', 'tok', { status: 200, headers: {} }, 60)).toBe(false)
    })

    it.each([[-1], [2], [null], ['1'], [true]])('rejects the reply %p', async (reply) => {
      // Arrange
      const { store } = build(reply)

      // Act / Assert
      expect(await codeOf(store.complete('k', 't', { status: 200, headers: {} }, 60))).toBe(
        CACHE_ERROR_CODES.DESERIALIZATION_FAILED
      )
    })

    it('refuses a bad ttl and an oversized header map before anything is sent', async () => {
      // Arrange
      const { store, evaluate } = build()
      const big = { k: 'a'.repeat(70_000) }

      // Act / Assert
      expect(await codeOf(store.complete('k', 't', { status: 200, headers: {} }, 1.5))).toBe(
        CACHE_ERROR_CODES.INVALID_OPTIONS
      )
      expect(await codeOf(store.complete('k', 't', { status: 200, headers: big }, 60))).toBe(
        CACHE_ERROR_CODES.INVALID_OPTIONS
      )
      expect(evaluate).not.toHaveBeenCalled()
    })
  })

  describe('release', () => {
    it('sends the token on the namespaced key', async () => {
      // Arrange
      const { store, evaluate } = build(1)

      // Act / Assert
      expect(await store.release('k', 'tok')).toBe(true)
      expect(evaluate).toHaveBeenCalledWith(RELEASE_SCRIPT, ['app:idem:k'], ['tok'])
    })

    it("answers false when the claim is not the caller's", async () => {
      // Arrange
      const { store } = build(0)

      // Act / Assert
      expect(await store.release('k', 'tok')).toBe(false)
    })

    it('rejects a key that is not a record', async () => {
      // Arrange
      const { store } = build(-1)

      // Act / Assert
      expect(await codeOf(store.release('k', 'tok'))).toBe(CACHE_ERROR_CODES.DESERIALIZATION_FAILED)
    })
  })
})
