# Multi-machine, Phases 0 and 1: Windows groundwork + LAN remote control

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One BrandyTerm controls another on the same network: projects of both machines in one sidebar grouped by machine, a machine chip on the chat, every chat/thread/approval/dev-server action routed to the machine that owns the project, over an end-to-end encrypted channel between paired devices.

**Architecture:** All main-process IPC handlers move into a registry that serves both `ipcMain` and a network server, each handler tagged with a remote rule. Each desktop runs (when "Acesso remoto" is on) a WebSocket server on private LAN addresses, advertised by mDNS; connections run a Noise-KK-style handshake over X25519 and XChaCha20-Poly1305 frames between keys trusted at pairing. The client side lives in the main process (keys never reach the renderer); the renderer installs a routing `window.brandy` that merges remote states with namespaced project ids, so existing components keep calling the same API.

**Tech Stack:** Electron 33, React, TypeScript, Node test runner (`node --test`). New dependencies: `ws` (^8.18.0), `@noble/curves` (^1.6.0), `@noble/ciphers` (^1.0.0), `@noble/hashes` (^1.5.0), `bonjour-service` (^1.2.1). All pure JS (no native builds), and the `@noble/*` ones also run in the browser for the phone phase.

**Spec:** `docs/superpowers/specs/2026-11-25-multi-machine-design.md`

## Global Constraints

- No code file over 400 lines; split by responsibility. `src/main/engine.ts` (397) gets nothing new. `src/main/index.ts` (210) loses lines in Task 2 and must stay under 400.
- UI copy in Brazilian Portuguese.
- Pure logic in Electron-free files (no `electron` import) so `node --test` imports it. Shared protocol and crypto live in `src/shared/remote/` (also used by the phone later).
- Work stays on branch `feat/multi-machine`.
- With "Acesso remoto" off (the default), no port is opened, no mDNS runs, and the app behaves exactly as on `main`.
- `PROTOCOL_VERSION = 1`. A peer with another version is refused with "atualize o BrandyTerm em <máquina>".
- Default port `47321`.
- Pairing window: 2 minutes, at most 3 failed attempts, then it closes.
- Remote attachment cap: reuse `MAX_ATTACHMENT` (25 MB) from `src/main/attachments.ts`.
- LAN server binds only to private-range IPv4 addresses (10/8, 172.16/12, 192.168/16) of non-tunnel interfaces; interface names matching `/^(utun|ppp|tun|tap|ipsec|wg|fortissl|forticlient)/i` or descriptions containing "Fortinet" are skipped.
- Client falls back (phase 4) or reports offline when a LAN address does not answer the handshake within 2 s.

**Change to the spec (pairing code):** the spec's "6-digit code" is replaced by a 16-character code (80 bits, Crockford base32, shown `XXXX-XXXX-XXXX-XXXX`). A 6-digit code used as a MAC key can be brute-forced offline by a man in the middle in milliseconds; 80 bits cannot. Same UX (type the code shown on the other screen), no PAKE needed.

## Review Focus

1. A peer whose key was revoked while connected: its channel is closed at once and the next connect is refused. Test in Task 6.
2. A project switched to "não disponível remotamente" while a client is connected: it disappears from the next pushed state and calls naming it are refused. Test in Task 6.
3. Two projects with the same id on two machines (restored from the same backup): namespaced ids keep them apart in the merged state and in routing. Test in Task 8.
4. The remote machine goes offline mid-session: its group greys out with "offline desde HH:MM", pending calls reject with a Portuguese error instead of hanging. Test in Task 7.
5. A frame replayed or reordered on the wire: rejected, channel closed. Test in Task 3.

---

### Task 0: Windows CI and groundwork (Phase 0)

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: whatever the Windows job shows broken (expected areas: path joins with `/`, `HOME` vs `USERPROFILE`, shell quoting in `src/main/adapters/proc.ts`, tests that hard-code POSIX paths)

- [ ] **Step 1:** Write `ci.yml` with a matrix `os: [macos-latest, windows-latest]`, Node 22+ matching `package.json` engines (check; Node must run `.ts` tests directly, use the version the project uses locally: `node --version`), steps `npm ci`, `npm run typecheck`, `npm test`, `npm run build`. Trigger on push to `feat/**` and `main`, and on pull requests.
- [ ] **Step 2:** Push the branch and read the Windows job: `gh run watch` then `gh run view --log-failed`.
- [ ] **Step 3:** Fix each failure at its cause (use `path.join`/`os.homedir()`; skip a test on win32 only when it tests a POSIX-only behavior, with a comment saying why). Re-run until both jobs are green.
- [ ] **Step 4:** Add a "Rodar no Windows" section to `README.pt-BR.md` and `README.md` (clone, `npm ci`, `npm run dev`, allow the firewall prompt for private networks when "Acesso remoto" is on).
- [ ] **Step 5:** Commit: `ci: run typecheck, tests and build on macOS and Windows`.

