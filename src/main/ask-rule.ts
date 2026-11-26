/** How a thread asks the user for decisions: the same words in every prompt that teaches it. */
export const ASK_RULE =
  'escreva uma linha "PERGUNTA: <pergunta curta>" por decisão e, se houver alternativas, logo abaixo da pergunta a linha "OPCOES: *a | b | c" dela, ' +
  'com * no início a opção que você recomenda (no máximo uma por pergunta; sem recomendação, não marque nenhuma). ' +
  'Nunca faça perguntas em lista numerada nem com alternativas (a)/(b) em texto livre. Depois das perguntas, pare.'

/** For threads whose prompt goes as typed (slash commands), which get no thread prompt. */
export const ASK_SYSTEM = `Se terminar a resposta precisando de decisões do usuário, ${ASK_RULE}`
