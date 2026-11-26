import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractQuestions, pendingDecision } from './ask-detect.ts'
import { FREE_TEXT_REPLY } from './ask-sample.ts'

const texts = (reply: string) => extractQuestions(reply).map((q) => q.text)

test('reads the four free-text questions of the reply that was marked resolved', () => {
  const q = extractQuestions(FREE_TEXT_REPLY)
  assert.deepEqual(texts(FREE_TEXT_REPLY), [
    'Por onde começar?',
    'Direção visual',
    'Lista de espera: quer capturar e-mail já (o Resend tem um domínio verificado?) ou só trocar o texto dos CTAs por enquanto?',
    'Alcance: só os 3 P1 ou também os P2 e P3 (preços, hero, favicon)?'
  ])
  assert.equal(q[0].options?.length, 3)
  assert.equal(q[0].recommended, undefined)
  assert.deepEqual(q[1].options, ['Assumir mais o manual de serviço', 'Manter o tom quieto atual e corrigir só a usabilidade'])
  assert.equal(q[1].recommended, true)
  assert.equal(q[2].options, undefined)
})

test('reads every PERGUNTA: line, each with its own OPCOES:', () => {
  const reply = 'Feito.\n\nPERGUNTA: Cor?\nOPCOES: azul | *verde\nPERGUNTA: Nome?\nPERGUNTA: Publicar?\nOPCOES: sim | não'
  assert.deepEqual(extractQuestions(reply), [
    { text: 'Cor?', options: ['verde', 'azul'], recommended: true },
    { text: 'Nome?', options: undefined },
    { text: 'Publicar?', options: ['sim', 'não'] }
  ])
})

test('reads options written inside the item line', () => {
  const reply = 'Preciso decidir:\n\n1) Banco: (a) SQLite ou (b) Postgres?\n2) Publico hoje?'
  assert.deepEqual(extractQuestions(reply), [
    { text: 'Banco', options: ['SQLite', 'Postgres'] },
    { text: 'Publico hoje?', options: undefined }
  ])
})

test('reads a bold number and a single item with options', () => {
  const reply = '**1.** Qual caminho prefere?\na) curto\nb) completo'
  assert.deepEqual(extractQuestions(reply), [{ text: 'Qual caminho prefere?', options: ['curto', 'completo'] }])
})

test('a reply that ends asking is one question without options', () => {
  assert.deepEqual(extractQuestions('Terminei o ajuste.\n\n**Quer que eu publique agora?**'), [{ text: 'Quer que eu publique agora?' }])
})

test('ignores replies that ask nothing of the user', () => {
  const none = [
    'Plano:\n1. Ler o código\n2. Escrever o teste\n3. Corrigir\n\nRESUMO: plano pronto',
    'Plano:\n1. Ler o código\n2. Escrever o teste',
    'Resultado.\n\nPendências:\n- testar no Windows\n\nRESUMO: feito',
    'Por que falhava? O cache era antigo.\n\nCorrigido.',
    'Exemplo:\n\n```\n1. Qual?\n2. Quando?\nPronto?\n```',
    'Causas encontradas:\n1. Corrida:\n   - (a) no boot\n   - (b) no resume\n\nCorrigi as duas.',
    'Perguntas frequentes:\n1. Por que demora? Porque o índice é refeito a cada abertura, e isso custa vários segundos em projetos grandes com muitos arquivos de mídia na raiz.\n2. Por que trava? Porque a leitura é feita no processo principal, que também desenha a janela, então tudo espera a leitura terminar antes de continuar.',
    'Dúvidas que resolvi:\n1. Precisa migrar?\n2. Quebra o Windows?\n\nNão para ambas.\nTestei as duas plataformas.\nO build passou.\nNada mais a fazer.\nTudo certo.',
    'Ficou pronto?\nRESUMO: sim'
  ]
  for (const reply of none) assert.deepEqual(extractQuestions(reply), [], reply)
})

test('only the end of a long reply counts, and the list is capped', () => {
  const filler = Array.from({ length: 80 }, (_, i) => `linha ${i}`).join('\n')
  assert.deepEqual(extractQuestions(`1. Antigo?\n2. Velho?\n${filler}`), [])
  const many = Array.from({ length: 12 }, (_, i) => `${i + 1}. Item ${i + 1}?`).join('\n')
  assert.equal(extractQuestions(many).length, 8)
  assert.equal(extractQuestions(`PERGUNTA: ${'x'.repeat(400)}?`)[0].text.length, 240)
})

test('a summary that says the user still has to decide is a pending decision', () => {
  assert.equal(
    pendingDecision('nada; o usuário ainda vai escolher prioridade, direção visual e o alcance.'),
    'o usuário ainda vai escolher prioridade, direção visual e o alcance'
  )
  for (const s of ['Aguardando sua decisão sobre o preço', 'falta o usuário confirmar o domínio', 'aguardando resposta do usuário', 'a decisão do usuário está pendente'])
    assert.ok(pendingDecision(s), s)
})

test('a summary without an open decision is left alone', () => {
  for (const s of ['nada', 'usar SQLite', 'o usuário escolheu a opção (b)', 'aguardando a resposta do servidor', 'testar no Windows', 'o usuário vai poder escolher o tema nas preferências'])
    assert.equal(pendingDecision(s), undefined, s)
})
