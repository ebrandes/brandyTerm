# BrandyTerm

Desktop terminal (Windows and macOS) that runs **Claude Code**, **Codex** and **Gemini** side by side, with one coordinator chat per project.

You talk to the project's coordinator. It decides what needs a separate **thread**, picks the best agent, model and effort for each one, and every thread reports back to the main chat. You can also open a thread and talk to it directly.

> Early version (0.1). Threads are **read-only** on purpose: they investigate, plan and answer, but do not edit files.

## How it works

- **Projects**: open any folder. The three demo projects are only examples.
- **Coordinator**: one headless call with a JSON schema. It either answers directly or delegates 1–3 tasks, each with agent, model, effort and a short "why". It validates the plan against the CLIs that are actually installed.
- **Threads**: a Claude Code Desktop-style view with the delegated prompt, a live **Plano** (task list), collapsed actions and a short final answer. Max 2 threads run at once per project. Context auto-compacts at 120k tokens.
- **Questions**: when a thread needs a decision it stops with state *Aguardando você*. A card appears in the main chat with the options; answering (there or by telling the coordinator) resumes that thread.
- **Processes**: start dev servers (frontend, backend, anything) from the *Processos* panel. Ports found in the output become clickable chips, logs are kept, and everything is killed when the app quits. Only you start them; threads never do.
- **Default plugins**: [Superpowers](https://github.com/obra/superpowers) and [TokenEconomizer](https://github.com/microsoft/TokenEconomizer) are loaded into every Claude thread when found in `~/.claude/plugins/cache`. Nothing is installed for you.
- **Safety**: no bypass flags, read-only sandbox, prompts are sent over stdin.

## Requirements

- Node 22+
- At least one CLI installed and logged in: `claude` and/or `codex` (Gemini adapter is a stub)

## Run

```bash
npm install
npm run dev
```

```bash
npm run typecheck
npm run build
```

## Known limits

- Codex `exec` does not emit a plan, so Codex threads show actions only. Its read-only sandbox may not find Node/npm.
- Gemini is not wired yet.
- State is a JSON file in the user data folder (SQLite is planned).

## License

MIT
