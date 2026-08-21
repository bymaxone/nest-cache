/**
 * Validation of the administration scope allowlist.
 *
 * Layer: admin. The application declares which keyspaces exist; this module
 * decides whether those declarations are safe to serve reads against, and it
 * runs once at module wiring rather than per request — a rule evaluated at boot
 * cannot be widened by anything that arrives later.
 */
import { CACHE_ERROR_CODES, CacheException } from '@bymax-one/nest-cache'

import type { CacheScope } from '../interfaces/cache-scope.interface'

/**
 * The only shape a scope pattern may take: one or more literal characters,
 * optionally followed by a single trailing `*`.
 *
 * **Deliberately narrower than Redis's glob syntax, and the reason is a security
 * property rather than simplicity.** A caller names a scope and a key, so the
 * library must decide whether that key really belongs to that scope — otherwise
 * a caller names the readable scope and passes a key from the credential-bearing
 * one. Deciding it for arbitrary globs means reimplementing Redis's
 * `stringmatchlen` (greedy `*` with backtracking, `[a-z]` classes, `^`
 * negation, `\` escapes, and the unterminated-class case where `ten[ant` matches
 * nothing at all), and a matcher that is even slightly MORE permissive than the
 * server's is a leak that no test of the happy path would show.
 *
 * With this shape, membership is exact and needs no matcher: a trailing `*`
 * means `startsWith(prefix)`, and its absence means the key equals the pattern.
 *
 * The cost is real — a deployment wanting `app:*:v1` cannot express it — but it
 * is a boot-time refusal with a message that says what is allowed, not a silent
 * disagreement with the server. The rule can widen compatibly later; a leak
 * cannot be un-shipped.
 */
const SCOPE_PATTERN_SHAPE = /^[^*?[\\]+\*?$/

/** The scope fields that must carry text, checked in a stable order. */
const REQUIRED_FIELDS = ['id', 'label', 'pattern', 'origin'] as const

/**
 * Splits a validated pattern into the literal prefix a key must carry and
 * whether that prefix may be extended.
 *
 * @param pattern - A pattern that already satisfies {@link SCOPE_PATTERN_SHAPE}.
 * @returns The literal prefix, and whether a trailing `*` allows a suffix.
 */
export function readScopePattern(pattern: string): {
  readonly prefix: string
  readonly isPrefixMatch: boolean
} {
  const isPrefixMatch = pattern.endsWith('*')
  return { prefix: isPrefixMatch ? pattern.slice(0, -1) : pattern, isPrefixMatch }
}

/**
 * Reports whether a key falls inside a scope's declared region.
 *
 * Exact by construction rather than by matching — see {@link SCOPE_PATTERN_SHAPE}
 * for why the pattern shape is restricted to make this possible.
 *
 * @param pattern - The scope's validated match pattern.
 * @param key - The key a caller named.
 * @returns `true` when the key belongs to the scope.
 */
export function isKeyInScope(pattern: string, key: string): boolean {
  const { prefix, isPrefixMatch } = readScopePattern(pattern)
  return isPrefixMatch ? key.startsWith(prefix) : key === pattern
}

/**
 * Reads a scope's required text field without a dynamic index lookup.
 *
 * Switching over the literal names keeps the field name out of a computed member
 * access, which would be an object-injection sink (`security/detect-object-injection`)
 * on a value that ultimately comes from a consumer's configuration.
 *
 * @param scope - The declared scope.
 * @param field - Which required field to read.
 * @returns The field's value.
 */
function readField(scope: CacheScope, field: (typeof REQUIRED_FIELDS)[number]): string {
  switch (field) {
    case 'id':
      return scope.id
    case 'label':
      return scope.label
    case 'pattern':
      return scope.pattern
    default:
      return scope.origin
  }
}

/**
 * Validates an administration scope allowlist and returns a frozen copy.
 *
 * Every rule here closes a way the allowlist could authorise more than it
 * appears to: an unanchored pattern reaches the whole instance, a duplicate id
 * makes one declaration silently shadow another, and an empty field produces a
 * scope a surface can name but not explain. Freezing the result keeps the
 * decision made at wiring from being edited by anything that later holds it.
 *
 * @param scopes - The scopes the application declares.
 * @returns A frozen list of frozen scopes, in declaration order.
 * @throws {CacheException} `INVALID_SCOPE` when the list is empty, a required
 *   field is empty, an id repeats, or a pattern has no literal prefix.
 */
export function validateScopes(scopes: readonly CacheScope[]): readonly CacheScope[] {
  if (scopes.length === 0) {
    throw new CacheException(CACHE_ERROR_CODES.INVALID_SCOPE, { reason: 'no scopes declared' })
  }

  const seen = new Set<string>()
  const validated: CacheScope[] = []

  for (const scope of scopes) {
    for (const field of REQUIRED_FIELDS) {
      if (readField(scope, field) === '') {
        throw new CacheException(CACHE_ERROR_CODES.INVALID_SCOPE, {
          reason: 'empty scope field',
          field,
          scopeId: scope.id
        })
      }
    }
    if (seen.has(scope.id)) {
      throw new CacheException(CACHE_ERROR_CODES.INVALID_SCOPE, {
        reason: 'duplicate scope id',
        scopeId: scope.id
      })
    }
    if (!SCOPE_PATTERN_SHAPE.test(scope.pattern)) {
      throw new CacheException(CACHE_ERROR_CODES.INVALID_SCOPE, {
        reason: 'pattern must be a literal prefix optionally followed by *',
        scopeId: scope.id,
        pattern: scope.pattern
      })
    }
    seen.add(scope.id)
    validated.push(
      Object.freeze({
        id: scope.id,
        label: scope.label,
        pattern: scope.pattern,
        isReadable: scope.isReadable,
        origin: scope.origin
      })
    )
  }

  return Object.freeze(validated)
}

/**
 * Finds a declared scope by the identifier a caller named.
 *
 * Exact string equality against the frozen list, never interpolation — the
 * caller's input selects a declaration, it never contributes to one.
 *
 * @param scopes - The validated allowlist.
 * @param id - The identifier from the request.
 * @returns The scope.
 * @throws {CacheException} `SCOPE_NOT_FOUND` when no declaration has that id.
 */
export function findScope(scopes: readonly CacheScope[], id: string): CacheScope {
  const found = scopes.find((scope) => scope.id === id)
  if (!found) {
    throw new CacheException(CACHE_ERROR_CODES.SCOPE_NOT_FOUND, { scopeId: id })
  }
  return found
}
