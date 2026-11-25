# Memória do projeto

## Projeto
- BrandyTerm (Electron + React/TS). Branch principal: main. O trabalho do contexto 300k e do artifact viewer já foi mergeado na main. O status por projeto e os chips recolhíveis ainda não foram commitados.
- Verificação: npm run typecheck, build, node scripts/archive-check.ts, compact-check.ts e project-status-check.ts. engine-e2e, ask-e2e e restart-check quebram fora do Electron (settings.ts:3 importa app). adapter-smoke e process-smoke saem com 0 mesmo falhando, então não servem de prova.
- Tema: variáveis CSS (--muted, --faint, --amber).
- Limite de 400 linhas: engine.ts está com ~397. Antes de acrescentar algo, extrair partes para synthesis.ts (que já existe).
- A janela de contexto vem de modelUsage.contextWindow (claude-events.ts:73), não de flag.
- O script dev roda electron-vite dev sem -w, então mudanças em src/main só valem depois de reiniciar o app. Isso já causou um falso bug (o lastSeen era descartado pelo main antigo).
- O script dev agora é electron-vite dev -w (electron-vite 2.3.0), ainda não commitado. Mudanças em src/main reiniciam o app sozinhas depois que o dev for reiniciado com o script novo. Isto substitui a nota de que o dev roda sem -w.

## Decisões
- Ordem de implementação: ícone, depois o SDK, depois o @. A menção com @ entra como texto no prompt, não como anexo.
- UI limpa: o grupo de resolvidas começa sempre recolhido ao entrar num projeto. O rodapé de contexto/tokens é discreto porque é só informativo.
- Retenção: o quadro mostra 10 finalizadas com 'Mostrar mais'. Threads com mais de 7 dias, ou além das 50 mais recentes por projeto, vão para o arquivo morto sem apagar nada. Motivo: o estado crescia sem limite.
- Repositório público: README em inglês (SEO), com README.pt-BR.md, Buy Me a Coffee e GIF pedindo estrela. Descrição e topics só com aprovação do usuário.
- Contexto do coordenador limitado a 300 mil tokens (não 1M), por custo. A compactação dispara antes desse limite.
- Status por projeto (revisado em 2026-11-25): spinner para execução. Bolinha só para avisos: âmbar = aguardando você (o único que pede ação), destaque = novidades (some ao abrir o projeto). Sem indicador = visto e ocioso. Execução e aviso podem aparecer juntos. Motivo: a bolinha amarela única parecia pendência permanente.
- Os chips do cabeçalho da thread (modelo, esforço, rota, skill, permissão, contexto) são recolhíveis e começam recolhidos numa linha. 'Permitindo tudo' fica sempre visível por ser alerta de segurança.
- Status por projeto: projectStatus devolve as flags independentes running, waiting e news, com contagens e label. Quando waiting e news valem juntos, aparece só a bolinha âmbar. Com 'Reduzir movimento' ativo, o spinner vira um ícone de relógio estático.
- Uma resposta não lida do coordenador (síntese final ou resposta) num projeto não selecionado deve acender a bolinha de novidades. O usuário considera isso importante.
- O usuário aprovou trocar o script dev para electron-vite dev -w (2026-11-25), para mudanças no main valerem sem reinício manual. Sempre que ele estiver trabalhando, as threads não reiniciam nem matam processos do app.

## Mapa
- Rodapé de contexto: components/Overview.tsx (.overview-footer*) + overview-footer.css. Estilos globais: styles.css.
- Resolvidas: components/ResolvedGroup.tsx (key={project.id} em Overview) + thread-card.css.
- Arquivo morto: src/main/archive.ts (seleção, escrita atômica, migração no início), archive-ipc.ts (archive:list/reopen), BoardArchive.tsx. Dados em ~/Library/Application Support/brandyterm/archive/<projectId>.json; o estado fica em brandyterm-state.json.
- Contexto: src/shared/context-limit.ts (300k, decisão de compactar, aviso). Troca de sessão em coordinator-memory.ts:23 (>20 mensagens ou 80k, teto de 85%). Autocompact de 120k em engine.ts:218.
- Status: src/shared/project-status.ts (função pura). lastSeen em src/main/last-seen.ts + renderer/useLastSeen.ts, gravado em settings.json. Visual em ProjectStatusDot.tsx + project-status.css, usado em Sidebar.tsx.
- Chips do cabeçalho da thread: components/ThreadMetaChips.tsx + thread-meta-chips.css, usados em Chat.tsx (329 linhas). O badge 'Permitindo tudo' é o AllowAllChip em ThreadAttention.tsx. A preferência de abrir ou recolher fica em localStorage, na chave brandyterm.threadMeta.open.
- Novidades: projectStatus conta threads finalizadas e também mensagens do coordenador depois do lastSeen, pela função unreadReplies (project-status.ts:44), no campo replies. O lastSeen fica em settings.json, nas linhas 20 e 36 de settings.ts.

