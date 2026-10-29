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
