/**
 * Namespace-aware Redis key builder.
 *
 * Layer: server. Every key in the library is composed through this injectable so
 * tenant/app isolation is structural, not by convention — raw keys that bypass
 * the namespace are an anti-pattern (CLAUDE.md §4, spec §7).
 */
import { Inject, Injectable } from '@nestjs/common'

import { BYMAX_CACHE_OPTIONS } from '../bymax-cache.constants'
import {
  ESCAPE_CHAR,
  buildEscapeSet,
  escapeKeyPart,
  holdsLiteralUnit,
  splitEscapedParts,
  unescapeKeyPart,
  unmatchableUnits
} from './key-escape'
import type { ResolvedOptions } from '../config/resolved-options'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'

/**
 * Composes Redis keys following `{namespace}{separator}{prefix}{separator}{id}`.
 *
 * With the defaults (`namespace='app'`, `separator=':'`):
 * - `build('users', 'u_1')` → `'app:users:u_1'`
 * - `applyNamespace('rl:u_1')` → `'app:rl:u_1'`
 *
 * @see `docs/technical_specification.md` §7 — Namespace Strategy
 */
@Injectable()
export class KeyBuilder {
  private readonly namespace: string
  private readonly separator: string
  private readonly strict: boolean
  private readonly partEscapes: ReadonlySet<string>
  private readonly prefixEscapes: ReadonlySet<string>
  private readonly separatorUnits: ReadonlySet<string>

  /**
   * @param options - Resolved module options supplying the namespace, separator and escaping mode.
   */
  constructor(@Inject(BYMAX_CACHE_OPTIONS) options: ResolvedOptions) {
    this.namespace = options.namespace
    this.separator = options.keySeparator
    this.strict = options.keyEscaping === 'strict'
    this.partEscapes = buildEscapeSet(options.keySeparator, false)
    this.prefixEscapes = buildEscapeSet(options.keySeparator, true)
    this.separatorUnits = unmatchableUnits(options.keySeparator)
  }

  /**
   * Builds the full namespaced key.
   *
   * Under `keyEscaping: 'strict'` each part is escaped, so no two distinct `(prefix, id)` tuples
   * compose one key; a part holding no separator character, no `%` and, for the prefix, no glob
   * metacharacter is left byte-identical. Under `'legacy'` (the default) the parts are joined as
   * given, and `build('a', 'b:c')` equals `build('a:b', 'c')`.
   *
   * @param prefix - The entity-group prefix (e.g. `'users'`).
   * @param id - The entity id.
   * @returns `{namespace}{sep}{prefix}{sep}{id}`, with the parts escaped under `'strict'`.
   * @throws {CacheException} `INVALID_KEY` when `prefix` or `id` is empty.
   */
  build(prefix: string, id: string): string {
    this.assertParts(prefix, id)
    return this.strict
      ? this.compose(escapeKeyPart(prefix, this.prefixEscapes), escapeKeyPart(id, this.partEscapes))
      : this.compose(prefix, id)
  }

  /**
   * Builds the key exactly as the unescaped composition would, whatever the escaping mode.
   *
   * Reads a key an earlier release wrote, so a host moving to `'strict'` can read the old key and
   * write the new one.
   *
   * @param prefix - The entity-group prefix.
   * @param id - The entity id.
   * @returns `{namespace}{sep}{prefix}{sep}{id}`, unescaped.
   * @throws {CacheException} `INVALID_KEY` when `prefix` or `id` is empty.
   */
  buildLegacy(prefix: string, id: string): string {
    this.assertParts(prefix, id)
    return this.compose(prefix, id)
  }

  /**
   * Builds a `SCAN`/`KEYS` match pattern: the prefix is a literal and the pattern is a glob.
   *
   * Under `'strict'` the prefix is escaped, glob metacharacters included, so it cannot widen the
   * match; the pattern is a glob over the escaped id and is passed through otherwise untouched.
   * A stored id holds no separator character under `'strict'`, so a pattern that spells one as a
   * literal before any character class can never match and is refused instead of returning nothing
   * (a character class is not parsed, so a pattern with one is accepted); use {@link KeyBuilder.idPrefixPattern} to
   * sweep a composite id. A separator character that is also spelled inside escape tokens (a digit,
   * `A`-`F`, `u`) cannot be told apart from a token and is never refused. Under `'legacy'` both are
   * joined as given.
   *
   * @param prefix - The entity-group prefix.
   * @param pattern - The glob for the id segment, e.g. `'*'`.
   * @returns `{namespace}{sep}{prefix}{sep}{pattern}`.
   * @throws {CacheException} `INVALID_KEY` when `prefix` or `pattern` is empty, or under `'strict'`
   *   when `pattern` holds a character of the separator.
   */
  buildPattern(prefix: string, pattern: string): string {
    this.assertParts(prefix, pattern)
    if (!this.strict) {
      return this.compose(prefix, pattern)
    }
    if (holdsLiteralUnit(pattern, this.separatorUnits)) {
      throw new CacheException(CACHE_ERROR_CODES.INVALID_KEY, {
        reason: 'pattern_contains_separator'
      })
    }
    return this.compose(escapeKeyPart(prefix, this.prefixEscapes), pattern)
  }

