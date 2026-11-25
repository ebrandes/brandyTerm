# Multi-machine: control Mac and Windows from each other and from the phone

## Intent

The user works on a Mac and a Windows PC every day and prefers each for different
work. Projects live on one machine or the other. Today each BrandyTerm is an island.
The user wants to:

1. From one computer, see the other computer's projects, open new chats and threads
   there, send prompts, answer approvals: "I'm on Windows but forgot something on the
   Mac; I want to talk to the Mac project from here."
2. Always know which machine the chat on screen belongs to.
3. Do the same from the phone, and from outside the home network (travel), not only on
   the home Wi-Fi (where they are ~90% of the day).
4. Keep both machines "on the same page": the same plugins, skills, hooks and
   settings, with a button that installs on one what the other has, in either
   direction.

## Goals

- Remote control of another machine's BrandyTerm: projects, coordinator chat,
  threads, approvals, dev servers, artifacts, attachments, later the terminal.
- Work always runs where the project lives. Nothing about Claude sessions, project
  paths or files moves between machines.
- A clear machine indicator in the UI, and one project list grouped by machine.
- Same-Wi-Fi: direct connection, no internet hop. Outside: through a relay.
- Phone client (web app, installable as PWA).
- Configuration parity on demand: a diff per machine and "install what's missing".
- The coordinator of one chat can send threads to either machine: "instale esse hook
  no Mac e no Windows" makes one thread on each, both reporting back to the same chat.

## Non-goals

- Moving or syncing a project, its files or its Claude session to the other machine.
- Running work on the phone.
- Automatic, continuous config sync (parity is a button the user presses).
- Multi-user / team sharing. One owner, their own devices.

## Anti-goals (failure even if it works)

- Prompt or chat content readable by the relay or Cloudflare. Some projects are
  corporate (Vivo); their content must never sit readable on an external service.
- A device that was not paired by the user being able to send anything.
- Breaking the current single-machine app: with multi-machine off, nothing changes.
- A Windows machine silently getting a macOS-only hook that breaks its Claude Code.

## Constraints

- No code file over 400 lines; `engine.ts` is at 397 and gets nothing new.
- UI copy in Brazilian Portuguese.
- Electron 33, React renderer, Node test runner.
- Work happens on branch `feat/multi-machine`; `main` stays untouched until merge.

## What exists today (relevant findings)

- The renderer talks to the main process only through `BrandyApi`
  (`src/shared/api.ts`): ~40 request/response calls plus three push streams
  (`state`, terminal `data`, terminal `exit`). The preload maps each call 1:1 to an
  `ipcMain.handle` channel. This is the seam: the same calls can travel over a
  network transport.
- `state` is pushed whole (debounced 40 ms) on every engine change.
- Threads run with `--setting-sources project`: the user's `~/.claude` hooks and
  settings do not load in BrandyTerm threads. What threads see from the user's setup
  is the plugins and personal skills turned on in BrandyTerm (`user-plugins.ts`,
  `thread-plugins.json`). User-level hooks matter only for the user's standalone
  Claude Code use.
- Windows is **not supported yet** (README: "Some Windows code paths exist (shell and
  process handling), but Windows is not supported yet"). Every host role on Windows
  depends on that groundwork (see Phase 0).

## Approaches considered

- **A. Local server on each desktop, Tailscale for outside.** No server to run. Needs
  Tailscale on every device including the phone; config parity only works with both
  machines on.
- **B. Everything through a cloud relay.** Works anywhere, stores config while a
  machine is off. Every message, even at home, takes an internet round trip and
  passes through a third party.
