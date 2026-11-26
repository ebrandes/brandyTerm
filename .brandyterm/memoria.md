# Memória do projeto

## Projeto
- BrandyTerm (Electron + React/TS). origin/main em 63f33ae; sem master; .brandyterm/memoria.md versionado. package.json 0.1.0, sem Releases.
- Verificação: typecheck, build, npm test, scripts archive/compact/project-status/project-actions-check.ts, `node scripts/proc-stop-check.ts`. engine-e2e, ask-e2e e restart-check quebram fora do Electron (settings.ts:3 importa app); adapter-smoke/process-smoke saem 0 mesmo falhando. Sandbox do Codex bloqueia sockets: rodar a suíte completa fora dele.
- Limite 400 linhas: engine.ts ~397 (extrair p/ synthesis.ts), types.ts ~350.
- Dev: `electron-vite dev -w` (sem -w o main antigo gera falsos bugs).
- Usuário também usa Windows: rótulos por plataforma. -webkit-app-region: drag engole clique direito.
- Tema: variáveis CSS (--muted, --faint, --amber). Janela de contexto: modelUsage.contextWindow (claude-events.ts:73).
- Context7: HTTP https://mcp.context7.com/mcp (`claude mcp add` dava -32001).
- Coordenador: tasks só criam threads novas; answers só alcançam threads aguardando.
- TokenEconomizer: hook.py só existe após `npm run plugins`. Codex: TE/RTK injetados por execução sem tocar ~/.codex (`-c hooks.state`), exige Codex ≥0.171.0, não reinjeta se já instalado.
- Resumo de logs pelo Haiku: ~US$ 0,001–0,003 por abertura.
- Perguntas: além de `PERGUNTA:`, detecta texto livre e decisão aberta em RESUMO:/PENDENTE: sem modelo. Claude recebe instrução de perguntar; Codex com `/`, só detecção.
- PROCESSOS: rótulo usa gerenciador real (ex.: pnpm run dev). Main recusa parar PIDs fora da lista, o BrandyTerm e ancestrais.

## Decisões
- Ordem dos planos: ícone → SDK → @ (menção vira texto no prompt).
- UI limpa: resolvidas recolhidas, rodapé discreto, chips recolhíveis; 'Permitindo tudo' sempre visível (segurança).
- Retenção: 10 finalizadas + 'Mostrar mais'; >7 dias ou >50/projeto vão ao arquivo morto sem apagar (estado crescia).
- Repo público: README EN (SEO) + pt-BR, BMC `ebrandes`, aviso de GIF a caminho. Descrição/topics e push só com aprovação.
- Coordenador limitado a 300k por custo; compacta antes.
- Status: spinner = execução; âmbar = aguardando você (único que pede ação); destaque = novidades (bolinha única parecia pendência).
- Threads não reiniciam nem matam o app; as que editam src/main usam worktree (../brandyTerm-wt-*) pois dev -w as derrubava.
- Fila de aplicação é a única via para a main (usuário não quer conferir à mão): thread commita na worktree e chama queue_apply {worktree,title,base?}; git apply sem commit, um por vez, só com tudo ocioso; falha trava os de trás; persiste em userData/apply-queue.json. Aprovação só para core que exige reiniciar (main, preload, package.json/deps); renderer/docs/outros projetos aplicam sozinhos.
- "Continue as threads" = retomar interrompidas. Substituída não vira pendência.
- Menu direito em projetos: renomear (F2, só exibição), arquivar/restaurar, limpar contexto, Finder/Explorador, copiar caminho, remover (nunca apaga pasta).
- Chips '+N…', sem out/ e dist/, máx. 200px; modal com código em largura total, diff resumido; chat sem rolagem horizontal.
- Logs por área: diagLog JSON lines, rotação, segredos ocultos. 'Ver logs': modal com pesquisa/filtro; resumo Haiku só ao abrir, entrada limitada, cache por mtime (não gastar à toa).
- Perguntas: recomendada primeiro; responder na thread ou no coordenador resolve nos dois; thread com perguntas pendentes fica âmbar; várias viram stepper. Motivo: usuário perdeu 4 perguntas da thread impeccable.
- Conectores: ações no clique direito; cinza/verde/amarelo; globais com exceção por projeto; Context7 global por padrão.
- PROCESSOS + rodapé minimizáveis (localStorage). Parar com confirmação, árvore, Mac/Windows, validado no main; só processos do projeto, esconde claude, codex, electron, BrandyTerm e MCP.
- 'Enviar resumo': enviando / enviado ✓ / erro com retry (usuário não sabia se enviou).
- Notificações nativas ao terminar/falhar/aguardar, ligadas por padrão; clique foca; não notifica o visível nem canceladas.
- Economia de tokens: hooks e config global intocados; poda só proposta; ganho só se gasto cai sem piorar qualidade. Via só global no Codex: consultar usuário.
- Versão ao lado do logo + selo 'Atualização' (cor de destaque): checa ao abrir e a cada 6 h, sem token; release ou origin/main no clone. Só avisa, nunca instala.

