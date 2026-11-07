/**
 * Unit tests for when the cache closes its Redis connections during application shutdown.
 *
 * Layer: server. They close a real Nest application context, so the order of the lifecycle
 * hooks is Nest's own, over a scripted ioredis: the connections must still be open while the
 * destroy and before-shutdown hooks run (requests in flight when a signal arrives are still being
 * served until the HTTP server has stopped) and closed only in the application-shutdown hook,
 * which Nest runs after it stopped the server.
 */
import { EventEmitter } from 'node:events'

import { Injectable } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { CacheService } from '../services/cache.service'
import { PubSubService } from '../services/pubsub.service'
import { BymaxCacheModule } from '../bymax-cache.module'

import type {
  BeforeApplicationShutdown,
  OnApplicationShutdown,
  OnModuleDestroy
} from '@nestjs/common'

// Hoisted registry the mock factory fills with every client the module opens.
var clients: ScriptedClient[]

interface ScriptedClient extends EventEmitter {
  status: string
  quit: jest.Mock
  disconnect: jest.Mock
  subscribe: jest.Mock
}

jest.mock('ioredis', () => {
  class FakeRedis extends EventEmitter {
    status = 'ready'
    quit = jest.fn().mockResolvedValue('OK')
    disconnect = jest.fn()
    subscribe = jest.fn().mockResolvedValue(1)
    unsubscribe = jest.fn().mockResolvedValue(1)
    constructor() {
      super()
      clients.push(this as unknown as ScriptedClient)
    }
  }
  return { __esModule: true, Redis: FakeRedis, Cluster: FakeRedis, default: FakeRedis }
})

beforeEach(() => {
  clients = []
})

/** Records how many clients were closed at each lifecycle stage Nest runs. */
@Injectable()
class StageProbe implements OnModuleDestroy, BeforeApplicationShutdown {
  readonly closedAt: Record<string, number> = {}

  onModuleDestroy(): void {
    this.closedAt['destroy'] = closedCount()
  }

  beforeApplicationShutdown(): void {
    this.closedAt['beforeShutdown'] = closedCount()
  }
}

/** Number of clients that were asked to quit or disconnect so far. */
function closedCount(): number {
  return clients.filter((c) => c.quit.mock.calls.length > 0 || c.disconnect.mock.calls.length > 0)
    .length
}

describe('cache connections during application shutdown', () => {
  // Scenario: the application receives a shutdown signal while requests are still being served.
  // Rule: the main and the subscriber connection stay open through the destroy and
  // before-shutdown hooks and are closed only afterwards, when the server has stopped.
  it('closes the main and the subscriber connection only in the application-shutdown hook', async () => {
    const app = await Test.createTestingModule({
      imports: [BymaxCacheModule.forRoot({ connection: { host: 'h' } })],
      providers: [StageProbe]
    }).compile()
    await app.init()
    await app.get(PubSubService).subscribe('events', () => undefined)
    expect(app.get(CacheService)).toBeDefined()
    expect(clients).toHaveLength(2)

    await app.close()

    expect(app.get(StageProbe).closedAt).toEqual({ destroy: 0, beforeShutdown: 0 })
    expect(closedCount()).toBe(2)
    expect(clients.every((c) => c.quit.mock.calls.length === 1)).toBe(true)
  })
})
