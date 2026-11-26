# Skills por projeto: biblioteca, catálogo e lista do projeto

## Intenção

O usuário tem ~25 plugins e ~10 skills soltas instalados, muitos sem saber o que fazem, e
a organização atual é acidental: um plugin "pertence" a um projeto só porque foi instalado
de dentro da pasta dele (as 9 design-* e o impeccable ficaram presos ao dark-factory, o
hyperframes ao canal-youtube). Ele quer:

1. Cada projeto com só as skills que fazem sentido para ele, sem pagar token pelas outras.
2. Skills úteis em vários projetos (impeccable, design-*) disponíveis para qualquer um que
   as escolha; skills de vídeo (hyperframes) nos projetos de vídeo (attywtw, pareciaErrado,
   canal-youtube).
3. Mac e Windows iguais: a escolha de cada projeto e os arquivos das skills.
4. `/skill-init` para propor as skills de um projeto, `/skill-refresh` para propor mais
   quando o projeto cresce. Skills feitas à mão para um projeto continuam valendo.
5. Uma limpa no que está instalado hoje.

## Metas

- Uma lista por projeto, versionada no próprio repositório do projeto.
- Uma biblioteca única (arquivos + catálogo) num repositório privado do usuário, a mesma
  nas duas máquinas.
- Abrir um projeto em outra máquina instala o que falta com um botão.
- Sugestões a partir do catálogo, sem internet. Busca na internet só sob pedido.
- O painel mostra a contagem certa de skills (hoje mattpocock-skills aparece "sem skills").

## Não-metas

- Escolher skill por skill dentro de um plugin. A unidade é o plugin (ele traz hooks,
  agentes e comandos juntos) ou a skill solta.
- Mudar o Claude Code fora do brandyTerm. O uso do `claude` no terminal continua com o que
  está em `~/.claude`.
- Medir quais skills são usadas de fato (pode vir depois, para o `/skill-refresh` sugerir
  tirar).

## Antimetas (fracasso mesmo funcionando)

- Conteúdo do plugin vivo, ou de qualquer coisa marcada corporativa, entrar num repositório
  de projeto, na biblioteca ou num serviço externo. O nome pode aparecer numa lista de
  projeto da Vivo; os arquivos, nunca.
- Apagar algo do usuário sem ele marcar. A limpa só remove o que ele aprovou, item a item.
- Projeto sem lista ficar sem as skills que tem hoje (nada muda até ele rodar `/skill-init`).
- Uma skill desconhecida da internet ser instalada sem passar pela checagem de segurança.

## Restrições

- Nenhum arquivo de código acima de 400 linhas; `user-plugins.ts` está em 164.
- Textos de interface em português do Brasil.
- Mac e Windows: nada de caminho absoluto em arquivo sincronizado; links de pasta são
  `junction` no Windows (como `personalDir()` já faz).
- O repositório do brandyTerm é público: a biblioteca não pode morar nele.
- `main` do brandyTerm tem trabalho em andamento (conectores). Por decisão do usuário, este
  trabalho vai na mesma branch e sobe junto com ele; os commits ficam separados por assunto.

## O que existe hoje

- Threads rodam com `--setting-sources project`: de `~/.claude` só chega o que o brandyTerm
  passa por `--plugin-dir` (`userPluginDirs` em `src/main/user-plugins.ts`). Skills do
  projeto em `<projeto>/.claude/skills` já carregam por serem fonte "project".
- Escolha atual: `userData/thread-plugins.json` (`{personal, on[]}`), só da máquina. O
  "projeto" de um plugin vem do escopo de instalação em `installed_plugins.json`.
- Skills soltas de `~/.claude/skills` entram todas ou nenhuma, como o plugin gerado "pessoal".
- Bug de contagem: `skillCount` olha só `skills/*/SKILL.md`; mattpocock-skills usa
  `skills/<categoria>/<skill>/SKILL.md` e lista os caminhos em `plugin.json` (`skills: []`).
- Lojas de plugin conhecidas (depois da limpa, seção 7): claude-plugins-official,
  mattpocock, impeccable, `ebrandes/claude-kit` (privado) e `ebrandes/claude-kit-private`
  (privado, vivo).
- `docs/superpowers/specs/2026-11-25-multi-machine-design.md`, seção 8 (paridade), prevê
  copiar skills pessoais e `thread-plugins.json` entre máquinas.

