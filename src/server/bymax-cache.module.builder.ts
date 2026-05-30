/**
 * Configurable module base for `BymaxCacheModule`.
 *
 * Layer: server. Generates the NestJS dynamic-module plumbing (the
 * `MODULE_OPTIONS_TOKEN` provider and the `forRoot`/`forRootAsync` statics) via
 * `ConfigurableModuleBuilder`, per the Bymax standard (spec §0). The concrete
 * module in `bymax-cache.module.ts` extends the generated class and augments the
 * produced `DynamicModule` with the connection/key-builder providers.
 */
import { ConfigurableModuleBuilder } from '@nestjs/common'

import type { BymaxCacheModuleOptions } from './interfaces/cache-module-options.interface'

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } =
  new ConfigurableModuleBuilder<BymaxCacheModuleOptions>({ moduleName: 'BymaxCache' })
    .setClassMethodName('forRoot')
    .build()
