# Resumo da thread para o coordenador

## Por quê
Threads longas (horas de conversa direta) terminam e o coordenador só vê uma frase
(`t.summary`). A memória do projeto não recebe nada da conversa direta. O coordenador
fica sem saber o que foi feito e decidido.

## Objetivos
1. **Resumo curto automático:** quando uma thread fica `done` sem pendência (auto-resolvida),
   ou quando o usuário clica "Marcar como resolvida", a própria thread (mesma sessão)
   escreve 3–5 linhas: Feito / Decidido / Arquivos. Isso entra no chat principal como
   mensagem com o nome da thread e vira notas na memória (`Recente`, `Decisões`).
2. **Botão "Enviar resumo ao coordenador"** na thread parada: relatório completo
   (Feito / Decidido / Arquivos / Pendente), mesmo destino.
3. **Coordenador pergunta à thread (abordagem A):** o JSON do coordenador ganha
   `ask_thread: [{threadTitle, question}]`. A pergunta vai para a sessão da thread
   (só se ela estiver parada), a resposta volta ao coordenador, que responde ao usuário.

## Não-objetivos
- Não resumir a cada turno de thread com pendência ou pergunta aberta.
- Não ler arquivos/histórico bruto pelo coordenador (abordagem B descartada).

## Restrições
- O resumo é uma execução "silenciosa": não muda o estado visível da thread
  (não vira running/done de novo, não dispara síntese nem reportDirect).
- Uma execução de resumo por vez por thread; se o usuário mandar mensagem durante,
  a mensagem espera ou o resumo é cancelado (escolha do construtor: cancelar).
- Thread ocupada quando o coordenador pergunta: responde ao usuário que a thread
  está ocupada e tenta de novo depois que ela parar.
- Primeira execução de um pedido com síntese: a síntese já cobre; o resumo curto
  automático vale para turnos de conversa direta (direct=true) e para o "resolvida".
- Textos em pt-BR; arquivos ≤ 400 linhas (engine.ts está em 389: lógica nova em módulo próprio).

## Abordagens
- **A (escolhida): perguntar à thread.** Precisa, usa o contexto completo; custa uma chamada.
- B: coordenador lê as últimas mensagens. Mais barato, mas cego ao que foi feito nos arquivos.

## Deixado ao construtor
Formato exato do prompt de resumo, limite de tamanho, onde o botão fica no cabeçalho.
