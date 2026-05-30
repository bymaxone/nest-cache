/**
 * Fully-resolved module options type.
 *
 * Layer: server. The shape produced by `applyDefaults` and stored under the
 * `BYMAX_CACHE_OPTIONS` token. Defaulted fields (including `mode`) are always
 * present; mode-specific blocks are kept as required-but-nullable so the
 * resolver can assign them unconditionally under `exactOptionalPropertyTypes`,
 * while consumers still narrow on `undefined`.
 */
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'

/**
 * Module options after defaults are merged. The defaulted fields
 * (`mode`, `namespace`, `keySeparator`, `shutdownTimeoutMs`,
 * `allowFlushInProduction`, `isGlobal`) are guaranteed present; the
 * mode/connection blocks are present keys whose value may be `undefined`.
 */
export type ResolvedOptions = Required<
  Pick<
    BymaxCacheModuleOptions,
    | 'mode'
    | 'namespace'
    | 'keySeparator'
    | 'shutdownTimeoutMs'
    | 'allowFlushInProduction'
    | 'isGlobal'
  >
> & {
  connection: BymaxCacheModuleOptions['connection']
  sentinel: BymaxCacheModuleOptions['sentinel']
  cluster: BymaxCacheModuleOptions['cluster']
  serializer: BymaxCacheModuleOptions['serializer']
  events: BymaxCacheModuleOptions['events']
  scripts: BymaxCacheModuleOptions['scripts']
}
