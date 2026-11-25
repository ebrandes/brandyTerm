# MCP Connectors on Demand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user installs MCP connectors once in BrandyTerm (panel, presets, custom, import from Claude Code), logs in through an explicit login card, and every Claude and Codex work thread reaches them only on demand through one small gateway MCP, with every connector call approved in the hub.

**Architecture:** A connector store and an encrypted secrets file live in `userData`. A hub in the main process owns one lazy MCP client per connector. A login broker runs OAuth, token or CLI logins behind a card with "Entrar" and "Cancelar". Work threads launch `gateway.js` (stdio MCP, run by the Electron binary in Node mode). The gateway forwards `list_connectors`, `connector_tools` and `call_connector` over a local socket to a dispatcher, which checks the thread, login and approval before the hub runs the tool. The renderer gets a "Conectores" sidebar section, an add dialog, login cards (in the panel and in the thread chat) and connector approval cards.

**Tech Stack:** Electron 33, React, TypeScript, electron-vite, `@modelcontextprotocol/sdk` 1.32.2 (client and low-level server), Agent SDK `mcpServers`/`strictMcpConfig`, Codex `-c` overrides, Electron `safeStorage`, `@lydell/node-pty` (existing), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-25-mcp-connectors-design.md`

**Starts after:** multi-machine phase 0-1 (branch `feat/multi-machine`) passes its final review. Branch `feat/mcp-connectors` from that head. Every `file:line` below refers to commit `8916bf5`; re-locate by symbol when lines have moved.

## Global Constraints

- No code file above 400 lines (code, tests, CSS). Split by responsibility. Do not join lines to fit.
- `src/main/engine.ts` gets exactly two edits and no other change: `private approvals` becomes `readonly approvals` (Task 4), and one new line `thread: { projectId: p.id, threadId: t.id },` in the `runOnce` options of `startThread` (Task 7). It must stay at 399 lines or fewer.
- UI copy in Brazilian Portuguese, using the exact strings quoted in each task.
- Secrets (env values, header values, tokens, OAuth tokens, client secrets, code verifiers) never appear in `connectors.json`, `AppState`, logs, thread prompts, the gateway process env or tool results. Secrets live only in `userData/connector-secrets.json`, encrypted with `safeStorage`.
- Never write `~/.claude.json` or anything under `~/.claude`. Import only reads.
- No connector process or network connection starts when a thread starts. A connector connects on the first `connector_tools` or `call_connector` for it.
- Timeouts: idle connector close after 10 minutes (`IDLE_MS = 600_000`). Login and approval holds give up after 15 minutes (`HOLD_MS = 900_000`). Claude threads get `MCP_TOOL_TIMEOUT=960000` in their env. Codex gets `tool_timeout_sec=960`.
- A thread's "permitir tudo" (`t.allowAll`, and the app default `allowAllThreads`) never covers a connector call.
- Remote: every `connectors:*` channel has rule `'deny'` and is in neither SCOPED nor UNSCOPED. Connectors are installed, configured, logged into and removed only on their own machine. Approval cards (`thread:approve`) can still be answered remotely, including "Sempre".
- Dependency: add `"@modelcontextprotocol/sdk": "1.32.2"` to `dependencies`. Do not add `zod`; the gateway uses the SDK's low-level `Server` with JSON schemas. In `package-lock.json`, commit only the hunks for `@modelcontextprotocol/sdk` (its root `dependencies` entry and the removed `"peer": true`). Leave any other lockfile change uncommitted.
- Tests: `node --test` with explicit `.ts` import extensions; run `npm test`, `npm run typecheck` and `npm run build` before each commit.
- Do not touch the uncommitted project-actions work in the working tree. Commit only your own hunks.

## Review Focus

1. A thread is cancelled while a connector call waits for login or approval. Expected: the call aborts, the thread's card disappears, and nothing stays pending (test in Task 6).
2. A connector process fails to start (bad command) or dies mid-call. Expected: a tool error carrying the last stderr lines, status `erro`, and a reconnect on the next call (test in Task 2).
3. Two threads hit the same connector that needs login at the same time. Expected: one login run, both threads show the card, and both continue after one Entrar (test in Task 5).
4. A tool returns a huge result (megabytes of logs). Expected: the text is cut at 100 000 characters with a note, and the gateway and socket survive (test in Task 6).
5. BrandyTerm quits or crashes while a gateway runs, leaving a stale socket file. Expected: the next start removes the stale socket, and a gateway whose socket is gone answers with a tool error instead of hanging (test in Task 3).

---

### Task 1: Connector types, store, secrets, presets

**Files:**
- Create: `src/shared/connectors.ts`, `src/main/connectors/store.ts`, `src/main/connectors/secrets.ts`, `src/main/connectors/presets.ts`, `src/main/atomic-write.ts`
- Modify: `src/main/remote/trust.ts` (import `writeAtomic` from `../atomic-write.ts` instead of its private copy), `package.json`, `package-lock.json` (sdk hunks only)
- Test: `src/main/connectors/store.test.ts`, `src/main/connectors/secrets.test.ts`, `src/main/connectors/presets.test.ts`

**Interfaces:**
- Produces, in `src/shared/connectors.ts`:
  ```ts
  export type ConnectorAuth =
    | { kind: 'none' }
    | { kind: 'oauth' }
    | { kind: 'token'; fields: TokenField[] }
    | { kind: 'cli'; command: string[]; check?: string[] }
  export interface TokenField { key: string; label: string; use: { header: string; format: string } | { env: string } } // format contains "{value}"
  export interface Connector {
    id: string; name: string; description: string
    transport: 'stdio' | 'http'; command?: string; args?: string[]; url?: string
    envKeys?: string[]; headerKeys?: string[]        // names only; values are secrets
    auth: ConnectorAuth; enabled: boolean; preset?: string
    projects?: string[]; alwaysAllow: string[]       // tool names
    trusted?: boolean                                // "Confio neste comando" given (custom/imported stdio)
  }
  export type ConnectorStatus = 'desconectado' | 'conectado' | 'precisa de login' | 'erro'
  export interface ConnectorView extends Omit<Connector, 'auth'> { authKind: ConnectorAuth['kind']; status: ConnectorStatus; error?: string; toolCount?: number }
  export interface PanelLogin { connectorId: string; name: string; phase: 'ask' | 'waiting' | 'failed'; error?: string; authKind: ConnectorAuth['kind']; fields?: { key: string; label: string }[]; terminalId?: string }
  export interface ConnectorsState { list: ConnectorView[]; logins: PanelLogin[] }
  export interface ThreadLogin { connectorId: string; name: string; phase: 'ask' | 'waiting' | 'failed'; error?: string; authKind: ConnectorAuth['kind']; fields?: { key: string; label: string }[]; terminalId?: string }
  export interface Preset { id: string; name: string; description: string; transport: 'stdio' | 'http'; command?: string; args?: string[]; url?: string; auth: ConnectorAuth }
  export interface ConnectorSecrets { env?: Record<string, string>; headers?: Record<string, string>; oauth?: { tokens?: unknown; client?: unknown; verifier?: string } }
  export interface ThreadRef { projectId: string; threadId: string }
  ```
- Produces, in `store.ts`: `class ConnectorStore extends EventEmitter` with `constructor(file: string)`, `list(): Connector[]`, `get(id): Connector | undefined`, `byName(name): Connector | undefined` (case-insensitive), `add(c: Omit<Connector, 'id' | 'alwaysAllow'>): Connector`, `update(id, patch: Partial<Omit<Connector, 'id'>>): Connector`, `remove(id): void`, `allow(id, tool): void`, `revoke(id, tool): void`, `visibleFor(projectPath: string): Connector[]` (enabled, and `projects` unset or containing the path). Emits `'change'`.
- Produces, in `secrets.ts`: `interface Cipher { available(): boolean; encrypt(s: string): string; decrypt(b64: string): string }`, `safeCipher: Cipher` (wraps `safeStorage`, base64), `class SecretStore` with `constructor(file: string, cipher: Cipher)`, `get(id): ConnectorSecrets`, `set(id, s: ConnectorSecrets): void`, `patch(id, s: Partial<ConnectorSecrets>): void`, `remove(id): void`.
- Produces, in `presets.ts`: `PRESETS: Preset[]` and `presetById(id): Preset | undefined`.
- Produces `src/main/atomic-write.ts`: `export function writeAtomic(file: string, data: string, mode?: number): void` (moved verbatim from `trust.ts:10`).

- [ ] **Step 1: Write the failing tests.** Use a temporary directory per test and a fake cipher (`encrypt: s => Buffer.from('x' + s).toString('base64')`, with `decrypt` reversing it).
  - `store adds, reads back after reload, updates, removes`: add, then `new ConnectorStore(file).list()` has it with `alwaysAllow: []` and a generated `id`.
  - `store rejects duplicate names`: adding "railway" when "Railway" exists throws `Já existe um conector chamado Railway`.
  - `store allow/revoke`: `allow(id, 'get_logs')` twice gives `['get_logs']`; `revoke` empties it.
  - `visibleFor filters disabled and project-restricted`: three connectors (disabled; `projects: ['/a']`; no projects). `visibleFor('/b')` returns only the third; `visibleFor('/a')` returns the second and third.
  - `store keeps a corrupt copy`: write `{not json` to the file; loading gives `[]` and a sibling `connectors.json.corrupt-<digits>` exists with the original bytes.
  - `secrets never in connectors.json`: set secrets `{ env: { RAILWAY_TOKEN: 'sek' } }`; `connectors.json` does not contain `sek`, and `connector-secrets.json` does not contain `sek` in plain text.
  - `secrets refuse without encryption`: cipher with `available: () => false`; `set` throws `Criptografia do sistema indisponível; não dá para guardar o segredo.`
  - `presets are well formed`: each preset has a unique id; http presets have an `https://` url; stdio presets have a command; `presetById('railway')` has `auth.kind === 'cli'` and `command === 'railway'`.
- [ ] **Step 2: Run** `node --test src/main/connectors/*.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.**
  - Store: file `userData/connectors.json`, written with `writeAtomic` at mode 0o600. Corrupt file: copy to `<file>.corrupt-<Date.now()>`, `console.error` it, start empty (same behavior as `trust.ts`).
  - Secrets: file `userData/connector-secrets.json` = `{ [id]: cipher.encrypt(JSON.stringify(secrets)) }`, mode 0o600. A value that fails to decrypt reads as `{}` and is logged.
  - Presets: verify each URL or command against the vendor's current docs while building, and keep these unless the docs say otherwise:
    - `railway`: stdio `railway` `['mcp']`; auth `{ kind: 'cli', command: ['railway', 'login'], check: ['railway', 'whoami'] }`; "Deploys, logs e variáveis do Railway".
    - `github`: http `https://api.githubcopilot.com/mcp/`; auth token field `{ key: 'token', label: 'Token do GitHub', use: { header: 'Authorization', format: 'Bearer {value}' } }`.
    - `stripe`: http `https://mcp.stripe.com`; oauth.
    - `supabase`: http `https://mcp.supabase.com/mcp`; oauth.
    - `sentry`: http `https://mcp.sentry.dev/mcp`; oauth.
    - `chrome-devtools`: stdio `npx` `['-y', 'chrome-devtools-mcp@latest']`; auth none.
  - Add the dependency (Global Constraints) and move `writeAtomic`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: connector store, encrypted secrets and presets`.

### Task 2: Connector hub (lazy MCP clients)

**Files:**
- Create: `src/main/connectors/hub.ts`, `src/main/connectors/client.ts`, `src/main/connectors/fixtures/echo-server.ts`
- Test: `src/main/connectors/hub.test.ts`, `src/main/connectors/client.test.ts`

**Interfaces:**
- Consumes: `Connector`, `ConnectorSecrets`, `ConnectorStatus` (Task 1).
- Produces, in `hub.ts`:
  ```ts
  export interface ToolInfo { name: string; description?: string; inputSchema: unknown }
  export interface CallResult { content: unknown[]; isError?: boolean }
  export interface LiveClient { tools(): Promise<ToolInfo[]>; call(tool: string, args: unknown, signal?: AbortSignal): Promise<CallResult>; close(): Promise<void>; onClose(cb: (stderrTail: string) => void): void }
  export interface AuthMaterial { env: Record<string, string>; headers: Record<string, string>; oauth?: import('@modelcontextprotocol/sdk/client/auth.js').OAuthClientProvider }
  export type ClientFactory = (c: Connector, auth: AuthMaterial) => Promise<LiveClient>
  export class ConnectorError extends Error { constructor(message: string, readonly kind: 'login' | 'failed') }
  export class ConnectorHub extends EventEmitter {
    constructor(deps: { factory: ClientFactory; auth: (c: Connector) => AuthMaterial; idleMs?: number })
    tools(c: Connector): Promise<ToolInfo[]>
    call(c: Connector, tool: string, args: unknown, signal?: AbortSignal): Promise<CallResult>
    test(c: Connector): Promise<number>            // connects, returns tool count
    close(id: string): Promise<void>
    closeAll(): Promise<void>
    status(id: string): { status: ConnectorStatus; error?: string; toolCount?: number }
    markLogin(id: string): void                    // status 'precisa de login'
  }
  ```
- Produces, in `client.ts`: `realFactory: ClientFactory`. It uses the SDK `Client` with `StdioClientTransport` (command, args, env = `process.env` + secret env, `stderr: 'pipe'`, cwd = home) or `StreamableHTTPClientTransport` (url, `requestInit.headers` = secret headers, `authProvider` = `auth.oauth`). It maps the SDK's `UnauthorizedError` to `ConnectorError(…, 'login')`.

- [ ] **Step 1: Write the failing tests.**
  - `hub.test.ts` (fake factory counting connects):
    - `no connect until first use`: constructing the hub and calling `status` makes zero connects.
    - `one shared client`: `tools` then `call` twice gives exactly 1 connect.
    - `idle close`: with `idleMs: 50`, after a call and a 120 ms wait, `close` was called and the status is `desconectado`; the next call reconnects (2 connects).
    - `crash marks erro and reconnects`: the fake fires `onClose('boom\nlast line')`; the status is `erro` and `error` ends with `last line`; the next call reconnects.
    - `failed start is a ConnectorError`: a factory rejecting with `spawn bad ENOENT` makes `tools` reject with a `ConnectorError` of kind `failed` whose message includes `ENOENT`, and the hub does not throw elsewhere.
    - `login error marks status`: a factory rejecting with `ConnectorError('x', 'login')` gives status `precisa de login`.
  - `client.test.ts`:
    - `realFactory talks stdio to the echo fixture`: connector `{ transport: 'stdio', command: process.execPath, args: ['src/main/connectors/fixtures/echo-server.ts'] }`; `tools()` returns `[{ name: 'echo', … }]`; `call('echo', { text: 'oi' })` returns content `[{ type: 'text', text: 'oi' }]`.
- [ ] **Step 2: Run** `node --test src/main/connectors/hub.test.ts src/main/connectors/client.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The echo fixture is a low-level SDK `Server` (`ListToolsRequestSchema`, `CallToolRequestSchema`) over `StdioServerTransport`, with one tool `echo`. The hub keeps the last 500 stderr characters per client for `error`. It emits `'change'` on every status change. Concurrent first uses share one pending connect promise.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: connector hub with lazy shared MCP clients`.

### Task 3: Gateway (socket server and stdio MCP script)

**Files:**
- Create: `src/main/connectors/gateway-server.ts`, `src/main/connectors/gateway.ts` (entry script), `src/main/connectors/gateway-protocol.ts`, `src/main/adapters/gateway-launch.ts`
- Modify: `electron.vite.config.ts` (add the main build input `gateway: 'src/main/connectors/gateway.ts'`, which builds to `out/main/gateway.js`)
- Test: `src/main/connectors/gateway-server.test.ts`, `src/main/connectors/gateway.test.ts`

**Interfaces:**
- Produces, in `gateway-protocol.ts`: `GwRequest = { id: number; token: string; op: 'list' | 'tools' | 'call'; name?: string; tool?: string; args?: unknown }`, `GwResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string }`, `MAX_LINE = 1_048_576`, framing = one JSON object per `\n`-terminated line, `TOOLS` (the three gateway tool definitions with JSON input schemas: `list_connectors {}`, `connector_tools { name: string }`, `call_connector { name: string; tool: string; args?: object }`).
- Produces, in `gateway-server.ts`:
  ```ts
  // ThreadRef comes from src/shared/connectors.ts (Task 1)
  export type GwHandler = (ctx: ThreadRef, req: GwRequest, signal: AbortSignal) => Promise<unknown>
  export function socketPath(userData: string, pid: number): string
  export async function startGatewayServer(path: string, handle: GwHandler): Promise<{ path: string; issue(t: ThreadRef): string; close(): Promise<void> }>
  ```
  `socketPath`: on Windows `\\.\pipe\brandyterm-gw-<pid>`; elsewhere `join(userData, 'gw-<pid>.sock')`, or `join(tmpdir(), 'bt-gw-<pid>.sock')` when that path is longer than 100 bytes.
- Produces, in `gateway-launch.ts`: `export interface GatewaySpec { command: string; args: string[]; env: Record<string, string> }`, `setGatewayProvider(fn: (t: ThreadRef) => GatewaySpec | null): void`, `gatewayFor(t?: ThreadRef): GatewaySpec | null`. The spec is `{ command: process.execPath, args: [<out/main/gateway.js>], env: { ELECTRON_RUN_AS_NODE: '1', BRANDY_GATEWAY_SOCKET, BRANDY_GATEWAY_TOKEN } }`.

- [ ] **Step 1: Write the failing tests.**
  - `gateway-server.test.ts`:
    - `unknown token is refused`: a request with token `nope` gets `{ ok: false, error: 'Sessão do gateway inválida' }`.
    - `issued token reaches the handler with its thread`: `issue({ projectId: 'p', threadId: 't' })` returns the same token on a second call for `t`; the handler sees `ctx.threadId === 't'`.
    - `socket close aborts in-flight requests`: the handler awaits its signal; destroying the client socket makes the signal `aborted`.
    - `oversized line drops the socket`: sending `MAX_LINE + 1` bytes with no newline closes the connection, and the server keeps serving new connections.
    - `stale socket file is replaced`: write a regular file at the path first; `startGatewayServer` still listens (posix only, skipped on win32).
    - The socket file mode is `0o600` (posix only).
  - `gateway.test.ts`: spawn `process.execPath src/main/connectors/gateway.ts` with the env pointing at a test server whose handler returns `[{ name: 'Railway', description: 'x' }]` for `list`; an SDK `Client` over `StdioClientTransport`:
    - `lists exactly three tools`: names are `list_connectors`, `connector_tools`, `call_connector`.
    - `list_connectors returns the handler result as JSON text`.
    - `handler error becomes isError`: the handler throws `Railway não está instalado em Mac.`; the call result has `isError: true` and that text.
    - `dead socket answers instead of hanging`: with `BRANDY_GATEWAY_SOCKET` pointing at a closed path, `list_connectors` resolves within 2 s with `isError: true` and text `BrandyTerm não está respondendo`.
- [ ] **Step 2: Run** `node --test src/main/connectors/gateway*.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The gateway uses the SDK's low-level `Server` (no zod) over `StdioServerTransport` and one persistent `net` connection, reconnecting once per request when it is closed. It sets no request timeout; the agent's tool timeout bounds the wait. The server unlinks a stale posix socket before `listen` and `chmod`s it to 0o600. The gateway env holds only the socket path and the token.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`, then check that `out/main/gateway.js` exists. Expected: PASS.
- [ ] **Step 5: Commit** `feat: gateway MCP and local socket server`.

### Task 4: Connector approvals

**Files:**
- Modify: `src/shared/types.ts` (`ApprovalDecision` gains `'forever'`; `ToolApproval` gains `connector?: { name: string; tool: string }`; `Thread` gains `logins?: ThreadLogin[]`; `AppState` gains `connectors?: ConnectorsState`), `src/main/adapters/types.ts` (`ApprovalAsk` gains `connector?: { id: string; name: string; tool: string }`), `src/main/approvals.ts`, `src/main/allow-rules.ts`, `src/main/engine.ts` (`private approvals` becomes `readonly approvals`, nothing else), `src/main/app-ipc.ts` (`thread:approve` accepts `'forever'`), `src/renderer/src/components/ThreadAttention.tsx`
- Test: `src/main/approvals.test.ts` (create or extend), `src/main/allow-rules.test.ts` (extend if present)

**Interfaces:**
- Produces: `ThreadApprovals.ask(t, a)` resolves `'forever'` when the user picks "Sempre" on a connector card. The caller stores it (Task 6).
- Produces: `rulesFor(a)` returns `['Conector:<id>:<tool>']` for a connector ask, and `alwaysLabel(a)` returns `Sempre nesta thread` for one.

- [ ] **Step 1: Write the failing tests.**
  - `allowAll does not cover connector asks`: with `t.allowAll = true`, `ask(t, connectorAsk)` stays pending and `t.approval.connector` is `{ name: 'Railway', tool: 'get_logs' }`.
  - `"all" answer leaves a connector card pending`: `respond(t, id, 'all')` on a connector card keeps the promise pending and the card shown.
  - `always in thread covers the same connector tool only`: after `'always'`, a second ask for `railway:get_logs` resolves `'allow'` at once, and one for `railway:deploy` shows a card.
  - `forever resolves forever`: `respond(t, id, 'forever')` resolves `'forever'`.
  - `forever on a non-connector card acts as always` (no global store for tools).
- [ ] **Step 2: Run** `node --test src/main/approvals.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `ThreadApprovals.ask`, skip the `allowAll` short-circuit for connector asks, while `covered(t.allow, a)` still applies. The queued re-check after `'all'` skips connector asks. Build the card's `summary` as `<name> · <tool>`; the caller passes the arguments in `detail`, capped at 2000 characters.
  - `ThreadAttention`: for `approval.connector`, the buttons are `Permitir` ('allow'), `Sempre nesta thread` ('always'), `Sempre` ('forever') and `Negar` ('deny'), with no "Permitir tudo nesta thread". The connector's name is the heading and the arguments go in the existing detail block.
