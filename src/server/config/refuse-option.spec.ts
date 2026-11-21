/**
 * Unit tests for {@link refuseOption}.
 *
 * Layer: server. What the exception it throws carries, and that none of the value's content does.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { CLUSTER_OPTION_KEYS, REDIS_OPTION_KEYS } from '../connection/copy-cluster-options'
import { refuseOption } from './refuse-option'

function thrownBy(fn: () => never): CacheException {
  try {
    fn()
  } catch (error) {
    return error as CacheException
  }
  throw new Error('refuseOption did not throw')
}

describe('refuseOption', () => {
  // Scenario: a refusal with a bound and a reason for it.
  // Rule: INVALID_OPTIONS whose details are reason, option, received and the bounds, in that content.
  it('throws INVALID_OPTIONS with reason, option, received and the bounds', () => {
    const error = thrownBy(() => refuseOption('o', 'r', 'SENTINEL-secret', { min: 1, why: 'w' }))

    expect(error).toBeInstanceOf(CacheException)
    expect(error.code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
    expect(error.details).toEqual({
      reason: 'o r',
      option: 'o',
      received: 'a string',
      min: 1,
      why: 'w'
    })
  })

  // Scenario: a refusal with no bounds.
  // Rule: the details are reason, option and received only.
  it('adds nothing when there are no bounds', () => {
    expect(thrownBy(() => refuseOption('o', 'r', 7)).details).toEqual({
      reason: 'o r',
      option: 'o',
      received: 7
    })
  })

  // Scenario: the refused option holds a credential, named by its option name, and a number was given.
  // Rule: the type is reported, not the number; an option that holds a quantity still reports it.
  it.each([
    'connection.password',
    'cluster.options.redisOptions.username',
    'sentinel.sentinelPassword',
    'tls.key[0].passphrase'
  ])('reports a number given as %s as a number', (option) => {
    expect(thrownBy(() => refuseOption(option, 'r', 12345)).details).toMatchObject({
      received: 'a number'
    })
  })

  it('reports a number given as an option that holds a quantity as itself', () => {
    expect(thrownBy(() => refuseOption('connection.port', 'r', 70000)).details).toMatchObject({
      received: 70000
    })
  })
})

/** The driver options that are not credentials. A driver option added later is not in this list. */
const NOT_CREDENTIALS = [
  'Connector',
  'autoPipeliningIgnoredCommands',
  'autoResendUnfulfilledCommands',
  'autoResubscribe',
  'blockingTimeout',
  'blockingTimeoutGrace',
  'clientInfoTag',
  'clusterNodeRetryStrategy',
  'clusterRetryStrategy',
  'commandQueue',
  'commandTimeout',
  'connectTimeout',
  'connectionName',
  'db',
  'disableClientInfo',
  'disconnectTimeout',
  'dnsLookup',
  'enableAutoPipelining',
  'enableOfflineQueue',
  'enableReadyCheck',
  'enableTLSForSentinelMode',
  'failoverDetector',
  'family',
  'himportFieldsets',
  'keepAlive',
  'keyPrefix',
  'lazyConnect',
  'maxLoadingRetryTime',
  'maxRedirections',
  'maxRetriesPerRequest',
  'monitor',
  'name',
  'natMap',
  'noDelay',
  'offlineQueue',
  'preferredSlaves',
  'protocol',
  'reconnectOnError',
  'redisOptions',
  'replyMapping',
  'resolveSrv',
  'retryDelayOnClusterDown',
  'retryDelayOnFailover',
  'retryDelayOnMoved',
  'retryDelayOnTryAgain',
  'role',
  'scaleReads',
  'scripts',
  'sentinelCommandTimeout',
  'sentinelMaxConnections',
  'sentinelReconnectStrategy',
  'sentinelRetryStrategy',
  'sentinelTLS',
  'shardedSubscribers',
  'showFriendlyErrorStack',
  'slotsRefreshInterval',
  'slotsRefreshTimeout',
  'socketTimeout',
  'stringNumbers',
  'tls',
  'updateSentinels',
  'useSRVRecords'
]

describe('the options that hold a credential', () => {
  const driver = [
    ...new Set([...Object.keys(CLUSTER_OPTION_KEYS), ...Object.keys(REDIS_OPTION_KEYS)])
  ]
  const credentials = driver.filter((name) => !NOT_CREDENTIALS.includes(name))

  // Scenario: every driver option is either a known non-credential or reported as a credential.
  // Rule: an option the driver adds that is neither fails here until it is classified, so a credential
  // named in a way the check does not recognise is never printed by accident.
  it('are exactly the driver options that are not on the list of non-credentials', () => {
    expect(credentials.sort()).toEqual([
      'password',
      'sentinelPassword',
      'sentinelUsername',
      'username'
    ])
  })

  it.each([
    'password',
    'sentinelPassword',
    'sentinelUsername',
    'username',
    'authToken',
    'apiSecret'
  ])('report a number given as %s as a number', (name) => {
    expect(
      thrownBy(() => refuseOption(`cluster.options.redisOptions.${name}`, 'r', 12345)).details
    ).toMatchObject({ received: 'a number' })
  })
})