## Abordagens consideradas

- **A. Só lista no projeto, apontando a origem de cada item.** Nada duplicado; skills soltas
  precisam de uma casa com origem (a biblioteca).
- **B. Copiar os arquivos das skills para dentro de cada projeto.** Projeto autossuficiente
  e offline; duplica entre projetos, cópias ficam velhas, plugin com hooks não copia bem.
- **C. Mistura (escolhida pelo usuário).** Lista do A, com versão, para o compartilhado;
  o que é só do projeto fica como arquivo nele (`.claude/skills`).

Onde mora a biblioteca (decisão do construtor; o usuário delegou):
- `ebrandes/claude-kit` (escolhido): já é privado, já é loja de plugins nas duas máquinas,
  os kit-* já vêm dele. A biblioteca vira uma pasta e um plugin a mais lá.
- Repositório novo: mais uma coisa para clonar e configurar, sem ganho.
- Pasta no repositório do brandyTerm: descartada, é público.

Busca na internet (decidido pelo usuário): só sob pedido (`/skill-init --buscar`) ou quando
nada do catálogo serve.

## Desenho

### 1. Biblioteca e catálogo (`ebrandes/claude-kit`)

```
claude-kit/
  biblioteca/
    catalogo.json
    skills/<nome>/SKILL.md ...      # skills soltas, uma pasta cada
    skills/<nome>/origem.json       # de onde veio: repo, commit, licença
```

`catalogo.json`:

```json
{
  "versao": 1,
  "itens": [
    { "id": "impeccable@impeccable", "tipo": "plugin",
      "descricao": "Acabamento de interface: polish, audit, tipografia, cor.",
      "tags": ["frontend", "design"] },
    { "id": "hyperframes@claude-plugins-official", "tipo": "plugin",
      "descricao": "Vídeo a partir de HTML: composições, animação, legendas.",
      "tags": ["video"] },
    { "id": "graphify", "tipo": "skill",
      "descricao": "Grafo de conhecimento de código e documentos.",
      "tags": ["docs", "arquitetura"] },
    { "id": "kit-core@claude-kit", "tipo": "plugin", "sempre": true,
      "descricao": "Base de trabalho, gates de qualidade.", "tags": [] },
    { "id": "vivo@claude-kit-private", "tipo": "plugin", "corporativo": true,
      "descricao": "Processum 3.0.", "tags": ["vivo"] }
  ]
}
```

- `descricao` em pt-BR, uma linha, escrita para a sugestão (não copiada do plugin).
- `sempre: true`: entra em todo projeto sem estar na lista (a base).
- `corporativo: true`: só é sugerido em projeto que já tenha a tag ou o usuário peça; nunca
  é copiado nem buscado fora da loja privada.
- `plataformas` (opcional, `["mac"]`/`["win"]`): item que só funciona num sistema.
- O brandyTerm clona a biblioteca em `userData/biblioteca` e faz `git pull` ao abrir e no
  `/skill-refresh`. A URL é configurada uma vez (Configurações → Skills); padrão
  `ebrandes/claude-kit`.

### 2. Lista do projeto (`<projeto>/.brandyterm/skills.json`)

```json
{
  "versao": 1,
  "plugins": [
    { "id": "impeccable@impeccable", "ref": "d41d986" },
    { "id": "hyperframes@claude-plugins-official" }
  ],
  "skills": ["graphify"],
  "sem": []
}
```

- Versionada no git do projeto: é ela que deixa Mac e Windows iguais por projeto.
- `ref` opcional fixa versão; sem `ref`, vale a instalada.
- `sem`: tira deste projeto um item `sempre` da base.
- Skills feitas só para o projeto ficam em `<projeto>/.claude/skills/` (Claude Code já as
  carrega) e não entram na lista.

### 3. O que a thread recebe

`userPluginDirs(projectPath)` passa a ler a lista do projeto:

- Com lista: itens `sempre` (menos `sem`) + plugins da lista + um plugin gerado por projeto
  em `userData/project-skills/<hash do caminho>/` cujas `skills/<nome>` são links para
  `userData/biblioteca/biblioteca/skills/<nome>`. Plugin da lista que não está instalado
  fica de fora e aparece no painel como "falta instalar".