- [ ] **Step 4: Run** `npm test && npm run typecheck` and `wc -l src/main/engine.ts` (at most 398). Expected: PASS.
- [ ] **Step 5: Commit** `feat: connector approvals outside "permitir tudo"`.

### Task 5: Login broker (OAuth, token, CLI)

**Files:**
- Create: `src/main/connectors/login.ts`, `src/main/connectors/oauth.ts`, `src/main/connectors/cli-login.ts`
- Modify: `src/renderer/src/terminals.ts:58` (ids starting with `connector-` never auto-restart, like `account-`)
- Test: `src/main/connectors/login.test.ts`, `src/main/connectors/oauth.test.ts`, `src/main/connectors/cli-login.test.ts`

**Interfaces:**
- Consumes: `ConnectorStore`, `SecretStore` (Task 1); `ConnectorHub.test`, `markLogin`, `ConnectorError` (Task 2).
- Produces, in `login.ts`:
  ```ts
  export interface LoginDeps { store: ConnectorStore; secrets: SecretStore; hub: ConnectorHub; runners: Runners; holdMs?: number }
  export interface Runners { oauth(c: Connector, signal: AbortSignal): Promise<void>; cli(c: Connector, terminalId: string, signal: AbortSignal): Promise<void> }
  export class LoginBroker extends EventEmitter {
    constructor(deps: LoginDeps)
    needsLogin(c: Connector): Promise<boolean>
    require(c: Connector, waiter: ThreadRef, signal: AbortSignal): Promise<void>  // holds a call until logged in
    ask(c: Connector): void                    // panel/install: show the card in phase 'ask'
    enter(id: string, values?: Record<string, string>): Promise<void>  // "Entrar"
    cancel(id: string): void                   // "Cancelar"
    panelLogins(): PanelLogin[]
    threadLogins(threadId: string): ThreadLogin[]
  }
  ```
  `'change'` is emitted whenever a card changes. The wiring (Task 6) copies `threadLogins` into `t.logins` and `panelLogins` into `state.connectors.logins`.
