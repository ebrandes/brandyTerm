import type { CatalogItem } from '../../shared/types.ts'
import { describeCounts, type ScanResult } from '../security.ts'

export type CliRun = (args: string[]) => Promise<{ code: number; out: string }>

export interface InstallOpts {
  /** the catalog entry; absent means the plugin isn't in the catalog and must be scanned */
  item?: CatalogItem
  /** keys of ~/.claude/plugins/known_marketplaces.json */
  knownMarkets: Set<string>
  run: CliRun
  scan: (spec: string) => Promise<ScanResult>
}

/**
 * Installs `name@market` with `--scope user`. An unknown store is added first from the
 * item's `loja`. A plugin outside the catalog goes through the security scan, and a
 * blocked scan stops everything; catalog items (corporate ones included) were already
 * approved and are never scanned again.
 */
export async function installPlugin(id: string, o: InstallOpts): Promise<{ ok: boolean; erro?: string }> {
  const market = id.split('@')[1]
  if (!market) return { ok: false, erro: `Plugin ${id} sem loja (use nome@loja).` }
  if (!o.knownMarkets.has(market)) {
    if (!o.item?.loja) return { ok: false, erro: `Loja ${market} desconhecida: rode /skill-install com o repositório dela.` }
    const add = await o.run(['plugin', 'marketplace', 'add', o.item.loja])
    if (add.code !== 0) return { ok: false, erro: add.out || `Falha ao adicionar a loja ${o.item.loja}.` }
  }
  if (!o.item) {
    const r = await o.scan(id)
    if (r.blocked || !r.ok) {
      const why = r.ok ? describeCounts(r.counts) : `scan falhou: ${r.error ?? 'sem relatório'}`
      return { ok: false, erro: `Bloqueado pela checagem de segurança: ${why}` }
    }
  }
  const done = await o.run(['plugin', 'install', id, '--scope', 'user'])
  return done.code === 0 ? { ok: true } : { ok: false, erro: done.out || `Falha ao instalar ${id}.` }
}