- Sem lista: comportamento de hoje (`thread-plugins.json` e "pessoal"), e o painel sugere
  `/skill-init`.
- Um plugin da lista serve em qualquer projeto, não importa o escopo em que foi instalado.
  Instalações novas pelo brandyTerm usam `--scope user`.

### 4. Instalar o que falta

- Botão "Instalar o que falta" no painel do projeto e aviso ao abrir um projeto com itens
  faltando.
- Plugin: `claude plugin marketplace add` (se a loja não é conhecida) + `claude plugin
  install <id> --scope user`. Item que está no catálogo não passa pelo scan de novo (já foi
  aprovado); item fora do catálogo passa.
- Skill solta: vem com a biblioteca (é só o clone estar em dia).

### 5. `/skill-init` e `/skill-refresh`

Comandos do brandyTerm (junto dos de `src/main/commands.ts`).

- `/skill-init`: o coordenador recebe o catálogo (id, descrição, tags) e sinais do projeto
  (dependências do `package.json` e afins, tipos de arquivo, README, `.claude/skills`
  existentes, lista atual se houver) e propõe itens com uma linha de motivo cada. O usuário
  aprova item a item (cartão de pergunta); o brandyTerm grava a lista e instala o que falta.
- `/skill-refresh`: igual, mas sobre a lista existente; propõe acréscimos e itens que não
  parecem mais servir. Não grava nada sem aprovação.
- `/skill-install <origem>` (pedido do usuário): instala um item conhecido e já o liga no
  projeto selecionado. `<origem>` pode ser um URL do GitHub, `dono/repo`, `dono/repo/caminho`
  ou o id de um item do catálogo.
  - Repo com `.claude-plugin/marketplace.json`: `claude plugin marketplace add` e depois
    `claude plugin install --scope user`. Se a loja tiver vários plugins, pergunta qual.
  - Repo de skills soltas (`skills/<nome>/SKILL.md`, ex.: `CloudAI-X/threejs-skills`): clona
    com `--depth 1`, copia cada skill para `biblioteca/skills/<nome>/` com `origem.json` (repo,
    commit, licença, estrelas) e cria uma entrada no catálogo por skill. A descrição em
    pt-BR é escrita a partir do `SKILL.md`. Se o nome já existir na biblioteca, pergunta antes
    de substituir.
  - Item do catálogo: só instala o que falta.
  - Item que ainda não está no catálogo passa por `instalar-com-seguranca` / Claude Security
    antes de qualquer cópia. Um alerta sério para tudo e mostra o motivo.
  - No fim, grava na lista do projeto (`plugins` ou `skills`), faz o commit no clone da
    biblioteca e oferece o push.
- `--buscar`: além do catálogo, procura fora, nesta ordem de fontes:
  1. Lojas oficiais já conhecidas (`claude-plugins-official`, `anthropics/skills`).
  2. skills.sh, o índice do ecossistema aberto, via `npx skills find <termo>`. Ele dá o
     número de instalações.
  3. GitHub, via `gh search repos` com os temas `claude-skills`/`agent-skills`/`claude-code-plugin`
     mais o termo, ordenado por estrelas.

  Ordem dos candidatos: fonte oficial primeiro, depois mais estrelas e mais instalações.
  Piso para entrar na proposta: 100 estrelas ou 1 mil instalações, e commit nos últimos 6
  meses (os mesmos critérios da find-skills). Abaixo do piso só aparece se nada passar, e
  marcado como "pouco usado". Cada cartão mostra estrelas, instalações, data do último
  commit e o motivo de servir ao projeto. Um candidato novo passa por
  `instalar-com-seguranca` / Claude Security antes de ser proposto. Quando aprovado, entra no
  catálogo da biblioteca (commit no clone; o push é oferecido e só acontece com o sim do
  usuário).

### 6. Painel de skills

O painel mostra sempre o projeto selecionado (decidido pelo usuário): cada projeto tem o seu
conjunto, e a chave liga e desliga o item só para ele.

```
Skills · canal-youtube
  Suas skills          7 skills            [on ]
  superpowers          15 skills           [on ]
  kit-core   hooks     2 skills · 2 agentes [on ]
  hyperframes          21 skills           [on ]
  impeccable hooks     1 skill · 5 agentes [off]
  vivo                 1 comando · 4 agentes [off]
  ⚠ falta instalar: ...                    [Instalar]
```

