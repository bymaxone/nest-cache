/**
 * Unit tests for {@link refuseOption}.
 *
 * Layer: server. What the exception it throws carries, and that none of the value's content does.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { CLUSTER_OPTION_KEYS, REDIS_OPTION_KEYS } from '../connection/copy-cluster-options'
import { STANDALONE_KEYS, TLS_KEYS } from './snapshot-blocks'
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

/**
 * The options that are not credentials, from the driver, the `tls` object and the standalone block. An
 * option added later is in none of the lists, so the spec below fails until it is classified. The key
 * material options are here because their refusals print a count, never the value.
 */
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
  'useSRVRecords',
  'ALPNCallback',
  'ALPNProtocols',
  'SNICallback',
  'allowPartialTrustChain',
  'ca',
  'cert',
  'certificateCompression',
  'checkServerIdentity',
  'ciphers',
  'clientCertEngine',
  'crl',
  'dhparam',
  'ecdhCurve',
  'enableTrace',
  'honorCipherOrder',
  'host',
  'key',
  'lookup',
  'maxVersion',
  'minDHSize',
  'minVersion',
  'path',
  'pfx',
  'port',
  'privateKeyEngine',
  'privateKeyIdentifier',
  'profile',
  'pskCallback',
  'rejectUnauthorized',
  'requestCert',
  'requestOCSP',
  'secureContext',
  'secureOptions',
  'secureProtocol',
  'servername',
  'session',
  'sessionIdContext',
  'sessionTimeout',
  'sigalgs',
  'socket',
  'ticketKeys',
  'timeout',
  'lazyConnect',
  'connectTimeout',
  'commandTimeout',
  'maxRetriesPerRequest',
  'enableReadyCheck',
  'enableOfflineQueue',
  'retryStrategy',
  'reconnectOnError',
  'keepAlive',
  'noDelay',
  'family',
  'db',
  'host',
  'port',
  'tls'
]

/** The options that hold a credential: a number given to one is reported as the type only. */
const CREDENTIALS = [
  'passphrase',
  'password',
  'sentinelPassword',
  'sentinelUsername',
  'url',
  'username'
]

describe('the options that hold a credential', () => {
  const names = [
    ...new Set([
      ...Object.keys(CLUSTER_OPTION_KEYS),
      ...Object.keys(REDIS_OPTION_KEYS),
      ...Object.keys(TLS_KEYS),
      ...Object.keys(STANDALONE_KEYS)
    ])
  ]
  const reported = (name: string): unknown =>
    thrownBy(() => refuseOption(name, 'r', 12345)).details?.['received']

  // Scenario: every option of the driver, the tls object and the standalone block is classified.
  // Rule: an option added later that is in neither list fails here until it is classified, so a
  // credential named in a way the check does not recognise is never printed by accident.
  it('leave no option unclassified', () => {
    expect(
      names.filter((name) => !NOT_CREDENTIALS.includes(name) && !CREDENTIALS.includes(name))
    ).toEqual([])
  })

  it.each(CREDENTIALS)('report a number given as %s as a number', (name) => {
    expect(reported(name)).toBe('a number')
  })

  it.each(names.filter((name) => NOT_CREDENTIALS.includes(name)))(
    'print a number given as %s',
    (name) => {
      expect(reported(name)).toBe(12345)
    }
  )

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
