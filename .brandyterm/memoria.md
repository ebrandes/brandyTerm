# Memória do projeto

## Projeto
- BrandyTerm (Electron + React/TS), branch main. Já na main: contexto 300k e artifact viewer. Ainda sem commit: status por projeto, chips recolhíveis, -w no dev, menu de projetos, lista de arquivos/modal.
- Verificação: npm run typecheck, build, npm test (204 ok), node scripts/archive-check.ts, compact-check.ts, project-status-check.ts, project-actions-check.ts. engine-e2e, ask-e2e e restart-check quebram fora do Electron (settings.ts:3 importa app). adapter-smoke e process-smoke saem com 0 mesmo falhando: não servem de prova.
- Tema: variáveis CSS (--muted, --faint, --amber).
- Limite de 400 linhas: engine.ts ~397 (extrair para synthesis.ts antes de crescer); types.ts ~350.
- Janela de contexto vem de modelUsage.contextWindow (claude-events.ts:73), não de flag.
- Dev: electron-vite dev -w (2.3.0); mudanças em src/main reiniciam o app. Sem -w, o main antigo causou falso bug (lastSeen descartado).
- Usuário também usa Windows: rótulos por plataforma (Finder/Explorador) e cuidado com -webkit-app-region: drag, que no Windows engole o clique direito.

## Decisões
- Ordem: ícone → SDK → @. Menção @ entra como texto no prompt, não anexo.
- UI limpa: resolvidas sempre começam recolhidas; rodapé de contexto/tokens discreto (só informativo).
- Retenção: quadro mostra 10 finalizadas + 'Mostrar mais'; threads >7 dias ou além das 50 mais recentes por projeto vão ao arquivo morto sem apagar. Motivo: estado crescia sem limite.
- Repo público: README em inglês (SEO) + README.pt-BR.md, Buy Me a Coffee, GIF pedindo estrela. Descrição/topics só com aprovação.
- Contexto do coordenador limitado a 300k (custo); compactação antes do limite.
- Status por projeto: flags independentes running/waiting/news com contagens e label. Spinner = execução (relógio estático com 'Reduzir movimento'); âmbar = aguardando você (único que pede ação); destaque = novidades (some ao abrir). waiting+news mostra só âmbar. Motivo: bolinha amarela única parecia pendência permanente.
- Resposta não lida do coordenador em projeto não selecionado acende novidades (importante para o usuário).
- Chips do cabeçalho da thread recolhíveis, começam numa linha; 'Permitindo tudo' sempre visível (alerta de segurança).
- Enquanto o usuário trabalha, threads não reiniciam nem matam processos do app.
- Menu de botão direito nos projetos: renomear (só nome exibido, F2), arquivar/restaurar (seção Arquivados), limpar contexto do coordenador (sessão nova, mantém memória), abrir no Finder, copiar caminho, remover do app (nunca apaga a pasta; limpa arquivo morto e lastSeen).
- Arquivos no resumo: linha de chips com '+N…' abrindo dropdown; out/ e dist/ fora. Motivo: cards ocupavam espaço.
- Modal de arquivo: código em largura total, barra lateral recolhível com arquivos da thread, Diff resumido (+/− e hunks curtos), pois diff completo quase não é lido.

## Mapa
- Rodapé: components/Overview.tsx + overview-footer.css; globais em styles.css.
- Resolvidas: ResolvedGroup.tsx (key={project.id}) + thread-card.css.
- Arquivo morto: main/archive.ts, archive-ipc.ts, BoardArchive.tsx; dados em ~/Library/Application Support/brandyterm/archive/<projectId>.json; estado em brandyterm-state.json.
- Contexto: shared/context-limit.ts (300k, aviso 60k); troca de sessão coordinator-memory.ts:23 (>20 msgs ou 80k, teto 85%); autocompact 120k engine.ts:218.
- Status: shared/project-status.ts (unreadReplies :44); lastSeen em main/last-seen.ts + useLastSeen.ts, em settings.json; visual ProjectStatusDot.tsx + project-status.css em Sidebar.tsx.
- Chips: ThreadMetaChips.tsx + css em Chat.tsx; AllowAllChip em ThreadAttention.tsx; localStorage brandyterm.threadMeta.open.
- Menu de projetos: main/project-actions(.ts, -ipc.ts), shared/project-busy.ts, ProjectRow/ProjectContextMenu/ProjectDialogs/ArchivedProjects.tsx + project-menu.css; canais em rpc/channels.ts e remote/scope.ts.
- Arquivos/modal: artifact-files.ts, file-chips.ts, FileChipsMenu, ArtifactViewer/File/FileList/Diff/Frame.tsx, useFileDiffs.ts, main/git-diff.ts, shared/diff-summary.ts.
- Os nomes das opções do menu de projetos que mudam por sistema ficam em src/shared/project-menu-labels.ts (+ .test.ts). A plataforma vem de api.platform, exposto pelo preload. Por causa do Windows, o .titlebar (região drag de 38 px) exige no-drag em .ctx-menu, .side-head, .project-list e .archived-projects.

## Pendências
- Menu de botão direito não abre no Windows (delegado; suspeita: falta de commit ou região de drag).
- Planos não aplicados: ícone (build/icon.icns do PNG 1254x1254 em ~/Downloads + electron-builder); migração para @anthropic-ai/claude-agent-sdk com canUseTool/ApprovalCard (tipos não conferidos); autocompletar @ via fs:list.
- Bloqueios do review (2026-11-24): allow-rules.ts:78 (bypass com && e redirecionamento; executável só pelo nome); security.ts:55 (src.path escapa do clone); engine.ts:326, terminal.ts:63, account-ipc.ts:61 (callbacks antigos afetam execuções novas); coordinator.ts:244 e restore.ts:10 (corrupção de estado, conferir).
- Arquivo morto: chips do chat para threads arquivadas não abrem; p.messages/p.synthesized crescem; retenção só na inicialização.
- README: falta usuário BMC (TODO_BMC_USER) e GIF/captura real.
- Teste manual no app: rodapé, resolvidas, status, novidades, cabeçalho, menu, lista de arquivos e modal.
- Sem resposta: badge no Dock/notificação macOS para novidades em segundo plano.
- Commitar o trabalho de 2026-11-25.
- Menu no Windows: o código está corrigido, mas falta o commit e o push. Depois, dar git pull no Windows e testar o clique direito numa máquina real.

## Recente
- 2026-11-24: contexto 300k; antes: resolvidas recolhidas, kanban 10 + arquivo morto, README, review do Codex reprovado.
- 2026-11-25: status por projeto em 4 estados com tooltip/contagem; checks ok; sem commit.
- 2026-11-25: cabeçalho recolhível e spinner separado do aviso; checks ok; sem commit.
- 2026-11-25: novidades não acendiam em segundo plano; causa main antigo sem -w; regra passou a contar respostas do coordenador; ok; sem commit.
- 2026-11-25: dev passou para -w (aprovado); vale no próximo npm run dev.
- 2026-11-25: menu de botão direito com 6 ações + F2; checks, build e npm test ok; falta teste manual; sem commit.
- 2026-11-25: lista de arquivos em chips e modal largura total com diff resumido entregues; typecheck, build e npm test ok; sem commit.
- 2026-11-25: usuário reportou menu de botão direito sem abrir no Windows; delegado a uma thread.
- 2026-11-25: o menu não abria no Windows porque não estava commitado. Também havia uma região drag que engolia o clique direito; recebeu no-drag. A opção de abrir a pasta agora tem nome por sistema. Typecheck, build, npm test (276) e project-actions-check ok; sem commit.
