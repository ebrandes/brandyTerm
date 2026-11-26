# Card de pergunta com recomendada primeiro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A opção recomendada pelo agente vem sempre primeiro, com selo "Recomendado", num card redesenhado.

**Architecture:** Função pura em `src/shared/ask-options.ts` faz parse do marcador e ordena; `extractQuestion` usa; `recommended?: boolean` viaja em `question`/`ask`; o card vira `AskCard.tsx` + `ask-card.css`.

**Tech Stack:** Electron, React/TS, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-25-ask-card-recommended-design.md`

## Global Constraints
- Nenhum arquivo de código > 400 linhas. Tudo no worktree `../brandyTerm-wt-ask`; aplicar no projeto só com aprovação.
- Marcador: `*` no início da opção, ou `(recomendado|recomendada)` no fim (sem distinção de maiúsculas). Máx. 6 opções.
- Sem marcador: ordem original, `recommended` ausente, sem selo. Selo em `--accent`, texto "Recomendado".

## Review Focus
- Duas opções marcadas → só a primeira marcada vai ao topo; a outra perde o marcador.
- Opção só com `*` (vazia após tirar o marcador) → descartada.
- `*` no meio do texto (`a*b`) não é marcador.
- Resposta enviada é o texto limpo (sem `*`), e o card antigo ainda fecha (comparação por `question.text`).
- Card estreito (≤420px): nada passa da largura, campo e botão empilham.

---

### Task 1: parse + ordenação
**Files:** Create `src/shared/ask-options.ts`, `src/shared/ask-options.test.ts`; Modify `src/main/coordinator.ts` (`extractQuestion`, `threadLine`, prompt), `src/shared/types.ts:75,132`, `src/main/engine.ts:318`; Test `src/main/coordinator.test.ts`.

**Interfaces — Produces:** `parseOptions(raw: string): { options: string[]; recommended: boolean }`; `extractQuestion(text) → { text; options?; recommended?: true }`.

- [ ] Testes: `parseOptions('a | *b | c')` → `{ options: ['b','a','c'], recommended: true }`; `'a | b (recomendada)'` → `['b','a']`; `'a | b'` → ordem original, `recommended: false`; `'*a | *b'` → `['a','b']`; `'a | * | b'` → `['a','b']`; `'a*b | c'` → sem recomendação; 8 opções → 6. `extractQuestion` com e sem marcador; prompt contém `*`.
- [ ] Rodar e ver falhar; implementar; rodar e ver passar.
- [ ] engine repassa `recommended` no `ask`; `threadLine` mostra `(recomendada)` na primeira.

### Task 2: AskCard redesenhado
**Files:** Create `src/renderer/src/components/AskCard.tsx`, `ask-card.css`; Modify `Chat.tsx` (remove AskCard local), `styles.css:184-196` (remove regras `.ask*`), `BoardDetail.tsx:69` (marca a recomendada).

- [ ] Lista vertical (`role="list"`) de botões largura total: número, texto que quebra, selo na primeira se `recommended`.
- [ ] Teclado: ↑/↓ movem foco entre opções; 1–9 escolhem quando o foco está no card (fora do input).
- [ ] Form "Ou escreva outra resposta"; em ≤420px (container query) empilha.

### Task 3: verificação
- [ ] `npm run typecheck`, `npm run build`, `npm test` no worktree; diff contra o baseline; aplicar com aprovação.
