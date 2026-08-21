/**
 * Defaults for the administration surface.
 *
 * Layer: admin. Each value is a threshold a deployment may override; they live
 * together so a consumer reading one can see what else is tunable.
 */

/**
 * Round trip above which the cache is answering but not well.
 *
 * A round number rather than a measured percentile, and deliberately so: this is
 * the threshold at which a surface changes what it reports, not a service-level
 * objective. A cache taking this long has stopped being the thing that makes
 * requests fast.
 */
export const DEFAULT_DEGRADED_ABOVE_MS = 250

/**
 * How long a health probe waits before reporting the cache down.
 *
 * Without this, a `PING` against a wedged connection never settles and a health
 * route hangs instead of answering — the failure mode a health route exists to
 * report becomes the failure mode it exhibits.
 */
export const DEFAULT_PROBE_TIMEOUT_MS = 2_000

/**
 * Most keys a single listing reads before reporting the page incomplete.
 *
 * A cap rather than a full scan: an administration surface asks about keyspaces
 * whose size is exactly what it does not know yet.
 */
export const DEFAULT_SCAN_LIMIT = 500

/**
 * Most commands one pipeline flush sends.
 *
 * Bounds the BATCH, in commands, rather than the key count — that is the
 * resource actually spent. Redis is single-threaded, so a pipeline converts a
 * network cost into a server-blocking one: describing N keys is two or three
 * commands each, and sending them as one flush blocks every other client for
 * the whole burst — on a server someone is inspecting precisely because it is
 * unwell. Pipelining is the aggravating factor here, not the mitigation.
 *
 * Every batch chunks to this size regardless of how many keys the page allows,
 * so a permitted maximum arrives as several small blocks rather than one large
 * one.
 */
export const DEFAULT_COMMAND_BATCH_LIMIT = 100

/**
 * Most members or hash fields one value reveal returns.
 *
 * A reveal is a debugging read, not an export. Returning a million-member set
 * would block the server assembling it and hand a surface a payload it cannot
 * draw; the truncation is reported so nobody mistakes the page for the whole.
 */
export const DEFAULT_REVEAL_LIMIT = 200

/**
 * Most characters one revealed string value carries.
 *
 * Same reasoning as {@link DEFAULT_REVEAL_LIMIT}: a cached HTML document or a
 * serialized blob is measured in megabytes, and a surface asking "what is in
 * this key" does not need all of it to answer the question.
 */
export const DEFAULT_REVEAL_STRING_LIMIT = 4096
