import type { BrandyApi } from '../../../shared/api.ts'
import type { LogArea, LogSummary } from '../../../shared/logs.ts'

type SummaryApi = Pick<BrandyApi, 'summarizeLogs' | 'cancelLogSummary'>

/** one request for as long as the summary is on screen; the returned function cancels it */
export function startSummary(api: SummaryApi, area: LogArea, onResult: (s: LogSummary) => void): () => void {
  let current = true
  const deliver = (s: LogSummary): void => { if (current) onResult(s) }
  api.summarizeLogs(area).then(deliver, (e) => deliver({ state: 'error', error: e instanceof Error ? e.message : String(e) }))
  return () => {
    current = false
    // harmless when the answer already arrived: there is nothing left to cancel
    void api.cancelLogSummary(area).catch(() => {})
  }
}
