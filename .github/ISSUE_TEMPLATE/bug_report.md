---
name: Bug report
about: Report a reproducible bug in @bymax-one/nest-cache
title: 'bug: '
labels: bug
---

## Summary

<!-- One-sentence description of the bug. -->

## Reproduction

<!-- Minimal steps or a repo link. Include the subpath you were using (server / shared). -->

1.
2.
3.

## Expected vs actual

- **Expected:**
- **Actual:**

## Environment

- Package version: `@bymax-one/nest-cache@`
- Node.js version: `node -v` →
- Package manager: pnpm / npm / yarn
- NestJS / ioredis version:
- Redis topology: standalone / sentinel / cluster?
- OS:

## Additional context

<!-- Relevant module configuration and error output (redact secrets/keys before pasting). -->

## Sensitive-data impact

- [ ] This bug exposes cached data across namespaces / tenants, or leaks secrets / PII through error `details` or event payloads.

> If **Yes**, please **STOP** and email `support@bymax.one` instead of opening a public issue — a cross-tenant leak or secret exposure is a security report, not a public bug.