Manual check for the user (cannot run from the Mac): `npm run dev` on the Windows PC opens the app, a project can be added and a Claude thread runs.

### Task 1: Machine identity

**Files:**
- Create: `src/shared/remote/machine.ts` (pure)
- Create: `src/shared/remote/machine.test.ts`
- Create: `src/main/remote/identity.ts` (Electron: loads/creates `<userData>/machine.json`)
- Modify: `src/shared/types.ts` (`AppState.machine?: MachineInfo`)
- Modify: `src/main/engine.ts` is NOT touched; `src/main/index.ts` sets `engine.state.machine` after `engine.init()`.

**Interfaces:**
- Produces: `type MachineOs = 'mac' | 'windows' | 'linux'`; `interface MachineInfo { id: string; name: string; os: MachineOs }`; `osOf(platform: string): MachineOs`; `defaultName(hostname: string, os: MachineOs): string`; `loadIdentity(): MachineInfo` (stable across restarts), `renameMachine(name: string): MachineInfo`.

- [ ] **Step 1: Failing tests** in `machine.test.ts`:
  - `osOf('darwin') === 'mac'`, `osOf('win32') === 'windows'`, `osOf('linux') === 'linux'`, `osOf('freebsd') === 'linux'`.
  - `defaultName('Eduardos-MacBook-Pro.local', 'mac') === 'Eduardos-MacBook-Pro'` (strips `.local`), `defaultName('', 'windows') === 'PC Windows'`, `defaultName('', 'mac') === 'Mac'`.
- [ ] **Step 2:** Run `node --test src/shared/remote/machine.test.ts`; expect failures.
- [ ] **Step 3:** Implement `machine.ts`; implement `identity.ts` (`randomUUID()` id, `os.hostname()`), saved on first load.
- [ ] **Step 4:** Tests pass; `npm run typecheck` clean.
- [ ] **Step 5:** Commit: `feat: stable machine identity`.

### Task 2: IPC handler registry with remote rules

**Files:**
- Create: `src/main/rpc/registry.ts` (pure: no electron import)
- Create: `src/main/rpc/registry.test.ts`
- Create: `src/main/rpc/ipc.ts` (binds a registry to `ipcMain`)
- Modify: every file that calls `ipcMain.handle` (38 channels): `src/main/index.ts`, `account-ipc.ts`, `archive-ipc.ts`, `artifact-ipc.ts`, `attachments.ts`, `fs-list.ts`, `terminal.ts`, and the `userPlugins:set` block in `index.ts`. Move the `index.ts` handlers into a new `src/main/app-ipc.ts` so `index.ts` shrinks.

**Interfaces:**
- Produces:
  - `type RemoteRule = 'pass' | 'deny' | 'terminal' | 'local-only'` (`local-only`: has a remote variant implemented in Task 9; until then remote calls are refused).
  - `interface CallCtx { sender?: Electron.WebContents /* typed as unknown in the pure file */; remote?: { deviceId: string; terminal: boolean } }`
  - `type Handler = (arg: any, ctx: CallCtx) => unknown | Promise<unknown>`
  - `class Registry { add(channel: string, fn: Handler, rule: RemoteRule): void; invoke(channel: string, arg: unknown, ctx: CallCtx): Promise<unknown>; rule(channel: string): RemoteRule | undefined; channels(): string[] }`
  - `invoke` with `ctx.remote` set: `deny`/`local-only` → throws `Error('Não permitido remotamente: <channel>')`; `terminal` without `ctx.remote.terminal` → throws `Error('Terminal remoto não liberado para este dispositivo')`; unknown channel → throws `Error('Canal desconhecido: <channel>')`.
  - `bindIpc(r: Registry): void` in `ipc.ts`: `ipcMain.handle(channel, (e, a) => r.invoke(channel, a, { sender: e.sender }))` for every channel.
  - A single shared instance: `export const registry = new Registry()` in `src/main/rpc/registry.ts`.

