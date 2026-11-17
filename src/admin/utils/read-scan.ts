/**
 * Narrowing of an `HSCAN` or `SSCAN` reply into one page of entries.
 *
 * Layer: admin. The reply comes back through `call`, so it is `unknown`. It is read the way the
 * sorted-set reply is, for both wire shapes: a flat alternating sequence under RESP2 and pairs
 * under RESP3, and a page that is not an array is an empty page that ends the scan.
 */

import { REVEAL_SCAN_CALLS_LIMIT } from '../constants/admin-defaults'

/** One page of a scan: the cursor to continue from and what the page held. */
export interface ScanPage {
  /** `"0"` when the scan is over, the cursor to ask for the next page otherwise. */
  readonly cursor: string
  /** The page's members, or its field and value pairs for a hash. */
  readonly entries: readonly (readonly [string, string])[]
}

/**
 * Reads a `[cursor, elements]` scan reply.
 *
 * @param reply - Whatever the server answered.
 * @param paired - `true` for `HSCAN`, whose elements are fields and values; `false` for `SSCAN`,
 *   whose elements are members, reported with an empty second slot.
 * @returns The page; an unreadable reply is an empty page with cursor `"0"`.
 */
export function readScanPage(reply: unknown, paired: boolean): ScanPage {
  if (!Array.isArray(reply) || !Array.isArray(reply[1])) {
    return { cursor: '0', entries: [] }
  }
  const entries: [string, string][] = []
  let pendingField: string | null = null
  for (const element of reply[1] as unknown[]) {
    if (Array.isArray(element)) {
      entries.push([String(element[0]), String(element[1] ?? '')])
    } else if (!paired) {
      entries.push([String(element), ''])
    } else if (pendingField === null) {
      pendingField = String(element)
    } else {
      entries.push([pendingField, String(element)])
      pendingField = null
    }
  }
  return { cursor: String(reply[0]), entries }
}

/**
 * Follows an `HSCAN` or `SSCAN` until it has seen more than `limit` distinct entries, the scan ends,
 * or {@link REVEAL_SCAN_CALLS_LIMIT} calls were made, so what is read is bounded whatever the size of
 * the value. A scan may return an entry twice, so entries are counted once, by name.
 *
 * @param limit - The most entries to return.
 * @param fetch - Asks for the page after a cursor.
 * @param paired - Whether the pages hold field and value pairs.
 * @returns The first `limit` entries, and whether they are all there is.
 */
export async function scanUpTo(
  limit: number,
  fetch: (cursor: string) => Promise<unknown>,
  paired: boolean
): Promise<{ entries: [string, string][]; isComplete: boolean }> {
  let found = new Map<string, string>()
  let cursor = '0'
  for (let call = 0; call < REVEAL_SCAN_CALLS_LIMIT; call += 1) {
    const page = readScanPage(await fetch(cursor), paired)
    // A name already seen keeps its first value, and the new ones follow in the order they came.
    found = new Map([...found, ...page.entries.filter(([name]) => !found.has(name))])
    cursor = page.cursor
    if (cursor === '0' || found.size > limit) {
      break
    }
  }
  return { entries: [...found].slice(0, limit), isComplete: cursor === '0' && found.size <= limit }
}
