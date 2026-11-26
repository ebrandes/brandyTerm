import type { MonthReport, QualityRow } from '../../../shared/usage-report.ts'
import { formatTokens } from '../health'

const KIND: Record<string, string> = {
  coordinator: 'coordenador', plan: 'thread (plano)', work: 'thread (execução)', report: 'resumo', router: 'roteador',
  memory: 'memória', compact: 'compactação', scan: 'varredura', other: 'outros'
}
const pct = (v: number | null) => (v === null ? '—' : `${v}%`)
const tokens = (v: number | null) => (v === null ? '—' : formatTokens(v))
const usd = (v: number) => (v ? `US$ ${v.toFixed(2)}` : '—')

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="usage-scroll">
      <table className="usage-table">
        <thead>
          <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const qualityCells = (q: QualityRow) => [
  q.finished, pct(q.cleanPct), q.replaced, q.corrections, q.escalations, tokens(q.tokensPerResolved)
]

export function UsageQuality({ report }: { report: MonthReport }) {
  const { quality, previous, verdict } = report
  return (
    <section>
      <h4>Qualidade</h4>
      <p className={`usage-verdict ${verdict.result}`}>{verdict.text}</p>
      <Table
        head={['Nível', 'Concluídas', 'Sem retrabalho', 'Substituídas', 'Correções', 'Subidas de nível', 'Tokens por resolvida']}
        rows={[
          ...quality.tiers.map((q) => [q.tier.replace('padrao', 'padrão'), ...qualityCells(q)]),
          ['total', ...qualityCells(quality.total)],
          [`${previous.month}${previous.partial ? ' (parcial)' : ''}`, ...qualityCells(previous.total)]
        ]}
      />
      <p className="usage-note">
        Conta as threads criadas no mês. “Correção” é qualquer mensagem sua depois de uma resposta final (um pedido novo na
        mesma thread também conta). Só há ganho se o gasto cair sem piorar a qualidade, ou se a qualidade subir com gasto igual.
      </p>
    </section>
  )
}

export function UsageSpend({ report }: { report: MonthReport }) {
  if (!report.usage.length) return <section><h4>Consumo</h4><p>Nenhuma execução registrada neste mês.</p></section>
  return (
    <section>
      <h4>Consumo</h4>
      <p className="usage-note">
        Registrado desde {new Date(report.ledgerSince!).toLocaleDateString('pt-BR')}. Entrada sem cache. O Codex não informa
        custo. Chamadas que o TokenEconomizer faz por conta própria ficam no histórico dele, não aqui.
      </p>
      <Table
        head={['Projeto', 'Agente', 'Modelo', 'Execuções', 'Entrada', 'Saída', 'Cache', 'Custo', 'Com RTK', 'Com TE']}
        rows={report.usage.map((r) => [
          r.project, r.agent, r.model, r.runs, formatTokens(r.input), formatTokens(r.output), formatTokens(r.cached),
          usd(r.costUsd), `${r.rtkRuns}/${r.runs}`, `${r.teRuns}/${r.runs}`
        ])}
      />
      <Table
        head={['Tipo de chamada', 'Execuções', 'Entrada', 'Saída', 'Custo']}
        rows={report.kinds.map((k) => [KIND[k.kind] ?? k.kind, k.runs, formatTokens(k.input), formatTokens(k.output), usd(k.costUsd)])}
      />
    </section>
  )
}

export function UsageSavings({ report }: { report: MonthReport }) {
  const share = (saved: number, input: number) => (input ? `${((saved / input) * 100).toFixed(1)}%` : '—')
  return (
    <section>
      <h4>Economia por ferramenta</h4>
      {report.rtk === null ? (
        <p>RTK não encontrado nesta máquina.</p>
      ) : report.rtk.length ? (
        <>
          <Table
            head={['Projeto', 'Comandos', 'Poupado (estimativa do RTK)', 'Da saída do shell', 'Sem picos', 'Picos']}
            rows={report.rtk.map((r) => [
              r.project, r.commands, formatTokens(r.saved), share(r.saved, r.input), formatTokens(r.savedWithoutPeaks),
              r.peaks.map((p) => `${p.date.slice(8)}/${p.date.slice(5, 7)}: ${formatTokens(p.saved)}`).join(', ') || '—'
            ])}
          />
          <p className="usage-note">
            O histórico do RTK não identifica o agente e inclui os comandos do seu terminal nessas pastas. Pico: dia que
            poupa mais de 3 vezes o dia mediano. As saídas maiores que o limite do agente o próprio RTK já deixa fora
            do total. Não é o mesmo que tokens cobrados.
          </p>
        </>
      ) : (
        <p>O RTK não tem histórico destes projetos no mês.</p>
      )}
      <h4>Threads com e sem cada ferramenta</h4>
      {report.compare.length ? (
        <Table
          head={['Ferramenta', 'Agente', 'Nível', 'Com / sem', 'Tokens por resolvida', 'Sem retrabalho', 'Leitura']}
          rows={report.compare.map((c) => [
            c.tool === 'rtk' ? 'RTK' : 'TokenEconomizer', c.agent, c.tier.replace('padrao', 'padrão'),
            `${c.with.finished} / ${c.without.finished}`,
            `${tokens(c.with.tokensPerResolved)} / ${tokens(c.without.tokensPerResolved)}`,
            `${pct(c.with.cleanPct)} / ${pct(c.without.cleanPct)}`,
            c.enough ? 'indício (tarefas não idênticas)' : 'amostra insuficiente'
          ])}
        />
      ) : (
        <p>Ainda não há threads do mesmo agente e nível com e sem uma ferramenta para comparar.</p>
      )}
    </section>
  )
}
