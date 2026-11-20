/**
 * Splitting of a host-sized list into parts a single command can take.
 *
 * Layer: server. A call that spreads an array into a command's arguments overflows the call stack at
 * about 125 000 elements, so a list longer than {@link MAX_COMMAND_ARGUMENTS} is sent in parts.
 */

/** Most arguments one command carries: well under the count at which a spread overflows the stack. */
export const MAX_COMMAND_ARGUMENTS = 10_000

/** Most keys and arguments `eval` accepts together: above this the call is refused, not split. */
export const MAX_EVAL_ARGUMENTS = 25_000

/**
 * Splits a list into consecutive parts of at most `size` elements.
 *
 * @typeParam T - The element type.
 * @param items - The list.
 * @param size - The most elements in a part; at least 1.
 * @returns The parts in order; none for an empty list.
 */
export function chunkOf<T>(items: readonly T[], size: number): T[][] {
  const parts: T[][] = []
  for (let start = 0; start < items.length; start += size) {
    parts.push(items.slice(start, start + size))
  }
  return parts
}
