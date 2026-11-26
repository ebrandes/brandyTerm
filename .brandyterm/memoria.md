# Memória do projeto

## Projeto
- BrandyTerm (Electron + React/TS), branch main. Commitado até baba16a (MCP 35a15db, sidebar). Sem commit: correção de rolagem do chat e diagnóstico MCP/logs (diag-* já na main).
- Verificação: typecheck, build, npm test (582 ok), scripts archive/compact/project-status/project-actions-check.ts. engine-e2e, ask-e2e e restart-check quebram fora do Electron (settings.ts:3 importa app). adapter-smoke e process-smoke saem 0 mesmo falhando: não servem de prova.
- Tema: variáveis CSS (--muted, --faint, --amber).
- Limite 400 linhas: engine.ts ~397 (extrair synthesis.ts antes de crescer); types.ts ~350.
- Janela de contexto vem de modelUsage.contextWindow (claude-events.ts:73).
- Dev: electron-vite dev -w; mudar src/main reinicia o app. Sem -w, main antigo gera falsos bugs.
- Usuário também usa Windows: rótulos por plataforma; -webkit-app-region: drag engole clique direito.
- Context7: correto é HTTP https://mcp.context7.com/mcp (salvar `claude mcp add ...` causava -32001).
- Coordenador: tasks só criam threads novas; answers só alcançam threads aguardando. Retomada de interrompidas + estado 'substituída' delegados.

## Decisões
- Ordem: ícone → SDK → @. Menção @ vira texto no prompt.
- UI limpa: resolvidas recolhidas; rodapé de tokens discreto.
- Retenção: 10 finalizadas + 'Mostrar mais'; >7 dias ou além de 50/projeto vão ao arquivo morto sem apagar (estado crescia sem limite).
- Repo público: README inglês (SEO) + pt-BR, BMC, GIF de estrela. Descrição/topics só com aprovação.
- Coordenador limitado a 300k (custo), compacta antes.
- Status por projeto: spinner = execução (estático com reduzir movimento); âmbar = aguardando você (único que pede ação); destaque = novidades (some ao abrir; inclui resposta não lida do coordenador); waiting+news mostra só âmbar. Motivo: bolinha única parecia pendência permanente.
- Chips do cabeçalho recolhíveis; 'Permitindo tudo' sempre visível (segurança).
- Enquanto o usuário trabalha, threads não reiniciam nem matam o app.
- Menu direito em projetos: renomear (F2, só exibição), arquivar/restaurar, limpar contexto (mantém memória), abrir no Finder/Explorador, copiar caminho, remover (nunca apaga pasta).
- Arquivos no resumo: chips com '+N…'; out/ e dist/ fora (cards ocupavam espaço). Modal: código largura total, lateral recolhível, diff resumido.
- Chat sem rolagem horizontal: só blocos de código rolam; chips seguem largura (ResizeObserver), máx. 200px (responsivo).
- Logs por área (mcp, plugins, skills, remote): diagLog em main/diag-log.ts; JSON lines em app.getPath('logs'), rotação, segredos ocultos; botão 'Ver logs' (saber onde investigar).
- Threads que editam src/main usam worktree (../brandyTerm-wt-*) e aplicam no fim com aprovação (dev -w derrubava threads).
- "Continue as threads" = retomar interrompidas, não criar novas; substituída não fica como pendência vermelha.
- Cards de pergunta: opção recomendada primeiro, selo 'Recomendado'.
- Conectores: ações (Configurar/Testar/Ver logs/Remover) no clique direito, sem botões nem selo. Bolinha: cinza = não conectado, verde = conectado neste projeto, amarelo = conectado mas não habilitado aqui.

## Mapa
- Rodapé: Overview.tsx + overview-footer.css; globais e overflow do chat em styles.css.
- Resolvidas: ResolvedGroup.tsx + thread-card.css.
- Arquivo morto: main/archive.ts, archive-ipc.ts, BoardArchive.tsx; dados em ~/Library/Application Support/brandyterm/archive/<projectId>.json; estado em brandyterm-state.json.
- Contexto: shared/context-limit.ts (300k, aviso 60k); coordinator-memory.ts:23 (>20 msgs ou 80k, teto 85%); autocompact 120k engine.ts:218.
- Status: shared/project-status.ts; main/last-seen.ts + useLastSeen.ts; ProjectStatusDot.tsx.
- Chips: ThreadMetaChips.tsx; AllowAllChip em ThreadAttention.tsx; file-chips.css (+test); attach.css.
- Menu: main/project-actions(-ipc).ts, shared/project-busy.ts, ProjectRow/ProjectContextMenu/ProjectDialogs/ArchivedProjects.tsx; canais em rpc/channels.ts e remote/scope.ts; rótulos shared/project-menu-labels.ts. .titlebar (drag) exige no-drag em .ctx-menu, .side-head, .project-list, .archived-projects.
- Arquivos/modal: artifact-files.ts, file-chips.ts, FileChipsMenu, Artifact*.tsx, useFileDiffs.ts, main/git-diff.ts, shared/diff-summary.ts.
- MCP: connect-diag.ts, pasted-fix.ts (conserta no boot.ts), shared/install-command.ts, diag-redact.ts, client.ts; 'Ver logs' em ConnectorsSection.tsx (canal logs:open).

## Pendências
- Confirmar aplicação do worktree ../brandyTerm-wt-diag; testar Context7 e 'Ver logs'; commitar com a correção de rolagem.
- Thread 'Context7 sumiu (CONECTORES 0)' interrompida aguardando decisão de escopo; última imagem já mostra Context7 conectado.
- Bug: grupo '60 ações' da thread MCP/logs abre vazio (delegado).
- Windows: git pull e testar clique direito.
- Planos: ícone (PNG 1254 em ~/Downloads → icon.icns + electron-builder); migrar para claude-agent-sdk com canUseTool/ApprovalCard; autocompletar @ via fs:list.
- Review (2026-11-24): allow-rules.ts:78 (bypass && e redirecionamento); security.ts:55 (src.path escapa do clone); engine.ts:326, terminal.ts:63, account-ipc.ts:61 (callbacks antigos); coordinator.ts:244 e restore.ts:10 (corrupção de estado).
- Arquivo morto: chips arquivados não abrem; p.messages/p.synthesized crescem; retenção só no boot.
- README: TODO_BMC_USER e GIF real.
- Teste manual das features de 2026-11-25.
- Sem resposta: badge no Dock; script dev sem -w + dev:watch.

## Recente
- 2026-11-25 (antes): novidades do coordenador, menu direito + F2, chips/diff, menu Windows; commits 30b79a5, 35a15db, baba16a.
- 2026-11-25: rolagem horizontal do chat corrigida (420/560/760px); sem commit.
- 2026-11-25: threads MCP/logs derrubadas pelo dev -w; refeitas em worktree.
- 2026-11-25: timeout do Context7 corrigido, 'Ver logs' e erros por etapa; testes ok; sem commit.
- 2026-11-25: aplicação do worktree aprovada; usuário criticou criar thread nova em vez de continuar; delegadas retomada e bug do grupo vazio.
- 2026-11-25: Context7 desconectado, Testar travando, botões quebrando; delegada correção.
- 2026-11-25: após correção (Testar, layout, ícones), Context7 sumiu da lista; delegada investigação.
- 2026-11-25: delegados card de pergunta (recomendada primeiro) e menu direito com status nos conectores.
