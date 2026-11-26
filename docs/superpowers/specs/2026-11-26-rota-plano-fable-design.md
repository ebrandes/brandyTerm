# Rota recalibrada e fase de plano no Fable

## Por quê
O usuário quer threads mais inteligentes sem perder a economia que o `/rota` já trouxe,
e pediu Fable no planejamento. Medição de 24–25/11/2026 (37 threads, preço de API):

- 89% do gasto está nas threads em Opus (31 threads, US$ 1,68 em média cada).
- O classificador haiku respondeu `pesado` em 80% das tarefas (36 de 45). A regra
  "na dúvida, o nível de cima" e a falta de contexto do haiku empurram quase tudo para Opus/high.
- O coordenador custa 9% do total. Não é onde está o dinheiro.
- Uma thread que substitui outra que falhou é classificada de novo no mesmo nível.

Ideia: quem decide o nível é o coordenador, que escreveu o objetivo e conhece o projeto.
O nível `pesado` deixa de significar "Opus/high do começo ao fim" e passa a significar
"Fable lê e planeja, Sonnet executa".

## Objetivos
1. **Nível no plano do coordenador.** Cada task do JSON do coordenador traz `tier`
   (`leve` | `padrao` | `pesado`). O `/rota` usa esse nível direto, sem chamada extra.
2. **Haiku só de reserva.** O classificador roda apenas quando a task chega sem `tier`
   válido (coordenador Codex, que não tem schema garantido, ou JSON torto).
3. **Subir na falha.** Task com `replaces` apontando para thread `failed` ou `interrupted`
   sobe um degrau em relação à thread antiga.
4. **Fase de plano.** Thread Claude de nível `pesado` roda em duas fases dentro do mesmo
   cartão: plano (Fable, somente leitura) e execução (Sonnet, modo de trabalho de hoje).
   A passagem é automática; só para se o plano terminar em `PERGUNTA:`.

## Não-objetivos
- Fase de revisão do diff pelo Fable depois da execução. Fica para depois; o campo de fase
  deve aceitar um terceiro valor sem refazer nada.
- Trocar o modelo do coordenador, enviar só o delta do prompt do coordenador, pular a
  síntese de pedido com uma thread só. São itens separados da revisão.
- Replanejar quando o usuário manda mensagem numa thread já executada: a conversa segue
  na sessão de execução, no modelo de execução.
- Instalar a skill `prompter` ou copiar suas regras de reescrita: a amostra de objetivos
  reais mostrou que o coordenador já resolve referências vagas, manda investigar antes de
  mexer e dá critério de conclusão.
- Conectores (gateway `mcp__brandy__*`) na fase de plano: ela lê só o projeto.
- Fase de plano para Codex e Antigravity.

## Anti-objetivos
- A fase de plano editar arquivo ou rodar comando que muda algo.
- A execução começar sem o plano no prompt.
- O usuário perder o controle manual: `!modelo`, `!!` e `/rota auto|aviso|off` continuam
  valendo e sempre ganham da rota automática.
- Uma thread ficar presa porque o Fable não está disponível na conta.

## Como fica

### Degraus
| Degrau | Plano | Execução |
|---|---|---|
| `leve` | — | haiku / low |
| `padrao` | — | sonnet / medium |
| `pesado` | fable / medium | sonnet / medium |
| `pesado+` (só por subida) | fable / medium | opus / high |

`pesado+` não é um valor que o coordenador ou o haiku escolhem: só existe quando uma thread
`pesado` falha e é substituída. Thread antiga sem nível registrado conta como `padrao`.
A task nova fica com o maior entre o nível que o coordenador deu e o degrau acima da antiga.

Codex continua recebendo só o esforço (`leve` low, `padrao` medium, `pesado` high) e
Antigravity não é roteado, como hoje.

### Quem decide o nível
- `PLAN_SCHEMA` ganha `tier` na task (enum dos três valores). `model` e `effort` continuam
  no schema: valem para Antigravity, para o modo `off` e para `!!`.
- O prompt do coordenador troca a orientação de escolher modelo/esforço por uma régua curta:
  - `leve`: consulta, busca, mudança mecânica de uma linha, renomear, formatar.
  - `padrao`: mudança delimitada com caminho claro, em poucos arquivos.
  - `pesado`: precisa entender antes de mexer — vários módulos, decisão de desenho, bug sem
    causa conhecida, risco de quebrar o que funciona.
  - Na dúvida, o nível de baixo: se falhar, a próxima tentativa sobe sozinha.
  - Se o pedido é refazer algo que uma thread entregou errado, um nível acima do da thread.