- Produces, in `oauth.ts`: `createOAuthProvider(id: string, secrets: SecretStore, redirectUrl: string, onRedirect: (url: URL) => void): OAuthClientProvider` and `waitForCode(signal: AbortSignal): Promise<{ redirectUrl: string; code: Promise<string> }>`. The loopback HTTP server listens on `127.0.0.1` on a random port, path `/callback`, and answers the browser with `Login concluído. Pode voltar ao BrandyTerm.`
- Produces, in `cli-login.ts`: `runCliLogin(c: Connector, terminalId: string, signal: AbortSignal, deps: { spawn: (id: string, o: { file: string; args: string[]; cwd: string; onExit: (code: number) => void }) => { kill(): void }; exec: (cmd: string[]) => Promise<number> }): Promise<void>`. It runs `auth.command` in a pty with id `connector-login-<id>` (cwd home), waits for exit, then runs `auth.check` and needs exit 0.

- [ ] **Step 1: Write the failing tests** (fake runners, a fake hub and `holdMs: 100`).
  - `card waits for Entrar`: `require(railway, {p, t1}, signal)` makes `threadLogins('t1')` show `[{ name: 'Railway', phase: 'ask' }]`, and no runner has run.
  - `Entrar runs the login once and releases every waiter`: `require` from t1 and t2, then one `enter('railway')`. `runners.cli` runs once, both promises resolve, and both threads' cards are gone.
  - `waiting phase`: during the runner, the cards' phase is `waiting`.
  - `Cancelar rejects with the message`: rejects with `login do Railway cancelado`, and the cards are gone.
  - `hold timeout`: with no Entrar for 100 ms, it rejects with `Tempo esgotado esperando o login do Railway`.
  - `waiter abort`: aborting t1's signal rejects only t1, and t2's card stays.
  - `token login saves fields as secrets`: `enter('github', { token: 'abc' })` saves secrets with `headers.Authorization === 'Bearer abc'`, and no card or state contains `abc`.
  - `failure keeps the entry`: a runner rejecting with `x` gives a card in phase `failed` with `error: 'x'`, and the store still has the connector.
  - `needsLogin`: none gives false; token with no secret gives true; oauth with no stored tokens gives true.
  - `cli-login.test.ts`: exit 0 and check 0 resolve; exit 1 rejects with `Login do Railway não terminou`; spawn `ENOENT` rejects with `Comando railway não encontrado. Instale o CLI e tente de novo.`
  - `oauth.test.ts`: provider round-trip (`saveTokens`, then `tokens()`) through the fake-cipher `SecretStore`; `waitForCode` resolves the code from `GET /callback?code=xyz` and closes the server.
