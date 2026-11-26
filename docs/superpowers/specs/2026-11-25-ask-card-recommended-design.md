# Card de pergunta: opção recomendada primeiro — desenho curto

Aprovado pelo usuário em 2026-11-25.

## Intenção
Quando uma thread pede decisão, o card deve ler bem (hierarquia clara, opções legíveis)
e a primeira opção deve ser sempre a que o agente recomenda, com o selo "Recomendado".
Decidir rápido, com a sugestão do agente à vista.

## Metas / não-metas
- Metas: card redesenhado (tema, responsivo, sem rolagem horizontal, teclado); recomendada
  no topo garantida no código; perguntas sem recomendação seguem sem selo e na ordem original.
- Não-metas: mudar o fluxo de resposta (api.send) ou a detecção de "respondida"; seção CONECTORES.
- Anti-meta: depender só do prompt para a ordem.

## Abordagens
- **Marcador `*` na linha OPCOES (escolhida):** `OPCOES: *a | b | c`; aceita também
  `(recomendado|recomendada)` no fim. Compatível com o formato atual, parse trivial.
- Linha extra `RECOMENDO: a`: frágil (o texto precisa bater exatamente com uma opção).
- "A primeira é sempre a recomendada": não distingue pergunta sem recomendação; só no prompt.

## Desenho
- `src/shared/ask-options.ts`: `parseOptions(raw)` → `{ options, recommended }` (tira marcador,
  move a primeira marcada ao topo, limite de 6). Usada por `extractQuestion`.
- `question`/`ask` ganham `recommended?: boolean` (true = `options[0]` é a recomendada).
- Prompt das threads pede o marcador; o coordenador vê `(recomendada)` na lista de aguardando.
- `AskCard.tsx` + `ask-card.css` (fora do Chat.tsx): lista vertical de largura total, número
  da opção, selo em `--accent` (âmbar já significa "aguardando você"); setas ↑↓ e teclas 1–9;
  campo livre "Ou escreva outra resposta"; empilha em telas estreitas.
- Testes: `ask-options.test.ts` e `coordinator.test.ts` (parse e ordenação).

## Deixado ao construtor
Espaçamentos, tamanhos de fonte e estados de foco/hover dentro do tema.
