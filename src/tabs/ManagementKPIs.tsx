import { useEffect, useState } from 'react'
import { cachedGet } from '../lib/apiCache'
import { Gauge, fmtDollar, fmtNum, fmtPct } from '../components/Gauge'
import ManagementEmailButton from '../components/ManagementEmailButton'
import { SnapshotTiles, type SnapshotTileDef } from '../components/SnapshotTiles'

type Kind = 'dollar' | 'number' | 'percent' | 'yesno' | 'count'

interface Tile {
  id: string
  group: string
  label: string
  sublabel?: string
  kind: Kind
  actual: number
  target: number
}

const FORMATTERS: Record<Kind, (v: number) => string> = {
  dollar: fmtDollar,
  number: fmtNum,
  percent: fmtPct,
  yesno: v => (v ? 'Yes' : 'No'),
  count: fmtNum,
}

// ── Read-only tile (percent/dollar/number use Gauge; yes/no and count are plain tiles) ──

function KpiTile({ tile }: { tile: Tile }) {
  if (tile.kind === 'yesno' || tile.kind === 'count') {
    const yes = !!tile.actual
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 flex flex-col h-full min-h-0">
        <div className="text-center shrink-0">
          <p className="text-sm xl:text-base font-bold tracking-widest text-gray-600 uppercase leading-tight">{tile.label}</p>
          {tile.sublabel && <p className="text-[10px] text-gray-400">{tile.sublabel}</p>}
        </div>
        <div className="flex-1 w-full min-h-0 flex items-center justify-center">
          {tile.kind === 'yesno' ? (
            <span className={`text-2xl font-extrabold ${yes ? 'text-green-500' : 'text-red-500'}`}>{yes ? 'Yes' : 'No'}</span>
          ) : (
            <span className={`text-2xl font-extrabold ${tile.actual > 0 ? 'text-red-500' : 'text-green-500'}`}>{fmtNum(tile.actual)}</span>
          )}
        </div>
      </div>
    )
  }
  return <Gauge compact label={tile.label} sublabel={tile.sublabel} actual={tile.actual} target={tile.target} format={FORMATTERS[tile.kind]} />
}

export default function ManagementKPIs({ snapshot = false }: { snapshot?: boolean }) {
  const [tiles, setTiles] = useState<Tile[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    cachedGet('/api/management/kpi-tiles')
      .then(r => setTiles(r.data.tiles))
      .catch(e => setError(e.response?.data?.error || e.message))
  }, [])

  if (error) return <div className="flex items-center justify-center py-20 text-red-500 text-sm">Failed to load: {error}</div>
  if (!tiles) return <div className="flex items-center justify-center py-20 text-gray-400 text-sm animate-pulse">Loading…</div>

  const groups: string[] = []
  for (const t of tiles) if (!groups.includes(t.group)) groups.push(t.group)

  // Snapshot mode (daily-email capture): render each KPI as its own fixed-size,
  // individually-tagged element (carrying its group) so the cron can screenshot
  // them one-by-one and compose a responsive grid of images, grouped by section,
  // in the email (see SnapshotTiles).
  if (snapshot) {
    const snapshotTiles: SnapshotTileDef[] = tiles.length
      ? tiles.map(tile => ({ key: tile.id, label: tile.label, group: tile.group, height: 320, node: <KpiTile tile={tile} /> }))
      : [{ key: 'empty', label: 'Management KPIs', node: (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-sm text-gray-400 h-full flex items-center justify-center">
            No KPI tiles set up yet.
          </div>
        ) }]
    return <SnapshotTiles tiles={snapshotTiles} />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">Management KPIs</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">Synced from the ops Google Sheet</span>
          <ManagementEmailButton dashboard="kpis" snapshot={snapshot} />
        </div>
      </div>

      {tiles.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-sm text-gray-400">
          No KPI tiles set up yet.
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(group => (
            <div key={group}>
              <div className="bg-gray-800 text-white text-sm font-semibold uppercase tracking-wider rounded-lg px-4 py-2 mb-3">
                {group}
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3" style={{ gridAutoRows: '220px' }}>
                {tiles.filter(t => t.group === group).map(tile => <KpiTile key={tile.id} tile={tile} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
