---
applyTo: '**/*.spec.ts,**/*.e2e.spec.ts'
---

# Testing standards

## Coverage gate

`pnpm test:cov:all` enforces **100% statements, branches, functions, and lines**. Any PR that drops coverage below 100% on a touched source file must not be approved — it is a hard pre-publish gate, not a target.

## Mutation testing threshold

Stryker `high: 99, low: 95, break: 95` — the break gate (95%) blocks a release; 99% is the aspirational target. `ignoreStatic: false` (exposes module-level constant mutants). Flag tests that use generic matchers (`toBeDefined()`, `toBeTruthy()`) where a value assertion is possible — they survive Stryker mutants.

## Test structure and naming

```
describe('ClassName')           →  class under test
  describe('#methodName()')     →  instance method (use . for static)
    it('should <outcome> when <condition>')
```

Every `it` must state the expected behaviour. Avoid `it('works')` or `it('returns value')`.

## Scope: public API only

Test through exported public interfaces only. Never access private class members or unexported internals. If behaviour is only verifiable through a private member, the design needs refactoring.

## Mutation-aware assertion patterns (required to kill Stryker mutants)

**1. Assert the value, not just existence:**

```typescript
// ❌ expect(result).toBeDefined()  — survives a value mutation
// ✅ expect(result.error.code).toBe('cache.invalid_key')
```

**2. Test BOTH sides of every `||` / `&&`:**

```typescript
// Source: if (mode === 'cluster' && !nodes) — add a test with only one side true
// to kill the && → || mutation
```

**3. Assert error code AND status independently:**

```typescript
expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST) // kills the status mutant
const body = ex.getResponse() as { error: { code: string } }
expect(body.error.code).toBe('cache.invalid_key') // kills the code mutant
```

**4. Cover the acceptance path of every filter/predicate:**

```typescript
// ❌ only testing rejection lets the ArrowFunction `() => undefined` mutant survive
// ✅ also test the success path (e.g. a valid namespaced key builds correctly)
```

## Stryker disable comments

Equivalent mutants only: `// Stryker disable next-line <Mutator>: <reason why the mutant is equivalent>`. Minimize them; never disable a mutant a test could kill.

## Error assertions

Assert the specific `CACHE_ERROR_CODES` value and the structured body — not just that an error was thrown:

```typescript
const ex = new CacheException(CACHE_ERROR_CODES.INVALID_KEY)
expect((ex.getResponse() as { error: { code: string } }).error.code).toBe('cache.invalid_key')
```

## NestJS integration tests

Use `@nestjs/testing → Test.createTestingModule(...)`. Override only external I/O — the Redis client via `ioredis-mock`. Keep all DI wiring real; do not stub internal services.

## E2E tests (`test/e2e/`)

Real module bootstrap via `@nestjs/testing` with `ioredis-mock` (or a disposable Redis). Validate: connection lifecycle (`OnModuleInit` / `OnModuleDestroy`), key namespacing / isolation, Pub/Sub round-trip, and the Lua `EVALSHA` → `NOSCRIPT` fallback.

## Mocking Redis

- Use `ioredis-mock` — never a real connection in unit tests.
- Test both connection event paths (`connect` / `ready` / `error` / `close` / `reconnecting` / `end`) propagated to `events.onEvent`.
- Restore all mocks in `afterEach` / `afterAll` — never leave module-level mocks bleeding across files.
