import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { RtkRow } from '../shared/usage-report.ts'

/** Reads RTK's own savings history, one project folder at a time (`rtk gain --project`). */

interface Day {
  date: string
  commands: number
  input_tokens: number
  saved_tokens: number
}

/** a peak saves more than this many times the median day (needs at least three days to tell) */
const PEAK_FACTOR = 3

export function rtkRow(project: string, json: string, month: string): RtkRow | null {
  let days: Day[]
  try {
    days = (JSON.parse(json) as { daily?: Day[] }).daily ?? []
  } catch {
    return null
  }
  days = days.filter((d) => d.date.startsWith(`${month}-`))
  if (!days.length) return null
  const sum = (list: Day[], key: 'commands' | 'input_tokens' | 'saved_tokens') => list.reduce((n, d) => n + d[key], 0)
  const sorted = days.map((d) => d.saved_tokens).sort((a, b) => a - b)
  const mid = sorted.length >> 1
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  const isPeak = (d: Day) => days.length >= 3 && d.saved_tokens > PEAK_FACTOR * median
  return {
    project,
    commands: sum(days, 'commands'),
    input: sum(days, 'input_tokens'),
    saved: sum(days, 'saved_tokens'),
    peaks: days.filter(isPeak).map((d) => ({ date: d.date, saved: d.saved_tokens })),
    savedWithoutPeaks: sum(days.filter((d) => !isPeak(d)), 'saved_tokens')
  }
}

function gain(bin: string, cwd: string): Promise<string> {
  return new Promise((done) => {
    execFile(bin, ['gain', '--project', '--daily', '--format', 'json'], { cwd, timeout: 10_000, maxBuffer: 4 << 20 },
      (err, stdout) => done(err ? '' : String(stdout)))
  })
}

/** Projects without a folder or without RTK history in the month are left out. */
export async function rtkRows(bin: string, projects: { name: string; path: string | null }[], month: string): Promise<RtkRow[]> {
  const rows: RtkRow[] = []
  // one at a time: they all read the same RTK database
  for (const p of projects) {
    if (!p.path || !existsSync(p.path)) continue
    const row = rtkRow(p.name, await gain(bin, p.path), month)
    if (row) rows.push(row)
  }
  return rows.sort((a, b) => b.saved - a.saved)
}
