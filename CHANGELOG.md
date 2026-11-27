# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Versioning is **not** strict [SemVer](https://semver.org/spec/v2.0.0.html) while this API is pre-stable: breaking changes ship in minor and patch releases by explicit `@bymax-one` policy, so a version number carries no compatibility information. The **Apply to a consumer** note, on the entries that carry one, is the compatibility contract — read it, not the number.

## [Unreleased]

## [1.2.41] - 2026-11-27

### Changed

- Error cause hygiene. An error from the Redis driver is now rewritten before it leaves the library: its `command` property is removed, and of a server reply only the reply code is kept, so its message reads `OOM (server error text withheld)` (a reply that does not start with a code word in capitals reads `ERR (server error text withheld)`). This covers what a library service rejects with, the `cause` of a `CacheException`, and the `error` event of `events.onEvent` and `./observability`. The error object and its class are the same. What a command on a raw client from `getClient()` rejects with, the results of `pipeline().exec()` and a `reconnectOnError` of your own receive the driver's error as it is.

  **Apply to a consumer:** code that matched the text of a server error now sees the reply code alone: match on the code (`error.message.startsWith('WRONGTYPE ')`, on `cause` under a `CacheException`). A script that signals an outcome with `redis.error_reply` should return a value instead, or put the outcome in the code word.

## [1.2.40] - 2026-11-24

### Security

- A key planted on `Object.prototype` after a client connected no longer reaches ioredis's command path. ioredis keeps its command flag tables and reply transformers in plain objects, so a planted `get`, `set` or `ttl` is found for every command of that name: the call fails with `transformer is not a function` and the reply handler then throws from the socket event, which ends the process. `guardClient` now runs the guard before every command, and before a transaction or pipeline is opened, and refuses with `cache.invalid_options` and a count, never a key or a value. Teardown and listener registration are exempt, so shutdown works under pollution.
- Known limit: a key planted after a command was sent and before its reply arrives is read by ioredis's reply handler, which has no library frame to check from; freeze `Object.prototype` early (`Object.freeze(Object.prototype)` at startup) to close it.

  **Apply to a derived backend:** a backend that wraps its own client with `guardClient` now has its commands refused while `Object.prototype` holds a key it does not hold by default; one that relied on the guard being absent at command time must not plant keys there.

## [1.2.39] - 2026-11-24

### Security

These changes harden the library against code in the same process that replaces or plants Promise built-ins. Same-process code is trusted, as in Node, so the guards are best-effort and not a security boundary; see "Threat model: same-process code" in `SECURITY.md`.

- A verdict of the library is no longer read from `Promise.race`, `Promise.all`, a `.catch` lookup, a `then` call on a promise the library started, or a promise constructor that was replaced after the library loaded. Code that replaced those built-ins, or planted a `then` on `Object.prototype`, `Array.prototype` or `Function.prototype`, could make a failed `QUIT` read as a clean close, a rejected command read as a reply, a failed `PING` read as `PONG`, a failed script load read as loaded, or a client that never became ready read as ready. Nine sites are covered: the `closeClient` race and its timeout, the command guard's rejection mapping and its `result instanceof Promise` test (a replaced global `Promise` skipped the error mapping), the `EXEC` rejection mapping, the connection manager's readiness wait, the script manager's bootstrap load, the Pub/Sub delivery chain (decode, handler, failure report), and the handler gate. The admin status probe and the observability helpers that raced or collected promises now use the same helpers. Affected: 1.2.38, where each site was reproduced; earlier releases were not re-measured.
- The same holds for the hops a public method returns through. An `async` method that returns a promise reads that promise's `then`, so a `then` replaced before the call and restored after it forged `isHealthy` (a rejected `PING` read as `true`), `setNx` (a refused `NX` read as `true`) and the admin health verdict (up while Redis was down); every library method now returns `await promise`, which reads only the constructor, and a lint rule (`@typescript-eslint/return-await: always`) keeps it that way. The operation tracker reports to `onOperation` before it returns the result, and a `then` planted by that hook was read when an object was returned: it now checks again after the hook and before the return, and refuses. A `Symbol.species` that throws is no longer read by the library: a rejection is watched with a native `await` of a promise that holds its own constructor, so the rejection is neither left unhandled nor reported as the raw trap error.
- Each decision awaits through helpers that check, synchronously and immediately before the `await`, that the promise constructor is the intrinsic one and that no `then` is planted on the prototypes a resolution reads; they settle through an object without a prototype and watch every started promise before the first await. A refusal fails closed: `closeClient` still disconnects and reports a forced close, and the guarded client rejects the command with `INVALID_OPTIONS` (count only). The promise the guarded client hands back carries its own `constructor`, defined non-writable and non-configurable; a promise that cannot take it (frozen or sealed) is refused with `INVALID_OPTIONS` and never reported as pinned.

- A host call that planted a self-restoring `constructor` and `then` on `Promise.prototype` and returned its promise could still forge a verdict: the checks before the call and after the await both saw a clean prototype, and the accessors answered the one `await` that read them (a rejected `PING` read as `true`, a refused `NX` as `true`, a failed admin probe as up). The library now pins a promise (`pinned`) so that it carries its own `constructor` before it is awaited, and the `await` does not read `Promise.prototype.constructor` or the `then` behind it.
- The intrinsic `Promise` is no longer taken from the global as it stands at load: `NativePromise` is the constructor of the prototype of an `async` function's promise, so an application that replaced the global `Promise` before the import (a wrapper, a polyfill, a subclass) still loads and the library keeps the intrinsic, not the host's. The library refuses to load, as `INVALID_OPTIONS`, only when that constructor is not a function whose `prototype` is that prototype.
- `scan` and `flushNamespace` read the scan stream with a `for await`, which awaits every step of the stream's iterator without a pin or a check, so a host iterator, or a plant on `Promise.prototype`, could answer for a step and hand `UNLINK` a chunk of keys outside the namespace. Both now advance the iterator one step at a time through a pinned, checked `await`, and `scan` no longer delegates with `yield*`; the lint rejects a `for await` in the sources.
- `awaitAll`, which replaced `Promise.all` where the library awaits several promises, awaited its inputs in order, so an input that never settled hid the rejection of a later one (a hanging observer suppressed the `CACHE_HOOK_FAILED` of the next). It now settles as soon as any input rejects, as `Promise.all` did, and still handles every input's rejection, including one that arrives after the aggregate settled.
- `Promise[Symbol.species]` is part of the baseline the library keeps. Every `.then` call, the library's or a dependency's, reads it, so a species accessor replaced after the load and left in place made each derived promise a promise of the host's constructor. The library records the `get` of the accessor when it loads (it refuses to load, as `INVALID_OPTIONS`, when the species is not an own accessor), reads the live descriptor by its own fields only, so a `get` planted on `Object.prototype` is never taken for the accessor's, and counts a replaced accessor with the other defects `assertPromiseIntrinsics` refuses.
- The socket a connector opens (the standalone and cluster connector, and the sentinel connector) is checked for a `then` anywhere on its prototype chain before it is handed to ioredis. Returning it from an `async` function, or resolving a promise with it, reads `then` along the whole chain, so a `then` planted on `Stream.prototype` or `EventEmitter.prototype` while the connect ran made the host's function answer for the connect. A Proxy anywhere on the chain counts the same, because it answers `then` through its `get` trap, which an own-property check does not consult; the check stops at a Proxy and does not read through it. A socket that carries one is destroyed and the connect is refused as `INVALID_OPTIONS`.

  **Apply to a derived backend:** `./` now exports `settleWithin`, `awaitAll`, `absorbCall`, `onRejection` and `pinned`, and the type `Settlement`. A backend that derives from the exports gains them and nothing is removed; a method of its own that returns a library promise should `return await` it. A wrapped `then` on `Promise.prototype` is tolerated; only a replaced constructor or a `then` planted on `Object.prototype`, `Array.prototype` or `Function.prototype` is refused, and a global `Promise` replaced before the library loads is refused at load.

### Known limits