Rules per channel (from the spec's table):
- `pass`: `state:get`, `chat:send`, `commands:list`, `fs:list`, `thread:cancel`, `thread:approve`, `thread:resolve`, `thread:allowAll`, `archive:list`, `archive:reopen`, `artifact:read`, `process:start`, `process:stop`, `process:remove`, `attach:save`, `userPlugins:set`, `project:remove`.
- `local-only` (remote variant in Task 9): `project:open-folder`, `attach:open`, `artifact:open`, `process:open-port`.
- `terminal`: `term:open`, `term:write`, `term:resize`, `term:kill`.
- `deny`: `settings:set`, `plugin:install`, `plugin:open-report`, every `accounts:*`, `clipboard:read`, `clipboard:write`.

- [ ] **Step 1: Failing tests** in `registry.test.ts`:
  - local call (`ctx = {}`) to a `deny` channel runs the handler and returns its value.
  - remote call to `deny` rejects with `'Não permitido remotamente: settings:set'`.
  - remote call to `terminal` with `terminal: false` rejects with the terminal message; with `terminal: true` runs.
  - unknown channel rejects with `'Canal desconhecido: x'`.
  - `add` twice for one channel throws (catches double registration during migration).
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement `Registry`, `bindIpc`. Migrate all 38 `ipcMain.handle` calls to `registry.add(channel, (a, ctx) => ..., rule)`; handlers that used `e.sender` (`term:open`, `accounts:login-start`) read `ctx.sender`. Call `bindIpc(registry)` once in `index.ts` after all registrations.
- [ ] **Step 4:** Add a test that every channel the preload uses is registered: parse `src/preload/index.ts` for `ipcRenderer.invoke('<channel>'` and assert each is in a list exported as `EXPECTED_CHANNELS` from `src/main/rpc/channels.ts` (the rules table above as data, which the registrations import their rule from). Keeps preload and registry in step.
- [ ] **Step 5:** `npm test`, `npm run typecheck`, `npm run build` pass; `npm run dev` and click through chat, terminal, accounts panel, archive: everything works as before.
- [ ] **Step 6:** Commit: `refactor: register IPC handlers in a registry with remote rules`.

### Task 3: Encrypted channel crypto

**Files:**
- Create: `src/shared/remote/crypto.ts` (pure, `@noble/*`)
- Create: `src/shared/remote/crypto.test.ts`

**Interfaces:**
- Produces:
  - `interface KeyPair { pub: Uint8Array; priv: Uint8Array }`; `newKeyPair(): KeyPair` (X25519).
  - `interface Hello1 { ie: string; is: string }` (base64 ephemeral and static pubs of the initiator); `interface Hello2 { re: string }`.
  - `initiatorStart(s: KeyPair): { msg: Hello1; e: KeyPair }`
  - `responderReply(s: KeyPair, m: Hello1, trusted: (pub: Uint8Array) => boolean): { msg: Hello2; keys: SessionKeys } | null` (null when `is` not trusted)
  - `initiatorFinish(s: KeyPair, e: KeyPair, rs: Uint8Array, m: Hello2): SessionKeys`
  - `interface SessionKeys { send: Uint8Array; recv: Uint8Array }`
  - `class FrameCipher { constructor(k: SessionKeys); seal(plain: Uint8Array): Uint8Array; open(sealed: Uint8Array): Uint8Array /* throws on tamper, replay, reorder */ }`

Key schedule (the algorithm the signatures do not determine):

```
ee = X25519(e_I, e_R); es = X25519(e_I, s_R); se = X25519(s_I, e_R); ss = X25519(s_I, s_R)
salt = sha256(utf8("brandyterm-kk-v1") || ie || is || re || rs)
okm  = hkdf(sha256, ikm = ee||es||se||ss, salt, info = utf8("keys"), 64)
initiator: send = okm[0:32], recv = okm[32:64]; responder: the reverse
frame  = counter(8 bytes, big-endian) || xchacha20poly1305(key, nonce = 16 zero bytes || counter, plain)
receiver accepts only counter == expected (starts at 0, +1 per frame)
```

- [ ] **Step 1: Failing tests:**
  - full handshake between two `newKeyPair()` statics yields `I.send == R.recv` and `I.recv == R.send` (byte-equal).
  - `responderReply` returns null when `trusted` returns false.
  - an initiator that used a wrong responder static (`rs` from a third key) derives keys under which `open` of the responder's first frame throws.
  - `seal`/`open` round trip of 3 frames in order.
  - flipping one byte of a sealed frame makes `open` throw.
  - opening frame #1 twice (replay) throws on the second; opening #2 before #1 (reorder) throws.
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement with `@noble/curves/ed25519` (`x25519`), `@noble/hashes/hkdf`, `@noble/hashes/sha256`, `@noble/ciphers/chacha` (`xchacha20poly1305`). Add the three `@noble` dependencies.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit: `feat: encrypted channel crypto for paired devices`.

### Task 4: Pairing and trust store

**Files:**
- Create: `src/shared/remote/pairing.ts` (pure)
- Create: `src/shared/remote/pairing.test.ts`
- Create: `src/main/remote/trust.ts` (Electron: `<userData>/remote-trust.json`, own static key in `<userData>/remote-key.json`)
- Create: `src/main/remote/trust.test.ts` (uses a temp dir: `TrustStore` takes its directory in the constructor so the test needs no Electron)

**Interfaces:**
- Produces:
  - `newPairingCode(): string` (16 chars from `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, formatted `XXXX-XXXX-XXXX-XXXX`); `normalizeCode(input: string): string | null` (uppercases, strips spaces and dashes, maps `O→0`, `I/L→1`; null when not 16 valid chars).
  - `clientProof(code, cpub, nonceC): string` = base64 HMAC-SHA256(code, "pair-c" || cpub || nonceC); `hostProof(code, hpub, cpub, nonceH, nonceC): string` = HMAC(code, "pair-h" || hpub || cpub || nonceH || nonceC).
  - `class PairingWindow { constructor(nowMs: () => number); open(): string /* code */; check(cpub, nonceC, proof): 'ok' | 'bad' | 'closed'; close(): void }` — expires 120 000 ms after open, closes after 3 `bad`, closes after one `ok`.
  - `interface TrustedDevice { pub: string; machineId: string; name: string; os: MachineOs | 'phone'; addedAt: string; lastSeen?: string; terminal: boolean }`
  - `class TrustStore { constructor(dir: string); ownKey(): KeyPair; list(): TrustedDevice[]; get(pub: string): TrustedDevice | undefined; add(d: Omit<TrustedDevice, 'addedAt' | 'terminal'>): TrustedDevice; revoke(pub: string): void; touch(pub: string, iso: string): void; setTerminal(pub: string, on: boolean): void }` — emits `'change'` (extends EventEmitter).

Pairing exchange (over a plain WebSocket, before any trust; see Task 6 for where it runs):
1. client → host `{ t: 'pair', cpub, nonceC, proof: clientProof(...), machineId, name, os, protocol }`
2. host: `window.check` → `ok`: replies `{ t: 'paired', hpub, nonceH, proof: hostProof(...), machineId, name, os }` and adds the client to trust; `bad`/`closed`: replies `{ t: 'pair-fail', reason: 'código inválido' | 'pareamento fechado' }`.
3. client verifies the host proof, then adds the host to its trust store. A failed host proof → nothing stored, error "resposta do host não confere".

- [ ] **Step 1: Failing tests:**
  - `newPairingCode()` matches `/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/`; `normalizeCode('abcd efgh-jkmn pqrs') === 'ABCDEFGHJKMNPQRS'`; `normalizeCode('abc') === null`; `normalizeCode('O1IL...')` maps to `0111...`.
  - `PairingWindow`: right proof → `'ok'`, then any further check → `'closed'`; 3 wrong proofs → the 4th check with the right proof returns `'closed'`; right proof at 120 001 ms → `'closed'`.
  - `hostProof` with another code differs (MITM cannot answer).
  - `TrustStore`: `ownKey()` stable across two instances on the same dir; `add` then `get`; `revoke` removes and emits `'change'`; new devices have `terminal: false`.
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit: `feat: pairing codes and trusted device store`.

### Task 5: Wire protocol and secure channel

**Files:**
- Create: `src/shared/remote/protocol.ts` (pure)
- Create: `src/shared/remote/channel.ts` (pure; works over any socket-like object)
- Create: `src/shared/remote/channel.test.ts` (in-memory socket pair)

**Interfaces:**
- Consumes: Task 3 handshake and `FrameCipher`.
- Produces:
  - `PROTOCOL_VERSION = 1`
  - `type Frame = { k: 'req'; id: number; channel: string; arg: unknown } | { k: 'res'; id: number; ok: true; value: unknown } | { k: 'res'; id: number; ok: false; error: string } | { k: 'push'; topic: string; payload: unknown } | { k: 'hello'; protocol: number; machine: MachineInfo }`
  - `decodeFrame(json: string): Frame | null` (validates shape; null on anything else)
  - `interface Socket { send(data: Uint8Array | string): void; onMessage(cb: (data: Uint8Array | string) => void): void; onClose(cb: () => void): void; close(): void }`
  - `connectChannel(sock: Socket, own: KeyPair, peerPub: Uint8Array, me: MachineInfo, timeoutMs = 2000): Promise<SecureChannel>` (initiator)
  - `acceptChannel(sock: Socket, own: KeyPair, trusted: (pub: Uint8Array) => boolean, me: MachineInfo, timeoutMs = 2000): Promise<SecureChannel>` (responder)
  - `class SecureChannel { peer: MachineInfo; peerPub: string; request(channel: string, arg: unknown, timeoutMs = 60_000): Promise<unknown>; serve(h: (channel: string, arg: unknown) => Promise<unknown>): void; push(topic: string, payload: unknown): void; onPush(cb: (topic: string, payload: unknown) => void): void; onClose(cb: (reason: string) => void): void; close(reason?: string): void }`
  - Both sides send `hello` as the first encrypted frame; a `protocol` different from `PROTOCOL_VERSION` closes with reason `'versão diferente'`. On close, every pending `request` rejects with `Error('Máquina desconectada')`.

- [ ] **Step 1: Failing tests** (in-memory `Socket` pair):
  - connect + accept succeed; `peer` on each side is the other's `MachineInfo`.
  - `request('x', 1)` on the client → server's `serve` handler gets `('x', 1)`, returns 2, client resolves 2; handler throwing `Error('boom')` makes the request reject with `'boom'`.
  - `push('state', {a:1})` from server reaches client `onPush`.
  - untrusted client: `acceptChannel` rejects and closes; client's `connectChannel` rejects.
  - peer hello with `protocol: 2` → both sides close with `'versão diferente'`.
  - pending request when the socket closes rejects with `'Máquina desconectada'`.
  - no `Hello2` within `timeoutMs` → `connectChannel` rejects with `'sem resposta'`.
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement. Handshake messages travel as JSON text; after it, frames are binary `FrameCipher` output of the JSON-encoded `Frame`.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit: `feat: secure request/push channel between machines`.

### Task 6: Host server (LAN)

**Files:**
- Create: `src/main/remote/lan.ts` (pure: `lanAddresses`)
- Create: `src/main/remote/lan.test.ts`
- Create: `src/main/remote/host-filter.ts` (pure: `filterState`, `projectOf`)
- Create: `src/main/remote/host-filter.test.ts`
- Create: `src/main/remote/server.ts` (Electron + `ws` + `bonjour-service`)
- Modify: `src/shared/types.ts` (`Project.remoteHidden?: boolean`; `AppSettings.remote?: { enabled: boolean; port: number }`)
- Modify: `src/main/settings.ts` (accept `remote` patch; default `{ enabled: false, port: 47321 }`)

**Interfaces:**
- Consumes: `registry` (Task 2), `TrustStore` (Task 4), `acceptChannel` (Task 5), `PairingWindow` (Task 4).
- Produces:
  - `lanAddresses(ifaces: ReturnType<typeof os.networkInterfaces>): string[]`
  - `filterState(s: AppState): AppState` (drops `remoteHidden` projects; replaces `accounts` with `{ list: list.map(({ id, label, limits... }) => ...) }` keeping only display fields; drops `settings.lastSeen`, `settings.lastProjectId`)
  - `projectOf(channel: string, arg: unknown): string | null` (reads `arg.projectId`, or `arg` itself for `commands:list` and `project:remove`, or `arg.id` for `term:*`; null for channels without a project)
  - `class HostServer extends EventEmitter { start(port: number): Promise<void>; stop(): Promise<void>; openPairing(): string /* code */; closePairing(): void; clients(): { pub: string; name: string; since: string }[] }` — emits `'change'`.
  - Remote dispatch: for each request, if `projectOf` names a project that is missing or `remoteHidden` → reject `'Projeto não disponível remotamente'`; else `registry.invoke(channel, arg, { remote: { deviceId: pub, terminal: device.terminal } })`. `state:get` returns `filterState(engine.state)`. On engine `change`, every channel gets `push('state', filterState(state))`, debounced 100 ms.
  - First text message decides the mode: `{ t: 'pair' }` → pairing (Task 4 exchange), anything else → `acceptChannel`.
  - `TrustStore` `'change'` with a revoked pub closes that channel with reason `'dispositivo removido'`.
  - mDNS: `bonjour.publish({ name: machine.name, type: 'brandyterm', port, txt: { id: machine.id, os: machine.os, v: '1' } })`.

- [ ] **Step 1: Failing tests:**
  - `lanAddresses`: keeps `en0 192.168.1.20`, `Ethernet 10.0.0.5`, `wlan0 172.20.1.2`; drops `utun3 10.8.0.2`, `ppp0 192.168.2.1`, `lo0 127.0.0.1`, IPv6 entries, `en0 8.8.8.8` (public), and any `internal: true`.
  - `filterState`: a project with `remoteHidden: true` is gone; a fixture account with an extra `token: 'sk-ant-xyz'` field does not appear in `JSON.stringify(filterState(s))`; `settings.lastSeen` is gone.
  - `projectOf('chat:send', { projectId: 'p1' }) === 'p1'`; `projectOf('commands:list', 'p2') === 'p2'`; `projectOf('term:write', { id: 'p3', data: 'x' }) === 'p3'`; `projectOf('archive:list', ['a']) === null` (multi-project: the server filters the ids instead, see Step 3).
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement `lan.ts`, `host-filter.ts`, `server.ts`. `archive:list` from a remote filters the id list to visible projects before invoking. Start/stop the server from `src/main/remote/index.ts` (`startRemote(engine)`) whenever `settings.remote.enabled` changes; call it from `index.ts` next to `startBackground`.
- [ ] **Step 4:** Integration test `src/main/remote/server.test.ts` without Electron: construct `HostServer` with an injected `{ state(), invoke(), trust, machine }` (make the constructor take these so no Electron import is needed in the tested path), start on port 0, connect a real `ws` client with `connectChannel`, assert: `state:get` returns filtered state; `chat:send` for a hidden project rejects `'Projeto não disponível remotamente'`; revoking the client's key closes its channel and a reconnect is refused; `settings:set` rejects `'Não permitido remotamente: settings:set'`.
- [ ] **Step 5:** All tests pass; typecheck; build.
- [ ] **Step 6:** Commit: `feat: LAN host server with pairing and remote rules`.

### Task 7: Client side in the main process

**Files:**
- Create: `src/main/remote/hosts.ts` (connections to paired hosts)
- Create: `src/main/remote/hosts.test.ts`
- Create: `src/main/remote/client-ipc.ts` (IPC for the renderer)
- Modify: `src/preload/index.ts` and `src/shared/api.ts` (new `remote` namespace)

**Interfaces:**
- Consumes: `connectChannel` (Task 5), `TrustStore` (Task 4), `bonjour-service` browse.
- Produces:
  - `interface RemoteHostInfo { machine: MachineInfo; online: boolean; since?: string /* offline since, ISO */; address?: string; error?: string }`
  - `class RemoteHosts extends EventEmitter { constructor(deps: { trust; own: KeyPair; me: MachineInfo; dial: (address: string) => Socket }); start(): void; stop(): void; list(): RemoteHostInfo[]; call(machineId: string, channel: string, arg: unknown): Promise<unknown>; pair(address: string, code: string): Promise<MachineInfo> }` — emits `'hosts'` (list) and `'state'` `({ machineId, state })`.
  - Reconnect: on close, retry after 1, 2, 4, 8, 16, 30 s (cap 30 s), reset on success; also retry at once when mDNS sees the host again. Addresses remembered in `<userData>/remote-hosts.json` (`machineId → last address`).
  - `call` on an offline host rejects at once with `Error('<nome> está offline')`.
  - Renderer API (in `BrandyApi`):

```ts
remote: {
  hosts(): Promise<RemoteHostInfo[]>
  onHosts(cb: (h: RemoteHostInfo[]) => void): () => void
  onState(cb: (e: { machineId: string; state: AppState }) => void): () => void
  call(args: { machineId: string; channel: string; arg: unknown }): Promise<unknown>
  /** host side */
  openPairing(): Promise<string>
  closePairing(): Promise<void>
  devices(): Promise<TrustedDevice[]>
  revoke(pub: string): Promise<void>
  setTerminal(args: { pub: string; on: boolean }): Promise<void>
  /** client side: hosts seen by mDNS that are not paired yet */
  discovered(): Promise<{ name: string; os: MachineOs; address: string; machineId: string }[]>
  pair(args: { address: string; code: string }): Promise<MachineInfo>
  rename(name: string): Promise<MachineInfo>
}
```

  These `remote:*` channels are registered with rule `deny` (a remote can never pair or manage devices).

- [ ] **Step 1: Failing tests** (`hosts.test.ts`, with an injected `dial` returning in-memory sockets wired to a fake host built on `acceptChannel`):
  - after `start()`, a trusted host with a remembered address comes `online: true`, and its pushed `state` is re-emitted as `'state'` with its machineId.
  - `call` forwards to the host and resolves its value.
  - host socket closes → `online: false`, `since` set; a pending `call` rejects with `'Máquina desconectada'`; a new `call` rejects with `'<nome> está offline'`.
  - reconnect delays follow `[1000, 2000, 4000, 8000, 16000, 30000, 30000]` (inject a fake timer).
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement `hosts.ts`, `client-ipc.ts` (forwards `'hosts'` and `'state'` events to the window like `pushState`), preload additions.
- [ ] **Step 4:** Tests pass; typecheck.
- [ ] **Step 5:** Commit: `feat: connect to paired machines from the main process`.

### Task 8: Routing `window.brandy` in the renderer

**Files:**
- Create: `src/renderer/src/remote/route.ts` (pure)
- Create: `src/renderer/src/remote/route.test.ts`
- Create: `src/renderer/src/remote/routed-api.ts` (wraps the preload API)
- Modify: `src/renderer/src/main.tsx` (install the routed API before rendering)
- Modify: `src/shared/types.ts` (`Project.machine?: { id: string; name: string; os: MachineOs; remote: boolean; online: boolean; since?: string }` — set only in the renderer's merged state, never saved)

**Interfaces:**
- Consumes: `window.brandy.remote` (Task 7).
- Produces:
  - `remoteId(machineId: string, projectId: string): string` = `@${machineId}/${projectId}`; `parseId(id: string): { machineId: string | null; projectId: string }`.
  - `mergeStates(local: AppState, remotes: { info: RemoteHostInfo; state?: AppState }[]): AppState` — local projects get `machine = { ...local machine, remote: false, online: true }`; each remote project is copied with id `remoteId(...)`, `machine` set, and its threads/messages untouched; offline hosts keep their last known projects with `online: false`. Agents, plugins, accounts, settings come from local only.
  - `routeCall(channel: string, arg: unknown): { machineId: string | null; arg: unknown }` — finds a project id in the arg (same positions as `projectOf` in Task 6), and if it is a remote id returns its machineId and the arg with the original projectId restored.
  - `createRoutedApi(local: BrandyApi): BrandyApi` — every method that carries a project goes through `routeCall`; local → the preload method; remote → `local.remote.call({ machineId, channel, arg })`. `getState`/`onState` return the merged state, recomputed on local state, remote `'state'` and `'hosts'` events. `term.onData`/`onExit` remote events are out of this phase.
- [ ] **Step 1: Failing tests:**
  - `parseId(remoteId('m1', 'p1'))` deep-equals `{ machineId: 'm1', projectId: 'p1' }`; `parseId('p1').machineId === null`.
  - `mergeStates` with a local project `p1` and a remote host whose state also has a project `p1`: the merged list has `p1` and `@m1/p1`, the second with `machine.remote === true` (Review Focus 3).
  - offline host with a last state: its projects are present with `machine.online === false` and `since`.
  - `routeCall('chat:send', { projectId: '@m1/p1', text: 'oi' })` → `{ machineId: 'm1', arg: { projectId: 'p1', text: 'oi' } }`; `routeCall('chat:send', { projectId: 'p1', ... }).machineId === null`; `routeCall('commands:list', '@m1/p1')` → arg `'p1'`.
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement. In `main.tsx`: `window.brandy = createRoutedApi(window.brandy)` before `createRoot`. Check that `contextBridge` objects allow re-assignment of `window.brandy`; if not, expose the routed API as the module `src/renderer/src/api.ts` (`export const api`) and replace the ~25 `window.brandy` uses with it (mechanical, same names).
- [ ] **Step 4:** Tests pass; typecheck; `npm run dev` with no paired machines: the app behaves as before.
- [ ] **Step 5:** Commit: `feat: route renderer calls to the machine that owns the project`.

### Task 9: Remote variants of local-only calls

**Files:**
- Create: `src/main/remote/remote-calls.ts` (host-side handlers for the remote variants)
- Modify: `src/main/rpc/channels.ts` (new channels with rule `pass`: `project:add-path`, `fs:browse`, `attach:read`, `artifact:bytes`)
- Modify: `src/renderer/src/remote/routed-api.ts` (remote variants)
- Create: `src/renderer/src/components/RemoteFolderPicker.tsx`

**Interfaces:**
- Produces (host side, rule `pass`):
  - `fs:browse` `(dir: string) => FsEntry[]` — reuses `browseDir` from `src/main/fs-browse.ts`, folders only.
  - `project:add-path` `(path: string) => string` — `engine.addProject(path)` after checking the path exists and is a directory.
  - `attach:read` `({ projectId, path }) => { name: string; mime: string; data: Uint8Array }` — only paths inside that project's attachment dir (`attachmentsDir`/projectId), size ≤ `MAX_ATTACHMENT`.
  - `artifact:bytes` `({ projectId, path }) => { name; mime; data }` — same guards as `artifact:read` (inside the project, realpath, 2 MB cap `MAX_ARTIFACT`).
  - Client side (main process, new `remote:open-bytes` IPC, rule `deny`): writes bytes to `<temp>/brandyterm-remote/<machineId>/<name>` and `shell.openPath`s it.
- Routed API behavior on a remote project:
  - `openFolder()` while a remote machine group is the one selected → opens `RemoteFolderPicker` (lists `fs:browse` starting at `~/`, "Abrir como projeto" calls `project:add-path`). The sidebar's "+" on a remote group passes that machineId.
  - `openAttachment(path)` / `openArtifact(...)` → `attach:read` / `artifact:bytes` on the host, then `remote:open-bytes` locally.
  - `openPort(port)` → opens `http://<host address>:<port>` locally; the tooltip of the port button on a remote project says "Abre pela rede local; o servidor precisa escutar além de localhost".
- [ ] **Step 1: Failing tests** (`remote-calls.test.ts`, inject engine/paths): `attach:read` with `../` escaping the attachment dir rejects; `artifact:bytes` on a symlink pointing outside the project rejects (reuse the fixtures style of `src/main/artifact-files.test.ts`); `project:add-path` on a file rejects with `'Não é uma pasta'`.
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement host handlers, client `remote:open-bytes`, routed variants, `RemoteFolderPicker`.
- [ ] **Step 4:** Tests pass; typecheck.
- [ ] **Step 5:** Commit: `feat: remote folder picker, attachments, artifacts and ports`.

### Task 10: Machine UI (sidebar groups, chip, settings)

**Files:**
- Create: `src/renderer/src/components/MachineChip.tsx`
- Create: `src/renderer/src/components/RemotePanel.tsx` (settings: "Acesso remoto")
- Create: `src/renderer/src/components/machine.css`
- Modify: `src/renderer/src/components/Sidebar.tsx` (group by `project.machine`)
- Modify: `src/renderer/src/components/Chat.tsx` (chip in header; composer disabled when `machine.online === false`)
- Modify: `src/renderer/src/components/Overview.tsx` (per-project "Disponível remotamente" toggle, local projects only, calls a new pass-through `project:set-remote-hidden` — add it to Task 2's table as `deny`: only the owner toggles it)
- Check sizes first: `wc -l` on `Sidebar.tsx`, `Chat.tsx` (332); if an edit would pass 400, extract the touched section into its own component first.

**Interfaces:**
- Consumes: `Project.machine` (Task 8), `window.brandy.remote` (Task 7).
- Copy (exact):
  - group titles: local `"Este <name>"` is replaced by the machine name with "(este)" suffix, e.g. `MacBook-Pro (este)`; remote `PC-ESCRITORIO`.
  - offline: `offline desde HH:MM`; composer placeholder when offline: `<nome> está offline`.
  - chip: OS icon (`lucide-react` `Apple` for mac, `Monitor` for windows, `Terminal` for linux) + name; remote chips get class `machine-chip remote` (accent color token), tooltip `Esta conversa roda em <nome>`.
  - RemotePanel: toggle `Acesso remoto (rede local)` with tooltip `Deixa seus outros computadores pareados verem e comandarem os projetos desta máquina. Só aceita aparelhos que você pareou`; field `Nome desta máquina`; button `Parear novo aparelho` (shows the code big, a 2:00 countdown, `Digite este código no outro computador`); section `Computadores na rede` listing `discovered()` with a code input and button `Parear`; list `Aparelhos pareados` with last seen, a `Terminal` checkbox (disabled until phase 3, label `Terminal remoto (em breve)`), and `Remover`.
- [ ] **Step 1:** Implement `MachineChip`, group headers, offline state, `RemotePanel` (opened from the same place as `AccountsPanel` / `UserPluginsPanel`; find with `codegraph explore "UserPluginsPanel open"`).
- [ ] **Step 2:** `npm run typecheck`, `npm test`.
- [ ] **Step 3:** Commit: `feat: machine groups, machine chip and remote access settings`.

### Task 11: Two instances on one Mac, end to end

**Files:**
- Modify: `src/main/index.ts` (honor `BRANDY_USER_DATA` env: `app.setPath('userData', ...)` before anything reads it, and skip the single-instance lock when it is set)
- Modify: `package.json` (script `"dev:second": "BRANDY_USER_DATA=$TMPDIR/brandy-second electron-vite dev"`)

- [ ] **Step 1:** Implement the env override.
- [ ] **Step 2:** Run `npm run dev` and `npm run dev:second`. In the first: turn on Acesso remoto, `Parear novo aparelho`. In the second: turn on Acesso remoto on another port (set in its RemotePanel), find the first under `Computadores na rede`, type the code, `Parear`.
- [ ] **Step 3:** Check, in the second window: the first's projects appear under its machine group with a remote chip; sending a message to one of them runs the coordinator in the first instance (its chat shows the same messages); an approval raised by a thread there can be answered from the second; a project marked "não disponível remotamente" in the first disappears from the second within a second; `Remover` the device in the first → the second shows it offline and reconnect is refused.
- [ ] **Step 4:** Quit the first instance: second shows `offline desde HH:MM` and a disabled composer; restart the first: it comes back online within 30 s.
- [ ] **Step 5:** Commit: `chore: second dev instance for multi-machine testing`.
- [ ] **Step 6:** Final checks: `npm test`, `npm run typecheck`, `npm run build`, CI green on both OS, `wc -l` shows no code file over 400 lines.

---

## Later phases (planned when reached)

- **Phase 2 — threads on another machine:** `machine` on plan tasks (`PLAN_SCHEMA`, `parsePlan`, `buildPlanPrompt` listing online machines), "Máquina" pseudo-project on the target, git-remote project matching plus manual link, remote thread cards mirrored in the origin chat, synthesis across machines, "aguardando máquina offline".
- **Phase 3 — remote terminal:** `term:*` push topics over the channel, per-device `terminal` permission enabled in `RemotePanel`.
- **Phase 4 — relay and phone:** Cloudflare Worker + Durable Object, host key registration, state diffs, LAN-then-relay transport selection (2 s), web/PWA build of the renderer with `routed-api` over the relay, pairing inside the installed PWA, then push notifications.
- **Phase 5 — parity:** inventory, "Mesma página" screen, marketplace installs, skill copy, non-portable hooks, MCP without secrets, then relay snapshots.
