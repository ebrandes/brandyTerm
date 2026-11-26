# Memória do projeto

## Projeto
- BrandyTerm (Electron + React/TS). Main em 5ddde4e + 4 patches da fila aplicados sem commit (conectores/Context7, notificações, PROCESSOS, economia de tokens).
- Verificação: typecheck, build, npm test, scripts archive/compact/project-status/project-actions-check.ts. engine-e2e, ask-e2e e restart-check quebram fora do Electron (settings.ts:3 importa app). adapter-smoke/process-smoke saem 0 mesmo falhando.
- Sandbox do Codex bloqueia sockets (~66 falhas): suíte completa fora dele.
- Limite 400 linhas: engine.ts ~397 (extrair p/ synthesis.ts), types.ts ~350.
- Dev: `electron-vite dev -w` (sem -w o main antigo gera falsos bugs).
- Usuário também usa Windows: rótulos por plataforma. -webkit-app-region: drag engole clique direito.
- Tema: variáveis CSS (--muted, --faint, --amber). Janela de contexto: modelUsage.contextWindow (claude-events.ts:73).
- Context7: HTTP https://mcp.context7.com/mcp (`claude mcp add` dava -32001).
- Coordenador: tasks só criam threads novas; answers só alcançam threads aguardando.
- TokenEconomizer: hook.py só existe em lib/tokeneconomizer/plugin após `npm run plugins`.
- Codex: TokenEconomizer e RTK injetados por execução, sem tocar ~/.codex; confiança via `-c hooks.state`. Exige Codex ≥0.171.0; não reinjeta se já instalado.
- Resumo de logs pelo Haiku: ~US$ 0,001–0,003 por abertura.

## Decisões
- Ordem dos planos: ícone → SDK → @ (menção vira texto no prompt).
- UI limpa: resolvidas recolhidas, rodapé de tokens discreto, chips recolhíveis; 'Permitindo tudo' sempre visível (segurança).
- Retenção: 10 finalizadas + 'Mostrar mais'; >7 dias ou >50/projeto vão ao arquivo morto sem apagar (estado crescia).
- Repo público: README inglês (SEO) + pt-BR, BMC, GIF. Descrição/topics só com aprovação.
- Coordenador limitado a 300k por custo; compacta antes.
- Status: spinner = execução; âmbar = aguardando você (único que pede ação); destaque = novidades. Motivo: bolinha única parecia pendência permanente.
- Threads não reiniciam nem matam o app; as que editam src/main usam worktree (../brandyTerm-wt-*) porque dev -w as derrubava.
- Fila de aplicação é a única via para a main (usuário não quer conferir à mão). Thread commita na worktree e chama queue_apply {worktree,title,base?}; aprovação única no painel 'Aplicações'; git apply sem commit, um por vez, só com tudo ocioso; falha trava os de trás. Persiste em userData/apply-queue.json.
- "Continue as threads" = retomar interrompidas. Substituída não vira pendência.
- Menu direito em projetos: renomear (F2, só exibição), arquivar/restaurar, limpar contexto, Finder/Explorador, copiar caminho, remover (nunca apaga pasta).
- Chips de arquivos '+N…', sem out/ e dist/; modal com código em largura total, diff resumido. Chat sem rolagem horizontal; chips máx. 200px.
- Logs por área (mcp, plugins, skills, remote, notify, usage): diagLog JSON lines, rotação, segredos ocultos.
- 'Ver logs': modal formatada, pesquisa, filtro; resumo Haiku só ao abrir, entrada limitada, cache por mtime. Motivo: entender sem gastar à toa.
- Perguntas: recomendada primeiro; responder na thread ou coordenador resolve nos dois.
- Conectores: ações no clique direito; cinza/verde/amarelo; globais com exceção por projeto; Context7 global por padrão.
- PROCESSOS + rodapé minimizáveis (localStorage); PROCESSOS só lista.
- 'Enviar resumo': enviando / enviado ✓ / erro com retry. Motivo: usuário não sabia se enviou.
- Notificações nativas ao terminar/falhar/aguardar, ligadas por padrão; clique foca; não notifica o visível nem canceladas.
- Economia de tokens: hooks e config global intocados; poda só proposta; ganho só se gasto cai sem piorar qualidade. Se só houver via global no Codex, consultar usuário.