- Ligar: grava o item na lista do projeto (`skills.json`) e, se não estiver instalado,
  instala (`--scope user`). Desligar um item da lista tira da lista. Desligar um item `sempre`
  grava no `sem`.
- Sem os rótulos de projeto (o "canal-you…", "dark…" de hoje): o painel já é do projeto.
  Fica só a etiqueta do tipo, `hooks` quando o plugin traz hooks. Etiqueta cortada mostra o
  texto inteiro ao passar o mouse.
- Projeto sem lista: o painel mostra o estado de hoje e a primeira mudança cria a lista
  (com os itens ligados no momento), além do convite para `/skill-init`.
- Contagem: soma `SKILL.md` em qualquer profundidade de `skills/`, ou os caminhos de
  `plugin.json` `skills[]` quando existir. Corrige o "sem skills" do mattpocock-skills.
- Thread já aberta não muda no meio. A mudança vale para a próxima thread do projeto, e o
  painel avisa isso.

### 7. A limpa (feita em 2026-11-25, antes da migração)

O usuário delegou a escolha; o critério foi o uso real (chamadas da ferramenta Skill nos logs
de sessão). Tudo removido pode ser reinstalado.

Ficou:

| Item | Por quê |
|---|---|
| superpowers, kit-core, kit-tokens, kit-router, kit-model-stack | Base; usados todo dia |
| mattpocock-skills | Engenharia (writing-for-agents, grilling, TDD) |
| vivo | Corporativo, projetos Vivo |
| impeccable | Usado em projetos com front (dark-factory) |
| hyperframes | Projetos de vídeo (canal-youtube) |
| chrome-devtools-mcp | Depuração de páginas web |
| graphify, instalar-com-seguranca, find-skills | Citados no CLAUDE.md global / usados pelo `--buscar` |
| vercel-react-best-practices | Usado em projetos React |
| orca-cli, orca-computer-use, orchestration | Orca em uso |
| `synced` | Skills do Claude.ai, controladas por `syncClaudeAiSkills` |

Saiu (desinstalado no escopo certo, loja removida, cache e dados apagados, restos de
configuração limpos):

| Item | Por quê |
|---|---|
| example-skills e a loja anthropic-agent-skills | Repetia as skills do Claude.ai |
| caveman (com hooks) | Sobrepunha kit-tokens |
| agent-browser e `~/.agent-browser` | chrome-devtools-mcp e o navegador do Claude.ai cobrem |
| ponytail (afilix, com hooks) e `~/.config/ponytail` | Nunca chamado |
| designer-skills (9 plugins, dark-factory) | Nunca chamados |
| archify, fireworks-tech-graph | Nunca chamados; diagramas usam diagram-design |

Também foram apagados 7 clones temporários abandonados em `~/.claude/plugins/cache/temp_git_*`.

### 8. Migração

1. Depois da limpa, o brandyTerm (ou uma thread) gera o `catalogo.json` inicial com o que
   sobrou e copia as skills soltas para `claude-kit/biblioteca/skills/` com `origem.json`.
   Usuário revisa as descrições e dá o push.
2. Gera listas iniciais a partir do escopo atual: dark-factory (impeccable), canal-youtube
   (hyperframes). Cada uma vira uma
   proposta no próximo `/skill-init` do projeto, não um arquivo escrito às cegas.
3. `~/.claude/skills` continua existindo para o uso do `claude` no terminal; o brandyTerm
   deixa de depender dele para projetos com lista.

### 9. Relação com o desenho de várias máquinas

A seção 8 daquele desenho (paridade) deixa de cuidar de skills pessoais e de
`thread-plugins.json` para projetos com lista: isso agora viaja pelo git do projeto e da
biblioteca. A paridade continua com hooks, MCPs, configurações do app e plugins instalados
fora de qualquer lista. Atualizar aquele documento faz parte deste trabalho.

## O que fica para o construtor

- Formato exato dos sinais do projeto mandados ao coordenador no `/skill-init`.
- Como o cartão de aprovação mostra muitos itens (agrupado por tag é a sugestão).
- Quando o `git pull` da biblioteca falha (sem rede): segue com o clone que tem e avisa.
- Testes: leitura de lista e catálogo, montagem dos diretórios por projeto (inclusive
  `junction`), contagem recursiva, fallback sem lista.