- As duas linhas que orientam `model` e `effort` ficam (encurtadas): são elas que valem em
  `aviso`, `off`, `!!` e como última reserva do `auto`.
- Em task `pesado`, o objetivo descreve o problema, a evidência e o critério de conclusão,
  sem ditar passos nem arquivos "prováveis": o coordenador não lê o código e quem decide o
  como é a fase de plano. *(decisão minha; hoje os objetivos já chegam com 2–3 mil caracteres
  de passos escritos às cegas)*
- O `RUBRIC` do haiku perde a regra "na dúvida, o de cima" e passa a dizer o contrário.

### Modos e atalhos
| Situação | Nível usado | Fase de plano |
|---|---|---|
| `/rota auto` | coordenador → haiku → escolha de modelo/esforço do coordenador | sim, em `pesado` |
| `/rota aviso` | só anota em `why`; vale modelo/esforço do coordenador | não |
| `/rota off` | nenhum | não |
| `!haiku` `!sonnet` `!opus` `!fable` | modelo forçado, fase única | não |
| `!!` | escolha do coordenador | não |
| `!plano` (novo) | força `pesado` nas tasks Claude | sim |

Os atalhos digitados valem em qualquer modo, inclusive `off`. Hoje `off` retorna antes de
olhar o atalho e `!opus` é ignorado; isso muda. *(decisão minha)*

Task Claude com `skill` em `pesado` também tem fase de plano. A skill é carregada na
**execução**, onde há todas as ferramentas; a fase de plano roda sem ela. Hoje 16 das 31
threads Opus têm skill (8 são `systematic-debugging`): deixá-las de fora tiraria metade do
ganho. *(decisão minha)*

Threads criadas por comando de barra ou de skill não passam pela rota e não mudam.

O `why` da thread registra o caminho: `rota: pesado · plano fable → sonnet · <motivo>`,
`rota: pesado+ (substitui falha) · …`, `rota: padrao (haiku, sem nível no plano) · …`.

### Fase de plano
1. A thread nasce com o modelo/esforço de **execução** em `model`/`effort` (é o que os
   selos mostram) e com um registro do plano: modelo, esforço, e depois sessão, texto e uso.
   Guarda também o nível (`tier`) para a subida na falha.
2. Enquanto não há texto de plano, a thread roda com o modelo do plano, `tools: 'readonly'`
   (caminho da CLI, que já existe e emite os mesmos eventos de passos e tarefas), anexos do
   pedido incluídos. Prompt próprio: ler o código, não editar, e terminar com o plano ou com
   `PERGUNTA:`/`OPCOES:`.
3. O plano pedido ao Fable: o que entendeu do objetivo; arquivos (`caminho:linha`) e o que
   muda em cada um; passos em ordem; armadilhas; como verificar (comandos). Aponta lugares
   em vez de reproduzir código. Precisa se sustentar sozinho, porque a execução não herda
   o que o Fable leu.
   O shell da fase de plano só aceita consulta (`git status/diff/log/show/blame`, `ls`,
   `cat`, `rg`, `grep`…). O Fable não roda teste nem typecheck: os comandos de "como
   verificar" são propostas, e bug que precisa ser reproduzido vira o primeiro passo do plano.
4. **Terminou com `RESUMO:`** → não havia nada a mudar (investigação, revisão, pergunta
   sobre o código): a resposta do Fable é a resposta final e a thread fica `done` pelo
   caminho normal, sem execução. O prompt de plano diz quando usar cada final.
4b. **Terminou com `PERGUNTA:`** → `waiting` e cartão de pergunta no chat, como hoje. A
   resposta do usuário retoma a **sessão do plano**, ainda em Fable e somente leitura.
5. **Terminou com o plano** → o texto entra na thread como mensagem do agente marcada como
   plano; a sessão do plano é guardada à parte; a thread **continua `running`** e começa a
   execução em **sessão nova**, no modelo de execução, com `tools: 'work'`. Prompt = prompt
   normal da thread + o plano + a instrução: siga o plano, confira antes de editar, e se ele
   estiver errado em algo corrija o rumo e diga no `RESUMO:`.
6. Nada entre as fases dispara síntese, relatório direto ou a fila: para o resto do motor
   é uma execução só. O que acontece no fim é o de hoje e atravessa a troca de fase: thread
   que rodou direto do pedido entra na síntese; thread retomada por resposta do usuário
   (`direct`) reporta direto, sem síntese.
