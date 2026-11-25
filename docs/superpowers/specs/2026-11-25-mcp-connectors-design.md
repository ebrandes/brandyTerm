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
- Connector login (OAuth for remote servers like Railway/Stripe, API keys for others) happens
  once, in the app; threads never see secrets.

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
uses the SDK's `OAuthClientProvider`: the first connect opens the system browser, the callback
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

**Login mid-run (builder's call, recorded).** A connector that still needs login does not open a
browser by itself: `call_connector`/`connector_tools` fail at once with "Railway precisa de login no
painel Conectores", the thread may ask the user with `PERGUNTA:`, and the main chat shows a notice with
a button that opens the panel's login. No browser window ever pops up unprompted mid-run.

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