## Pendências
- Planos não aplicados: ícone (build/icon.icns a partir do PNG 1254x1254 em ~/Downloads + electron-builder); migração para @anthropic-ai/claude-agent-sdk com canUseTool/ApprovalCard (tipos não conferidos); autocompletar com @ via fs:list.
- Bloqueios do code review (2026-11-24): allow-rules.ts:78 (bypass com && e redirecionamento; executável reconhecido só pelo nome do arquivo); security.ts:55 (src.path escapa do clone); engine.ts:326, terminal.ts:63 e account-ipc.ts:61 (callbacks antigos afetam execuções novas); coordinator.ts:244 e restore.ts:10 (corrupção de estado; detalhe truncado, conferir).
- Arquivo morto: chips do chat para threads arquivadas não abrem; p.messages/p.synthesized seguem crescendo; o arquivo fica órfão ao remover o projeto; a retenção só roda na inicialização.
- README: falta o usuário do Buy Me a Coffee (TODO_BMC_USER) e um GIF/captura real.
- Conferir no app o visual do rodapé, das resolvidas, do status por projeto e do cabeçalho recolhível.
- Aguardando aprovação do usuário: trocar o script dev para electron-vite dev -w e mostrar badge no Dock ou notificação do macOS quando houver novidade com o app em segundo plano.
- Continua sem resposta do usuário: mostrar badge no Dock ou notificação do macOS para novidades com o app em segundo plano. O -w já foi aplicado.

## Recente
- 2026-11-24: grupo 'N resolvidas' sempre recolhido ao abrir/trocar de projeto; typecheck ok.
- 2026-11-24: kanban limitado a 10 + arquivo morto; typecheck e archive-check ok.
- 2026-11-24: pedido de README público (SEO, BMC, GIF); resultado não reportado.
- 2026-11-24: o code review do Codex reprovou o commit (1 bloqueio + itens importantes).
- 2026-11-24: contexto do coordenador limitado a 300k (troca em 80k, autocompact em 120k, aviso em 60k); typecheck, build e compact-check ok.
- 2026-11-25: pedido de status mais claros na lista de projetos no lugar da bolinha amarela.
- 2026-11-25: 4 estados implementados com tooltip e contagem; check, typecheck e build ok; sem commit.
- 2026-11-25: pedido de cabeçalho da thread recolhível e spinner de execução separado do aviso; delegado a duas threads, sem commit.
- 2026-11-25: cabeçalho da thread recolhível e spinner de execução separado da bolinha de aviso implementados. Typecheck, build e project-status-check passaram. Falta conferir no app e nada foi commitado.
- 2026-11-25: o usuário reportou que o brandyTerm terminou em segundo plano sem mostrar a bolinha de novidades. Correção delegada a uma thread. Foi sugerido badge no Dock ou notificação do macOS, aguardando resposta.
- 2026-11-25: a bolinha de novidades não aparecia porque o main antigo, sem -w, descartava o lastSeen. A regra passou a contar também respostas do coordenador. O check, o typecheck e o build passaram. Falta reiniciar o app para conferir e nada foi commitado.
- 2026-11-25: o usuário aprovou o -w no script dev, sem reiniciar nada. Delegado a uma thread (só edita o package.json). A pergunta sobre o badge no Dock ou a notificação do macOS continua sem resposta.
- 2026-11-25: o script dev passou para electron-vite dev -w, sem reiniciar nada e com o typecheck passando. Vale só depois do próximo npm run dev e nada foi commitado.