- [ ] **Step 2: Run** `node --test src/main/connectors/login.test.ts src/main/connectors/oauth.test.ts src/main/connectors/cli-login.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - There is one in-flight login per connector id.
  - The real `oauth` runner: `waitForCode`, then a provider whose `onRedirect` calls `shell.openExternal`, then `hub.test`. On `UnauthorizedError` the redirect has happened, so await the code, call `transport.finishAuth(code)`, then run `hub.test` again. Expose what is needed from `client.ts` for that.
  - If the stored client registration's redirect URL differs from the new loopback URL, `clientInformation()` returns `undefined` so the SDK registers again.
  - Nothing opens a browser or a pty before `enter`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: login broker with explicit Entrar/Cancelar for oauth, token and cli`.

### Task 6: Call dispatcher and main wiring

**Files:**
- Create: `src/main/connectors/calls.ts`, `src/main/connectors/index.ts`
- Modify: `src/main/index.ts` (call `startConnectors` before `bindIpc` and stop it on quit; the call adds at most 3 lines)
- Test: `src/main/connectors/calls.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5; `engine.state`, `engine.approvals.ask`, `engine.fail`, `engine.touch` (`engine.ts:76`, `:95`); `RemoteHosts.states()` (`src/main/remote/hosts.ts:122`).
- Produces, in `calls.ts`:
  ```ts
  export interface CallsDeps { store; hub; login: LoginBroker; approvals: { ask(t: Thread, a: ApprovalAsk): Promise<ApprovalDecision> }
    findThread(r: ThreadRef): { p: Project; t: Thread } | undefined; machineName(): string
    elsewhere(name: string): string | undefined; notify(r: ThreadRef, text: string): void; holdMs?: number }
  export function createCalls(d: CallsDeps): GwHandler
  export const RESULT_CAP = 100_000
  ```
- Produces, in `index.ts`: `startConnectors(d: { engine: Engine; userData: string; hosts?: RemoteHosts }): Promise<{ stop(): Promise<void>; deps: ConnectorDeps }>`. It builds the store, secrets, hub (`realFactory`), broker and gateway server, calls `setGatewayProvider`, mirrors the views into `engine.state.connectors` and the thread logins into `t.logins` (calling `engine.touch()` on `'change'`), and clears stale `t.logins` on start. `ConnectorDeps` is what Task 8's IPC needs.

- [ ] **Step 1: Write the failing tests** (all fakes).
  - `list shows only connectors visible to the thread's project`: returns `[{ name, description }]` for `visibleFor(p.path)`, with no secrets and no command.
  - `unknown thread`: the error is `Thread encerrada`.
  - `missing here, present elsewhere`: with `elsewhere('Railway') === 'Mac'` and machine `PC`, the error is `Railway não está instalado em PC; está em Mac. Instale pelo painel Conectores em PC.`, and `notify` got the same text.
  - `missing everywhere`: `Railway não está instalado em PC. Instale pelo painel Conectores.`
  - `disabled`: `Railway está desativado no painel Conectores.`
  - `needs login holds, then continues to approval`: `login.require` is awaited before `approvals.ask`.
  - `alwaysAllow skips approval`: with `alwaysAllow: ['get_logs']`, `approvals.ask` is not called.
  - `forever stores the tool`: an ask resolving `'forever'` calls `store.allow(id, 'get_logs')` and the call runs.
  - `deny`: the error is `Chamada negada pelo usuário`.
  - `approval hold timeout`: with `holdMs: 50` and no answer, the error is `Tempo esgotado esperando aprovação`, and the ask's signal was aborted.
  - `thread cancel aborts`: aborting the request signal while waiting on approval aborts the ask's signal and rejects, so nothing stays pending.
  - `huge result is capped`: a 300 000-character text result comes back as 100 000 characters followed by `\n(resultado cortado em 100000 caracteres)`.
  - `approval card carries the arguments`: `ask` gets `connector: { id, name: 'Railway', tool: 'get_logs' }`, summary `Railway · get_logs`, and `detail` = `JSON.stringify(args, null, 2)` capped at 2000.
