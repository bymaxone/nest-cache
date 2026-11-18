/**
 * The one way a refused administration option becomes an `INVALID_SCOPE` exception.
 *
 * Layer: admin. The admin entry imports the server surface by package specifier only, and the
 * server's describing helper is not part of it, so the rule is restated here: a refusal names the
 * option and the type of the value, and a configured value never reaches the details.
 */
import { CACHE_ERROR_CODES, CacheException } from '@bymax-one/nest-cache'

/**
 * The value's type, or the number itself when it is finite.
 *
 * @param value - The refused value.
 * @returns A finite number as itself; `NaN` and an infinity as their names; anything else as a
 *   phrase such as `a string`, `an array` or `null`.
 */
function describeReceived(value: unknown): number | string {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value)
  }
  if (value === undefined || value === null) {
    return String(value)
  }
  if (Array.isArray(value)) {
    return 'an array'
  }
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`
}

/**
 * Throws `INVALID_SCOPE` for an administration option, reporting its type and never its content.
 *
 * @param option - The option's name, as the host writes it (`scopes[1].pattern` for a scope field).
 * @param problem - What is wrong with it; the `reason` is the option's name followed by this.
 * @param value - The refused value; only its type, or the number itself, reaches the details.
 * @param bounds - Further fixed details such as the accepted range.
 * @throws {CacheException} Always, with `details` of `reason`, `option`, `received` and `bounds`.
 */
export function refuseAdminOption(
  option: string,
  problem: string,
  value: unknown,
  bounds?: Readonly<Record<string, number | string>>
): never {
  throw new CacheException(CACHE_ERROR_CODES.INVALID_SCOPE, {
    reason: `${option} ${problem}`,
    option,
    received: describeReceived(value),
    ...bounds
  })
}