## Mapa
- Fila: shared/running.ts, shared/apply-queue.ts, main/apply-{queue,git,request,store,gateway,ipc}.ts, ApplyQueuePanel.tsx.
- Rodapé: Overview.tsx, OverviewDock/OverviewFooter.tsx, dock-summary.ts, ProcessPanel.tsx.
- Arquivo morto: main/archive(-ipc).ts, BoardArchive.tsx; userData/archive/<projectId>.json.
- Contexto: shared/context-limit.ts (300k); coordinator-memory.ts:23; autocompact 120k (engine.ts:218).
- Status: shared/project-status.ts, main/last-seen.ts, ProjectStatusDot.tsx.
- Menu: main/project-actions(-ipc).ts, ProjectContextMenu.tsx; .titlebar exige no-drag em .ctx-menu, .side-head, .project-list, .archived-projects.
- Arquivos: artifact-files.ts, file-chips.ts, Artifact*.tsx, main/git-diff.ts, shared/diff-summary.ts.
- MCP: connect-diag.ts, pasted-fix.ts, diag-redact.ts, ConnectorsSection.tsx.
- Resumo/perguntas: thread-report*.ts, shared/ask-question.ts, ThreadAsk.tsx.
- Logs: main/logs-digest.ts (18000 chars, erros primeiro), logs-summary, summary-session; runOnce em main/run.ts. `te` CLI: resources/plugins/tokeneconomizer/scripts.

## Pendências
- Aprovar no painel Aplicações wt-codex-plugins e wt-logs-modal (34a47ad); conferir ✓ de plugins e `te --host codex status`; testar modal de logs no Mac e Windows.
- Rodar `npm test` fora do sandbox, reiniciar app, testar e commitar a main; remover worktrees aplicadas; ativar Context7 em todos os projetos.
- Testar: TokenEconomizer (Claude), Context7 em outro projeto, notificações com clique, portas em PROCESSOS. 1 falha intermitente no npm test (economia).
- Windows não testado: notificações, PROCESSOS, clique direito, plugins no Codex.
- Thread 'responder na thread' descartada incompleta: perguntar se refaz.
- Delegados: RTK/medição mensal; grupo '60 ações' abre vazio.
- Planos: ícone (PNG em ~/Downloads → icon.icns); claude-agent-sdk com canUseTool/ApprovalCard; autocompletar @.
- Review 2026-11-24: allow-rules.ts:78 (bypass com && e redirecionamento); security.ts:55 (path escapa); callbacks antigos engine.ts:326, terminal.ts:63, account-ipc.ts:61; corrupção de estado coordinator.ts:244, restore.ts:10.
- Arquivo morto: chips arquivados não abrem; p.messages/p.synthesized crescem; retenção só no boot.
- README: TODO_BMC_USER e GIF real.
- Ideias sem resposta: badge no Dock; dev sem -w + dev:watch.

## Recente
- Antes: coordenador, menu direito, chips/diff, Context7, painéis minimizáveis, resumo enviado; commits até 5ddde4e; fila criada.
- 2026-11-26: conectores MCP globais (wt-mcp-global).
- 2026-11-26: notificações nativas (wt-notify) e PROCESSOS (wt-procs).
- 2026-11-26: economia de tokens (wt-economy).
- 2026-11-26: 4 worktrees aplicadas, conflitos resolvidos; `npm run plugins` recuperou hook.py.
- 2026-11-26: typecheck/build ok; 968 testes ok, 66 falhas de socket no sandbox. Sem commit.
- 2026-11-26: TokenEconomizer/RTK no Codex em wt-codex-plugins na fila; Codex 0.171.0 ok, 1047 testes.
- 2026-11-26: modal Ver logs pronta (wt-logs-modal) na fila; 1073 testes ok; não testada no app.
- 2026-11-26: o usuário pediu commit e push da main; delegado. A fila (wt-codex-plugins, wt-logs-modal) só entra se for aprovada antes.
