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

While the library is pre-1.0 (`0.x`), the latest `0.x` minor receives security
fixes. Backports to older minors are considered case by case.

## Security Practices

- `dependencies: {}` — zero direct runtime dependencies; everything is a peer
  dependency, minimizing supply-chain surface.
- Published with npm **provenance** (OIDC trusted publishing) — no long-lived
  tokens.
- Error `details` must never include secret values; serialized previews are
  truncated to avoid leaking whole payloads.
- Continuous scanning via CodeQL and OpenSSF Scorecard on every push.
