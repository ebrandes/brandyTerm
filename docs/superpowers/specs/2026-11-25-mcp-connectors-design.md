# MCP connectors on demand (panel + gateway)

## Intent

The user installs MCP connectors (Railway, Stripe, GitHub, anything) once, inside
BrandyTerm, and threads use them **only when the task needs them**. A thread that
must read a Railway log turns Railway on by itself, mid-run, without restarting;
a thread that never needs a connector pays nothing for it. Today threads run with
`--strict-mcp-config` and get no MCP at all, and the only MCP the app knows is a
fixed plugin (Chrome DevTools MCP) whose server never reaches the threads anyway.

## Goals

- **Panel** in the sidebar: install, uninstall, configure (tokens, env, URL), enable/disable
  connectors. Easy: presets for common services plus a custom form; one-click import of the
  servers the user already has in Claude Code.
- **On demand**: every Claude and Codex thread loads one small BrandyTerm MCP, the
  *gateway*, with three tools:
  - `list_connectors()` → installed, enabled connectors: name + one-line description.
  - `connector_tools(name)` → that connector's tools with their input schemas (connects on first use).
  - `call_connector(name, tool, args)` → runs one tool and returns its result.
  The real connectors' tool schemas never enter a thread's context until it asks.
- Every `call_connector`, from **any agent (Claude and Codex)**, waits for the user's approval
  in the hub, shown as the existing approval card with connector, tool and arguments (user's
  decision). The card offers: allow once, deny, **always in this thread**, and **always** (remembered
  per `connector:tool` across all threads and projects, listed and revocable in the panel).
  A thread's "permitir tudo" does **not** cover connector calls (builder's call: it was granted for
  local edits and commands, not production services).
