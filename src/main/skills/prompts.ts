// The instructions a /skill-* thread starts with. The thread acts only through the skills_* tools,
// which show the user one card per item.
import type { CatalogItem, SkillsList } from '../../shared/types.ts'
import type { Signals } from './signals.ts'

export type SkillKind = 'init' | 'refresh' | 'install'

export interface PromptInput {
  /** what the user typed after the command, without --buscar */
  args: string
  itens: CatalogItem[]
  list: SkillsList | null
  signals: Signals
  buscar: boolean
}

const line = (i: CatalogItem) =>
  `- ${i.id} [${i.tags.join(', ')}]: ${i.descricao}${i.sempre ? ' (base: já entra em todo projeto)' : ''}${i.corporativo ? ' (corporativo)' : ''}`

const RULES = [
  'Regras:',
  '- use skills_add para cada item, um por vez, com o motivo em uma linha. Cada chamada mostra um cartão ao usuário; "Recusado pelo usuário." quer dizer seguir para o próximo item.',
  '- itens corporativos só se o projeto já tiver a tag ou o usuário pedir.',
  '- itens base já entram em todo projeto: não chame skills_add para eles, a não ser que estejam em "sem".',
  '- com muitos itens, agrupe por tag antes dos cartões (uma linha por grupo na resposta), mas mande um cartão por item.',
  '- skills feitas só para este projeto ficam em .claude/skills e não entram na lista.',
  '- não edite .brandyterm/skills.json nem a biblioteca à mão: só as ferramentas skills_* mudam a lista.',
  '- responda em português do Brasil.',
  '',
  'Ao terminar, dê uma resposta curta (no máximo 12 linhas): o que foi ligado, o que o usuário recusou e o que ficou de fora.',
  'Se precisar de uma decisão do usuário, encerre a resposta com a linha "PERGUNTA: <pergunta curta>" e, se houver alternativas, "OPCOES: a | b | c", e pare. Sem pergunta, termine com a linha "RESUMO: <uma frase>".',
]

const TASK: Record<SkillKind, (o: PromptInput) => string[]> = {
  init: (o) => [
    'Tarefa (/skill-init): proponha as skills deste projeto. Leia os sinais e o catálogo, escolha o que serve e ligue cada item com skills_add.',
    ...(o.list ? ['O projeto já tem lista: proponha só o que falta nela.'] : []),
  ],
  refresh: () => [
    'Tarefa (/skill-refresh): reveja a lista de skills deste projeto. Proponha acréscimos com skills_add e, para o que não parece mais servir, skills_remove, com o motivo em uma linha.',
    'não grave nada sem o cartão aprovado: as ferramentas já mostram o cartão, e uma recusa encerra aquele item.',
  ],
  install: (o) => [
    'Tarefa (/skill-install): instale e ligue neste projeto o que o usuário pediu.',
    `Origem: ${o.args}`,
    '1. chame skills_resolve com essa origem.',
    '2. Se vier kind "catalog": ligue o item com skills_add (ela instala o plugin que faltar).',
    '3. Se vier uma loja de plugins (kind "marketplace"): se a loja tiver vários plugins, pergunte qual (com as linhas PERGUNTA:/OPCOES:) antes de importar; com um só, use esse.',
    '4. Se vier um repositório de skills (kind "skills"): leia o SKILL.md de cada skill na pasta devolvida (staging) e escreva, para cada uma, a descrição em pt-BR escrita a partir do SKILL.md (uma linha, pensada para a sugestão) e as tags.',
    '5. Chame skills_import com staging, itens [{nome, descricao, tags}] e, numa loja, plugin. Ela roda a checagem de segurança antes de qualquer cópia; um bloqueio para tudo: mostre o motivo ao usuário e não tente contornar.',
    '6. No fim, ofereça skills_push para enviar a biblioteca: a ferramenta mostra um cartão e só envia com o sim do usuário.',
  ],
}

const SEARCH = [
  'Busca fora do catálogo (--buscar), nesta ordem de fontes:',
  '1. lojas oficiais já conhecidas: claude-plugins-official e anthropics/skills;',
  '2. skills.sh: `npx skills find <termo>` (dá o número de instalações);',
  '3. GitHub: `gh search repos --topic claude-skills --topic agent-skills --topic claude-code-plugin --sort stars <termo>`.',
  'Ordene os candidatos: fonte oficial primeiro, depois mais estrelas e mais instalações. Piso para entrar na proposta: 100 estrelas ou 1 mil instalações, e commit nos últimos 6 meses. Abaixo do piso, só se nada passar, e marcado como "pouco usado".',
  'Na resposta, cada candidato mostra estrelas, instalações, data do último commit e o motivo de servir ao projeto.',
  'Um candidato novo passa por skills_resolve + skills_import (que roda a checagem de segurança) antes de ser ligado; nada é instalado por fora dessas ferramentas.',
]

const CATALOG_ONLY = 'Use só o catálogo. Se nada servir, diga isso e sugira rodar o comando de novo com --buscar.'

export function skillPrompt(kind: SkillKind, o: PromptInput): string {
  const list = o.list
    ? ['Lista atual do projeto (.brandyterm/skills.json):', '```json', JSON.stringify(o.list, null, 2), '```']
    : ['Projeto sem lista ainda: o que for ligado agora vira a lista (.brandyterm/skills.json), e os itens base continuam valendo.']
  const asked = kind !== 'install' && o.args ? [`Pedido do usuário: ${o.args}`] : []
  return [
    ...TASK[kind](o),
    ...asked,
    '',
    'Catálogo da biblioteca:',
    ...(o.itens.length ? o.itens.map(line) : ['(vazio)']),
    '',
    ...list,
    '',
    'Sinais do projeto:',
    '```json\n' + JSON.stringify(o.signals, null, 2) + '\n```',
    '',
    ...RULES,
    '',
    ...(o.buscar ? SEARCH : [CATALOG_ONLY]),
  ].join('\n')
}