- Same-process code that is hostile on purpose is outside the guards, which are best-effort; the known cases that are not fixed are listed in `SECURITY.md`, section "Threat model: same-process code".
- Code running concurrently that plants a `then` and removes it again between the entry check and the work's own resolution cannot be seen afterwards. This includes a plant that fires on the work's own resolution, which runs before any library code.
- A caller's own `await` of the promise a public method returns reads that promise's `constructor` once, when the method first suspends; the library cannot pin the promise of an `async` method it returns, so a constructor replaced at that moment is the caller's to guard.
- A plant made inside ioredis's own synchronous command path, before the promise of a public method is returned, is not covered: the library calls no replaceable global between a public method's entry and its first suspension, and what the driver does there is the dependency's.
- A replacement made before the library is imported is out of scope for the guards: a replaced global `Promise` does not matter, since the library reads the intrinsic from the prototype of an `async` function's promise, but code that replaced the constructor of that prototype and its `prototype` together, consistently, before the load, is not detectable.
- A dependency that reads a static internally (for example `prom-client` collecting a registry with `Promise.all`) is not covered: the entry covers only the library's own code.
- A promise that is not a native one (a thenable of the host's own, or a promise of another realm) is passed through unchanged where the library awaits a client's result (`pinned` in `src/server/utils/settle.ts` and the `isNativePromise` check of `guardClient` in `src/server/utils/guard-client.ts`); its `then` is host code and the library does not pin or inspect it.
- A value the host's serializer returns is handed back as the host built it, so a `then` on its own prototype chain is host-authored; the library does not inspect the chain of what a serializer returns.

## [1.2.38] - 2026-11-23

### Fixed

- An option the host left out is no longer taken from `Object.prototype`. A property access on a plain object also finds what another part of the process planted there, so a planted `url` redirected the Redis connection, and a planted `namespace`, `scripts`, `serializer`, `tls`, key material or timer was read as the host's. A key now counts only when the host's object, or a prototype between it and a root, holds it; a root is recognised by its shape (no prototype, reached through the object) and never by a property it holds, so the root of another realm and a root whose `constructor` was overwritten are skipped too: an own key, a class getter, an object made over a prototype that has a prototype of its own, a proxy and an object from another realm are read as before, and a value found only on `Object.prototype` is not; a key held only by a prototype-less object that the host's object was made over (`Object.create(Object.create(null))`) cannot be told from a root and is not read either. Every plain object in the copies of the options, the `tls` key and pfx entries included, carries no prototype; a list is copied with the plain objects in it made prototype-less, and a `Buffer` and an object that is not plain are kept as they are. These copies and the structural rule protect the library's own reads of the options, while it resolves them, before any client or guard exists, and when it reads them later; what ioredis and Node read is the guard's concern, below.
- The `events` hooks (`onEvent`, `onOperation`, `onQueue`) are read once when the options are resolved, from the host's bag, and bound to it, so a hook planted on `Object.prototype` is never called. The provided `BYMAX_CACHE_EVENTS` value is that copy and no longer the host's own object; a hook the host put runs on the host's object as before.

  **Apply to a consumer:** nothing to change for options the host wrote on its own objects, classes or prototypes. A host that relied on a value planted on `Object.prototype` as a default for `url`, `namespace`, `scripts`, `serializer`, `events` or any other option, now gets the library default. A host that compared the injected `BYMAX_CACHE_EVENTS` value with its own events object by identity compares its hooks instead. The options objects the library hands to ioredis carry no prototype, one level deep, and hold an own key, `undefined`, for every option name the driver reads (`DRIVER_OPTION_NAMES`), and the connection block of a sentinel or cluster whose `connection` is omitted is read from a prototype-less object. ioredis merges the options it is given into an ordinary object of its own and reads names it was not given from it while the client lives (`socketTimeout` on every command, `tls` and `path` on a reconnect), so that merged object keeps the own keys: a key planted on `Object.prototype` after the client was built, enumerable or not, is not read as one of its options. A key planted before the client is built is another case: ioredis copies an enumerable one into any option left `undefined`, whatever the shape of the options, and the driver also reads names off objects it creates itself, through `this`, through an alias of `this` and through other objects, that those objects do not hold when built, and no list of those names can be shown complete, so the connection manager now refuses to be built, refuses to build a client, and refuses to open a socket (the first connect and every reconnect, through a connector of the library that every standalone client and every cluster node uses, and a guard on the connector of a sentinel client), with `INVALID_OPTIONS` (`Object.prototype holds keys the driver would read as its own`, with the count of the keys, never a key or a value) while `Object.prototype` holds any string key it does not hold by default. A process that extends `Object.prototype` does not start the cache. A symbol planted there counts as well, enumerable or not, except the one Jest keeps hidden on the prototype of its test realm, which is recognised by its registered key and only while it is not enumerable. The options the connector of the library hands to Node when a socket opens are held in an object without a prototype, so a `path`, `ca`, `cert` or `servername` planted after the client was built reaches neither a reconnect nor a TLS handshake. The guard and the paths it protects call the built-ins of the language through references captured when the library loads, and walk their tables with an index in objects without a prototype, so a built-in replaced after the library was imported does not blind them; one replaced before the import is out of reach. The built-ins the option reading calls (`BASELINE_BUILTINS` holds the list) are compared by identity with what they were when the library loaded, inside the same guard, which also runs at `forRoot` and in the factory of `forRootAsync` before the first option is read: a replaced one is refused with the same count-only error, under its own reason (built-ins replaced after the library loaded, apart from the one for keys), which is built from fields prepared when the library loads, so no replaced built-in changes its type. The global `Promise` is not compared, because tracing and monitoring agents wrap it after load on a healthy host; the library uses the `Promise` captured when it loads. Import the library after any polyfill or patch of the built-ins. A spy on a listed built-in replaces it (`jest.spyOn(JSON, 'stringify')`): restore it before the module is registered or a client connects. The accessors that `RegExp.prototype` offers (`flags`, `global`, `unicode`) are replaced with `Object.defineProperty`, as is any accessor planted on a prototype, and the comparison does not cover them. The guard does not look for keys planted on `Array.prototype`, `Function.prototype` or `Buffer`'s prototype. A standalone or sentinel client whose connect is refused ends (ioredis does not retry a connector that rejects), so the process has to be restarted once `Object.prototype` is clean. In sentinel mode a socket opened while a key was planted is destroyed before the client uses it. A standard name that was overwritten, redefined or deleted (`hasOwnProperty`, `toString`, `constructor`) counts as planted, as does any key beyond the standard ones, and so does a standard name that was already replaced when the library was imported (it is not the native function with its own name, or `__proto__` has no native getter and setter, or is present without them; a `__proto__` that is missing when the library loads is accepted, as `--disable-proto=delete` removes it, and one deleted afterwards counts): the refusal is the same at every use and nothing is thrown at import. The table of listeners of the socket the library opens has no prototype, because Node reads the listeners of an event with a property read, and a string planted under the name of any event after the guard ran would be called and throw in the event loop; the listeners of the socket keep working. The retries of a cluster client after a redirect or a dropped node go through a delay queue whose tables have no prototype and whose pushes carry a `timeout` and a `callback` of their own, because a string planted after the build under the name of a bucket or under `callback` would throw in a timer and end the process. The probe clients of a sentinel client, which ask the sentinels for the master and watch for a failover, use a connector of the library made for the sentinel the probe is for, which takes its host and port from that address and not from the options of the probe, and hold the own keys too, so a key planted while the connect waited reaches neither the socket of a probe nor the sentinel password, and a `path`, `host` or `port` planted only while the probe was built does not either. The connector refuses a connect while `Object.prototype` holds a key it does not hold by default at the call itself, before it reads an option, and again in the tick that opens the socket. A key planted after the client was built is still read by the objects the driver creates later: the options of a command (a `readOnly` sends a write to a replica when `scaleReads` is not `master`) and a pipeline. A host that gave its own `Connector` in `cluster.options.redisOptions` keeps it, and the guard of the connector does not run for it; standalone and sentinel clients take no connector from the host. No declaration changes.

- A `tls.key` or `tls.pfx` object entry that holds no bytes (only a passphrase, an empty object, a `Map`, a `Date`, or a proxy over a `KeyObject`, which cannot be recognised through the proxy) is refused as `INVALID_OPTIONS` naming the entry (`tls.key[0] has no pem`) when the options are resolved. It was held with undefined bytes, so Node refused it at connect, late and without the library's code in the message.
- A list inside a list of key material (`tls.ca`, `cert`, `key`, `pfx`, `crl`, `ticketKeys`, `session`, `dhparam`, `ALPNProtocols`) is refused as `INVALID_OPTIONS` naming the entry (`tls.key[0] must not be a list`).
- A `cluster.options.scaleReads` that is not `all`, `master`, `slave` or a function, and a `himportFieldsets` that is not a list, are refused as `INVALID_OPTIONS` naming the option, with the type of the value and no text of it (a number is reported as itself): the driver's own message printed the `scaleReads` value the host gave. `himportFieldsets` and `cluster.options.scripts` are copied once the options are resolved, like the other objects the driver reads, so nothing of the host's runs inside the driver's constructor; an option the driver still refuses when the cluster client is built ends as `INVALID_OPTIONS` (`the driver refused an option of the cluster`) with no `cause`, and what the constructor throws is dropped without being inspected.
- A hole or an `undefined` in `himportFieldsets`, or in the `fields` of an entry, is refused as `INVALID_OPTIONS` naming the position (`cluster.options.himportFieldsets[1] must not be empty` for an entry, `cluster.options.himportFieldsets[].fields[0] must not be empty` for a field) instead of being kept for the driver to skip; a `himportFieldsets` list or `fields` list of more than 1 000 entries and a `cluster.options.scripts` map of more than 1 000 scripts are refused naming the option and the bound, like the other lists.
- The bytes of a `tls.key` or `tls.pfx` object entry must be bytes or a string; `null`, a number, an object or a list there is refused as `INVALID_OPTIONS` (`tls.key[0].pem must be bytes or a string`).
- A script `name` or `lua` made only of control characters (`Cc`, U+0085 included), format characters (`Cf`), U+FFFC or U+2800 (braille blank) is refused as blank, like the other characters that print as nothing; a tab, a carriage return and a line feed are still blanks.
- A `SharedArrayBuffer`, given as key material or as session material, is copied into a `Buffer` of its own like an `ArrayBuffer`: another thread can write to one after boot.

  **Apply to a consumer:** a host that passed a key or pfx object entry without its `pem` or `buf`, or a proxy over a `KeyObject`, now gets `cache.invalid_options` at registration instead of a connect failure, as does a list inside a list of key material; a `scaleReads` that is not `all`, `master`, `slave` or a function, a `himportFieldsets` that is not a list and a key or pfx entry whose bytes are not bytes or a string are `cache.invalid_options` at registration, and a cluster option the driver still refuses is `cache.invalid_options` with a fixed reason and no `cause`, where it was the driver's own error. No declaration changes.

## [1.2.37] - 2026-11-21

### Fixed

- An object entry of `tls.key` or `tls.pfx` (`{ pem, passphrase }`, `{ buf, passphrase }`) is copied by name once the options are resolved: its bytes like the other key material and its passphrase, which must be a string; another key in it is refused as `INVALID_OPTIONS` naming the entry by position (`tls.key[0] has a key that is not pem or passphrase`). The entry stayed by reference, so a host that swapped its bytes after boot changed the identity the next reconnect presented. A `KeyObject` and a `secureContext` stay by reference; any other object, a class instance or one made over a prototype, is read by name and copied.
- `tls.ticketKeys`, `tls.session`, `tls.dhparam` and `tls.ALPNProtocols` are copied like the other key material: a buffer or a list the host changes after boot no longer reaches the next reconnect, and `ticketKeys` decides who can resume a session.
- A script given as an array, even with a `name` and a `lua` on it, and a `natMap` that is an array, a string or a number are refused as `INVALID_OPTIONS`. A script `name` or `lua` made only of blanks or invisible characters (the Unicode default-ignorable set: zero-width characters, joiners, word joiner, byte order mark, soft hyphen, direction marks, Hangul filler) is refused like an empty one, in `scripts` and in `register`.
- A refusal of an option that holds a credential (`password`, `username`, `sentinelPassword`, `url`, a `passphrase`) reports a number as the type only (`received: 'a number'`). It printed the number, so a numeric password given to the wrong option appeared in the error. A number in an option that holds a quantity is still printed as itself.

  **Apply to a consumer:** a host that passed a script as an array, a `natMap` that is not an object or a function, a key entry with a key other than `pem` and `passphrase`, a pfx entry with a key other than `buf` and `passphrase`, or a passphrase that is not a string, or a script text made only of characters that print as nothing, now gets `cache.invalid_options` when the options are resolved, or when `register` is called. A host that read a number from `details.received` of a credential option reads `'a number'`. A host that changes `tls.ticketKeys`, `tls.session`, `tls.dhparam`, `tls.ALPNProtocols` or a key or pfx object entry (a class instance included) after boot no longer reaches the next reconnect; set them before the module is registered. No declaration changes.

## [1.2.36] - 2026-11-21

### Fixed

- The key material of a `tls` object (`ca`, `cert`, `key`, `pfx`, `crl`) is copied once when the options are resolved. The driver merges the `tls` object into the connection options on every connect and reconnect, and the copy kept those lists and `Buffer`s by reference, so a host that pushed into a `ca` list, or overwrote a `Buffer`, after the module was registered changed the trust roots or the identity of the next reconnect. A list is now read once (the length first, then each index), and every view of bytes (a `Buffer`, a `Uint8Array`, a `DataView`) and every `ArrayBuffer`, in a list or given whole, is copied into a `Buffer` of its own. A list of more than 1 000 entries, or one whose length is not a count, is refused as `INVALID_OPTIONS` (`reason: 'tls.ca has too many entries'`, `'tls.ca has an invalid length'`). The same holds for the `tls` and the `sentinelTLS` of the cluster node options (`cluster.options.redisOptions`). An object entry of `key` or `pfx` (`{ pem, passphrase }`) and a `secureContext` stay by reference.

- An entry of `sentinel.sentinels` or `cluster.nodes` that is not an address (an array, a function, a boolean or `null`; a node may also be a `host:port` string or a port number) and a `natMap` entry that is not an object are refused as `INVALID_OPTIONS` naming the entry by position (`cluster.nodes[1] must be an address`). An array entry used to reach the driver as it was. A `natMap` of more than 1 000 entries is refused before it is copied (`reason: '<option> has too many entries'`). A `name` or `lua` of a script, in `scripts` and in `register`, made of blanks is refused like an empty one. A `null` `sentinelTLS` in the cluster node options is refused like a `null` `tls`, because it reaches the driver as no tls at all.

  **Apply to a consumer:** nothing changes for key material that is a string, a `Buffer` or a list of at most 1 000 of them. A host that relied on mutating a `ca` list or a `Buffer` after boot to change what the next reconnect trusts must register the module again. A host that passed a sentinel or node entry that is not an address, a `natMap` entry that is not an object, a script whose `name` or `lua` is made of blanks, or a `null` `sentinelTLS` now gets `cache.invalid_options` at registration. No declaration changes.

## [1.2.35] - 2026-11-21

### Fixed

- A `tls` that is a number, an array or a function is refused as `INVALID_OPTIONS` (`reason: 'connection.tls must be an object, a profile name or a boolean'`) when the options are resolved, in `connection.tls` and in `cluster.options.redisOptions.tls`; it used to fail at connect, far from the option. `true` and `false` stay accepted: `true` makes the driver speak tls with its defaults.
- The `sentinelTLS` of the cluster node options is copied once by name like `tls`, and held to the same two checks: a kind the driver cannot use and a profile it does not resolve are refused as `INVALID_OPTIONS`.
- `ScriptManagerService.register(name, lua)` refuses a `name` or a `lua` that is not a non-empty string as `INVALID_OPTIONS` (`register name must be a non-empty string`) before it registers, like an entry of `scripts`; a `lua` that was a number used to fail inside Redis at the first load.
- The administration ACL end-to-end spec waits for the first line the monitor connection echoes before it boots the app, so a line from the app's first command cannot reach a connection that has not switched to monitor mode, and the monitor's sibling connection neither connects nor sends a ready-check `INFO`, which the driver would echo into the feed in that window. A test-only change.

  **Apply to a consumer:** a host that passed a `tls` that is a number, an array or a function, or a `register` call with an empty or non-string name or source, now gets `cache.invalid_options` instead of a failure at connect or at the first load. `register` declares the same signature. No declaration changes.

## [1.2.34] - 2026-11-21

### Fixed

- A `tls.profile` the driver does not resolve is refused as `INVALID_OPTIONS` (`reason: 'connection.tls.profile is not a known tls profile'`, `allowed: 'RedisCloudFixed or RedisCloudFlexible'`) when the options are resolved, in `connection.tls` and in `cluster.options.redisOptions.tls`, whether the profile is an option of the `tls` object or the whole `tls` value. A number or an unknown name used to leave the connection without the pinned authority, and an object whose `toString` throws escaped raw from the driver.
- A script definition that is not an object with a non-empty string `name` and `lua`, and a `scripts` value that is neither unset nor an array, are refused as `INVALID_OPTIONS` naming the entry and the field (`scripts[1].lua`) when the options are resolved. A `lua` that is a number used to surface as a raw Redis error when the scripts were loaded, and an entry with no `name` was accepted.

  **Apply to a consumer:** a host that passed a `tls.profile` other than the two the driver knows, or a script definition without a string `name` and `lua`, now gets `cache.invalid_options` at registration instead of a connection without the pinned authority or a failure at boot. No declaration changes.

## [1.2.33] - 2026-11-21

### Fixed

- A `tls` object that is a class with prototype getters, a get-only proxy, or that holds an option as a non-enumerable or inherited property lost every option outside a short fixed list when it was copied: `ALPNProtocols`, `honorCipherOrder`, `secureProtocol`, `ecdhCurve`, `profile` and the rest went without an error. The copy now reads every documented option of `tls.ConnectionOptions`, and the `profile` that `ioredis` reads, by name; the own enumerable keys beyond them are still copied.
- The `scripts` list and each definition in it are copied once when the options are resolved, so a list whose length or whose `lua` answers differently on a later read registers what was read first, not a script that was never read.
- A `sentinel.sentinels`, `cluster.nodes` or `scripts` list that claims more than 1 000 entries is refused as `INVALID_OPTIONS` (`reason: '<option> has too many entries'`, `max: 1000`) before it is copied; a length of one hundred million used to abort the process with a heap error. A list that reports a length that is not a non-negative integer (`NaN`, a negative, a fraction, `Infinity`) is refused the same way (`reason: '<option> has an invalid length'`).

  **Apply to a consumer:** nothing changes for a list of at most 1 000 entries. A host that configures more than 1 000 sentinels, cluster seed nodes or scripts must lower the count. No declaration changes.

## [1.2.32] - 2026-11-21

### Fixed

- Every property of the `connection`, `sentinel` and `cluster` blocks, of `cluster.options` and of its `redisOptions` is read once, by name, when the options are resolved, and validation and the client builders read that copy. A getter of the host's that answered differently on each read used to drop a security option without an error: `tls`, `password`, `username` or `url` of a standalone setup (a dropped `url` meant `localhost` with no tls), `sentinel.password` falling back to `connection.password`, `sentinelPassword` and `natMap`, and the cluster `tls`, `password` and `username`. The cluster connect timeout is read once too, so the boot wait and the driver agree.
- The objects the driver reads again on every connect and reconnect are copied once as well: the `tls` object, the `sentinels` and `cluster.nodes` lists with their entries (the length once, each entry once, by name), and a `natMap` with its entries, in a standalone, sentinel or cluster setup. A getter of the host's on `tls.ca`, `tls.rejectUnauthorized`, a sentinel or node `host` or a `natMap` entry could change the TLS or authentication outcome after validation; it now answers once. A `Buffer` or a `secureContext` inside `tls` is kept by reference. A getter or a trap of the host's in any of them ends as `INVALID_OPTIONS` (`reason: 'option could not be read'`) with the error on `cause`, where one in `sentinels` reached the host raw and one in `tls`, `cluster.nodes` or a sentinel entry ended as `CONNECTION_FAILED` at boot.

  **Apply to a consumer:** nothing changes for options that read normally. A host that matched the raw error of a throwing `sentinels` getter, or the `CONNECTION_FAILED` of a throwing `tls`, `cluster.nodes` or sentinel entry getter, on the exception from `forRoot` or from boot, reads the `INVALID_OPTIONS` exception and its `error.cause` instead. No declaration changes.

## [1.2.31] - 2026-11-21

### Fixed

- The `scripts` option (the array and each definition) is read under the same guard as the rest of the options, so a getter or a proxy of the host's in it ends as `INVALID_OPTIONS` with the thrown error on `cause`, and the status screen of `./admin` lists no script names when the definitions cannot be read. The connection manager reads the connect timeout once, when it is built, and the boot wait uses that value: before, it read the option a second time.

  **Apply to a consumer:** nothing changes for a host whose options read normally. The class `ConnectionManager` loses a private member (`connectDeadline`) that 1.2.30 added, so the text of its declaration changes while every public signature stays the same; subclassing it is not a supported extension point.

### Documentation

- The README narrows the limit of the option-read guard: of the objects handed to the driver as they are, only the `sentinels` array reaches the host raw, and a trap in `cluster.nodes`, a sentinel entry or `tls` ends as `cache.connection_failed` with no `cause`.
- The README says where each figure of the production section comes from: the timings of the frozen and the stopped Redis, the burst of 12 000 messages and the 64 MB message were measured by hand in the QA gate of 1.2.25 and no spec pins them; the 125 000-argument threshold of the call stack was measured when the chunking was added in 1.2.27; and `pubsubMaxConcurrentHandlers: 256` with `pubsubMaxQueuedMessages: 10000` is a starting point chosen by judgement, not a measured optimum.
- The shutdown-hooks note no longer says what the process does without `app.enableShutdownHooks()`, which is Nest's behaviour: it says that the library closes its connections, `shutdownTimeoutMs` included, only inside Nest's shutdown hook, which `app.close()` runs too.

## [1.2.30] - 2026-11-21

### Fixed

- An option that could not be read ended as the host's own error. A getter or a proxy trap in the options handed to `forRoot`, `forRootAsync` or `createConnectionManager` that throws now ends as `CacheException` `cache.invalid_options` (`details.reason`: `option could not be read`) with the thrown error on `cause` and none of its text in `details`. Each top-level option is read once, into a plain copy that validation and defaulting then share, so what is validated is what is applied. The same holds for the reads the connection manager makes when it builds the client and when it boots, and for the script manager's lazy flag; the status screen of `./admin` answers with no endpoint named when the connection block cannot be read. A trap that fires inside the driver, in an object handed to it as it is, still reaches the host as its own error.

  **Apply to a consumer:** a host that matched the error its own getter throws, on the exception that `forRoot` raised, reads `error.cause` instead; a refusal the library raises for a value it could read keeps its code. The class `ConnectionManager` gains one private member, `connectDeadline`, so the text of its declaration changes while every public signature stays the same; subclassing it is not a supported extension point.

### Documentation

- The README says that the allowance of the hook-failure line is kept only for `logger: false` and Nest's own console logger and its subclasses, and that a nested write by one bag is visible to the next bag and to the host's own object.

## [1.2.29] - 2026-11-20

### Added

- `CACHE_LOG_EVENTS.hookFailed`, the code `CACHE_HOOK_FAILED` that the main entry writes when a hook of `events` fails, in the catalog of `@bymax-one/nest-cache/observability`.

  **Apply to a consumer:** nothing changes unless you iterate over `CACHE_LOG_EVENTS`: it gains the key `hookFailed`. The line was already written by 1.2.28; this only lists its code.

### Fixed

- The one `CACHE_HOOK_FAILED` line a hook is allowed is no longer spent when nothing can be written: while Nest's logging is disabled (`logger: false`) or `warn` is left out of its levels, the hook keeps its allowance for when logging is on again.

### Documentation

- The 1.2.28 entry for a refused queued command said the error was "mapped like any command's", which reads as if it carried a library code. It does not: a timeout or an offline connection is `cache.command_timeout` or `cache.connection_lost`, and any other refusal (an out-of-memory refusal, say) is the driver's own error with no library code and no `cause`, as for every other command.
- The frozen copy of the hook data is the top level only: a nested value (`err`, an array) is shared with the library.
- The CHANGELOG of 1.2.28 did not mention that the main entry exports `guardClient` at runtime. It is an internal export that `@bymax-one/nest-cache/admin` uses and it is not supported.

## [1.2.28] - 2026-11-20

### Fixed

- A transaction discarded because a command was refused as it was queued (an `OOM` on the first chunk of a large `mset`, say) rejected with ioredis's generic `EXECABORT`, which hid the refusal. It now rejects with the first queued command's own error, mapped like any command's.
- A host hook in `events` that threw or rejected left no trace. The first failure of each hook (`onEvent`, `onOperation`, `onQueue`) is now logged once, as `CACHE_HOOK_FAILED` with the hook's name and nothing the hook threw; a later failure of the same hook is absorbed silently. `onEvent` receives a frozen copy of the event data made for that call, and `combineCacheEvents` gives every bag its own copy, then raises its first failure to the module so it is logged too.
- `CacheObservability.events.onEvent` called directly with no object (`null`, a string) threw a `TypeError`; it reads that as an empty payload.

  **Apply to a consumer:** a host that matched `EXECABORT` on a failed `mset` now gets the first queued command's error instead. An `onEvent` hook that wrote to the `data` it received gets a `TypeError` in strict mode, which the library absorbs and logs: copy the data first. Nothing else changes.

### Documentation

- A `LoggerService` installed through `Logger.overrideLogger` must not reject: Nest drops what its methods return, so a rejection is unhandled and ends the Node process (exit code 1) unless the application handles `unhandledRejection`. Pass the service as `logger` to have the library absorb it. `dist/` is unchanged.
- `bymax_cache_pubsub_dropped_total` can trail the real drops by up to 10 s, because the library reports the drops after the first one summed over a 10 s window.

## [1.2.27] - 2026-11-20

### Added

- `@bymax-one/nest-cache/observability`, an optional subpath: the cache's operations, its Pub/Sub backlog and its drops as Prometheus metrics (`bymax_cache_operations_total{operation,outcome}`, `bymax_cache_pubsub_queued`, `bymax_cache_pubsub_dropped_total`), a readiness indicator named `cache` (one `PING`, no details), the library's operational log events as object messages with `CACHE_*` codes, and `combineCacheEvents` to share the module's single `events` between several observers. Every label value comes from a closed set. The README lists each metric, each log code and what it carries. `@bymax-one/nest-core` and `prom-client` stay optional peers, and the main entry imports neither.
- `ICacheEvents.onOperation(operation, outcome)` and `ICacheEvents.onQueue(queued)`, two optional callbacks the metrics read, and the `CacheOperationName` and `CacheOperationOutcome` types in `./shared`. The `error` event's payload carries the driver's error, or the error a host's Pub/Sub handler threw, as an `err` object, never inside the text.

  **Apply to a consumer:** nothing changes until the subpath is wired. A host that already passes `events` is unaffected: the two new callbacks are optional, and the `error` event only gains the `err` field. A host that wires it passes `observability.events` (or `combineCacheEvents(...)` with its own) as `events`, and adds `CacheOperationMetrics` and `CacheHealthIndicator` as providers. The class `CacheService` now inherits its hash and set commands from an internal base class, so the text of its declaration changes while every method signature stays the same; consumer-facing signatures are identical. Subclassing `CacheService` is not a supported extension point: its protected members are internal and can change without notice.

### Fixed

- A host callback in `events` that is an `async` function no longer takes the process down. A hook typed `=> void` still accepts one, and a `try`/`catch` does not see the rejected promise it returns, so `onEvent` (the connection manager and the Pub/Sub subscriber), and the new `onOperation` and `onQueue`, now absorb a rejection and a throwing thenable as they absorbed a throw before.

- An option that is present but unset (`undefined`, or `null`) now takes its default, in every group, instead of replacing it. In `cluster.options.redisOptions` an explicit `undefined` for `connectTimeout`, `commandTimeout`, `maxRetriesPerRequest` or `disconnectTimeout`, and in `cluster.options` for `enableOfflineQueue`, replaced the default through an object spread, so the library's fail-fast value was lost and the driver applied its own; each of those keys is now read by property access and an unset one takes the default, which also honours a group that is a class instance whose values sit behind getters. `cluster.options` and `cluster.options.redisOptions` are copied by property access from the documented ioredis keys, plus every own key the list does not name, as given, so a value a class keeps behind a getter, a password or tls included, reaches the client; before, the object spread dropped it and the client connected without it, although validation had read it. `null` is read as unset too. Some options refuse `null` instead, and only `undefined` means unset there: `maxRetriesPerRequest`, because `null` is the driver's "retry without limit", and every credential or tls field (`password`, `username` and `tls` of `connection` and of `cluster.options.redisOptions`, and the sentinel `password` and `sentinelPassword`), because their default is the weaker security posture: a secret that failed to load and arrived as `null` would otherwise connect without authentication or without tls, silently.

  **Apply to a consumer:** a host that set `undefined` in `cluster.options.redisOptions` to drop a bound now gets the default bound back; give the option an explicit value instead. A host that passed `null` for `port`, `db`, `keepAlive`, `connectTimeout`, `commandTimeout` or a Pub/Sub bound, which was refused at boot, now boots with the default. A host that passed `null` for a credential or tls field, which before reached the driver as it was, now fails at boot with `cache.invalid_options` (`details.received` is `'null'`): pass `undefined`, or omit the field, when no credential is meant, and fix the loading of the secret otherwise. `maxRetriesPerRequest: null` is unchanged: refused.

- The refusal of `connectTimeout` or `commandTimeout` now names the option with its group, like every other numeric option: `connection.connectTimeout` and `cluster.options.redisOptions.connectTimeout` (and the same for `commandTimeout`) in `details.option` and in `details.reason`. Before, both groups reported the bare name, so a host that set the timer in a cluster's node options was told about an option it had not written. `shutdownTimeoutMs` is a top-level option and keeps its name.

  **Apply to a consumer:** a host or a test that matches on `details.option` or `details.reason` of a timer refusal (`'connectTimeout too low'`, `option: 'commandTimeout'`) matches the prefixed text instead (`'connection.connectTimeout too low'`); the codes, the accepted ranges and what is refused are unchanged.

- A refused value of a configured option is never echoed in `details`, in the namespace, separator and scope families too. The refusals of `namespace`, `keySeparator` and `keyEscaping` (`cache.invalid_namespace`), of the key builder's separator checks, and of the `./admin` scopes and thresholds (`cache.invalid_scope`) used to carry the value itself (`namespace`, `separator`, `keyEscaping`, `pattern`, `scopeId`, `value`), so a token pasted into the wrong option reached logs and error reporters; they now carry `reason`, `option` and `received` (the value's type, or the number itself) like the rest, plus the fixed `metacharacter` or `allowed` where there is one. A scope field is named by position (`scopes[1].pattern`). An option of the wrong type (a symbol, a function or an object for a namespace, a separator or a scope field) is now refused with the same exception instead of a raw `TypeError`, and `scopes` that is not an array or an entry that is not an object is refused too. The README states the rule once, for every family.

  **Apply to a consumer:** a host, a test or an error mapper that reads `details.namespace`, `details.separator`, `details.keyEscaping`, `details.pattern`, `details.scopeId` or `details.value` of these refusals, or matches their `reason` (`'key separator contains the escape character'`, `'duplicate scope id'`, `'threshold must be positive'`), reads `details.option` and `details.received` and the new `reason` (`'keySeparator contains the escape character'`, `'scopes[1].id duplicates scopes[0].id'`, `'scanLimit must be a positive integer'`) instead; the codes and what is refused are unchanged. The `scopeId` of `SCOPE_NOT_FOUND` and `KEY_NOT_IN_SCOPE` is a caller's request, not configuration, and is still echoed.

