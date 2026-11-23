/**
 * The module object handed to `jest.mock('ioredis', ...)` resolves a default import to the fake client.
 *
 * Layer: server. Compiled code reads `default` only when the module says it is an ES module, through
 * `__esModule`; a module without the flag hands the whole object to a default import instead.
 */
import { ioredisModule } from './ioredis-module'

describe('ioredisModule', () => {
  const redis = function FakeRedis(): void {
    // a stand-in client
  }
  const cluster = function FakeCluster(): void {
    // a stand-in cluster
  }

  // Scenario: the object is read the way compiled `import Redis from 'ioredis'` reads a CommonJS module.
  // Rule: it declares itself an ES module, so the default import is the fake client, not the object.
  it('declares itself an ES module whose default is the client', () => {
    const module_ = ioredisModule(redis, cluster) as Record<string, unknown>

    expect(module_['__esModule']).toBe(true)
    expect(module_['default']).toBe(redis)
    expect(module_['Redis']).toBe(redis)
    expect(module_['Cluster']).toBe(cluster)
  })

  // Scenario: the real connectors are asked for by name.
  // Rule: they are the library's own classes, which the connectors of this package extend.
  it('carries the real AbstractConnector and SentinelConnector', () => {
    const actual = jest.requireActual<typeof import('ioredis')>('ioredis')
    const module_ = ioredisModule(redis, cluster) as Record<string, unknown>

    expect(module_['AbstractConnector']).toBe(actual.AbstractConnector)
    expect(module_['SentinelConnector']).toBe(actual.SentinelConnector)
  })
})