- [ ] **Step 2: Run** `node --test src/main/connectors/calls.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `elsewhere`: the first machine in `hosts.states()` whose `state.connectors.list` has the name (case-insensitive), or `undefined`.
  - `notify`: `engine.fail(p, text, t)` plus `engine.touch()`.
  - Connector lookup: by name, case-insensitive, among all connectors. Apply the visibility, enabled and project rules after the lookup, so the error is specific.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: connector call dispatcher wired to approvals, login and gateway`.

### Task 7: Threads load the gateway

**Files:**
- Modify: `src/main/adapters/types.ts` (`RunOpts` gains `thread?: ThreadRef`), `src/main/engine.ts` (one line, see Global Constraints), `src/main/adapters/claude-sdk.ts:58-81` (`buildOptions`), `src/main/adapters/codex.ts:32-46`, `src/main/coordinator.ts:193-213` (`buildThreadPrompt`)
- Test: `src/main/adapters/claude-sdk.test.ts` (extend or create), `src/main/adapters/codex-args.test.ts`, `src/main/coordinator.test.ts` (extend)

**Interfaces:**
- Consumes: `gatewayFor(t)` (Task 3).
- Produces: work threads carrying a `thread` ref get the gateway. Other runs (coordinator, readonly, scan) never do.

- [ ] **Step 1: Write the failing tests.** Stub with `setGatewayProvider(() => ({ command: '/e', args: ['/g.js'], env: { ELECTRON_RUN_AS_NODE: '1', BRANDY_GATEWAY_SOCKET: '/s', BRANDY_GATEWAY_TOKEN: 'tok' } }))`.
  - `claude work thread gets brandy`: `buildOptions({ tools: 'work', thread: { projectId: 'p', threadId: 't' }, … })` has `strictMcpConfig: true`; `mcpServers.brandy` is `{ type: 'stdio', command: '/e', args: ['/g.js'], env: {…} }`; `allowedTools` includes `mcp__brandy__list_connectors`, `mcp__brandy__connector_tools` and `mcp__brandy__call_connector`; and `env.MCP_TOOL_TIMEOUT === '960000'`.
  - `claude non-work run has no mcpServers`: `tools: 'readonly'` gives no `mcpServers` key.
  - `canUseTool allows mcp__brandy__ tools without asking`: `approve` is never called.
  - `codex args`: for a work thread, the args contain, before the final `'-'`: `-c`, `mcp_servers.brandy.command="/e"`; `-c`, `mcp_servers.brandy.args=["/g.js"]`; `-c`, `mcp_servers.brandy.env={ ELECTRON_RUN_AS_NODE = "1", BRANDY_GATEWAY_SOCKET = "/s", BRANDY_GATEWAY_TOKEN = "tok" }`; `-c`, `mcp_servers.brandy.tool_timeout_sec=960`. A Windows pipe path is escaped (`"\\\\.\\pipe\\x"`). Extract the arg building into an exported pure `codexArgs(opts)` if it is not already testable.
  - `thread prompt mentions connectors`: `buildThreadPrompt(...)` contains `Serviços externos (Railway, GitHub e outros) ficam disponíveis pelas ferramentas list_connectors, connector_tools e call_connector; use só quando a tarefa precisar.`
