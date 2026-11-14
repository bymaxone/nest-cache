/**
 * Unit tests for {@link validateRead}.
 *
 * Layer: server. The helper runs the host's rule over a decoded value: a type predicate or a
 * Standard Schema validator. A value that does not satisfy it, or a validator that fails, becomes a
 * `CacheException` that carries nothing from the value, with the original outcome kept as `cause`.
 */
import * as v from 'valibot'
import { z } from 'zod'

import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { validateRead } from './validate-read'

import type { StandardSchemaLike } from '../interfaces/read-options.interface'

interface User {
  id: number
  name: string
}

/** Whether `value` is a {@link User}. */
const isUser = (value: unknown): value is User =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as User).id === 'number' &&
  typeof (value as User).name === 'string'

/** A hand-written Standard Schema for {@link User}, optionally asynchronous. */
const userSchema = (isAsync: boolean): StandardSchemaLike<User> => ({
  '~standard': {
    version: 1,
    validate: (value) => {
      const result = isUser(value)
        ? { value }
        : { issues: [{ message: `bad value ${JSON.stringify(value)}` }] }
      return isAsync ? Promise.resolve(result) : result
    }
  }
})

/** Runs `call` and returns the error it rejected with, failing the test when it resolved. */
const rejectionOf = async (call: () => Promise<unknown>): Promise<CacheException> => {
  try {
    await call()
  } catch (error) {
    return error as CacheException
  }
  throw new Error('expected the call to reject')
}

describe('validateRead', () => {
  const user: User = { id: 1, name: 'Ada' }

  // A predicate that accepts returns the value itself, unchanged and typed.
  it('returns the value a predicate accepts', async () => {
    await expect(validateRead(user, isUser)).resolves.toBe(user)
  })

  // A predicate that refuses is a mismatch: VALIDATION_FAILED with no issue count (a predicate
  // reports none) and nothing from the value.
  it('rejects a value a predicate refuses', async () => {
    const error = await rejectionOf(() => validateRead({ id: 'secret-token-123' }, isUser))

    expect(error).toBeInstanceOf(CacheException)
    expect(error.code).toBe(CACHE_ERROR_CODES.VALIDATION_FAILED)
    expect(error.details).toEqual({ error: 'the stored value does not match the expected shape' })
    expect(JSON.stringify(error.getResponse())).not.toContain('secret')
  })

  // A predicate that merely returns a truthy non-true value (a promise, a string) does not pass:
  // only `true` accepts.
  it('accepts only true from a predicate', async () => {
    const lax = ((): unknown => 'yes') as unknown as (value: unknown) => value is User

    expect((await rejectionOf(() => validateRead(user, lax))).code).toBe(
      CACHE_ERROR_CODES.VALIDATION_FAILED
    )
  })

  // A Standard Schema, synchronous or asynchronous, returns the value it hands back.
  it.each([false, true])(
    'returns the value a Standard Schema accepts (async: %s)',
    async (isAsync) => {
      await expect(validateRead(user, userSchema(isAsync))).resolves.toBe(user)
    }
  )

  // A Standard Schema may transform: the value it returns, not the input, is what the caller gets.
  it('returns the output of a transforming schema', async () => {
    const doubled: StandardSchemaLike<number> = {
      '~standard': { version: 1, validate: (value) => ({ value: (value as number) * 2 }) }
    }

    await expect(validateRead(21, doubled)).resolves.toBe(42)
  })

  // Issues are counted and kept as the cause, never copied into details: a schema's messages often
  // quote the value it received.
  it.each([false, true])(
    'rejects with the issue count and the issues as cause (async: %s)',
    async (isAsync) => {
      const error = await rejectionOf(() => validateRead('secret-token-123', userSchema(isAsync)))

      expect(error.code).toBe(CACHE_ERROR_CODES.VALIDATION_FAILED)
      expect(error.details).toEqual({
        error: 'the stored value does not match the expected shape',
        issueCount: 1
      })
      expect(JSON.stringify(error.getResponse())).not.toContain('secret')
      expect(JSON.stringify(error.cause)).toContain('secret')
    }
  )

  // A validator that throws, or rejects, did not decide: that is VALIDATION_FAILED too, with the
  // thrown value as the cause and a text that says the check could not run.
  it.each([
    [
      'throws',
      (): never => {
        throw new Error('boom secret-token-123')
      }
    ],
    ['rejects', (): Promise<never> => Promise.reject(new Error('boom secret-token-123'))]
  ])('wraps a Standard Schema that %s', async (_name, validate) => {
    const schema: StandardSchemaLike<User> = { '~standard': { version: 1, validate } }
    const error = await rejectionOf(() => validateRead(user, schema))

    expect(error.code).toBe(CACHE_ERROR_CODES.VALIDATION_FAILED)
    expect(error.details).toEqual({ error: 'the validator could not check the stored value' })
    expect((error.cause as Error).message).toContain('boom')
    expect(JSON.stringify(error.getResponse())).not.toContain('secret')
  })

  // A predicate that throws is wrapped the same way, and a falsy thrown value is still the cause.
  it('wraps a predicate that throws, keeping a falsy cause', async () => {
    const throwing = ((): never => {
      throw 0
    }) as unknown as (value: unknown) => value is User
    const error = await rejectionOf(() => validateRead(user, throwing))

    expect(error.details).toEqual({ error: 'the validator could not check the stored value' })
    expect(error.cause).toBe(0)
  })

  // Where the value came from is added to the details, so a batch read names the failing element.
  it('adds the location of the failing value to the details', async () => {
    const byIndex = await rejectionOf(() => validateRead(1, isUser, { index: 2 }))
    const byField = await rejectionOf(() => validateRead(1, isUser, { field: 'name' }))

    expect(byIndex.details).toEqual({
      error: 'the stored value does not match the expected shape',
      index: 2
    })
    expect(byField.details).toEqual({
      error: 'the stored value does not match the expected shape',
      field: 'name'
    })
  })

  // Real Standard Schema implementations are the contract this claims: zod 4 and valibot.
  describe('real Standard Schema libraries', () => {
    const zodUser = z.object({ id: z.number(), name: z.string() })
    const valibotUser = v.object({ id: v.number(), name: v.string() })

    it.each([
      ['zod', zodUser],
      ['valibot', valibotUser]
    ])(
      '%s accepts a matching value and rejects a mismatch with value-free details',
      async (_name, schema) => {
        const typed = schema as unknown as StandardSchemaLike<User>

        await expect(validateRead(user, typed)).resolves.toEqual(user)
        const error = await rejectionOf(() =>
          validateRead({ id: 'secret-token-123', name: 1 }, typed)
        )

        expect(error.code).toBe(CACHE_ERROR_CODES.VALIDATION_FAILED)
        expect((error.details as { issueCount: number }).issueCount).toBe(2)
        expect(JSON.stringify(error.getResponse())).not.toContain('secret')
      }
    )

    it('zod keeps a transform and a coercion in the returned value', async () => {
      const schema = z.object({ at: z.string().transform((s) => new Date(s)) })
      const out = (await validateRead(
        { at: '2026-01-01T00:00:00.000Z' },
        schema as unknown as StandardSchemaLike<{ at: Date }>
      )) as { at: Date }

      expect(out.at).toBeInstanceOf(Date)
    })
  })
})