## Mapa
- Fila: shared/running.ts, shared/apply-queue.ts, main/apply-{queue,git,request,store,gateway,ipc}.ts, ApplyQueuePanel.tsx.
- Rodapé: Overview.tsx, OverviewDock/OverviewFooter.tsx, dock-summary.ts, ProcessPanel.tsx.
- Processos: main/proc-scan*.ts, proc-stop.ts, shared/proc-{attribution,filter,kind}.ts, DetectedProcs.tsx, ManagedProc.tsx, StopConfirm.tsx.
- Versão: main/update-{check,monitor,ipc}.ts, VersionBadge.tsx.
- Arquivo morto: main/archive(-ipc).ts, BoardArchive.tsx; userData/archive/<projectId>.json.
- Contexto: shared/context-limit.ts (300k); coordinator-memory.ts:23; autocompact 120k (engine.ts:218).
- Status: shared/project-status.ts, main/last-seen.ts, ProjectStatusDot.tsx.
- Menu: main/project-actions(-ipc).ts, ProjectContextMenu.tsx; no-drag em .ctx-menu, .side-head, .project-list, .archived-projects.
- Arquivos: artifact-files.ts, file-chips.ts, Artifact*.tsx, main/git-diff.ts, shared/diff-summary.ts.
- MCP: connect-diag.ts, pasted-fix.ts, diag-redact.ts, ConnectorsSection.tsx.
- Perguntas: thread-report*.ts, shared/ask-*.ts, main/ask-rule.ts, ThreadAsk.tsx, AskStepper.tsx, AskOptions.tsx.
- Logs: main/logs-digest.ts (18000 chars, erros primeiro), logs-summary, summary-session; runOnce em main/run.ts.

## Pendências
- Aprovar na fila e testar Mac/Windows: wt-ask-stepper (6808e85), wt-procs-stop (3db9872), wt-auto-apply, wt-readme (3d9f428; faltam 6 capturas, TODO_BMC_USER, GIF; push só com sim).
- Aplicações da fila sem commit/push na pasta principal.
- Reiniciar e testar: modal de logs, notificações, portas em PROCESSOS, plugins no Codex (`te --host codex status`), TE no Claude, Context7 em outro projeto. Depois remover worktrees aplicadas e ativar Context7 em todos.
- Windows não testado: notificações, PROCESSOS, clique direito, plugins no Codex, logs.
- 1 falha intermitente no npm test (economia).
- Thread 'responder na thread' descartada incompleta: perguntar se refaz.
- Delegados: RTK/medição mensal; grupo '60 ações' abre vazio.
- Planos: ícone (PNG em ~/Downloads → icon.icns); claude-agent-sdk com canUseTool/ApprovalCard; autocompletar @.
- Review 2026-11-24: allow-rules.ts:78 (bypass com && e redirecionamento); security.ts:55 (path escapa); callbacks antigos engine.ts:326, terminal.ts:63, account-ipc.ts:61; corrupção de estado coordinator.ts:244, restore.ts:10.
- Arquivo morto: chips arquivados não abrem; p.messages/p.synthesized crescem; retenção só no boot.
- Ideias sem resposta: badge no Dock; dev sem -w + dev:watch.

## Recente
- Antes: coordenador, menu, chips, Context7, fila, conectores, notificações, PROCESSOS, TE/RTK no Codex, modal de logs; push origin/main 63f33ae.
- 2026-11-26: stepper de perguntas na fila (6808e85); 1093 testes ok.
- 2026-11-26: wt-procs-stop na fila (3db9872); 1098 testes ok; parada testada no Mac por script.
- 2026-11-26: wt-version aplicada e testada pelo usuário; 1137/1137 testes ok.
- 2026-11-26: README EN/pt-BR atualizado (3d9f428, wt-readme), aguardando aprovação na fila.
- 2026-11-26: usuário aprovou exigir aprovação só para o core; auto-aplicação delegada a wt-auto-apply.
- 2026-11-26: commit e push para origin/main delegados (usuário disse 'master'; o repo só tem main); wt-auto-apply ainda aguarda aprovação.