- [ ] **Step 2: Run** the three test files. Expected: FAIL.
- [ ] **Step 3: Implement.** TOML strings use `JSON.stringify`. Add the engine line, and nothing else in engine.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build` and `wc -l src/main/engine.ts` (at most 399). Expected: PASS.
- [ ] **Step 5: Manual check (record the result in the report).** In `npm run dev`, add the echo fixture as a custom stdio connector (Task 8 UI, or by seeding `connectors.json` by hand). Start a Claude thread and a Codex thread, each asked to "liste os conectores e chame echo com oi". Expected: each thread calls `list_connectors`, then `call_connector`, which shows the approval card, and the thread gets `oi` after Permitir. If Codex exec refuses MCP calls, record the exact error and the override that fixes it, as a ruling.
- [ ] **Step 6: Commit** `feat: work threads load the BrandyTerm gateway`.

### Task 8: IPC, remote filter and the "Conectores" panel

**Files:**
- Create: `src/main/connectors/connectors-ipc.ts`, `src/renderer/src/connectors/ConnectorsSection.tsx`, `src/renderer/src/connectors/ConnectorRow.tsx`, `src/renderer/src/connectors/AddConnectorDialog.tsx`, `src/renderer/src/connectors/CustomConnectorForm.tsx`, `src/renderer/src/connectors/elsewhere.ts`, `src/renderer/src/connectors/useHostConnectors.ts`, `src/renderer/src/connectors/connectors.css`
- Modify: `src/main/rpc/channels.ts` (RULES), `src/preload/index.ts`, `src/shared/api.ts` (a `connectors` group), `src/main/remote/host-filter.ts` (`filterState`), `src/renderer/src/components/Sidebar.tsx:122-131` (drop the `'mcp'` plugin rows and render `ConnectorsSection` in their place)
- Test: `src/main/connectors/connectors-ipc.test.ts`, `src/main/remote/host-filter.test.ts` (extend), `src/renderer/src/connectors/elsewhere.test.ts`, `src/renderer/src/connectors/custom-form.test.ts`

**Interfaces:**
- Channels, all `'deny'`, with their args:
  - `connectors:presets` () → `Preset[]`
  - `connectors:add` `{ preset?: string; draft: Omit<Connector, 'id' | 'alwaysAllow'>; secrets?: ConnectorSecrets }` → `{ id }`
  - `connectors:update` `{ id; patch; secrets? }`
  - `connectors:remove` `{ id }`
  - `connectors:enable` `{ id; on }`
  - `connectors:test` `{ id }` → `{ tools: number }`
  - `connectors:login` `{ id; values? }`
  - `connectors:login-cancel` `{ id }`
  - `connectors:revoke-always` `{ id; tool }`
  - Task 9 adds `connectors:import-list` and `connectors:import` (RULES, preload and api together, so `registry.test.ts` stays green after each task).
- `api.connectors.{ presets, add, update, remove, enable, test, login, loginCancel, revokeAlways }`.
- `filterState`: `connectors` reaches remotes only as `{ list: list.map(({ id, name, description, preset, enabled, status, toolCount }) => …), logins: [] }`. `t.logins` travel with visible threads only, already covered by the project filter.
- `onlyElsewhere(local: ConnectorView[], hosts: { machine: MachineInfo; list: { name: string; preset?: string }[] }[]): { name: string; preset?: string; machines: string[] }[]`.
- `validateCustom(d): string | null` (in `CustomConnectorForm.tsx` or a sibling `custom-form.ts`).

- [ ] **Step 1: Write the failing tests.**
  - `connectors-ipc.test.ts`:
    - `add with secrets keeps them out of the returned view`;
    - `add of a custom stdio without trusted is refused`: `Confirme "Confio neste comando" antes de salvar`;
    - `remove closes the hub client and deletes the secrets`.
  - The existing `rpc/registry.test.ts` and `rpc/remote-refusal.test.ts` must pass unchanged with the new channels.
  - `host-filter.test.ts`: `remote state has no connector command, args, url, envKeys, headerKeys, projects or logins`.
  - `elsewhere.test.ts`: local has Railway; host Mac has Railway and Stripe; host PC has Stripe. The result is `[{ name: 'Stripe', preset: 'stripe', machines: ['Mac', 'PC'] }]`. Name matching is case-insensitive.
  - `custom-form.test.ts`:
    - stdio without command gives `Informe o comando`;
    - http with a non-https URL that is not localhost gives `Use uma URL https`;
    - an empty name gives `Informe o nome`;
    - a valid draft gives `null`.
- [ ] **Step 2: Run** these tests. Expected: FAIL.
- [ ] **Step 3: Implement the panel.**
  - Section heading `Conectores`. Each row shows the name, a status chip with the exact `ConnectorStatus` text, `<n> ferramentas` when known, a toggle (`connectors:enable`) and the buttons `Configurar`, `Testar` and `Remover`. `Remover` asks for confirmation using the app's existing confirm pattern.
  - `Configurar` edits the name, description, the projects it is limited to (checkboxes of local projects; none checked means all), and replaces secret values (shown as `••••` with only their key names).
  - Under each row, `Sempre permitido:` lists the tools in `alwaysAllow`, each with `×` (`connectors:revoke-always`).
  - Footer buttons `Adicionar` and `Importar do Claude Code` (the latter wired in Task 9).
  - The add dialog has a grid of presets, plus `Personalizado` (the stdio or http form: env and header names with secret values).
  - A custom stdio connector shows the exact command, args and env names, plus a checkbox `Confio neste comando` that must be ticked before `Salvar`.
  - After saving, the panel's login card opens for that connector (Task 9) unless `authKind` is `none`.
  - Below the rows, the `onlyElsewhere` entries show `Só em <máquinas>`, with `Instalar aqui` only when `preset` is set (it opens the dialog on that preset).
  - On a remote machine group, the section is not shown. `useHostConnectors` reads each online host's state from the renderer's remote host states (see `merged-state.ts` and `useRemoteHosts.ts`).
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`, and run `wc -l` on every touched file (all at most 400). Expected: PASS.
- [ ] **Step 5: Commit** `feat: Conectores panel with presets, custom connectors and remote-safe state`.

