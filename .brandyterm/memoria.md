# Memória do projeto

## Projeto
<!-- o que é, stack, como rodar e testar -->
- Para verificar tipos: npm run typecheck. As cores do tema são variáveis CSS como --muted e --faint.
- O branch principal é main, não master. O único commit até agora é o 8dba7a5 (BrandyTerm 0.1). O resto do trabalho ainda não foi commitado.
- src/main/engine.ts está com 398 linhas, no limite das 400. Qualquer acréscimo exige extrair partes antes, por exemplo reportDirect e maybeSynthesize para synthesis.ts.
- Testes: scripts/engine-e2e.ts, ask-e2e.ts e restart-check.ts quebram fora do Electron por causa de src/main/settings.ts:3 (import do app). adapter-smoke e process-smoke saem com código zero mesmo falhando, então não servem de prova. O que passa: typecheck, build e scripts/archive-check.ts.
- O 1M de contexto vem da janela nativa do modelo, informada em modelUsage.contextWindow (claude-events.ts:73), e não de flag ou sufixo. engine.ts está com 397 linhas e synthesis.ts já existe.

## Decisões
<!-- o que foi decidido e por quê -->
- Ordem combinada de implementação: ícone, depois o SDK e depois o @. A menção com @ fica como texto no prompt, não como anexo.
- UI mais limpa: o grupo de threads resolvidas começa sempre recolhido ao entrar num projeto. O rodapé de contexto e tokens fica discreto porque é só informativo.
- Retenção de threads: o quadro mostra só as 10 concluídas ou falhas mais recentes, com 'Mostrar mais'. Threads finalizadas há mais de 7 dias, ou além das 50 mais recentes por projeto, vão para um arquivo morto, sem apagar nada. Motivo: o estado e o quadro cresciam sem limite.
- O repositório vai ser público no GitHub. O README principal fica em inglês para SEO, com README.pt-BR.md ao lado, botão do Buy Me a Coffee e GIF pedindo estrela. A descrição e os topics só são aplicados com aprovação do usuário.
- O contexto do coordenador fica limitado a 300 mil tokens no máximo, e não mais 1M, por decisão do usuário por custo. A compactação deve disparar antes de passar desse limite.

## Mapa
<!-- onde ficam as partes importantes do código -->
- O rodapé de contexto e tokens fica em src/renderer/src/components/Overview.tsx, nas classes .overview-footer*, com estilos em components/overview-footer.css. Os estilos globais ficam em src/renderer/src/styles.css, com cerca de 227 linhas.
- O grupo de threads resolvidas fica em src/renderer/src/components/ResolvedGroup.tsx, usado em Overview.tsx com key={project.id}. Os estilos dos cards de thread e do .resolved-toggle ficam em components/thread-card.css.
- Arquivo morto de threads: src/main/archive.ts (seleção, escrita atômica e migração na inicialização), archive-ipc.ts (archive:list e archive:reopen) e o componente BoardArchive.tsx. Os dados ficam em ~/Library/Application Support/brandyterm/archive/<projectId>.json e o state principal em brandyterm-state.json. O teste é node scripts/archive-check.ts.
- Limite de contexto do coordenador: src/shared/context-limit.ts (limite de 300 mil, decisão de compactar, aviso do rodapé). A troca de sessão antes do turno fica em src/main/coordinator-memory.ts:23 (mais de 20 mensagens ou 80 mil tokens, com teto de 85% do limite). O autocompact de 120 mil fica em engine.ts:218. O teste é node scripts/compact-check.ts.

## Pendências
<!-- o que ficou em aberto -->
- Planos prontos e ainda não aplicados: ícone (build/icon.icns a partir do PNG de 1254x1254 em ~/Downloads, mais o electron-builder), migração para @anthropic-ai/claude-agent-sdk com canUseTool e ApprovalCard (os tipos do SDK não foram conferidos porque não havia rede) e autocompletar com @ via fs:list. Bug confirmado em src/main/security.ts:39: o startsWith permite escapar por prefixo; trocar por u
- Pendências do arquivo morto: chips do chat que apontam para threads arquivadas não abrem; p.messages e p.synthesized continuam crescendo; o arquivo do projeto fica órfão quando o projeto é removido; a retenção só roda na inicialização. Falta também o resultado do code review do Codex antes do commit e do push para main.
- Falta o nome de usuário do Buy Me a Coffee para o README (marcador TODO_BMC_USER) e uma captura ou GIF real do app.
- O code review de 2026-11-24 bloqueou o commit. Corrigir: allow-rules.ts:78 (bypass de aprovação com && e redirecionamento, e executáveis reconhecidos só pelo nome do arquivo); security.ts:55 (src.path escapa do clone; o startsWith antigo já foi corrigido); engine.ts:326, terminal.ts:63 e account-ipc.ts:61 (callbacks antigos afetam execuções novas); coordinator.ts:244 e restore.ts:10 (corrompem esc

## Recente
<!-- últimos pedidos, uma linha cada -->
- 2026-11-24: o usuário pediu para compactar o bloco 'Contexto do coordenador' e 'Tokens gastos no projeto' no canto inferior direito, por ser só informativo. Delegado a uma thread.
- 2026-11-24: o bloco de contexto e tokens do canto inferior direito foi compactado (fonte de 11px, cores apagadas, uma linha por item) e o typecheck passou. O visual ainda não foi conferido no app.
- 2026-11-24: o usuário pediu que o grupo 'N resolvidas' venha sempre recolhido ao entrar no projeto. Delegado a uma thread.
- 2026-11-24: o grupo 'N resolvidas' agora começa sempre recolhido, ao abrir o app e ao trocar de projeto, e a thread selecionada continua visível. O typecheck passou e o visual ainda não foi conferido no app.
- 2026-11-24: o usuário perguntou até quando a coluna Concluídas do kanban cresce. Delegada a uma thread a limitação do quadro e o arquivo morto das threads antigas.
- 2026-11-24: o usuário pediu um code review pelo Codex antes do commit e do push. Review delegado sem edições; o commit e o push dependem da aprovação do usuário.
- 2026-11-24: kanban limitado a 10 cards finalizados com paginação e arquivo morto implementado; o typecheck e o archive-check passaram. O code review ainda não foi reportado.
- 2026-11-24: o usuário pediu README público com SEO, Buy Me a Coffee e GIF de estrela. Delegado a uma thread, com o code review do Codex ainda rodando.
- 2026-11-24: o code review do Codex concluiu que não está pronto para commit (1 bloqueio e vários itens importantes). O resultado da thread do README não foi reportado.
- 2026-11-24: o usuário pediu para baixar o contexto do coordenador de 1M para 300 mil. Delegado a uma thread.
- 2026-11-24: o contexto do coordenador foi limitado a 300 mil (troca de sessão em 80 mil, autocompact em 120 mil, rodapé com 'de 300 mil' e aviso em 60 mil). O typecheck, o build e o compact-check passaram, e o visual ainda não foi conferido no app.
