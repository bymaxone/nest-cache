/**
 * Merges several `ICacheEvents` bags into one, because the module accepts a single `events`.
 *
 * Layer: observability, an optional subpath. Every bag is called, in the order given, whatever an
 * earlier one threw or rejected with: a faulty observer must not hide the event from the others.
 */
import type { ICacheEvents } from '@bymax-one/nest-cache'

import { absorb } from './absorb'

/**
 * Builds the bag that forwards each callback to every given bag.
 *
 * @param bags - The bags to combine, for example a connection tally's and the observability's.
 * @returns One bag to hand to `BymaxCacheModule` as `events`.
 */
export function combineCacheEvents(...bags: readonly ICacheEvents[]): ICacheEvents {
  return {
    onEvent: (event, data): void => {
      for (const bag of bags) absorb(() => bag.onEvent?.(event, data))
    },
    onOperation: (operation, outcome): void => {
      for (const bag of bags) absorb(() => bag.onOperation?.(operation, outcome))
    },
    onQueue: (queued): void => {
      for (const bag of bags) absorb(() => bag.onQueue?.(queued))
    }
  }
}