### Task 9: Login cards (panel and chat) and import from Claude Code

**Files:**
- Create: `src/renderer/src/connectors/LoginCard.tsx`, `src/main/connectors/import-claude.ts`, `src/renderer/src/connectors/ImportConnectors.tsx`
- Modify: `src/renderer/src/components/ThreadAttention.tsx` (render `t.logins`), `src/renderer/src/connectors/ConnectorsSection.tsx` (render `state.connectors.logins`, and the import button), `src/main/connectors/connectors-ipc.ts`, `src/main/rpc/channels.ts`, `src/preload/index.ts`, `src/shared/api.ts` (channels `connectors:import-list` () → `ImportCandidate[]` and `connectors:import` `{ names: string[]; trusted: boolean }`, both `'deny'`; `api.connectors.importList`, `api.connectors.import`)
- Test: `src/main/connectors/import-claude.test.ts`, `src/renderer/src/connectors/login-card.test.ts` (pure helper `loginCardView`)

**Interfaces:**
- Produces, in `import-claude.ts`:
  ```ts
  export interface ImportCandidate { name: string; transport: 'stdio' | 'http'; command?: string; args?: string[]; url?: string; envKeys: string[]; headerKeys: string[]; unsupported?: string }
  export function readClaudeServers(file: string): ImportCandidate[]   // file defaults to join(homedir(), '.claude.json')
  export function toDraft(c: ImportCandidate, raw: unknown): { draft: Omit<Connector, 'id' | 'alwaysAllow'>; secrets: ConnectorSecrets }
  ```
