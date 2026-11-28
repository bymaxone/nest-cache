/**
 * Encoding and validation of what the idempotency store keeps under a key. A value read back is
 * checked field by field and never trusted: one that does not decode as a record is refused as
 * `DESERIALIZATION_FAILED`, with a fixed reason and never a part of the value.
 *
 * Layer: idempotency, the codec and argument checks of the stored record.
 */
import type {
  IdempotencyRecord,
  IdempotencyStoredResponse,
  StoredResponseHeaders
} from '@bymax-one/nest-core/idempotency'

import { CACHE_ERROR_CODES, CacheException } from '@bymax-one/nest-cache'

/** The most a stored header map may take once serialised, in bytes. */
export const MAX_HEADERS_BYTES = 65_536

/** The longest lease or ttl accepted, in seconds (about 68 years; `EXPIRE` rejects an overflow). */
export const MAX_SECONDS = 2_147_483_647

/** One element of a script reply: a string, or `null` for a field the hash does not hold. */
type Field = string | null

/** Refuses a stored record: the reason is fixed text, never a part of the stored value. */
function malformed(reason: string): CacheException {
  return new CacheException(CACHE_ERROR_CODES.DESERIALIZATION_FAILED, { reason })
}

/** Refuses an argument of the caller, naming it and never its value. */
function refused(option: string, reason: string): CacheException {
  return new CacheException(CACHE_ERROR_CODES.INVALID_OPTIONS, { option, reason })
}

/**
 * Checks a lease or ttl before anything is sent.
 *
 * @param option - The option's name, for the refusal.
 * @param seconds - The value to check.
 * @throws {CacheException} `INVALID_OPTIONS` unless it is an integer from 1 to {@link MAX_SECONDS}.
 */
export function assertSeconds(option: string, seconds: number): void {
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > MAX_SECONDS) {
    throw refused(option, 'must be an integer from 1 to 2147483647')
  }
}

/**
 * Checks a fingerprint before it is stored: a record without one cannot be read back.
 *
 * @throws {CacheException} `INVALID_OPTIONS` unless it is a non-empty string.
 */
export function assertFingerprint(fingerprint: unknown): void {
  if (typeof fingerprint !== 'string' || fingerprint === '') {
    throw refused('fingerprint', 'must be a non-empty string')
  }
}

/**
 * Checks a status before it is stored: a record with another one cannot be read back.
 *
 * @throws {CacheException} `INVALID_OPTIONS` unless it is an integer from 100 to 599.
 */
export function assertStatus(status: unknown): void {
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599) {
    throw refused('response.status', 'must be an integer from 100 to 599')
  }
}

/** The map a JSON text holds, or `undefined` unless it is an object of strings. */
function headerMap(text: string): StoredResponseHeaders | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // `parsed` stays undefined, which the shape check below refuses.
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const entries = Object.entries(parsed)
  if (!entries.every(([, value]) => typeof value === 'string')) return undefined
  return Object.fromEntries(entries) as StoredResponseHeaders
}

/**
 * Serialises the headers of a response for storage. The text is checked with the rule the read
 * applies, so what is stored can be read back.
 *
 * @param headers - The allow-listed headers.
 * @returns The JSON text.
 * @throws {CacheException} `INVALID_OPTIONS` unless it serialises to an object of strings, or when
 *   it would take more than {@link MAX_HEADERS_BYTES}.
 */
export function encodeHeaders(headers: StoredResponseHeaders): string {
  let text: string | undefined
  try {
    text = JSON.stringify(headers)
  } catch {
    // `text` stays undefined, which is refused below.
  }
  if (text === undefined || headerMap(text) === undefined) {
    throw refused('response.headers', 'must be an object of strings')
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_HEADERS_BYTES) {
    throw refused('response.headers', 'serialised headers exceed 65536 bytes')
  }
  return text
}

/** Parses stored headers: a JSON object of strings no larger than {@link MAX_HEADERS_BYTES}. */
function decodeHeaders(text: Field): StoredResponseHeaders {
  if (text === null || Buffer.byteLength(text, 'utf8') > MAX_HEADERS_BYTES) {
    throw malformed('headers_invalid')
  }
  const headers = headerMap(text)
  if (headers === undefined) throw malformed('headers_invalid')
  return headers
}

/** Parses a stored status: three digits, 100 to 599. */
function decodeStatus(text: Field): number {
  if (text === null || !/^[1-5]\d\d$/.test(text)) throw malformed('status_invalid')
  return Number(text)
}

/** Decodes the answer of a completed record. */
function decodeResponse(status: Field, headers: Field, body: Field): IdempotencyStoredResponse {
  const base = { status: decodeStatus(status), headers: decodeHeaders(headers) }
  return body === null ? base : { ...base, body }
}

/**
 * Validates the reply of `begin` for a key that was already held.
 *
 * @param reply - `[pttl, s, f, t, st, h, b]` as the script returned it.
 * @returns The record, without the token that holds the claim.
 * @throws {CacheException} `DESERIALIZATION_FAILED` for anything that is not exactly an
 *   in-progress claim or a completed record with a lifetime.
 */
export function decodeHeld(reply: readonly unknown[]): IdempotencyRecord {
  const [pttl, state, fingerprint, token, status, headers, body] = reply
  const fields = [state, fingerprint, token, status, headers, body]
  if (typeof pttl !== 'number' || !(pttl >= 0)) throw malformed('no_lifetime')
  if (!fields.every((f) => f === null || typeof f === 'string')) throw malformed('field_type')
  if (typeof fingerprint !== 'string' || fingerprint === '') throw malformed('fingerprint_missing')
  if (state === 'p') {
    if (typeof token !== 'string' || status !== null || headers !== null || body !== null) {
      throw malformed('in_progress_invalid')
    }
    return { state: 'in_progress', fingerprint }
  }
  if (state !== 'c' || token !== null) throw malformed('state_unknown')
  return {
    state: 'completed',
    fingerprint,
    response: decodeResponse(status as Field, headers as Field, body as Field)
  }
}
