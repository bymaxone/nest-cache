/**
 * The one way a refused option value becomes an exception.
 *
 * Layer: server. Routing every such refusal through here is what keeps a configured value out of
 * the details: a site cannot forget to describe it, because it never builds the details itself.
 */
import { CACHE_ERROR_CODES, type CacheErrorCode } from '../errors/cache-error-codes'
import { describeReceived } from './describe-received'
import { refusal } from './own-refusals'

/** The options that hold a credential, by name: their refusals never print a number. */
const CREDENTIAL = /pass|user|secret|token|cred|auth/i

/**
 * Throws `code` for an option value, reporting its type and never its content.
 *
 * @param code - The error code of the refusal: the one the option's family has always used.
 * @param option - The option's name, as the host writes it.
 * @param problem - What is wrong with it; the `reason` is the option's name followed by this.
 * @param value - The refused value; only its type, or the number itself, reaches the details.
 * @param bounds - Further fixed details such as the accepted range or the reason for it.
 * @throws {CacheException} Always, with `details` of `reason`, `option`, `received` and `bounds`.
 */
export function refuseValue(
  code: CacheErrorCode,
  option: string,
  problem: string,
  value: unknown,
  bounds?: Readonly<Record<string, number | string>>
): never {
  throw refusal(code, {
    reason: `${option} ${problem}`,
    option,
    received: describeReceived(value, CREDENTIAL.test(option)),
    ...bounds
  })
}

/**
 * Throws `INVALID_OPTIONS` for an option value, reporting its type and never its content.
 *
 * @param option - The option's name, as the host writes it.
 * @param problem - What is wrong with it; the `reason` is the option's name followed by this.
 * @param value - The refused value; only its type, or the number itself, reaches the details.
 * @param bounds - Further fixed details such as the accepted range or the reason for it.
 * @throws {CacheException} Always, with `details` of `reason`, `option`, `received` and `bounds`.
 */
export function refuseOption(
  option: string,
  problem: string,
  value: unknown,
  bounds?: Readonly<Record<string, number | string>>
): never {
  return refuseValue(CACHE_ERROR_CODES.INVALID_OPTIONS, option, problem, value, bounds)
}