- Produces, in `LoginCard.tsx`: `LoginCard({ login, machineName, remote }: { login: ThreadLogin | PanelLogin; machineName?: string; remote: boolean })` and a pure `loginCardView(login, remote, machineName) → { title, primary?: { label, disabled }, cancel: boolean, note?: string, showTerminal: boolean, showFields: boolean }`.

- [ ] **Step 1: Write the failing tests.**
  - `import-claude.test.ts`, with a fixture JSON that has top-level `mcpServers` with a stdio server (`env: { RAILWAY_TOKEN: 'sek' }`), an http server (`headers: { Authorization: 'Bearer x' }`) and an `sse` one:
    - three candidates, with `envKeys: ['RAILWAY_TOKEN']`, `headerKeys: ['Authorization']`, and the sse one `unsupported: 'SSE não é suportado'`;
    - no candidate contains `sek` or `Bearer x`;
    - `toDraft` puts the values in `secrets` and gives `auth: { kind: 'none' }`;
    - the file's bytes and mtime are unchanged after reading;
    - a missing file gives `[]`.
  - `login-card.test.ts`:
    - local `ask`: title `Conectar Railway`, primary `Entrar` enabled, cancel true;
    - `waiting`: note `Aguardando login…`, no primary, cancel true;
    - the cli kind while waiting has `showTerminal` true;
    - the token kind in `ask` has `showFields` true;
    - remote `ask` with machine `PC`: primary `Faça login em PC` disabled, cancel false;
    - `failed` shows `error` as the note and primary `Tentar de novo`.
- [ ] **Step 2: Run** these tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `Entrar` calls `api.connectors.login({ id, values })`, and `Cancelar` calls `api.connectors.loginCancel({ id })`.
  - The cli terminal mounts `attach('connector-login-<id>').host`, the same as `AccountLogin.tsx:43-51`, and calls `dispose` on unmount.
  - Token fields are password inputs that are never put in state.
  - In the chat, `ThreadAttention` shows one `LoginCard` per `t.logins` entry, above the approval card. `remote` is true for `@machine/project` ids, and `machineName` comes from the project's `machine`.
  - Import: the list has checkboxes; unsupported entries are disabled with their reason; a stdio entry needs `Confio neste comando` before `Importar`.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build` and `wc -l` on the touched files. Expected: PASS.
- [ ] **Step 5: Manual check (record in the report).**
  - Install Railway from the preset: the card shows Entrar/Cancelar, the embedded terminal runs `railway login`, the status becomes `conectado` with the tool count, and Cancelar mid-login leaves `precisa de login`.
  - Log out (`railway logout`), then ask a thread for Railway logs: the card appears in the thread, and after Entrar and login the call goes to its approval card.
  - With a second instance (`npm run dev:second`) paired: the remote thread's card shows `Faça login em <máquina>` disabled, `Só em <outra>` shows on the instance without Railway, and an approval can be answered from the other instance.
- [ ] **Step 6: Commit** `feat: login cards in panel and chat, import from Claude Code`.