- Connector login (OAuth for remote servers, API keys, or the service's own CLI login such as
  `railway login`) happens in the app through an explicit login card with "Entrar" and "Cancelar"
  that waits for the result and then connects, like the big apps do (user's decision). Threads
  never see secrets.

## Non-goals

- Running MCPs in the coordinator chat (it has no tools).
- MCP resources/prompts/sampling; only tools.
- A public marketplace or search of MCP registries.

## Anti-goals

- Secrets in thread prompts, logs, state JSON or plaintext files.
- A connector call that skips the user's approval in a Claude thread.
- Changing the user's own `~/.claude` configuration (import reads it, never writes).
- Thread startup getting slower: no connector process starts until a thread asks for it.

## Approaches considered

1. Coordinator picks MCPs per task, thread can request more and gets resumed with them
   (reuses Claude Code's own MCP/OAuth; costs a restart mid-run).
2. **Gateway MCP**: one always-loaded BrandyTerm MCP proxying to the real connectors on demand
   (no restart, works for Codex too; BrandyTerm must handle connector auth itself).
3. Load all MCPs in every thread and rely on Claude Code's lazy tool loading
   (cheapest to build; every thread spawns every server; unverified in headless runs).

**Picked: 2**, by the user.

## Design

**Connector store (main).** `userData/connectors.json`: `{ id, name, description, transport:
'stdio' | 'http', command?, args?, url?, enabled, preset?, projects?: string[], alwaysAllow: string[] }`.
Connectors are **global** (user's decision); `projects`, when set, restricts one to those project
paths, and `list_connectors` hides it elsewhere. Secrets (env values, headers,
OAuth tokens) live apart, encrypted with Electron `safeStorage`, keyed by connector id.

**Hub (main process).** Owns one live MCP client per connector (`@modelcontextprotocol/sdk`
`Client` with `StdioClientTransport` or `StreamableHTTPClientTransport`), started lazily on the
first request and shared by every thread; idle connections close after 10 minutes. Remote OAuth
uses the SDK's `OAuthClientProvider`: the login card's Entrar opens the system browser, the callback
lands on a loopback port, tokens go to `safeStorage`. Errors come back as tool errors, never
crashes.

**Gateway (per thread).** A tiny stdio MCP server script launched by Claude/Codex with
`ELECTRON_RUN_AS_NODE=1 <electron> gateway.js`. It forwards the three tools to the hub over a
local socket (Unix socket / named pipe under `userData`, path and a random per-launch token
passed in its env). It holds no secrets and no connections.

**Threads.** Claude threads keep `strictMcpConfig: true` and get
`mcpServers: { brandy: <gateway> }`; the `mcp__brandy__*` tools are added to the thread's
tool list. All three gateway tools are pre-allowed in Claude's `canUseTool`; approval of `call_connector`
happens in the hub instead, for every agent: the gateway's per-launch token identifies the thread,
the hub asks `ThreadApprovals` (the card shows `Railway · get_logs` plus the arguments) and holds the
call until the user answers. Codex threads get the gateway via `-c mcp_servers.brandy.command=…`
overrides with a tool timeout long enough to wait for the user (e.g. 15 minutes); a denied or
timed-out call returns a tool error the agent can read.
The thread prompt gains one line: connectors are available through `list_connectors` when a task
needs an external service.

**Panel (renderer).** Sidebar section "Conectores", replacing the fake-green MCP rows: list with
status (desconectado / conectado / precisa de login / erro), toggle enabled, "Configurar",
"Remover", "Adicionar". Add dialog: presets (Railway, Stripe, GitHub, Supabase, Sentry —
each a URL or command plus which fields to ask) or custom (stdio command+args+env, or HTTP
URL+headers), and "Importar do Claude Code" that lists servers found in `~/.claude.json`
(user scope) and imports the chosen ones (secrets re-encrypted into BrandyTerm's store).
"Testar" connects and shows the tool count.

**Login card (user's decision).** Every connector, preset or custom, declares how it logs in, so
the app (and the thread) always knows what to do:
`auth: { kind: 'none' } | { kind: 'oauth' } | { kind: 'token', fields } | { kind: 'cli', command, check? }`
(`cli` example: Railway's `railway login`, with `railway whoami` as the check).
- Install: "Adicionar" → preset or custom form → a login card "Conectar Railway" with **Entrar** and
  **Cancelar** → on Entrar the app runs the login (OAuth: system browser plus loopback callback;
  token: the form fields; cli: the command in an app terminal shown inside the card so its prompts
  are visible) and the card shows "Aguardando login…" with Cancelar still available → on success it
  connects, shows the tool count and the connector is saved as conectado; on failure or Cancelar
  nothing is half-installed (the entry stays as "precisa de login").
- Mid-run: when `connector_tools`/`call_connector` hits a connector that needs login, the hub holds
  the call and shows the same login card in that thread's chat, next to the approval cards. Nothing
  opens until the user clicks Entrar; the call continues after a successful login (then goes to its
  approval card as usual), and Cancelar or a 15-minute timeout returns a tool error
  "login do Railway cancelado" the agent can read.

**Multiple machines (user's decision).** Connectors belong to the machine they are installed on;
one machine may have a connector the other does not, and the app only warns about it.
- Installing, configuring, logging in and removing happen only on that machine, never from a
  paired device (the remote channels are `deny`), the same way Claude only installs where the
  permissions can be accepted. A login card seen from another machine shows "Faça login em <máquina>"
  with Entrar disabled.
- A thread uses the connectors of the machine it runs on. When it asks for one that is missing there
  but installed on a paired machine, the tool error says "Railway não está instalado em <máquina>;
  está em <outra>. Instale pelo painel Conectores em <máquina>." and the chat shows the same notice.
- The panel lists, per paired online machine, the connectors it has that this one lacks, marked
  "Só em <outra>", with "Instalar aqui" (prefills the preset; secrets are never copied, login runs here).
- Approval cards for connector calls can be answered from either machine, like other approvals.

**Custom and imported stdio connectors (builder's call, recorded).** Presets are trusted as shipped.
A custom or imported stdio connector shows the exact command, arguments and env names before it is
saved and needs an explicit "Confio neste comando" confirmation; no claude-security scan (there is no
source to scan for an `npx`/binary command line).

## Constraints

- No code file above 400 lines; `engine.ts` is at 397 — gateway wiring goes in new modules.
- Electron 33, Agent SDK `mcpServers`/`strictMcpConfig` options, `@modelcontextprotocol/sdk` (new dep).
- UI copy in Brazilian Portuguese.

## Left to the builder

Exact preset list contents (URLs/commands verified at build time), socket framing, idle timeout
tuning, panel styling consistent with the plugin rows, how the Chrome DevTools MCP plugin entry
migrates (becomes a preset).