  /**
   * Builds the id-part glob that matches every composite id starting with the given leading fields.
   *
   * The ids are those composed the documented way: each field escaped with
   * {@link KeyBuilder.escapePart}, joined with the separator and passed to `build()`. The trailing
   * separator belongs to the prefix, so `['u1']` matches `u1:s1` and not `u10:s1`. Every field is
   * escaped, so no glob character of its own survives and the trailing `*` is the only wildcard.
   * Both modes escape the fields; only `'strict'` also escapes the joined id, as `build()` does. A
   * separator that is a glob character, which `'legacy'` allows, is backslash-escaped in the pattern.
   *
   * @param segments - The leading fields of the composite id, at least one, none empty.
   * @returns The glob to pass to `scan()` or `keys()` as `pattern`.
   * @throws {CacheException} `INVALID_KEY` when there is no field or one is empty.
   */
  idPrefixPattern(segments: readonly string[]): string {
    if (segments.length === 0) {
      throw new CacheException(CACHE_ERROR_CODES.INVALID_KEY, { reason: 'empty_segments' })
    }
    if (segments.includes('')) {
      throw new CacheException(CACHE_ERROR_CODES.INVALID_KEY, { reason: 'empty_id' })
    }
    const fields = segments.map((segment) => this.escapePart(segment))
    if (this.strict) {
      return `${escapeKeyPart(fields.join(this.separator) + this.separator, this.partEscapes)}*`
    }
    // Legacy stores the joined id as it is, so the separator stays raw in the id; in the pattern a
    // separator that is a glob character is backslash-escaped, so it is the owner's literal boundary.
    const separator = this.separator.replace(/[*?[\\]/g, '\\$&')
    return `${fields.join(separator)}${separator}*`
  }

  /**
   * Escapes one part so it can be joined with the separator unambiguously, in any position.
   *
   * Rewrites `%`, every separator character, glob metacharacters and unpaired surrogates as
   * `%XX` / `%uXXXX` tokens. Independent of the escaping mode: a host composing one id from several
   * fields escapes each field with this, then joins them.
   *
   * @param part - The caller-owned part.
   * @returns The escaped part.
   * @throws {CacheException} `INVALID_NAMESPACE` when the separator contains `%`: the escape
   *   character would then reappear as the separator and the join could not be undone.
   */
  escapePart(part: string): string {
    if (this.separator.includes(ESCAPE_CHAR)) {
      throw new CacheException(CACHE_ERROR_CODES.INVALID_NAMESPACE, {
        reason: 'key separator contains the escape character',
        separator: this.separator
      })
    }
    return escapeKeyPart(part, this.prefixEscapes)
  }

  /**
   * Reverses {@link KeyBuilder.escapePart}.
   *
   * @param part - An escaped part.
   * @returns The original part, or `null` when `part` is malformed: a `%` that starts no valid token.
   */
  unescapePart(part: string): string | null {
    return unescapeKeyPart(part)
  }

  /**
   * Splits a key this builder composed back into its parts.
   *
   * @param key - A full key as returned by {@link KeyBuilder.build}.
   * @returns The prefix and id, or `null` when the key has another namespace, is not two parts, or
   *   holds a malformed escape, and always under `'legacy'`, where the composition is ambiguous and
   *   cannot be inverted. A well-formed token the escape would not write (`%u0041` for `A`) decodes.
   */
  parse(key: string): { prefix: string; id: string } | null {
    const head = this.getNamespacePrefix()
    if (!this.strict || !key.startsWith(head)) {
      return null
    }
    const parts = splitEscapedParts(key.slice(head.length), this.separator)
    if (parts === null) {
      return null
    }
    const prefix = unescapeKeyPart(parts.prefix)
    const id = unescapeKeyPart(parts.id)
    return prefix === null || id === null ? null : { prefix, id }
  }

  /**
   * Applies only the namespace to an already-composed key. Used by the Pub/Sub
   * and script services for channel/key namespacing.
   *
   * @param keyWithoutNamespace - The bare key to namespace.
   * @returns `{namespace}{sep}{keyWithoutNamespace}`.
   * @throws {CacheException} `INVALID_KEY` when the key is empty.
   */
  applyNamespace(keyWithoutNamespace: string): string {
    if (!keyWithoutNamespace) {
      throw new CacheException(CACHE_ERROR_CODES.INVALID_KEY, { reason: 'empty_key' })
    }
    return `${this.namespace}${this.separator}${keyWithoutNamespace}`
  }

  /**
   * Returns the `{namespace}{separator}` prefix string used to build `SCAN`
   * match patterns scoped to this namespace.
   *
   * @returns The namespace prefix, e.g. `'app:'`.
   */
  getNamespacePrefix(): string {
    return `${this.namespace}${this.separator}`
  }

  /** Rejects an empty prefix or id, either of which would collapse the key structure. */
  private assertParts(prefix: string, id: string): void {
    if (!prefix) {
      throw new CacheException(CACHE_ERROR_CODES.INVALID_KEY, { reason: 'empty_prefix' })
    }
    if (!id) {
      throw new CacheException(CACHE_ERROR_CODES.INVALID_KEY, { reason: 'empty_id' })
    }
  }

  /** Joins the namespace and two already-final parts. */
  private compose(prefix: string, id: string): string {
    return `${this.namespace}${this.separator}${prefix}${this.separator}${id}`
  }
}