- **C. Hybrid (picked, builder's call; the user delegated the how).** Direct LAN
  connection when both are on the same network; a Cloudflare relay for outside
  access, the phone web app and config snapshots. One end-to-end encrypted channel
  over either transport, so the relay only sees ciphertext. Picked because it serves
  the 90% case without the cloud and still covers travel, phone and parity.

## Design

### Roles

- **Host:** a desktop BrandyTerm. Owns its projects and runs work. Every desktop is a
  host.
- **Client:** anything that controls a host: the other desktop's BrandyTerm, the phone
  web app. A desktop is host of its own projects and client of the other's at the same
  time.

### 1. Transport-agnostic API (the seam)

- Replace direct `ipcMain.handle(channel, fn)` registrations with a small registry
  (`handle(channel, fn, { remote })`) that registers with `ipcMain` and also makes the
  handler callable by the network server. Each handler declares whether it may be
  called remotely and how (see "Remote rules").
- Wire protocol: JSON frames `{ id, channel, args }` / `{ id, result | error }` and
  push frames `{ push: 'state' | 'term:data' | 'term:exit', payload }`.
- In the renderer, `window.brandy` stays the local API. A `RemoteApi` implements the
  same `BrandyApi` over the channel. A `hosts` store holds one API per connected
  machine.

### 2. Machine identity and the indicator

- Each install has a stable `machineId`, a user-editable name (default from the OS
  hostname) and `os` (`mac` / `windows` / `linux`), stored in userData.
- Sidebar: projects grouped by machine ("Este Mac", "PC Windows"), each group with an
  online/offline dot. Remote groups appear only for paired machines.
- Chat header: a machine chip with OS icon and name. A remote machine's chip uses an
  accent color so "I'm sending to the other computer" is never ambiguous. Sketch:

  ```
  ┌ Sidebar ─────────────┐  ┌ Chat ─────────────────────────────┐
  │ ● Este Mac           │  │ [ Windows · PC-ESCRITORIO ] remoto│
  │   brandyTerm         │  │ projeto: api-vivo                 │
  │   dedetizap          │  │ ...                               │
  │ ● PC Windows (remoto)│  │                                   │
  │   api-vivo   ◀       │  │ > mensagem vai para o Windows     │
  └──────────────────────┘  └───────────────────────────────────┘
  ```

- Offline remote machine: its projects show greyed with "offline desde HH:MM"; the
  composer is disabled with that reason.

### 3. Pairing and security

- Pairing is done once per device, by the user, on the host: "Parear dispositivo"
  shows a QR code and a 6-digit code (valid 2 minutes). The client scans or types it.
- Trust is per pair of devices (builder's call): each host keeps its own list of
  trusted keys and revokes locally. Pairing Mac and Windows once trusts both
  directions. The phone pairs with each host it should control (two pairings for two
  computers). No device vouches for another, so there is no trust list to sync.
- Pairing exchanges long-term X25519 public keys (a SPAKE2/PAKE-style exchange bound
  to the short code, so a code seen by someone else after use is worthless). Each
  side stores the other's key.
- Every session runs an authenticated, encrypted channel between the two keys
  (Noise-style handshake, XChaCha20-Poly1305 frames) over LAN or relay. The relay
  routes opaque frames only.
- Host keeps a device list ("Dispositivos pareados") with name, last seen, revoke.
- Per-project switch "Disponível remotamente" (default on). Off: the project is not
  listed to clients at all. Lets the user keep a corporate project local-only even
  with encryption in place.

### 4. LAN (phase 1)

- Host runs a WebSocket server on a fixed port (configurable) on all interfaces, only
  when "Acesso remoto" is on in settings (default off).
- Discovery by mDNS/Bonjour (`_brandyterm._tcp`) carrying `machineId`. Clients also
  remember the last address per machine.
- No connection is accepted until the encrypted handshake proves a paired key.

### 5. Threads on another machine (coordinator)

- A coordinator plan task gets an optional `machine` (machineId) next to agent, model
  and effort. Default: the machine that owns the project. The coordinator prompt
  lists the paired machines that are online, with name and OS.
- Two kinds of target:
  - **Machine task** (install a hook, a skill, a CLI): runs on the target host in the
    user's home folder, not tied to a project. The target host shows these under a
    built-in "Máquina" pseudo-project so they have a place in its state and archive.
  - **Project task**: runs in the target host's copy of the same project, matched by
    normalized git remote URL, or by a manual link the user sets once.
- The origin host asks the target host to create and start the thread through the
  channel (new remote call). The thread lives in the target host's state, linked to
  the origin request (origin machineId, projectId, requestId).
- The origin chat shows the remote thread's card with the machine chip, mirrored from
  the target's pushed state. Approvals and questions are answered from wherever the
  user is. When the thread ends, the origin coordinator's synthesis includes it like
  any local thread.
- If the target is offline when planned, the task is shown as "aguardando máquina
  offline" and starts when it comes back, or the user cancels it.

### 6. Relay and phone (phase 4)

- The relay is the user's own deployment in their own Cloudflare account (builder's
  call), one Durable Object, no signups or multi-tenancy. The repo ships deploy docs
  so anyone else can deploy their own.
- Cloudflare Worker + the Durable Object. Hosts keep one outbound
  WebSocket to it (works behind any NAT, no port forwarding). Clients connect to it
  and are routed to a host by `machineId`. The DO only forwards encrypted frames and
  keeps online/offline presence.
- Client picks transport: LAN when the host answers on the local network, else relay.
- The relay admits a device only by a signed challenge from a key some host
  registered with it (each host uploads its trusted public keys). No password.
- Over the relay, `state` goes as diffs against the last frame, not whole, to keep
  message count and cost down during runs.
- Threat model (builder's call): nothing readable is stored, logged or visible to the
  relay. The phone app's code is served by the Worker from the user's own account, so
  that account's integrity is trusted; an attacker who controls the deployment is out
  of scope. Desktop clients never load code from the relay.
- Phone app: the same React renderer built as a web bundle and served by the Worker,
  installable as a PWA, using `RemoteApi` over the relay. Layout adapted for narrow
  screens (project list, chat, approvals first; board and artifacts after).

### 7. Remote terminal (phase 3)

- `term:*` calls and pushes go over the channel unchanged.
- Off by default per paired device ("Pode usar o terminal"), because a remote shell
  is full control of the machine. Threads already run tools under approval rules;
  the terminal has none.

### 8. Configuration parity (phase 5)

- Each host builds an inventory:
  - Claude Code plugins: marketplaces, installed plugins with versions, enabled state.
  - Personal skills (`~/.claude/skills/*`), with content hash.
  - BrandyTerm: thread plugin toggles (`thread-plugins.json`) and portable app
    settings (keep awake, idle compaction, "permitir tudo"; not `lastProjectId`,
    `lastSeen`, accounts).
  - User-level Claude Code hooks and MCP servers from `~/.claude/settings.json` and
    `~/.claude.json` (optional section, see below).
- "Mesma página" screen: side by side, per item: same / only here / only there /
  different version. Buttons: "Instalar aqui o que falta", "Enviar para lá o que
  falta", or per item.
- Install actions:
  - Plugins: through the marketplace (`claude plugin marketplace add`, `claude plugin
    install`), never by copying plugin folders. This is a new install path (the
    existing `plugin:install` only handles BrandyTerm's own optional plugins). No
    Claude Security scan by default (builder's call): the plugin is already installed
    and in use on the other machine. A per-item "escanear antes" option runs the scan.
  - Personal skills: copy the skill folder.
  - Settings and toggles: apply the values.
  - Hooks: a hook whose command is shell-specific (`.sh`, `bash`, `zsh`, POSIX paths on
    Windows; `.ps1`, `powershell`, `C:\` paths on Mac) is marked "não portável" and is
    never installed by the bulk button, only by an explicit per-item click with a
    warning.
  - MCP servers: copied without secrets; env values that look like secrets are left
    empty and the item is marked "precisa de credenciais".
- Parity first works peer to peer over the live channel (both machines on). Then it
  stores each host's inventory and skill contents encrypted on the relay, so "install
  what the other has" works while the other machine is off.
- Never deletes anything on either side; parity only adds or updates.

### Remote rules for existing calls

| Call | Remote behavior |
|------|-----------------|
| `openFolder` (native picker) | replaced by a remote folder browser built on `fs-browse`; adds the project on the host |
| `saveAttachment` | bytes sent over the channel, stored on the host (size cap) |
| `openAttachment`, `openArtifact` | open on the client: file content streamed, opened locally; never pops a window on the host |
| `readArtifact` | as today, content over the channel |
| `openPort` | on LAN opens `http://<host-ip>:PORT` (works only if the dev server listens beyond localhost; the UI says so); over relay, shows "só disponível na rede local". Port forwarding over the channel is out of scope (builder's call) |
| `accounts.*` | read-only remotely; `addToken`, `loginStart`, `remove` refused (secrets stay on the host) |
| `installPlugin`, `setUserPlugin` | allowed (used by parity) |
| `removeProject` | allowed with a confirm on the client |
| `term.*` | only with the per-device terminal permission |
| everything else | passed through unchanged |

## Phases (each shippable on its own)

0. **Windows groundwork** (only as far as needed): BrandyTerm runs on Windows from
   source, firewall prompt handled, mDNS works.
1. **Seam + identity + LAN:** handler registry, wire protocol, machine identity,
   pairing, encrypted channel, LAN server and discovery, desktop client, grouped
   sidebar and machine chip, remote rules except terminal.
2. **Threads on another machine:** `machine` on plan tasks, machine tasks, project
   matching, remote thread cards and synthesis.
3. **Remote terminal** with per-device permission.
4. **Relay + phone:** Cloudflare Worker/DO, transport selection, web/PWA build.
5. **Parity:** inventory, diff screen, install buttons (live first, then via relay
   snapshots).

## Assumptions (open questions the user did not answer; builder's calls, robust to either answer)

- **BrandyTerm on Windows:** assumed not in daily use yet. Phase 0 is real work. Both
  machines run from source; the wire protocol carries a `protocol` version and a
  client refuses a host with a different one, showing "atualize o BrandyTerm em
  <máquina>". No cross-version compatibility layer.
- **Corporate VPN:** assumed it may block the home LAN. The client falls back to the
  relay automatically when the LAN address does not answer within 2 s. The LAN
  server binds only to private-range addresses of physical interfaces (not tunnel
  interfaces such as `utun*`, `ppp*`, `tun*`, FortiClient adapters), so nothing listens
  on the corporate network.
- **Projects on both machines:** both cases supported: git-remote matching plus a
  manual link; a project that exists on one machine only is simply targeted there.
- **Phone:** the PWA must work on iPhone and Android. Pairing happens inside the
  installed PWA (iOS storage is separate from Safari). Push notifications for
  approvals and questions are a separate, last sub-phase of phase 4.

## Left to the builder

- Crypto library choice (e.g. libsodium-wrappers / `@noble/*`) and exact handshake.
- Port number, mDNS library, reconnect/backoff.
- Size cap for remote attachments.
- How the web bundle shares code with the Electron renderer (shared components with
  an API provider).
- Exact parity inventory format.
