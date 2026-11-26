import type { LogEntry, LogLevel } from '../../../shared/logs.ts'

export const LEVEL_LABEL: Record<LogLevel, string> = { error: 'Erro', warn: 'Aviso', info: 'Info', debug: 'Debug' }

const TIME: Intl.DateTimeFormatOptions = {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
}

const hasData = (data: unknown): boolean =>
  data !== undefined && data !== null && !(typeof data === 'object' && Object.keys(data).length === 0)

/** the connector the line is about, shown without opening the details */
function subject(data: unknown): string | undefined {
  const name = (data as { connector?: unknown } | null | undefined)?.connector
  return typeof name === 'string' ? name : undefined
}

export function LogEntryRow({ entry }: { entry: LogEntry }) {
  const when = new Date(entry.ts)
  const who = subject(entry.data)
  return (
    <li className={`log-row ${entry.level}`}>
      <time dateTime={entry.ts} title={entry.ts}>
        {Number.isNaN(when.getTime()) ? entry.ts : when.toLocaleString('pt-BR', TIME)}
      </time>
      <span className="log-level">{LEVEL_LABEL[entry.level]}</span>
      <div className="log-body">
        <span className="log-msg">{who && <b>{who}: </b>}{entry.msg}</span>
        {hasData(entry.data) && (
          <details>
            <summary>Detalhes</summary>
            <pre>{JSON.stringify(entry.data, null, 2)}</pre>
          </details>
        )}
      </div>
    </li>
  )
}
