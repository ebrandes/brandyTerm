# Modal "Ver logs" com resumo Haiku Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Execução nativa (a thread foi pedida para ir até o fim).

**Goal:** "Ver logs" abre um modal com o log `mcp` formatado e um resumo do Claude Haiku pedido só na abertura.

**Architecture:** o main lê os JSON lines, monta uma entrada limitada e resume com cache e cancelamento (`run` injetado). O renderer filtra com função pura e pede o resumo no efeito de montagem do modal.

**Tech Stack:** Electron, React, TypeScript, node:test.

## Global Constraints
- Arquivos ≤ 400 linhas; sem rolagem horizontal (só `<pre>`); rótulos por plataforma.
- `MAX_SUMMARY_CHARS = 18_000`; Haiku, effort low, tools none; canais novos `'deny'` no remoto.

## Review Focus
1. Fechar (ou StrictMode) enquanto o log ainda é lido: o modelo não é chamado pela abertura cancelada.
2. Linhas iguais que só diferem na duração (`data.ms`, visto no log real): contam como repetidas.
3. Linha corrompida ou arquivo ausente: ignora, sem erro.
4. CLI ausente ou falha: erro com "Tentar de novo", lista continua; erro não vai para o cache.
5. Segredo perto do corte de uma linha longa: redigir antes de cortar.

---

### Task 1: núcleo
**Files:** `src/shared/logs.ts`, `src/main/logs-{read,digest,summary}.ts` + testes.
**Produces:** `filterEntries(entries,{query,levels})`, `readLogs(dir,area)`, `buildDigest(entries,max)`, `createSummarizer({read,run,timeoutMs})` → `{summarize(area),cancel(area)}`.

### Task 2: IPC
**Files:** `src/main/logs-ipc.ts`, `rpc/channels.ts`, `shared/remote/scope.ts`, preload, `shared/api.ts`, `routed-api(.test).ts`, `main/index.ts`.
**Produces:** `readLogs(area)`, `summarizeLogs(area)`, `cancelLogSummary(area)`.

### Task 3: modal
**Files:** `connectors/{LogsModal,LogsSummary,LogEntryRow}.tsx`, `summary-session.ts` + teste, `logs-modal.css`, `ConnectorRow.tsx`, `ConnectorsSection.tsx`.
**Produces:** `startSummary(api,area,onResult): () => void` (cancela).

### Task 4: verificar (`npm run typecheck && npm run build && npm test`), medir custo, commit, `queue_apply`.