6b. Resumo e pergunta do coordenador (`ThreadReporter`) rodam na sessão atual da thread com
   o modelo dessa sessão: durante a fase de plano, o modelo do plano, não o de execução.
7. **Fase de plano falhou** (erro, limite, Fable indisponível; cancelamento não conta) → uma
   mensagem de sistema na thread avisa e ela roda em fase única com Opus/high, o `pesado`
   de antes. Só uma vez: se essa também falhar, a thread fica `failed` normalmente.
8. Cancelar durante o plano cancela a thread. App fechado durante o plano: a thread volta
   `interrupted` e, retomada, continua a fase de plano na sessão dela.

Sessão nova na execução, em vez de retomar a do plano com outro modelo *(decisão minha)*:
o cache é por modelo, então a troca regravaria tudo; a execução carregaria a leitura inteira
do Fable em toda chamada; e sobraria pouco espaço até a compactação automática (120k).

### O que o usuário vê
Um cartão por thread, como hoje. O selo de modelo muda com a fase:

```
planejando    →  [claude  plano · fable]  rota: pesado · plano fable → sonnet · mexe em 3 módulos
executando    →  [claude  sonnet · médio] (plano: fable)
```

Dentro da thread, o plano aparece como uma mensagem própria, antes dos passos da execução.
Os passos e tarefas da fase de plano podem ser limpos na troca de fase; o texto do plano fica.

## Restrições
- Arquivos ≤ 400 linhas. `engine.ts` está em 395 e `shared/types.ts` em 376: a lógica de
  fases vai para módulo próprio e `startThread` só pode crescer se algo sair de `engine.ts`.
- Base: `main` em `3848c8d` ou depois. Há trabalho de outra sessão não commitado em
  `src/renderer/src/components/` (botão de resumo da thread): não mexer nele.
- `Effort` continua `low | medium | high`.
- Os campos novos de `Thread` são opcionais: threads salvas e máquinas remotas com versão
  antiga continuam abrindo.
- `readMode()` (store do kit-router) e a forma dos atalhos no início da mensagem não mudam.
- Textos de interface e prompts de thread em pt-BR, como os atuais.
- Testes com `node --test`, sem chamar modelo: a classificação e a execução entram por
  injeção nas funções testadas.

## Abordagens
- **A (escolhida): uma thread, fases comandadas pelo motor.** O motor garante a ordem
  (nada é editado antes do plano), o quadro mantém um cartão por tarefa, a pergunta do
  plano reaproveita o cartão existente. Custo: mexer no ciclo de vida da thread.
- **B: duas threads encadeadas.** Menos estado por thread, mas dobra os cartões e a
  síntese do pedido teria de esperar por uma thread que ainda não foi criada.
- **C: thread Sonnet com subagente Fable planejador** (`agents` do SDK). Menor mudança, mas
  depende do Sonnet chamar o planejador, o plano não vira etapa visível e não dá para parar
  numa pergunta.
- Descartada: thread Fable delegando ao Sonnet. O Fable carregaria todo resultado de
  ferramenta, que é a parte cara.

O usuário decidiu: passagem automática do plano para a execução, parando só em `PERGUNTA:`.
A escolha de A e os itens marcados *(decisão minha)* são meus.

## Como saber se deu certo
Rodar de novo a medição das sessões em `~/.claude/projects` depois de alguns dias de uso:
- fatia de `pesado` bem abaixo dos 80% atuais;
- custo médio de uma thread `pesado` (plano + execução) contra US$ 1,68 da thread Opus;
- quantas threads `pesado` precisaram de `pesado+` ou de correção do usuário.
Para isso o uso de tokens da fase de plano fica registrado separado do total da thread.
A estimativa de "igual ou mais barato que Opus/high" ainda não foi medida.

## Deixado ao construtor
- Nomes dos campos novos e do módulo de fases; como dividir `engine.ts`.
- Texto exato dos prompts de plano e de execução; limite de tamanho do plano embutido.
- Como `routeTasks` recebe o nível da thread substituída (o casamento por título já existe
  em `thread-match.ts`).
- Desenho exato dos selos nos quatro componentes que mostram o modelo (`ThreadCard`,
  `Board`, `BoardDetail`, `ThreadMetaChips`).
- Se os passos da fase de plano ficam visíveis depois da troca de fase.
