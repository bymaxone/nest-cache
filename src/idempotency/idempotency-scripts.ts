/**
 * Lua bodies of the idempotency store. Each script touches exactly one key, so it routes to one
 * slot in Cluster without a hash tag, and each runs atomically on the primary: `EVAL` and `EVALSHA`
 * are write commands, which ioredis never sends to a replica.
 *
 * A claim is a hash: `s` state (`p` in progress, `c` completed), `f` fingerprint, `t` the token that
 * holds the claim (dropped on completion), `st` status, `h` headers as JSON, `b` the body. No input
 * reaches a script body; every value arrives as `ARGV`. The lease and ttl are validated before the
 * call, so the `EXPIRE` that follows a write cannot fail.
 *
 * Replies: `begin` answers `{'c'}` (claimed), `{'h', pttl, s, f, t, st, h, b}` (held) or `{'x'}`
 * (a key that is not a hash, or a hash with extra fields); `complete` and `release` answer `1`
 * (done), `0` (not the caller's) or `-1` (a key that is not a hash).
 */

/** Registered name of the claim-or-report script. */
export const BEGIN_SCRIPT = 'bymax-idempotency-begin'

/** Registered name of the complete-by-token script. */
export const COMPLETE_SCRIPT = 'bymax-idempotency-complete'

/** Registered name of the release-by-token script. */
export const RELEASE_SCRIPT = 'bymax-idempotency-release'

/** `KEYS[1]`; `ARGV` = fingerprint, token, lease seconds. */
export const BEGIN_LUA = `
local kind = redis.call('TYPE', KEYS[1])['ok']
if kind == 'none' then
  redis.call('HSET', KEYS[1], 's', 'p', 'f', ARGV[1], 't', ARGV[2])
  redis.call('EXPIRE', KEYS[1], ARGV[3])
  return {'c'}
end
if kind ~= 'hash' or redis.call('HLEN', KEYS[1]) > 6 then
  return {'x'}
end
local f = redis.call('HMGET', KEYS[1], 's', 'f', 't', 'st', 'h', 'b')
return {'h', redis.call('PTTL', KEYS[1]), f[1] or false, f[2] or false, f[3] or false, f[4] or false, f[5] or false, f[6] or false}
`

/** `KEYS[1]`; `ARGV` = token, status, headers JSON, ttl seconds, then the body when there is one. */
export const COMPLETE_LUA = `
local kind = redis.call('TYPE', KEYS[1])['ok']
if kind == 'none' then return 0 end
if kind ~= 'hash' then return -1 end
local held = redis.call('HMGET', KEYS[1], 's', 't')
if held[1] ~= 'p' or held[2] ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 's', 'c', 'st', ARGV[2], 'h', ARGV[3])
if #ARGV > 4 then redis.call('HSET', KEYS[1], 'b', ARGV[5]) end
redis.call('HDEL', KEYS[1], 't')
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 1
`

/** `KEYS[1]`; `ARGV` = token. */
export const RELEASE_LUA = `
local kind = redis.call('TYPE', KEYS[1])['ok']
if kind == 'none' then return 0 end
if kind ~= 'hash' then return -1 end
local held = redis.call('HMGET', KEYS[1], 's', 't')
if held[1] ~= 'p' or held[2] ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
return 1
`
