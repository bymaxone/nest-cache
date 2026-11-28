# Security Policy

`@bymax-one/nest-cache` is a Redis cache library for NestJS. Because it sits on
the data path of applications that may cache sensitive data, we take security
reports seriously.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report privately through GitHub's **[Private vulnerability reporting](https://github.com/bymaxone/nest-cache/security/advisories/new)**
(Security tab → "Report a vulnerability"), or email **support@bymax.one** with
the details and a proof of concept if possible.

### Response timeline

| Stage                                  | Target          |
| -------------------------------------- | --------------- |
| Acknowledgement                        | within 72 hours |
| Initial triage & severity assessment   | within 7 days   |
| Fix or mitigation for confirmed issues | within 90 days  |

We will keep you informed throughout and credit you in the advisory unless you
prefer to remain anonymous.

## In Scope

- **Cache poisoning** — accepting hostile data that later deserializes into an
  unexpected type or structure.
- **Key injection** — bypassing the namespace via raw keys so one tenant reads
  or overwrites another's entries.
- **Unsafe deserialization** — a malformed payload causing a crash, prototype
  pollution, or code execution instead of a clean `DESERIALIZATION_FAILED`.
- **Lua script injection** — untrusted input reaching `EVAL`/script bodies.
- **Destructive operations in production** — `flushNamespace` (or similar)
  running without the explicit production guard.
- **Sensitive data exposure** — secrets/PII leaking through error `details`,
  logs, or event payloads.
- Supply-chain integrity of the published package (tampered `dist`, unexpected
  dependencies).

## Out of Scope

- Vulnerabilities in Redis itself, in `ioredis`, or in NestJS — report those
  upstream.
- Misconfiguration in the consuming application (e.g. an unauthenticated Redis
  instance, caching plaintext secrets the app should have encrypted first).
- Denial of service from unbounded usage patterns the consumer controls.

## Threat model: same-process code

Code that runs in the same Node.js process as the library is trusted, as it is in Node itself.
It can replace `Promise`, plant a `then` on a shared prototype, or edit this package's files, and
no library running in that process can stop all of it. The guards against replaced Promise
built-ins (`assertPromiseIntrinsics`, `settleWithin`, `pinned`, and the socket check of the
connectors) are best-effort hardening that catches accidents and common planting, not a security
boundary. Known cases they do not cover: a `then` planted on `EventEmitter` or `Stream` during a
connect and removed again before the socket check, a throwing `stream.destroy` in a refusal, a replaced `Promise.prototype.then` reached
through ioredis, the stream accessor, a live `net.createConnection` in the CommonJS build, and a
self-referencing Proxy given to `isNativePromise`. A report of one of these is a known limit, not a
vulnerability; a report of a way for untrusted input (a key, a value, a Redis reply) to cause
one is.

A key planted on `Object.prototype` is refused before each command the library sends, except
`quit` and `disconnect`, which teardown needs (`cache.invalid_options`, with a count and never a
key or a value). These cases stay outside that check, and each is a known limit:

- A command already in flight: a key planted after the command was sent and before its reply
  arrives is read by ioredis's reply handler, which the library cannot check from. Freeze
  `Object.prototype` before the library is imported to close it: import a module that runs the
  freeze ahead of the library, or use `node --import`. A freeze that runs after the import is
  read as a change to the standard keys, and the cache then refuses with `cache.invalid_options`.
- The later pages of `cache.scan` and `flushNamespace`: ioredis's scan stream sends the `SCAN`
  commands itself, so a key planted during an iteration does not stop them. `flushNamespace` is
  refused at its next `UNLINK`, and completes if no later page holds a key. `cache.scan` is not
  refused, and a planted key that the driver reads while it handles a reply (one named `scan`,
  for example) ends the process, as for a command in flight.
- A pipeline or transaction opened before the plant and executed after it: `exec()` runs the
  queued commands without a library frame, so the plant ends the process with an uncaught
  exception, as it does for a command in flight. `getClient()` returns the raw client, which
  is not guarded at all.
- `unsubscribe` and `punsubscribe` under a plant: the call is refused like any other command, so
  the handler is detached locally and the server-side subscription stays, so its messages find no
  listener (a later `subscribe` to the same channel sends `SUBSCRIBE` again).

## Supported Versions

Only the latest minor (currently `1.2.x`) receives security fixes. Earlier versions are not
supported: upgrade to the latest minor.

## Security Practices

- `dependencies: {}` — zero direct runtime dependencies; everything is a peer
  dependency, minimizing supply-chain surface.
- Published with npm **provenance** (OIDC trusted publishing) — no long-lived
  tokens.
- Error `details` must never include secret values: a stored value that fails to
  decode is reported by a fixed text and its length, never by any part of its content.
- CodeQL, OpenSSF Scorecard and OSV-Scanner on the full lockfile run on `main` and on a
  weekly schedule. Pull requests are also checked by CodeQL, OSV-Scanner and a
  dependency-review job that fails on high severity. A weekly job audits the declared
  peer ranges against published advisories.
- Dependency advisories: a vulnerable transitive development dependency is fixed by a
  version floor in the `overrides` of `pnpm-workspace.yaml`. An advisory with no patched
  release is suppressed only through a dated, reasoned entry in `osv-scanner.toml`, which
  expires. None of these dependencies ships: the package publishes with `dependencies: {}`.