- `revealValue` no longer reports a hash, a set or a sorted set complete, or a deleted key, when a reply cannot be read. A reply of a shape that is not a page ended the `HSCAN` or `SSCAN` as if it had reached its end, so the entries of the earlier pages were shown with `isComplete: true`, and an unreadable first page of an existing key read as `missing`. The read now stops there and reports what it holds with `isComplete: false`; a sorted-set reply that is not a list, which already read as no members, is now incomplete too.

  **Apply to a consumer:** a surface that treated `isComplete: true` on a hash, a set or a sorted set as everything there is stays correct; one that read `status: 'missing'` for a key it knows exists now gets `status: 'revealed'` with no entries and `isComplete: false` when the server answers a scan in an unexpected shape.

- `mget`, `mset` and `delMany` accept an array of any length. A call that spreads an array into a command's arguments overflows the call stack at about 125 000 elements, so the three threw a `RangeError` for a host-sized array; they now send it in parts of at most 10 000 arguments. `mget` and `delMany` send the parts one after the other (`delMany` adds up what each removed). `mset` sends them inside one `MULTI`/`EXEC`, so a write of more than 5 000 entries is applied all at once, as a shorter one always was; a Redis that fails the transaction rejects the call with the failing command's error, and an aborted `EXEC` rejects with `cache.connection_lost` (`details.reason: 'transaction_aborted'`). `eval` refuses more than 25 000 keys and arguments together with `cache.script_execution_failed` (`details.reason: 'too many keys and arguments'`, `details.max: 25000`) before any command is sent, where a longer list overflowed the stack. `sadd`, `srem` and `hdel` take their elements as rest parameters, so the caller's own spread limits them before the library is reached; they are unchanged.

  **Apply to a consumer:** a call that worked keeps working and does the same, with one exception: an `eval` with more than 25 000 keys and arguments together is now refused, where it ran as long as the call stack held the spread (about 125 000 for a plain call, fewer through the library's wrapper); split such a call, or pass the data in one argument. `delMany` and `mget` of more than 10 000 keys are no longer one command: a key written between two parts is seen by one part and not the other, and `delMany` is not atomic across parts, where a shorter call is. A host that relied on a single atomic `delMany` of more than 10 000 keys should delete in its own transactions. A cluster `mset` of more than 5 000 entries needs its keys in one slot, as every multi-key command does.

## [1.2.26] - 2026-11-17

### Changed

- `port`, `db`, `keepAlive` and `maxRetriesPerRequest` of `connection`, and the same options in `cluster.options.redisOptions`, are checked when the module is configured (a `port` or `db` that the connection `url` replaces is not). Before, they were handed to the driver as given: `NaN`, an infinity or a string for `maxRetriesPerRequest` (and `-1`) switched the retry bound off, so a command queued during an outage waited for `commandTimeout` alone; `NaN` or `0` for `keepAlive` made the socket use the operating system's own delay, which lost the 30 s half-open probe; an invalid `port` or `db` failed at connect with a driver error. Each is now refused at boot with `cache.invalid_options`, naming the option, the type of the value received and the accepted range: `port` 1 to 65 535, `db` 0 to 2 147 483 647, `keepAlive` 1 to 2 147 483 647 ms, `maxRetriesPerRequest` 0 to 2 147 483 647. These are validation ranges, not usable ones: Redis itself refuses `SELECT` for a `db` above its `databases` setting (16 by default). `keepAlive: 0` and `maxRetriesPerRequest: null` are refused as well, and only those two refusals carry a `why` in `details`. The check also covers what 1.2.25 let through unchecked: a `port` in `cluster.options.redisOptions` (a `port` of 70 000 there was ignored), and the four options of `connection` in every mode: sentinel mode builds its client from them, and cluster mode, which ignores the block, now checks them too.

  Every `cache.invalid_options` refusal raised for an option value now reports `details.option` and `details.received`, and no longer carries `details.value`: `received` is the number itself when it is finite, the name of `NaN` or of an infinity, and otherwise the type of the value, so a credential or token placed in the wrong option is never echoed into a log.

  **Apply to a consumer:** a host that reads `details.value` of a `cache.invalid_options` error (to print or to log the refused value) must read `details.received` instead, which holds the number or the type; `details.option` now names the option for the timer and handler-bound refusals too. A host that passed `keepAlive: 0`, `maxRetriesPerRequest: null`, or a string or a non-integer for any of these options, now fails at boot with `cache.invalid_options`. Remove the option (the default is kept), or give it an integer in the range above. `null` for `maxRetriesPerRequest` was already documented as not to be passed. In standalone `connection`, 1.2.25 read a `null` there as the default of 3, so a host that passed it now fails at boot instead; only `cluster.options.redisOptions` handed the `null` to the driver, which then retried without limit.

## [1.2.25] - 2026-11-17

### Added

- `AdminReadCommand` is exported from `@bymax-one/nest-cache/admin`. It is the union `IRedisReader.call` takes (declared in 1.2.24 but not exported there), so a host that implements the reader can import it from the entry point.
- A "Running in production" section in the README: what the library bounds by default, what it leaves to the host (value and key sizes, batch arity, Pub/Sub message size, Pub/Sub handler concurrency, with a starting pair for `pubsubMaxConcurrentHandlers` and `pubsubMaxQueuedMessages`), what each failure of Redis looks like to a caller, how shutdown behaves, and that the library keeps no key of its own.

**Apply to a consumer:** nothing. The addition is a type export.

## [1.2.24] - 2026-11-17

### Changed

- The `command` parameter of `IRedisReader.call`, a deprecated implementation helper of `./admin`, is now typed as the union `AdminReadCommand` (`'GETRANGE' | 'HSCAN' | 'SSCAN' | 'ZRANGE'`) instead of `string`. A write command, or a name computed at run time, no longer compiles. The compiled JavaScript of the package is unchanged; only the declarations differ.

  **Apply to a consumer:** nothing for a host that only uses `CacheAdminService` and `CacheStatusService`. A host that implements `IRedisReader` itself (a test double) keeps compiling, since a method accepting `string` accepts the narrower type; a host that calls `reader.call(name, ...)` with a `string` it computed narrows `name` to `AdminReadCommand` first or stops calling it, which `./admin` never intended.

## [1.2.23] - 2026-11-17

### Fixed

- `CacheAdminService.revealValue` no longer shows a string cut in the middle of a character, and no longer shows a deleted collection as an
  empty one. A string cut at `revealStringLimit` could end in a lone surrogate when a four-byte character (an emoji) straddled the limit,
  which is not valid text and becomes U+FFFD after a UTF-8 round trip; the limit still counts UTF-16 units, and the shown text now ends on
  a whole character, one unit short of the limit when a pair would have been split (QA's matrix of 176 multibyte cases showed 33 such
  ends). A hash, set, list or sorted set that was deleted between the `TYPE` reply and the read came back as an empty value with
  `isComplete: true`, which reads as "an empty collection"; Redis never stores an empty collection, so a finished read of nothing now means
  the key is gone and the reveal answers `missing`, as it already did for a string. A scan that stopped at its call cap with nothing found
  stays incomplete. A key replaced by a different type between the two reads still throws `WRONGTYPE`, as before.

  **Apply to a consumer:** nothing to change in the types. A host that treated an empty `hash`, `members` or `scored` reveal as "gone" can
  rely on `missing` instead; the text of a long string may now be one unit shorter than `revealStringLimit`.

## [1.2.22] - 2026-11-17

### Fixed

- `CacheAdminService.revealValue` (the `./admin` subpath) no longer reads a whole value to show a part of it. It read a string with `GET`,
  a hash with `HGETALL` and a set with `SMEMBERS` and cut the result in the process, so revealing a multi-megabyte string or a set of
  a million members pulled it all into the process and made the server assemble it. A string is now read with one `GETRANGE` of four
  bytes per character of `revealStringLimit`, and a hash or a set with `HSCAN` or `SSCAN` (`COUNT` `revealLimit`) followed until more than
  `revealLimit` distinct entries were seen, with a bounded number of calls, after which the value is reported incomplete. A list and a sorted set
  were already read with a range. Measured on a real Redis with a 10 MB string and a set and a hash of 200 000 entries: the three reveals
  run no `GET`, `HGETALL` or `SMEMBERS`, make one `GETRANGE` and some `HSCAN` and `SSCAN` calls, and the server sends back less than 200 KB
  in all. The three reads go through `call`, like the sorted-set read, so `IRedisReader` is unchanged.

  **Apply to a consumer:** nothing to change in the types. The entries of a large set or hash can come in a different order than before:
  they come in the server's scan order, not in the order of `SMEMBERS` or `HGETALL`; Redis documents neither order.

## [1.2.21] - 2026-11-16

### Fixed

- Closing the application while Redis is down no longer keeps the process alive for the command timeout. A client in its retry delay
  (`reconnecting`, `close`) has a stream that is already closed, so disconnecting it emits no `close` and ioredis never flushed what was
  queued on it: a `subscribe` or `unsubscribe` issued while the server was down kept its command timeout timer, and with it the process,
  for `commandTimeout` (5 000 ms by default). Since 1.2.19 the shutdown of such a client
  disconnects it without a `QUIT`, and now also rejects what is queued on it at once, with `cache.connection_lost`
  (`reason: 'shutdown'`, fixed text). The flush is ioredis's own `flushQueue`, which both client classes have at runtime but declare
  private; it is called when present, and a contract test against the real `Redis` and `Cluster` classes fails if an ioredis release
  removes or changes it. If a release lacked it, or its version threw, the shutdown would still complete and the queued commands would again be left to their
  own timeouts.

  **Apply to a consumer:** nothing to change. A `subscribe` or `unsubscribe` that was pending when the application closed now rejects
  with `cache.connection_lost` immediately instead of at its command timeout.

### Added

- Two optional module options bound the work the Pub/Sub handlers have in flight: `pubsubMaxConcurrentHandlers` (an integer from 1)
  caps the executions running at once across the whole subscriber, each covering decoding, validating and running the handler for one
  message, and `pubsubMaxQueuedMessages` (an integer from 0, which needs the first) caps how many wait for a slot. Waiting messages start
  in arrival order, so with 1 the handlers run one at a time in the order the messages arrived, even with an asynchronous `validate`.
  A message that finds no slot and no room is dropped, never retried, and reported through `events.onEvent` as an `error` with
  `reason: 'handler_queue_full'` and the `channel`, never a payload; the first drop is reported at once and the drops of the next
  10 seconds as one event with `dropped` (their number) and the channel of the last. The slots are shared by every channel, so one slow
  channel can delay the others, and a handler that never settles keeps its slot. Unset, both options bound nothing, as before.

  **Apply to a derived backend:** nothing to change. Both options are optional and unset keeps today's behaviour. A host whose handlers
  can fall behind the publish rate can set `pubsubMaxConcurrentHandlers` (and `pubsubMaxQueuedMessages`) and alert on
  `handler_queue_full` events; the declarations of `PubSubService` also list its new private members, which are not part of the API.

## [1.2.20] - 2026-11-15

### Fixed

- The Pub/Sub subscriber no longer carries one listener per subscription. It had a `message` (or `pmessage`) listener for each
  `subscribe` / `psubscribe`, so the eleventh made Node print `MaxListenersExceededWarning: Possible EventEmitter memory leak
detected` for the library's own connection, and every message was offered to every listener in turn. It now carries one listener of each kind and
  looks each message up by its channel or pattern. Measured on a real ioredis client with 12 channel and 12 pattern
  subscriptions: 12 and 12 listeners and a `MaxListenersExceededWarning` for each kind before, one and one after. Each handler keeps its own decoding and its own
  failure report, so a handler that throws still reaches no other handler and no later message, and the `handler_error` event is
  unchanged. The README and the specification now state the ordering a handler gets (calls may overlap and
  finish out of order) and that nothing bounds the calls in flight.

  **Apply to a consumer:** nothing to change.

## [1.2.19] - 2026-11-14

### Fixed

- A shutdown during a Redis outage no longer reports a forced disconnect for a client that has no live connection when the shutdown runs. A client that is
  `reconnecting`, `close` or `wait` (a lazy client that never connected) has no live connection to say goodbye on, so `closeClient`
  now releases it directly (`disconnect()`, which stops its retries) instead of sending a `QUIT`. The `forced_disconnect` event is reserved
  for a connection that was live and did not quit in time or refused. A connect still in flight (`connecting`, `connect`) and any status
  this code does not know keep the previous path: `quit()` raced against `shutdownTimeoutMs`, then a forced disconnect, so it ends within
  `shutdownTimeoutMs`. Measured on a stopped Redis with both clients `reconnecting`: on 1.2.18 the main client always reported
  `forced_disconnect` (its `QUIT` is rejected at once because it has no offline queue) and the subscriber did so only when a command was queued
  on it (ioredis answers its `QUIT` locally otherwise); the close took a few milliseconds without a queued command and tens of milliseconds or more with one, depending on when the retry fires. With this
  version none of those cases emits `forced_disconnect` and the close took 0 to 2 ms (the end-to-end test asserts under 500 ms).

  **Apply to a consumer:** `forced_disconnect` now fires only for a live connection that did not quit in time or refused. A shutdown
  during an outage no longer emits it; such a shutdown is visible through the `error`, `close` and `reconnecting` events that preceded
  it. A host that alerts on `forced_disconnect` to detect a shutdown during an outage must alert on those events instead.

## [1.2.18] - 2026-11-14

### Fixed

- The shutdown of the Pub/Sub subscriber is now bounded by `shutdownTimeoutMs`. The main client's `quit()` was raced against it, but
  the subscriber's was only bounded by `commandTimeout`, so with a server that stopped answering and a `commandTimeout` longer than
  `shutdownTimeoutMs` the application waited out the command timeout (8 003 ms measured with `commandTimeout` 8 000 and
  `shutdownTimeoutMs` 500). Both clients now close through one helper: the graceful `quit()` gets `shutdownTimeoutMs`, and when it
  fails or is too slow the client is disconnected. Nest runs the shutdown hooks of the providers of one module together, so the
  whole close takes about one `shutdownTimeoutMs` (measured on a frozen Redis with both clients open and the default 5 000 ms: see the
  test). The forced teardown of the subscriber is reported to `events.onEvent` like the main client's: an `error` event with
  `reason: 'forced_disconnect'` and `role: 'subscriber'`.
  The declarations of `PubSubService` list two private members more (`shutdownTimeoutMs`, `emitForcedDisconnect`); a private member is
  not part of the API.

  **Apply to a consumer:** a host that counts or alerts on `forced_disconnect` and filters on `role: 'main'` sees nothing new; one that
  counts every `forced_disconnect` now also sees the subscriber's. Nothing else to change.

## [1.2.17] - 2026-11-14

### Changed

- The `details` of these errors no longer carry a message written by a driver, a script or a host. `details` is serialised verbatim
  into the HTTP body of a `CacheException`, and those messages can name a host and a port (`connect ECONNREFUSED 10.0.0.5:6379`),
  quote a command's arguments or quote a value. The `cache.connection_failed` that `onModuleInit` throws when the client errors
  before it is ready now has `details.error` `connection error before ready`, `cache.script_execution_failed` has
  `details.error` `the script did not run to completion` in place of `details.originalError`, and `cache.serialization_failed`
  of the default JSON serializer has `details.error` `the value could not be encoded as JSON`. The original error is on `cause`
  in each, which a response body never carries. The README lists the values `details` still echoes back, which are the
  caller's own or the configuration's.

  **Apply to a consumer:** a host that read `details.originalError` or the driver's text in `details.error` to log or branch on
  it reads `cause` instead (`error.cause.message`); a host that forwards `details` to an HTTP client can now do so for these
  codes. The keys of `details` are otherwise unchanged, except that `originalError` of `cache.script_execution_failed` is gone.

### Fixed

- A client closed while it is reconnecting no longer keeps the process alive for two seconds. With the default retry strategy a
  client whose server stopped sits between two attempts with no open stream; `disconnect()` armed ioredis's teardown timer there,
  which only the stream's `close` clears and a stream that is already closed never emits, so the process exited about 2 000 ms
  after the shutdown (measured 2 001 to 2 003 ms with a stopped server, 1 to 3 ms after this change). Every client the library
  creates (the main client, the Pub/Sub subscriber, the sentinel client and the nodes of a cluster) now has a `disconnectTimeout`
  of 1 ms. A forced `disconnect()` on a client with an open stream now destroys that stream 1 ms after ending it, where it waited
  up to 2 s for the server to close its side. That includes the disconnect ioredis makes itself before it reconnects (after a
  `READONLY` reply or a sentinel failover), which abandons the old stream anyway. A client that has ended is still not disconnected.

  **Apply to a consumer:** nothing to change. A host that sets `disconnectTimeout` in `cluster.options.redisOptions` keeps its own
  value; the connection options of the other modes have no such field.

## [1.2.16] - 2026-11-14

### Fixed

- A failed boot no longer lets a later call reopen the client it closed. When the readiness wait fails (an error, the end of the
  connection, or no `ready` within `connectTimeout`) the client is disconnected on purpose, but `getClient()` (and with it every
  `CacheService`, script, Pub/Sub and admin call) and the Pub/Sub subscriber then opened a new one that nothing had waited for,
  which reconnected behind a boot that had reported the connection as failed. They now answer with
  `cache.connection_failed` (503, `details.reason` `boot_failed`) and open nothing. On these later refusals the boot's own error,
  which can name a host and a port, stays on `cause` and is never part of the response body. The boot rejection itself, the
  `cache.connection_failed` that `onModuleInit` throws, still carries the driver's message in `details.error`, as it did before this
  release; a host that forwards `details` to an HTTP client should not forward that one.
  The declarations of `ConnectionManager` name its private guard `assertCanOpen` where they named `assertNotShutDown`; a private
  member is not part of the API.

  **Apply to a consumer:** a host that caught the boot failure and kept the application running now gets that error from every
  cache call instead of a silently reopened connection. Restart the application, or build a new module, to try the connection
  again.

## [1.2.15] - 2026-11-14

### Changed

- The default message of `cache.connection_failed` now states what the code does. It read "Could not connect to Redis after
  retries.", but the code covers a missing or malformed `connection.url`/`connection.host` (no connection is attempted) and a
  boot wait that ends on a connection error, the end of the connection, or no `ready` within `connectTimeout`; no retry count is
  involved. It now reads "Could not establish the Redis connection: the connection options are missing or invalid, or the client
  did not become ready." The code, the HTTP status and `details` are unchanged.

  **Apply to a consumer:** match on `code` (`cache.connection_failed`), never on the message text. A test, log filter or alert
  that matches the old sentence must match the new one or, better, the code.

### Fixed

- A client that has already ended is no longer disconnected. ioredis arms a 2 s teardown timer in `disconnect()` and clears it only
  when the stream emits `close`; an ended client never emits it again, so the process stayed alive 2 s longer after a boot that
  failed because the client ended, after the shutdown of a main client that had ended (which also reported a spurious
  `forced_disconnect` event), and after the shutdown of an ended Pub/Sub subscriber. Shutdown now skips a client whose status is
  `end`, and the forced teardown disconnects only a client that has not ended.

## [1.2.14] - 2026-11-14

### Changed

- HTTP statuses now follow one rule: a backing service that is unavailable or too slow answers 503, a caller's mistake a 4xx, and
  only an internal fault or a boot-time configuration error 500. `cache.command_timeout` moves from 504 to 503 (it was never
  thrown before the command mapping of this release, so nothing depends on 504), the readiness failure of the boot wait
  (`cache.connection_failed`: an error, the end of the connection, or no `ready` within `connectTimeout`) answers 503 while the
  configuration errors of the same code keep 500, and `cache.scope_not_found` and `cache.key_not_in_scope` answer 404. A key
  outside a scope is refused from the scope's pattern alone, with no Redis command, so the answer is the same for a key that
  exists and one that does not.

- The `keepAlive` default is now 30 000 ms, as in ioredis, instead of 0. A zero left the operating system's own delay, which on
  Linux is two hours, so a connection that went half-open (a NAT idle drop, a failover without a reset) stayed silent that
  long; the dedicated Pub/Sub connection has no command traffic to notice it otherwise.

- A refused timer option now reports the new code `cache.invalid_options` (HTTP 500) instead of `cache.connection_failed`,
  whose message reads as a network failure: `shutdownTimeoutMs`, `connection.connectTimeout` and `connection.commandTimeout`
  below their minimum, not a finite integer, or above 2147483647 ms. `details` are unchanged. The admin
  `probeTimeoutMs` keeps `cache.invalid_scope`, the administration surface's code.

- Dev tooling floors: `glob` 14.0.2 and `minimatch` 11.0.1 (GHSA-3g3m-2fjr-6pw4, GHSA-g3hv-75wg-m249) and
  `eslint-plugin-import-x` 4.18.1, reached only through test, mutation and lint tooling, so no dependency of the package moves
  (`dependencies` stays empty, the peers are unchanged). The newer lint plugin sorts parent before sibling imports as this
  repository's own configuration always asked, so seven source files reorder their import lines; that changes the order of
  modules inside `dist/server` and `dist/admin` and nothing else: no code is added or removed.

### Added

- `scanRoundsLimit` (admin option, default 100, a whole number from 1 to 10 000, refused with `cache.invalid_scope` naming the option
  otherwise) caps the `SCAN` round trips one `listKeys` request makes, and `KeyspacePage` carries it as `scanRoundsLimit`. A scope
  that matches few keys never reached `scanLimit`, so one request walked the whole keyspace serially on the shared connection. Past
  the cap the page is incomplete, possibly empty, and `cursor` says where to continue.

### Fixed

- A timeout or an offline connection while a script loads or runs, a message is published or a channel subscribed, or the
  `/admin` surface reads, is now `cache.command_timeout` or `cache.connection_lost` (503) with the original on `cause`, as it
  already was for `CacheService`. Before, `ScriptManagerService` wrapped every failure as `cache.script_execution_failed` (500)
  and `PubSubService` and `/admin` let ioredis's bare `Error` through. `cache.script_execution_failed` is now only what the script
  or the server said: a Lua runtime error or a failed NOSCRIPT retry. `getClient()` and `pipeline()` still hand out the raw client.
- The `COUNT` hint of `CacheService.scan()` is a whole number from 1 to 10 000: a larger value is clamped, a smaller one raised to 1,
  and a value that is not a whole number (`NaN`, `Infinity`, `2.5`) falls back to 100. An application that forwarded a caller's
  value could ask Redis for a batch of any size.
- The production guard of `flushNamespace()` now reads `NODE_ENV` trimmed and without regard to case, so `Production` or
  `PRODUCTION` is production too. `prod` and other names are still not guessed at.
- The README no longer says that `cache.connection_lost` is never thrown, that `cache.connection_failed` follows retries, or that
  no error detail can carry a driver message: it documents what each code carries, the `lazyConnect` caveat with the default
  `enableOfflineQueue: false`, and the new `keepAlive` default.

- The readiness wait at boot is bounded and cleans up after itself. It had no deadline and ignored the end of the connection, so a
  `retryStrategy` that returns `null` (the client ends and emits no error), or a server still loading its dataset (ioredis polls
  until it has loaded), held `onModuleInit` without limit, and a failed wait left the client reconnecting with nothing left to
  close it. It now ends at `connectTimeout` or when the client ends, rejects with `cache.connection_failed` and disconnects the
  client.
- Cluster mode validates what it uses. The timers in `cluster.options.redisOptions` (`connectTimeout`, `commandTimeout`) get the
  same rule as the standalone ones, so `NaN` or a delay above 2147483647 ms no longer times every command out at once. The
  `connection` options a cluster ignored without a word (`password`, `username`, `tls`, `lazyConnect`) are refused at registration
  with `cache.invalid_options`, naming where to set each. A cluster created with `cluster.options.lazyConnect` no longer waits for
  readiness at init.
- A command that exceeds `commandTimeout` through `CacheService` now rejects with `cache.command_timeout` (HTTP 503), with ioredis's
  error on `cause`, instead of a bare `Error`. The server may still have applied the command, so a timed-out `incr`, `setNx` or
  `eval` is not known to have failed. With the offline queue off (the default here), a call while the connection is down, which
  ioredis rejects at once with `Stream isn't writeable and enableOfflineQueue options is false`, now rejects with
  `cache.connection_lost` (HTTP 503, `details.reason: 'offline'`, the original on `cause`). `getClient()` and `pipeline()` still hand out
  the raw client; the same mapping covers `ScriptManagerService`, `PubSubService` and the `/admin` reads.

- A malformed `connection.url` is now refused with the structured `cache.connection_failed` (`details.reason:
'invalid connection.url'`, no URL) in every mode. In `sentinel` and `cluster` mode the check was skipped and the raw
  parse error escaped the connection manager's constructor; that error's enumerable `input` holds the whole URL, so a
  credential in it reached whatever logged the boot failure.
- In `sentinel` mode with TLS configured for the data nodes (`connection.tls`, or a `rediss://` `connection.url`), TLS now also applies to the connection to the sentinels
  (`enableTLSForSentinelMode` and `sentinelTLS`). Before, `sentinelPassword` and the master discovery went to the
  sentinels in cleartext while only the data nodes used TLS.
- Admin scopes now deny first. A key's value is revealed only when every scope whose pattern matches it is readable, so
  naming a broader readable scope (`app:*`) no longer reaches a key in a withheld scope nested inside it
  (`app:secrets:*`): `revealValue` returns `withheld` for the scope that withholds it, and `describeKey` reports
  `isReadable: false`.

#### Apply to a consumer

A host that mapped `cache.command_timeout` to 504 now sees 503, the same status as `cache.connection_lost`: treat both as "retry
later". `cache.connection_failed` from the boot wait is 503; a missing or malformed `connection.url` stays 500. Code that caught
the bare ioredis `Error` ("Command timed out", "Stream isn't writeable...") from `PubSubService`, `ScriptManagerService` or `/admin`
now receives a `CacheException` with the same text on `cause`; code that matched `cache.script_execution_failed` to detect an
unavailable Redis during a script now matches `cache.command_timeout` or `cache.connection_lost`. `cache.scope_not_found` and
`cache.key_not_in_scope` are 404, not 500.

A `listKeys` page can now be incomplete and empty with a `cursor`: loop on `listKeys(scopeId, { cursor })` until `isComplete` is
`true` (each request makes at most `scanRoundsLimit` round trips). While keys are written `SCAN` can return a key twice, so
deduplicate if it matters. `KeyspacePage` has a new `scanRoundsLimit` field.

A connection that went half-open is now probed after 30 s of idleness instead of the operating system's much longer delay;
set `connection.keepAlive: 0` to keep the old behaviour. A deployment whose `NODE_ENV` is `Production` now has the flush guard
that `production` always had.

A host that catches errors from `CacheService` and keys on `cache.command_timeout` now sees it for a timed-out command, and
`cache.connection_lost` (`reason: 'offline'`) while the connection is down; treat a timed-out write as unknown, not failed. If you set `connection.password`, `username`, `tls` or `lazyConnect` with `mode: 'cluster'`,
move them to `cluster.options.redisOptions` (`lazyConnect` to `cluster.options`): they were ignored and are now refused. A boot that
waited without limit, a server loading a large dataset included, now fails with `cache.connection_failed` after `connectTimeout`: raise `connection.connectTimeout` (`cluster.options.redisOptions.connectTimeout` in cluster mode) if your server takes longer to become ready.

If you configure sentinels with `connection.tls` or a `rediss://` url, check that your sentinels accept TLS: the sentinel connection now uses
the same TLS options. If your admin scopes overlap, a key matched by a withheld scope is now withheld whichever scope the
caller names. A malformed `connection.url` in `sentinel` or `cluster` mode now fails at registration, as it already did
in `standalone`.

A refused timer option now reports `cache.invalid_options` instead of `cache.connection_failed`; `details` are unchanged.
A host that matched `cache.connection_failed` on a boot-time timeout refusal matches `cache.invalid_options` instead.

## [1.2.13] - 2026-11-13

### Added

- Opt-in read validation. `get`, `mget`, `hget`, `hgetall`, `subscribe` and `psubscribe` take a trailing
  `{ validate }` option: a type predicate or any Standard Schema validator (zod, valibot, arktype), declared
  structurally so the library imports none of them and gains no dependency. `T` is inferred from the validator. A value
  that does not satisfy it throws `CacheException` with the new code `cache.validation_failed` (HTTP 500): `details`
  hold fixed text (`index` or `field` for a batch read), never the value or the validator's
  messages, and the issues are on `cause`; the entry is left in place. A subscriber's message that fails is not
  delivered and takes the handler-error path. Without `validate` nothing changes and no validator runs.

### Fixed

- A timeout option outside what `setTimeout` honours is now refused at registration instead of firing at once. Node stores
  a delay of `NaN` or above 2147483647 ms (2^31-1) as 1 ms, so `shutdownTimeoutMs: 2 ** 31` released the connection
  without waiting for in-flight commands, `connection.connectTimeout` fired before the socket could connect, `connection.commandTimeout` timed every command out
  at about 1 ms, and the
  admin `probeTimeoutMs` reported the cache down without asking it. `shutdownTimeoutMs`, `connection.connectTimeout` and `connection.commandTimeout`
  must now be finite integers from their minimum (1 ms for the command timeout) to 2147483647 (`CONNECTION_FAILED`), and `probeTimeoutMs` at most
  2147483647 (`INVALID_SCOPE`). `NaN` previously passed the minimum check because `NaN < 100` is false.

- The message of a `CacheException` is now the catalog text for its code. An object response left `Error.message`
  as the class-name default, so a refusal at boot surfaced only as "Cache Exception". The `cache.invalid_namespace`
  text now names its rules, including that a separator containing `%` is rejected under `keyEscaping: 'strict'`
  (and by `escapePart` in either mode). The serialized body is unchanged except for that catalog text.

- A custom `ISerializer` that throws now reaches the caller as a `CacheException`, as the `ISerializer` contract
  says: `SERIALIZATION_FAILED` from a failed encode and `DESERIALIZATION_FAILED` from a failed decode, with a fixed
  `details` text (plus the stored value's length on decode) and the original error as `cause`. The error a codec
  throws often quotes its input, so a `Pub/Sub` handler event for a failed decode now carries the catalog text and
  not that message. `CacheException` accepts an optional fourth argument, `cause`. A `CacheException` thrown by the
  serializer passes through unchanged, which covers the default JSON serializer.
- Under `keyEscaping: 'strict'`, a `scan()` or `keys()` pattern that spells a character of the separator as a literal can
  never match, because a stored id holds none, so it silently returned nothing. A sweep that worked under `'legacy'`, such as
  `scan('sessions', `${userId}:*`)` to revoke a user's sessions, was a silent no-op under `'strict'`. That pattern now
  throws `INVALID_KEY` (`details.reason: 'pattern_contains_separator'`; a separator character that escape tokens are also
  spelled with, `%`, a digit, `A`-`F` or `u`, is never refused, and the check stops at a character class), and the new `KeyBuilder.idPrefixPattern` builds
  the pattern that matches the ids of one owner. A separator containing a glob character (`*`, `?`, `[`, `\`) is now
  rejected at registration under `'strict'`, since it widened every pattern built from it, `flushNamespace` included;
  a separator holding an astral character, such as an emoji, or an unpaired surrogate is rejected there too (`INVALID_NAMESPACE`: use a BMP separator),
  since a pattern holding a surrogate cannot be judged exactly against the stored ids;
  under `'legacy'`, which still boots with such a separator, `idPrefixPattern` throws `INVALID_NAMESPACE` for a glob one, because
  every boundary of the composed pattern would be read as glob syntax.
- The `JsonSerializer` documentation no longer says a corrupted entry can never pass as a valid `T`: only a payload
  that is not valid JSON throws, and valid JSON is not checked against `T`.

### Changed

- README: the build-tool badge now says tsup 9, the `@bymax-one/nest-queue` entry says it takes this module's
  connection (its Mode A) instead of owning its own. Maintainer notes, measurement notes, mentions of libraries that do not exist, links to the
  specification and repeated sections (the admin rationale, the design principles) are
  removed, so the page documents the package rather than its history.
  The Security Table is a compact table, one line per control.

#### Apply to a consumer

New: pass `{ validate }` to a read to check its shape, and treat `cache.validation_failed` as a miss (the README shows the
rolling-deploy pattern). Nothing changes if you do not.
A `shutdownTimeoutMs`, `connection.connectTimeout`, `connection.commandTimeout` or admin `probeTimeoutMs` of `NaN`, a fraction or above 2147483647
now refuses at registration; such a value never waited, so set the intended finite delay.

Under `keyEscaping: 'strict'`, replace a `scan`/`keys` pattern that holds the separator with
`KeyBuilder.idPrefixPattern`, and use a BMP separator without `*`, `?`, `[` or `\` (no emoji). Under `'legacy'`, which still boots with such a separator, `idPrefixPattern` throws `INVALID_NAMESPACE` for a separator holding `*`, `?`, `[` or `\`, because a pattern built from it could match other ids: pick a separator without those characters, or do not use `idPrefixPattern`.

Code that matched on `error.message` to equal "Cache Exception" must match on `error.code` instead; the code and
the `details` are unchanged. Code that caught the raw error a custom serializer threw must catch `CacheException`
instead, or read the original from its `cause`. The `message` field in a serialized `cache.invalid_namespace` body now carries the
longer text. The declarations do not change.

## [1.2.12] - 2026-11-12

### Added

- `keyEscaping: 'legacy' | 'strict'` module option (default `'legacy'`). Under `'strict'`, `KeyBuilder.build`
  escapes each part, so no two distinct `(prefix, id)` tuples compose one Redis key: `build('a', 'b:c')` and
  `build('a:b', 'c')` no longer both give `app:a:b:c`. The escape rewrites `%`, every character of the key
  separator, glob metacharacters in the prefix, and unpaired surrogates (which ioredis would send as U+FFFD,
  merging two different parts at the server) as `%XX` / `%uXXXX` tokens; a part holding none of those keeps its
  key. `keys()` and `scan()` escape only the prefix and keep their pattern a glob, through the new
  `KeyBuilder.buildPattern`. `KeyBuilder` also gains `buildLegacy` (the unescaped key, to read what an earlier
  release wrote), `escapePart`, `unescapePart` and `parse`, and the admin `CacheConfig` reports `keyEscaping`.
  A key separator containing `%` is rejected under `'strict'`, and only there; `escapePart` refuses it in either
  mode, since the escape character would reappear as the separator.

- `@bymax-one/nest-cache/metrics`, a new subpath that publishes the cache connections' lifecycle on the `prom-client`
  registry that `@bymax-one/nest-core` serves. `CacheConnectionTally` records each connection event per role
  (`main`, `subscriber`) and hands `BymaxCacheModule` its `events`; `CacheConnectionMetrics` is a
  nest-core metrics contributor that registers `bymax_cache_connection_events_total` (by `role` and `event`) and
  `bymax_cache_connection_ready` (by `role`). An `error` event carrying a `reason` (a forced disconnect at shutdown, a
  subscriber handler that threw) is counted but never moves readiness. Labels come from a closed set, and no part
  of an error message is ever a label. `@bymax-one/nest-core` (`^1.1.0`) and `prom-client` (`^15`) are optional
  peers, and no other entry loads either.

#### Apply to a consumer

Nothing changes unless you set `keyEscaping: 'strict'` or import `@bymax-one/nest-cache/metrics`: the default keeps every key byte-identical.

Switching to `'strict'` changes the key of every part the escape rewrites, that is, a part holding the key
separator, `%`, an unpaired surrogate, or (in the prefix) `*`, `?`, `[` or `\`. A part holding none of those
keeps its key. The library cannot see which of your locks or rate-limit counters pass such a part, so
check your own before you switch.

If you followed the earlier advice and encoded each field with `encodeURIComponent`, that encoding is now
applied twice: a field you encoded to `a%3Ab` is escaped again to `a%253Ab`. Drop the per-field encoding when you
switch, and expect those entries to miss once. `KeyBuilder.buildLegacy(prefix, id)` returns the old key, for a
host that reads the old key and writes the new one. To join several fields into one `id`, escape each with
`KeyBuilder.escapePart` and join them with the separator.

Every instance sharing a Redis must run one mode. During a rolling deploy the two modes compose a different key
for a part the escape rewrites, so a lock on such a part can be held once per mode and a counter on it splits in
two until the older instances are gone. Quiesce locks and limits on those prefixes while you switch, or accept up
to twice the budget for the counter's TTL. A key with no such part is the same in both modes, so its lock and
counter hold across the rollout. `CacheStatusService.config().keyEscaping` shows what an instance runs.

## [1.2.11] - 2026-11-09

### Fixed

- `ConnectionManager.getClient()` and `createSubscriberClient()`, and so the `CacheService` and
  `PubSubService` calls that reach Redis, no longer open a new Redis client once shutdown has begun. The first call after
  `onApplicationShutdown` quietly built a client that nothing closed: it kept reconnecting and could keep
  the process alive. The call now fails with a `CacheException` whose code is `cache.connection_lost` and
  whose `details.reason` is `'shutdown'`; `PubSubService.subscribe` and `psubscribe` reject the same way
  once the service itself has shut down.

#### Apply to a consumer

A cache call made after the application has shut down used to succeed against a fresh connection and now
rejects, and `pipeline()` and `getClient()` throw. Work that still touches the cache from its own shutdown hook must run
before the library's `onApplicationShutdown` closes the client; a hook ordered after it has to treat the
cache as gone. The declarations gain only a private method on `ConnectionManager`.

## [1.2.10] - 2026-11-06

### Fixed

- The Redis connections now close after the HTTP server has stopped, not before. `ConnectionManager` and
  `PubSubService` closed their clients in `onModuleDestroy`, which Nest runs first on shutdown, while the
  server is still answering: every request in flight when a `SIGTERM` arrived lost its cache and failed
  (a server-sent-events endpoint answered 500 during shutdown). They now close in `onApplicationShutdown`,
  which Nest runs after it has stopped the server, so those requests complete. The timeout and the forced
  `disconnect()` after `shutdownTimeoutMs` are unchanged.

#### Apply to a consumer

`onModuleDestroy` is gone from `ConnectionManager` and `PubSubService`, replaced by
`onApplicationShutdown`. Nest calls the new hook for you on `app.close()`, and on a
signal when shutdown hooks are enabled (`app.enableShutdownHooks()`), as it did for the old one; code that called
`connection.onModuleDestroy()` or `pubsub.onModuleDestroy()` itself, in a test for instance, calls
`onApplicationShutdown()` instead. Other providers that use the cache in their own
`onModuleDestroy` or `beforeApplicationShutdown` now find it open rather than closed.

## [1.2.9] - 2026-11-06

### Fixed

- A cluster client now fails fast, as the standalone and sentinel clients do. The cluster branch passed
  `cluster.options` to ioredis untouched, so it ran on ioredis defaults: an offline queue that is on and no
  command timeout. When the cluster went down after boot, every
  cache call waited in that queue for as long as the outage lasted (measured still pending after 20 s,
  against about 0 ms standalone), so a caller that treats an unreachable cache as a miss never reached its
  fallback. The cluster client now starts from `enableOfflineQueue: false` and `redisOptions` of
  `connectTimeout` 10 000 ms, `commandTimeout` 5 000 ms and `maxRetriesPerRequest` 3, and anything set in
  `cluster.options` (including `cluster.options.redisOptions`) wins over them. The subscriber client keeps
  an offline queue, as in the other modes, so a subscribe issued before its sockets are ready is buffered.
- Apply to a consumer: if you run `mode: 'cluster'`, a cache call made while the cluster is unreachable now
  rejects at once instead of waiting; handle that rejection the way you handle a standalone one. To keep
  the old queueing, set `cluster.options.enableOfflineQueue: true`. The public declarations are unchanged.

### Changed

- The shipped `index.mjs` and `index.cjs` bundles no longer carry comments (the `.d.ts` and `.d.cts` files,
  where editors read the documentation, are untouched). Comments were about half of the server bundle's
  brotli size. The build proves each stripped bundle is the same program before it writes anything.
- Built with tsup 9. The runtime bundles are byte-identical; the declaration files differ only in how the
  final export list is spelled (`export { A }; export type { B }` instead of `export { A, type B }`), which
  `pnpm check:api` reports as no difference.

### Tests

- `src/readme-quickstart.spec.ts` runs the README Quick Start as written: the standalone module and the
  `ProfileService` cache-aside flow, over an in-memory Redis, asserting that the value is stored under
  `app:user-profile:<userId>` with a 3600-second TTL and served from the cache on the second call. The
  snippet gate compiles the Quick Start but cannot run it.

## [1.2.8] - 2026-11-01

### Fixed

- `PubSubService.subscribe` and `psubscribe` no longer report a subscription the server never accepted.
  The first listener on a channel or pattern recorded it before the `SUBSCRIBE` / `PSUBSCRIBE` had been
  accepted. When that command failed (a `LOADING` reply, a reset connection, a command timeout), the
  caller got the error, but the record stayed: the next `subscribe()` on the same channel found it, sent
  no command, and resolved, so its handler was attached to a subscription that was never made and
  no message ever reached it. A caller that arrived while the command was still in flight was told it
  was subscribed before the outcome was known, with the same result.
- Every listener now waits for the same in-flight command. When it fails, all of them reject and the
  record is dropped, so the next call sends the command again; a listener counts from the moment it
  joins, so the last other listener leaving while it waits cannot unsubscribe the channel under it. The
  public signatures are unchanged.

## [1.2.7] - 2026-11-01

### Fixed

- A thrown or rejected value that cannot be printed no longer makes the error path throw. Caught values
  were turned into text with `err instanceof Error ? err.message : String(err)`, and
  `String()` throws for an object with no prototype (`Object.create(null)`) or a `toString` that throws.
  A `toJSON` hook that threw such a value escaped `JsonSerializer.serialize` as a `TypeError` instead of
  `cache.serialization_failed`; a Redis script rejection of that kind escaped `ScriptManagerService.eval`
  as a `TypeError` instead of `cache.script_execution_failed`; and a Pub/Sub handler that threw one was
  never reported to `onEvent`, because the reporter threw inside its own guard.
- Those sites now share a `describeError` helper that never throws. It reads a string `message`
  from the value itself instead of testing `instanceof Error`, which is false for an `Error` created in
  another realm (`vm`, a worker) and for an error-shaped object; otherwise it uses `String()`, and
  falls back to the fixed text `unprintable error`.

## [1.2.6] - 2026-10-31

### Added

- **`createConnectionManager(options)`**, exported from the main entry. It takes the options
  `BymaxCacheModule.forRoot` takes, validates and defaults them exactly as the module does, and returns a
  `ConnectionManager` that Nest connects on `onModuleInit` and quits on `onModuleDestroy` when it is
  registered as a provider. A consumer that needs a second, dedicated connection (for example a standalone
  one beside a clustered cache) no longer has to hand-write `ResolvedOptions`, which skipped validation and
  the defaults. The README has a section, "A second, dedicated connection", with a provider snippet.

### Internal

- `forRoot`, `forRootAsync` and `createConnectionManager` share one `resolveOptions` function, so the
  sequence "validate, then apply defaults" is written once. Nothing about `forRoot` or `forRootAsync`
  changes.

## [1.2.5] - 2026-10-31

A documentation and test release. Nothing you execute changes: `dist/` differs from 1.2.4 only in one comment, the
JSDoc of `ConnectionManager.createSubscriberClient`, which no longer calls cluster Pub/Sub experimental.

### Documentation

- The README states that Pub/Sub works in cluster mode: channel and pattern subscribers both receive the
  message. The same sentence in the `createSubscriberClient` JSDoc described it as an experimental
  passthrough.

### Tests

- The cluster end-to-end suite runs three masters on `redis:8-alpine`, formed with `redis-cli --cluster
create`, and measures what the cluster guards claim: `keys`, `getClient`, `scan`, `flushNamespace` and the
  administration calls that read keys throw `UNSUPPORTED_IN_CLUSTER`, a rejected `ttlSeconds` writes nothing,
  and Pub/Sub delivers to channel and pattern subscribers. Without the `keys` guard a real cluster returned
  2 of 6 seeded keys.

## [1.2.4] - 2026-10-31

Two calls now refuse input they could not honor, one error code is added, and the documentation catches up with the code.

### Added

- **`CACHE_ERROR_CODES.INVALID_TTL` (`cache.invalid_ttl`, HTTP 400)**, thrown for a TTL the library refuses. See Changed.

### Changed

- **`CacheService.keys()` is refused in cluster mode.** `KEYS` carries no key, so the cluster client sends
  it to one sampled node and the reply listed only that node's share of the keyspace, with no sign that it
  was partial. It now throws `UNSUPPORTED_IN_CLUSTER` with `details.operation: 'keys'`, like `scan`,
  `getClient` and `flushNamespace`. **Apply to a consumer.** A cluster deployment that called `keys()`
  must iterate with `scan` on each node through its own client, or avoid listing keys; standalone and
  sentinel are unchanged.
- **`ttlSeconds` is validated, with a new error code, `cache.invalid_ttl` (HTTP 400).** `set`, `setRaw`
  and `setNx` need a safe integer of at least 1, or none for no expiry; `expire` needs a safe integer,
  and zero or a negative one still deletes the key, as in Redis. Anything else throws `CacheException`
  with `INVALID_TTL` and `details.reason` set to `not_a_safe_integer` or `below_minimum`, before a command
  is sent. **Apply to a consumer.** What now throws `INVALID_TTL`: `set`, `setRaw`, `setNx` with `0`, a negative number, a fraction, `NaN`, `Infinity` or an integer above 2^53; `expire` with a fraction, `NaN`, `Infinity` or an integer above 2^53. Redis documents `SET ... EX` as a positive integer and `EXPIRE` as an
  integer, and answers anything else with a raw reply error that carries no `cache.*` code, so the values
  refused here already failed. The one exception is an integer above 2^53 seconds, a TTL of about 285
  million years, which this refuses and Redis may accept. Code that caught the raw error by its message
  should switch to `error.code === 'cache.invalid_ttl'`.

### Deprecated

- **Implementation helpers exported from `@bymax-one/nest-cache/admin`** are marked `@deprecated` and will
  leave the public surface in 2.0.0: `validateScopes`, `findScope`, `isKeyInScope`, `readScopePattern`,
  `resolveAdminOptions`, `ResolvedAdminOptions`, `parseInfoFields`, `readRedisStats`, `readKeyTtl`,
  `readKeyType`, `readSizeBytes`, `IRedisReader`, `IRedisReaderSource`, `IRedisPipeline`,
  `PipelineReply` and `ICacheProbe`. They keep working in 1.x. Do not depend on them.

### Documentation

- The README error-code table described `cache.shutdown_timeout` as thrown when `quit()` exceeds
  `shutdownTimeoutMs`. It never reaches the caller: the library forces `disconnect()` and emits an
  `error` event with `reason: 'forced_disconnect'`. The row now says so.
- The README states that `app.enableShutdownHooks()` is required for the graceful shutdown to run, and
  carries a warning that `/admin` has no authentication of its own. It documents the `/admin` options
  and their defaults and the exported types, constants and tokens it left out, lists `keys` among the
  cluster-refused calls, and marks the three codes the library never throws as reserved.
- The sentinel example passed `process.env.REDIS_PASSWORD` as `password`, which does not compile
  for a consumer that enables `exactOptionalPropertyTypes`. It now falls back to an empty string,
  which ioredis treats like no password.

### Tests

- `src/readme.spec.ts` parses the README's option-defaults table and error-code table and asserts them
  against the resolved defaults, the minimum timeouts, `CACHE_ERROR_CODES` and the status each
  `CacheException` carries, so a README that drifts from the code fails CI.

### Internal

- `check:published` compiles every README snippet, not only the ones that import the package, through the
  TypeScript API so a syntax error in one snippet no longer hides the type errors in the others. A
  snippet that omits its import is given the package's public names, and the names a snippet takes from
  the surrounding prose are typed in `scripts/readme-prelude.d.ts`, so a wrong method, option or field is
  an error instead of a call on `any`.
- The same gate no longer excuses a wrong method on an imported type or on a union-typed value as a
  class the README abbreviates, and a relative import in a snippet that resolves to nothing fails it.
- The same gate now checks the typed names the snippets rely on, so a name in that declaration file that
  stops resolving is an error instead of silently becoming `any`, and it tolerates a parse error only
  where the parse tree shows a `...` elision, so a genuine syntax error in a snippet fails it.

## [1.2.3] - 2026-10-30

### Changed

- `JsonSerializer.deserialize` throws `DESERIALIZATION_FAILED` with `details` of a fixed `error` text and the
  `length` of the stored value. `details.preview` and the parser's own message, which quoted the start of the
  input, are gone. The error code is unchanged; a consumer that read `details.preview` must stop.
- **Apply to a consumer.** Do not read `details.preview` or `details.error` to debug a decoding
  failure. Log the error on the server by its code, `cache.deserialization_failed`; the call site already
  knows the prefix and id it asked for. Use `details.length` when you need a size signal. A backend that
  sent `details` to its clients needs no other change: the response no longer carries any part of the
  stored value.
- Apart from that, nothing you execute changes.

### Documentation

- `README.md`, `docs/technical_specification.md` and the contributor documents state that
  `KeyBuilder` validates `prefix` and `id` only for emptiness. A separator inside either
  collides (`build('a', 'b:c')` and `build('a:b', 'c')` both give `app:a:b:c`), and a glob
  metacharacter in `prefix` widens `keys()` and `scan()` within the namespace. Behaviour is
  unchanged. Keys are unambiguous only for a single-character separator that appears in neither field; encoding each field with `encodeURIComponent` provides that for a separator it escapes and never emits, such as the default `':'`.
- Contributor and security documents match the current tooling: pnpm 11, the admin
  read-only check in the verification chain, mutation testing after merge and weekly, and
  how dependency advisories are handled.

### Security

- **A non-JSON stored value no longer appears in the exception body.** `CacheException` extends
  `HttpException`, so a default Nest filter sends `details` to the HTTP client. A cached value that was
  not JSON (written by another writer, or by another serializer) leaked up to 100 characters of itself
  through `details.preview`, and the start of it through `details.error`. It could carry PII or a token.
  Only a malformed entry triggers it; a valid JSON value never does.
- Dependency advisories in development-only transitive dependencies are fixed by raising the
  `overrides` floors in `pnpm-workspace.yaml`. None of them ships: the package
  publishes with `"dependencies": {}`, so no consumer was exposed to these advisories.
- `GHSA-gcqx-w48m-w2h4` (`deepmerge`, reached only through `jest-config`) has no patched
  release. It is suppressed in `osv-scanner.toml` until 2027-01-27 and nowhere else.

### Internal

- Development dependencies updated within their ranges; GitHub Actions bumped.

## [1.2.2] - 2026-09-04

### Changed

- **Nothing you execute changes.** `dist/` built from this tag is byte-for-byte
  identical to 1.2.1 — verified by unpacking the published 1.2.1 tarball and
  diffing it against a fresh build, not asserted. `src/` has not been touched
  since 1.2.1.

  Two files in an installed copy do differ, and neither is code: the `version`
  field in `package.json`, and this changelog. Upgrading from 1.2.1 changes no
  behaviour; staying on 1.2.1 costs you nothing.

  The version exists because the repository moved underneath the artifact, and a
  released tag is where that movement is recorded.

### Security

- **Three advisory fixes, all in development dependencies.** `browserslist` to
  4.28.8 (GHSA-73wf-gq98-2v4g, GHSA-c83g-rgw3-j3cx), `fast-uri` to 3.1.6 (four
  advisories at CVSS 7.5) and `qs` to 6.16.0 (GHSA-4mjr-xmp4-gh2g,
  GHSA-x5fp-wj9c-mxmx). All three are reached through `@stryker-mutator/*`, which
  is a devDependency, and this package publishes with `"dependencies": {}`.

  **No consumer was exposed and none is protected by this release.** The fixes
  protect the build environment. They are listed because "Security" in a changelog
  is read as "upgrade for this", and here that reading would be wrong.

  Two of the three were already pinned in `overrides` at floors that already
  admitted the fixed versions, and protected nothing: a caret there is a floor
  applied when resolution happens, not a standing instruction to re-resolve. The
  check that works is the resolved version in the lockfile, never the presence of
  an entry.

### Internal

- ESLint 9 to 10, with `eslint-plugin-import` replaced by the maintained fork
  `eslint-plugin-import-x`. The 9 line is end-of-life: 9.39.5 is the last release
  and is itself deprecated, and the `maintenance` dist-tag points at it.
- `import-x/parsers` is now configured, which fixes a rule that had never worked.
  `no-cycle` was declared `error` and reported as active by `--print-config` while
  a real two-file cycle passed with exit 0, because the dependency parser skips in
  silence every extension it cannot map. No cycles exist in `src/`; the gate was
  simply open.
- `@parcel/watcher`'s build script is recorded as denied, so `pnpm install` stops
  failing on it under pnpm 11.
- The shared Bymax code-review rules are adopted in `AGENTS.md`, kept in step by
  the `agents-sync` workflow.

## [1.2.1] - 2026-08-21

### Changed

- **`RevealedValue`'s hash arm now names each entry `field`, not `name`**
  (`{ field, value }`). Redis's own vocabulary for a hash is field/value —
  `HSET key field value`, `HDEL key field`, and `HGETALL` returns field-value
  pairs — so a generic `name` lost the domain term in the one place a reader
  would check the shape against the server's documentation.

  This is a **type-level breaking change** shipped as a patch, deliberately and
  with the trade-off stated: `RevealedValue` was published in 1.2.0 roughly an
  hour earlier, no consumer had wired it yet, and correcting a freshly published
  name is cheaper than carrying a permanent vocabulary mismatch or maintaining
  two names for one concept. A consumer that already destructured `name` gets a
  compile error, not a silent behaviour change.

  The library emits **one** name. Aliasing `field` and `name` together would have
  been two names for one idea, which is the defect this corrects rather than a
  softer way to ship it.

## [1.2.0] - 2026-08-21

### Security

- **`validateOptions` now rejects a namespace containing a Redis glob metacharacter
  (`*`, `?`, `[`, `\`).** The namespace is this library's isolation boundary and it was
  composed unvalidated into `flushNamespace`'s destructive match pattern
  (`{namespace}{separator}*`), so a metacharacter changed which keys `UNLINK` reached.
  Measured against Redis 8.10.0, each one broke isolation differently: `*` and `?` **widen**
  the pattern (namespace `ten*ant` matches every other tenant's keys, turning a scoped flush
  into a cross-tenant delete); `\` **escapes** the next character (namespace `ten\ant`
  matches `tenant:*` — a different keyspace — while sparing its own keys); and `[` opens a
  character class that never closes, so the pattern matches **nothing** and `flushNamespace`
  removes none of the namespace's keys while returning `0`, which reads as a successful flush.
  Triggering it required a misconfigured namespace, so no default configuration was exposed;
  the case to worry about is a namespace derived from input, such as multi-tenant wiring using
  a tenant slug. `]` is deliberately still accepted — measured to be a literal that neither
  widens nor silences the pattern.
- An **empty `keySeparator`** now fails with its own message. It was already rejected, but by
  coincidence: the next guard is `namespace.includes(separator)` and `'anything'.includes('')`
  is `true` for every string, so it reported _"namespace contains key separator"_ — something
  the consumer had not done.

### Added

- **New subpath `@bymax-one/nest-cache/admin`** — a privileged, read-only administration
  surface: health, parsed `INFO` statistics, resolved configuration, keyspace listing, key
  inspection and value reveal. Kept out of the main entry deliberately: importing it is a
  greppable, reviewable act; a consumer who never wires it cannot resolve a reveal service
  from DI by accident and does not pay for it in the main bundle.
- `BymaxCacheAdminModule.forRoot()` / `.forRootAsync()`, `CacheStatusService`,
  `CacheAdminService`, and the scope model (`CacheScope`, `validateScopes`, `findScope`,
  `isKeyInScope`).
- New error codes: `cache.invalid_scope`, `cache.scope_not_found`, `cache.scope_not_readable`,
  `cache.key_not_in_scope`.
- `ResolvedOptions` and `DEFAULT_REDIS_PORT` are now exported from the main entry. The former
  is the shape stored under the already-exported `BYMAX_CACHE_OPTIONS` token, which previously
  had no public type.
- `pnpm check:admin-readonly` — a build gate that fails if the admin subpath declares a method
  named after a mutating Redis command, sends a non-allowlisted command through the `call`
  escape hatch, or imports `ioredis` as a value. Wired into `prepublishOnly`.

### Administration surface — shapes chosen deliberately

- **The application declares which keyspaces exist; the library validates and serves them.**
  A cache library cannot know that another library writes at Redis root through
  `getClient()`, and must not depend on that library to learn it.
- **`isReadable: false` withholds the value only.** Listing, types, TTLs and sizes stay
  available. A surface that renders an unreadable keyspace as empty tells an operator the
  region holds nothing when it is full — the same defect as a blank log page during an outage.
- **Scope patterns are restricted to a literal prefix with at most one trailing `*`.** A
  caller names a key, so the library must decide whether that key belongs to the named scope.
  Deciding that for arbitrary globs means reimplementing Redis's `stringmatchlen`, and a
  matcher even slightly _more_ permissive than the server's is a silent cross-scope leak that
  no happy-path test would show. With this shape, membership is exact by construction — and it
  is checked differentially against a real server in the E2E suite.
- **Health is three states and `latencyMs` cannot exist without a measurement.** The type is
  a union, so a handler that caught a throwing ping and returned a confident status does not
  compile. `mode` and `isScanSupported` sit outside the union: a cluster deployment that is
  down should still report that scanning was never going to work.
- **Every reading that would carry two meanings under one `null` is a union.**
  `maxmemory` is `unbounded | limited | unreported` (Redis spells "no ceiling" as
  `maxmemory:0`, which read literally draws a full saturation bar on the least constrained
  server there is); `TTL` is `expiring | persistent | missing` (`-1` and `-2` are different
  facts, and the key that expired mid-listing is the one an operator is watching);
  `aofEnabled` is nullable, because `false` for an absent field is a durability claim made
  without evidence.
- **`connection.url` is never on the wire.** The config payload carries host, port and a TLS
  flag; the URL and its password are never read into this subpath at all.
- **Sampled figures are named `sampledCount` / `sampledBytes`.** They are sums over a capped
  `SCAN`, not measurements of the keyspace. `isComplete` is the fact; the names are the guard,
  because a caller reaching for one does not necessarily read the other.
- **Pipeline batches are bounded in commands, not keys.** Redis is single-threaded, so a
  pipeline converts a network cost into a server-blocking one — describing N keys is two or
  three commands each, and one flush blocks every other client for the whole burst, on a
  server someone is inspecting precisely because it is unwell. Sizing is opt-in for the same
  reason.

### Internal

- Bundle-size budgets recalibrated: server `14.50` → `15.00` kB, admin added at `7.25` kB
  against a measured `6.60` kB. The admin entry marks `@bymax-one/nest-cache` **external** —
  bundling the server modules would give it its own copies of `CacheService` and the DI
  tokens, so `@Inject(CacheService)` in an admin provider would name a different class object
  than the one `BymaxCacheModule` registered and DI would fail at a consumer's runtime.
- E2E coverage for the admin subpath against a real Redis, asserting all twenty-four `INFO`
  field names the parser reads, real `MEMORY USAGE` sizing, and the differential scope-membership
  check. `ioredis-mock` supports none of those three (measured), so a unit suite alone could not
  have verified them.

## [1.1.0] - 2026-08-11

### Changed

- **BREAKING: peer dependency `ioredis` migrated `^5` → `^6`.** A consumer must move to
  ioredis 6, which aligns this package with `@bymax-one/nest-queue` so a single ioredis copy
  resolves across a workspace that uses both. ioredis 6 negotiates **RESP3** on the wire by
  default — the protocol changes at runtime — but its `'legacy'` reply mapping preserves every
  reply shape this cache relies on (GET/SET/TTL, EVALSHA, Pub/Sub message events, cluster and
  sentinel commands), so observable behaviour is unchanged; the only source change is the
  compile-time typing narrowing below. ioredis 6 requires Node.js ≥ 20, already covered by
  this package's `engines` (Node ≥ 24).

### Internal

- `ConnectionManager` narrows the options handed to the `Redis` and `Cluster` constructors
  to a local shape (`OwnedRedisOptions` / `OwnedClusterOptions`). ioredis 6's constructor
  overloads intersect `replyMapping` with a non-`undefined` variant to infer the
  reply-mapping generic, which makes a plain `RedisOptions`/`ClusterOptions` value
  unassignable under `exactOptionalPropertyTypes`. The narrowing drops only that `undefined`;
  the runtime object is untouched.
- Mutation gate tightened: Stryker `break`/`high`/`low` raised to **100** (the run is at
  100%, 0 survivors).

## [1.0.6] - 2026-08-06

### Fixed

- `ConnectionManager.onModuleInit()` assigned a freshly created client over the field
  unconditionally. When something had already opened the main client through
  `getClient()`, that first socket was left connected with no reference left to close it —
  `onModuleDestroy()` quits only the current client, so the abandoned one stayed in Redis's
  `CLIENT LIST` until its own timeout. Init now adopts an existing client instead of
  replacing it, and the assignment lives in one private accessor so no other path can
  strand a live connection.

  Reaching it takes touching the cache before the cache module's own init hook runs, which
  is possible in two ordinary shapes: NestJS orders `onModuleInit` by module depth, so a
  consumer module deeper in the graph runs first, and `app.get()` works between
  `NestFactory.create()` and `app.init()`. The ordinary boot path opened exactly one client
  before this change and still does.

## [1.0.5] - 2026-08-06

**Documentation, tests and E2E only.** `dist/` is byte-identical to `1.0.4`.

### Fixed

- The Redis Cluster E2E was flaky at roughly one run in three, failing with `CLUSTERDOWN` or
  "Too many Cluster redirections". The container log line proves `redis-cli --cluster create`
  printed its coverage message, but what the client needs is the state each node serves on the
  port the test dials. The helper now polls `CLUSTER INFO` on every node until all six report
  `cluster_state:ok` and full slot coverage. Six consecutive runs of the previously flaky spec
  pass, where it failed three times in nine before.

### Documentation

- The mutation badge said **100%**; the measured score is **99.78%**.

### Tests

- `findProvider` gained a spec of its own; it had only ever been exercised through the module
  suites, where either half of its disjunction covered for the other.

## [1.0.4] - 2026-08-04

### Security

- The Redis credentials are no longer disclosed when a service that holds the resolved
  options is serialized. The three connection shapes — `connection`, `sentinel` and
  `cluster` — move from plain fields on the resolved options to non-enumerable accessors,
  and `ConnectionManager` keeps its client and the driver options built from them, as does
  `PubSubService` with its subscriber, in ECMAScript private fields. A `url` carries the
  password inline, the discrete forms carry it as a field, and an ioredis instance carries
  `options.password` as a plain field, so `JSON.stringify`, object spread and
  `util.inspect` on any holder emitted it in plaintext — which is what a structured logger
  does when it renders a provider it was handed, and what an error reporter does when it
  captures the scope of a throw.

Reading on purpose is unchanged: `options.connection` resolves as before, and no public
type or export moved.

## [1.0.3] - 2026-08-01

### Security

- **Peer floors raised to exclude known-vulnerable NestJS versions.** The declared
  ranges were `@nestjs/common ^11.0.0` and `@nestjs/core ^11.0.0`, and both
  admitted versions carrying published advisories:

  | Peer             | Advisory                                                                                                                                    | Vulnerable                    | New floor  |
  | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------- |
  | `@nestjs/common` | [GHSA-cj7v-w2c7-cp7c](https://github.com/advisories/GHSA-cj7v-w2c7-cp7c) — remote code execution via the `Content-Type` header              | `>= 11.0.0-next.1, < 11.0.16` | `^11.0.16` |
  | `@nestjs/core`   | [GHSA-36xv-jgw5-4q75](https://github.com/advisories/GHSA-36xv-jgw5-4q75) — improper neutralization of special elements in downstream output | `<= 11.1.17`                  | `^11.1.18` |

  A peer range is a statement about which versions this library supports. Leaving
  the floor below a published advisory told a consumer that a vulnerable install
  was a supported one, and nothing in their tooling contradicted it — the install
  resolved cleanly and silently.

  Shipped as a patch, which is where a security fix belongs. A minor would have
  bought nothing: `^1.0.2` accepts `1.1.0` just as readily as `1.0.3`, so the same
  installs are affected either way. No runtime behaviour changed.

## [1.0.2] - 2026-07-29

### Fixed

- **The `./shared` subpath now resolves under `moduleResolution: node`.** A
  `typesVersions` map points the subpath at its `.d.cts` declarations, which is
  the only mechanism that resolution algorithm understands — it predates
  `exports` and ignores it entirely. Without this, a consumer whose tsconfig
  sets `module: commonjs` without an explicit `moduleResolution` (the default
  the Nest CLI scaffolds, which falls back to `node`) got
  `error TS2307: Cannot find module '@bymax-one/nest-cache/shared'` while the
  root entrypoint resolved fine. Runtime was never affected: Node reads
  `exports`, so `require('@bymax-one/nest-cache/shared')` always worked.

  This supersedes the note under 1.0.1 claiming the subpath was "not fixable
  without a directory shim" — that was wrong, `typesVersions` fixes it with no
  extra files in the tarball.

### Changed

- `check:exports` now runs the **strict** `attw` profile. The `--profile node16`
  escape hatch existed only to ignore the failing `node10` row, which no longer
  fails, so every entrypoint is now verified in every resolution mode.

## [1.0.1] - 2026-07-29

### Fixed

- **CommonJS consumers no longer receive ESM type declarations.** Both subpaths
  now declare `types` per condition, so `require()` resolves to the `.d.cts`
  declarations that match the `.cjs` runtime. Previously a single `types` entry
  pointed at the `.d.ts` files, which — with `"type": "module"` — TypeScript
  reads as ESM, so a project on `moduleResolution: node16` / `nodenext`
  importing from CommonJS got declarations for the wrong module format.
- Added top-level `main`, `module` and `types` so the root entrypoint also
  resolves under the legacy `moduleResolution: node` algorithm. The `./shared`
  subpath remains unresolvable in that mode, which is inherent to subpath
  exports and not fixable without a directory shim.
- Exposed `./package.json` through the `exports` map. Reading it previously
  failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`, which breaks tooling that
  inspects an installed package's manifest.

### Added

- `pnpm check:exports` (`@arethetypeswrong/cli`) — packs the tarball and
  resolves every entrypoint the way each module resolution mode would. Wired
  into CI and into the release-shape gates, since the type-level API tests
  compile `src` and therefore cannot catch a broken `exports` map.

## [1.0.0] - 2026-07-29

### Added

- Initial public release of `@bymax-one/nest-cache`
- `BymaxCacheModule.forRoot()` and `forRootAsync()` via `ConfigurableModuleBuilder` — global by default
- `ConnectionManager` — singleton ioredis 5 client with full lifecycle (`OnModuleInit` / `OnModuleDestroy`), bounded retry strategy, `READONLY`-failover reconnect, and graceful `quit()` with configurable shutdown timeout
- Standalone, Sentinel, and Cluster connection topologies from a single options shape
- `CacheService` — typed, namespaced command API:
  - Strings: `get<T>` · `getRaw` · `set<T>` · `setRaw` · `setNx<T>`
  - Delete / exists: `del` · `delMany` · `exists`
  - TTL: `expire` · `persist` · `ttl`
  - Numerics: `incr` · `decr`
  - Batch: `mget<T>` · `mset<T>`
  - Hashes: `hget<T>` · `hset<T>` · `hgetall<T>` · `hdel`
  - Sets: `sadd` · `srem` · `smembers` · `sismember` · `scard`
  - Iteration: `keys` (dev only) · `scan` (cursor-based, async iterator)
  - Pipeline / escape hatch: `pipeline` · `getClient`
  - Namespace: `flushNamespace` (production safety guard)
  - Health: `isHealthy` · `ping` · `info`
- `KeyBuilder` — `{namespace}{separator}{prefix}{separator}{id}` composition with configurable namespace and separator; all keys namespaced automatically; raw access via `getClient()` documented as an anti-pattern
- `ISerializer` interface + default `JsonSerializer` — fail-closed deserialization (malformed payloads throw `CacheException(DESERIALIZATION_FAILED)`, never a partial value)
- `PubSubService` — `publish<T>` / `subscribe<T>` / `psubscribe<T>` on namespaced channels; subscriber connection created lazily on first subscription
- `ScriptManagerService` — `register` / `load` / `eval` with `EVALSHA` + automatic `NOSCRIPT` reload-and-retry; cluster mode uses `EVAL` (body routing by key)
- Connection lifecycle events surfaced via `events.onEvent` callback (plug any logger or metrics backend — no observability peer dep forced)
- `CacheException` (extends `HttpException`) + `CACHE_ERROR_CODES` — stable `cache.*` error codes with mapped HTTP statuses
- Subpath exports: `.` (server — NestJS module + services) and `./shared` (zero-dependency types + constants)
- 100% coverage gate (statements / branches / functions / lines) enforced by `jest.coverage.config.ts`
- Mutation score: **100% global** (427 killed, 6 timeout, 0 survived) under Node 24 — `pnpm mutation` exits 0 (`break: 95`)
- E2E suite: `@nestjs/testing` with `ioredis-mock` + Testcontainers (standalone, sentinel, cluster, connection resilience)
- Published with npm OIDC provenance — no long-lived tokens
- Zero direct runtime dependencies (`dependencies: {}`) — `ioredis` and NestJS via peer deps

[Unreleased]: https://github.com/bymaxone/nest-cache/compare/v1.2.41...HEAD
[1.2.41]: https://github.com/bymaxone/nest-cache/compare/v1.2.40...v1.2.41
[1.2.40]: https://github.com/bymaxone/nest-cache/compare/v1.2.39...v1.2.40
[1.2.39]: https://github.com/bymaxone/nest-cache/compare/v1.2.38...v1.2.39
[1.2.38]: https://github.com/bymaxone/nest-cache/compare/v1.2.37...v1.2.38
[1.2.37]: https://github.com/bymaxone/nest-cache/compare/v1.2.36...v1.2.37
[1.2.36]: https://github.com/bymaxone/nest-cache/compare/v1.2.35...v1.2.36
[1.2.35]: https://github.com/bymaxone/nest-cache/compare/v1.2.34...v1.2.35
[1.2.34]: https://github.com/bymaxone/nest-cache/compare/v1.2.33...v1.2.34
[1.2.33]: https://github.com/bymaxone/nest-cache/compare/v1.2.32...v1.2.33
[1.2.32]: https://github.com/bymaxone/nest-cache/compare/v1.2.31...v1.2.32
[1.2.31]: https://github.com/bymaxone/nest-cache/compare/v1.2.30...v1.2.31
[1.2.30]: https://github.com/bymaxone/nest-cache/compare/v1.2.29...v1.2.30
[1.2.29]: https://github.com/bymaxone/nest-cache/compare/v1.2.28...v1.2.29
[1.2.28]: https://github.com/bymaxone/nest-cache/compare/v1.2.27...v1.2.28
[1.2.27]: https://github.com/bymaxone/nest-cache/compare/v1.2.26...v1.2.27
[1.2.26]: https://github.com/bymaxone/nest-cache/compare/v1.2.25...v1.2.26
[1.2.25]: https://github.com/bymaxone/nest-cache/compare/v1.2.24...v1.2.25
[1.2.24]: https://github.com/bymaxone/nest-cache/compare/v1.2.23...v1.2.24
[1.2.23]: https://github.com/bymaxone/nest-cache/compare/v1.2.22...v1.2.23
[1.2.22]: https://github.com/bymaxone/nest-cache/compare/v1.2.21...v1.2.22
[1.2.21]: https://github.com/bymaxone/nest-cache/compare/v1.2.20...v1.2.21
[1.2.20]: https://github.com/bymaxone/nest-cache/compare/v1.2.19...v1.2.20
[1.2.19]: https://github.com/bymaxone/nest-cache/compare/v1.2.18...v1.2.19
[1.2.18]: https://github.com/bymaxone/nest-cache/compare/v1.2.17...v1.2.18
[1.2.17]: https://github.com/bymaxone/nest-cache/compare/v1.2.16...v1.2.17
[1.2.16]: https://github.com/bymaxone/nest-cache/compare/v1.2.15...v1.2.16
[1.2.15]: https://github.com/bymaxone/nest-cache/compare/v1.2.14...v1.2.15
[1.2.14]: https://github.com/bymaxone/nest-cache/compare/v1.2.13...v1.2.14
[1.2.13]: https://github.com/bymaxone/nest-cache/compare/v1.2.12...v1.2.13
[1.2.12]: https://github.com/bymaxone/nest-cache/compare/v1.2.11...v1.2.12
[1.2.11]: https://github.com/bymaxone/nest-cache/compare/v1.2.10...v1.2.11
[1.2.10]: https://github.com/bymaxone/nest-cache/compare/v1.2.9...v1.2.10
[1.2.9]: https://github.com/bymaxone/nest-cache/compare/v1.2.8...v1.2.9
[1.2.8]: https://github.com/bymaxone/nest-cache/compare/v1.2.7...v1.2.8
[1.2.7]: https://github.com/bymaxone/nest-cache/compare/v1.2.6...v1.2.7
[1.2.6]: https://github.com/bymaxone/nest-cache/compare/v1.2.5...v1.2.6
[1.2.5]: https://github.com/bymaxone/nest-cache/compare/v1.2.4...v1.2.5
[1.2.4]: https://github.com/bymaxone/nest-cache/compare/v1.2.3...v1.2.4
[1.2.3]: https://github.com/bymaxone/nest-cache/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/bymaxone/nest-cache/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/bymaxone/nest-cache/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/bymaxone/nest-cache/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/bymaxone/nest-cache/compare/v1.0.6...v1.1.0
[1.0.6]: https://github.com/bymaxone/nest-cache/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/bymaxone/nest-cache/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/bymaxone/nest-cache/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/bymaxone/nest-cache/releases/tag/v1.0.3
[1.0.2]: https://github.com/bymaxone/nest-cache/releases/tag/v1.0.2
[1.0.1]: https://github.com/bymaxone/nest-cache/releases/tag/v1.0.1
[1.0.0]: https://github.com/bymaxone/nest-cache/releases/tag/v1.0.0
