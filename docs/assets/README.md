# docs/assets

Images used by `README.md` and `README.pt-BR.md`.

| File | What it is | License |
| --- | --- | --- |
| `logo.png` | App icon, 256×256, resized from `resources/icon.png` | Same as the project (MIT) |
| `star.svg` | Animated star for the "Star this repo" call to action. Original artwork made for this project (CSS animation, respects `prefers-reduced-motion`) | CC0 1.0 (public domain) |
| `screenshot-chat.png` | Coordinator chat: a request split into threads, a question card, project overview | Same as the project (MIT) |
| `screenshot-thread.png` | Agent thread with its plan and an approval card for a shell command | Same as the project (MIT) |
| `screenshot-board.png` | Kanban board of agents with all five columns | Same as the project (MIT) |

## TODO: missing screenshots

Both READMEs already reference these files inside HTML comments. Add each file, then remove
the comment markers around its block. Follow the privacy rule below.

| File | What it should show |
| --- | --- |
| `screenshot-overview.png` | Main window: projects with status in the sidebar, coordinator chat, overview |
| `screenshot-coordinator.png` | Coordinator delegating a request to Claude Code and Codex threads |
| `screenshot-questions.png` | Thread questions in the stepper, with a recommended option |
| `screenshot-apply-queue.png` | **Aplicações** panel with a request waiting for approval |
| `screenshot-processes.png` | **PROCESSOS** panel with origins, ports and the stop button |
| `screenshot-logs.png` | **Ver logs** window with the summary |

## How the screenshots were made

All data on screen is fake: the projects (Lumen Notes, Orbita API, Pomar Shop), threads,
messages and accounts were written into a seed, not taken from real use.

- The app ran as a **separate instance**: its own build output, its own `userData` folder
  (so its own single-instance lock and state), a throwaway `HOME` and a clean environment
  (`env -i`). The real app state and any running instance were not touched.
- `claude` and `codex` on `PATH` were small stub scripts, so no real agent run could start.
- The window was 1440×900 and captured with `webContents.capturePage()` (2× scale), then
  resized to 1600 px wide with `sips -Z 1600`.

When you retake them, keep the same rule: nothing personal on screen (no e-mails, real
account names, tokens, home-folder paths with your user name, or private repo names). The
sidebar, the accounts panel and the terminal are the usual places where these show up.

## TODO: demo GIF

Record a short loop (10–20 s, 1440×900 window) showing: a message to the coordinator →
threads appearing on the kanban board → an approval card → the final summary in the main
chat. Use a demo project with fake data. [Kap](https://getkap.co) or the macOS screenshot
tool (`Cmd+Shift+5`) work well. Convert and shrink it to stay under ~5 MB:

```bash
ffmpeg -i demo.mov -vf "fps=12,scale=1100:-1:flags=lanczos" -loop 0 docs/assets/demo.gif
```

Then use `docs/assets/demo.gif` as the hero image in both READMEs.

## TODO: GitHub social preview (1280×640)

Upload it in **Settings → General → Social preview** (it is not read from the repo).

- Size 1280×640 px (minimum 640×320), PNG or JPG, under 1 MB.
- Keep the important content inside the central ~1100×520 area: some sites crop the edges.
- Suggested layout: logo on the left; on the right "BrandyTerm" and the tagline
  "Orchestrate Claude Code & Codex agents from one desktop app"; a faded crop of the
  kanban board in the background. Dark background (`#1c1a24`) and the purple from the icon.
- Keep the source file as `docs/assets/social-preview.png` so it can be updated later.
