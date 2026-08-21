/**
 * The keyspaces an administration surface is allowed to read, and what may be
 * read from each.
 *
 * Layer: admin. A scope is declared by the *application*, not by the library and
 * not by a caller. The library owns the mechanism — validating the declarations,
 * scanning against them, withholding what they mark unreadable — while which
 * keyspaces exist is a fact about a deployment's wiring that no library can
 * learn. A cache configured with `namespace: 'app'` may still share its Redis
 * with keys another library writes at root through `CacheService.getClient()`,
 * and only the application knows that.
 *
 * @see `docs/technical_specification.md` §7 — Namespace Strategy
 */

/**
 * One keyspace an administration surface may read.
 *
 * Declared once at module wiring and frozen. A caller names a scope by
 * {@link CacheScope.id} and never supplies a pattern — a pattern composed from
 * request input is the vulnerability class this type exists to close.
 */
export interface CacheScope {
  /** The identifier a caller names. Unique within a deployment; never a pattern. */
  readonly id: string
  /** Human-readable name for an operator-facing surface. */
  readonly label: string
  /**
   * The `SCAN` match pattern this scope resolves to.
   *
   * Composed by the application and validated here: it must carry at least one
   * literal character before its first glob metacharacter, so a scope can never
   * resolve to the whole keyspace. That is an anchoring guarantee, not a
   * narrowness one — the library cannot judge whether `a*` is too broad for a
   * given deployment, only that it is anchored somewhere.
   */
  readonly pattern: string
  /**
   * Whether a key's **value** may be returned from this scope.
   *
   * `false` means the value alone is withheld. Listing, types, TTLs and sizes
   * stay available, and that split is the whole point: a surface that renders an
   * unreadable keyspace as empty tells an operator the region holds nothing when
   * it is full — the same defect as a blank log page during an outage, where a
   * reading meaning "I may not tell you" is drawn identically to one meaning
   * "there is nothing here".
   */
  readonly isReadable: boolean
  /**
   * Why this keyspace exists, in the application's own words.
   *
   * Rendered **verbatim**, as plain text — the library imposes no length limit
   * and interprets no markup. An application with one scope wants a sentence and
   * one with eight wants a phrase, and a truncation rule imposed here would cut
   * an explanation mid-clause on the screen where the explanation is the point.
   */
  readonly origin: string
}
