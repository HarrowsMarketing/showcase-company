import { useEffect, useState } from 'react'
import axios from 'axios'
import { cachedGet } from '../lib/apiCache'
import DateRangePicker, { type RangePreset } from '../components/DateRangePicker'

// ── Date range (NZ financial year, Apr–Mar) ─────────────────────────────────────
// The breakdown defaults to the current FY (matching the old fixed window); the picker
// lets you scope the closed-deal figures (Win/Loss, Salespeople, Corridors, Funnel) to
// any range — e.g. compare this FY vs last FY. Open pipeline is always "as of now".
const _now = new Date()
const _fyStartYear = _now.getMonth() < 3 ? _now.getFullYear() - 1 : _now.getFullYear()
const fyRange = (startYear: number) => ({ from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` })
const CUR_FY = fyRange(_fyStartYear)
const HISTORY_MIN = '2010-01-01'
// Cap at the end of the current financial year — the "This year" preset runs to next
// 31 Mar, so a today-based max would make it out-of-bounds and block switching back.
const RANGE_MAX = `${_fyStartYear + 1}-03-31`
const FY_LABEL = (startYear: number) => `FY${String(startYear).slice(2)}/${String(startYear + 1).slice(2)}`
const fmtRangeLabel = (from: string, to: string) => {
  const opt: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
  const f = new Date(from + 'T00:00:00').toLocaleDateString('en-NZ', opt)
  const t = new Date(to + 'T00:00:00').toLocaleDateString('en-NZ', opt)
  return `${f} – ${t}`
}
const RANGE_PRESETS: RangePreset[] = [
  { label: `This year (${FY_LABEL(_fyStartYear)})`, ...CUR_FY },
  { label: `Last year (${FY_LABEL(_fyStartYear - 1)})`, ...fyRange(_fyStartYear - 1) },
]

interface Stage { id: string; label: string; probability: number; count: number; value: number; avgAgeDays: number; actualWinValuePct?: number | null; actualWinCountPct?: number | null; closedSample?: number }
interface DealSnap { id: string; name: string; owner: string; value: number; closeDate: string; probability: number; stage: string }
interface PersonStat { name: string; open: { count: number; value: number }; won: { count: number; value: number }; lost: { count: number; value: number }; winRate: number | null }
interface CorridorStat { name: string; open: { count: number; value: number }; won: { count: number; value: number }; lost: { count: number; value: number }; winRate: number | null }
interface FunnelStage { id: string; label: string; count: number }
interface BreakdownData {
  fyLabel: string
  stages: Stage[]
  stageWinRateMeta?: { windowMonths: number; closedCount: number; excludedCount: number }
  totalOpen: { count: number; value: number; avgAgeDays: number }
  winLoss: { won: { count: number; value: number }; lost: { count: number; value: number }; winRate: number | null }
  corridors: CorridorStat[]
  hasCorridorData: boolean
  salespeople: PersonStat[]
  pipeSplit: { next1to4: DealSnap[]; next5to8: DealSnap[]; next9to12: DealSnap[]; top20pct: DealSnap[] }
  funnel: { overall: FunnelStage[]; bySalesperson: Record<string, FunnelStage[]>; excludedCount: number; excludedBySalesperson: Record<string, number> }
}

const fmt = (v: number) => new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD', maximumFractionDigits: 0 }).format(v)
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }) : '—'

function ProbBadge({ prob }: { prob: number }) {
  const pct = Math.round(prob * 100)
  const cls = pct >= 70 ? 'bg-green-100 text-green-700' : pct >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
  return <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}>{pct}%</span>
}

// Historical win rate for the stage — of closed deals (last 12 months) that reached
// it, the share won by value. Count-based rate in the tooltip.
function ActualWinCell({ s }: { s: Stage }) {
  if (s.actualWinValuePct == null) return <span className="text-gray-400 text-xs">—</span>
  return (
    <span title={`Value-weighted: ${s.actualWinValuePct}% · by deal count: ${s.actualWinCountPct}%`}>
      <span className="text-sm font-semibold text-gray-800">{s.actualWinValuePct}%</span>
      <span className="text-xs text-gray-400 ml-1.5">n={s.closedSample}{(s.closedSample || 0) < 30 ? ' · low' : ''}</span>
    </span>
  )
}

function WinBadge({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-gray-400 text-xs">—</span>
  const cls = rate >= 33 ? 'bg-green-100 text-green-700' : rate >= 20 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>{rate}%</span>
}

function DealRow({ deal }: { deal: DealSnap }) {
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-gray-50 last:border-0">
      <div className="min-w-0 flex-1 pr-3">
        <p className="text-sm font-medium text-gray-800 truncate">{deal.name}</p>
        <p className="text-xs text-gray-400 mt-0.5">{deal.owner} · {deal.stage} · Close {fmtDate(deal.closeDate)}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <ProbBadge prob={deal.probability} />
        <span className="text-sm font-semibold text-gray-800 w-24 text-right">{fmt(deal.value)}</span>
      </div>
    </div>
  )
}

// Color encodes how big the drop INTO that stage was, not just position — the
// stage with the largest fall from its predecessor gets the deepest shade of
// brand yellow (#EBA117), everything else scales down toward a pale tint.
function yellowShade(t: number) {
  const from = [253, 240, 210] // pale tint of #EBA117
  const to   = [153, 105, 15]  // deep shade of #EBA117
  const [r, g, b] = from.map((c, i) => Math.round(c + (to[i] - c) * t))
  return `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`
}
function stageColors(stages: FunnelStage[]) {
  const drops = stages.map((s, i) => i === 0 || stages[i - 1].count <= 0 ? 0 : Math.max(0, (stages[i - 1].count - s.count) / stages[i - 1].count))
  const maxDrop = Math.max(...drops, 0.0001)
  return stages.map((_, i) => yellowShade(drops[i] / maxDrop))
}

function DropOffPill({ from, to }: { from: FunnelStage; to: FunnelStage }) {
  const pct = from.count > 0 ? Math.round((1 - to.count / from.count) * 100) : 0
  const cls = pct >= 50 ? 'bg-red-50 text-red-700 border-red-100' : pct >= 20 ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-green-50 text-green-700 border-green-100'
  return (
    <div className={`flex items-center gap-2 shrink-0 px-3 py-1.5 rounded-lg border ${cls}`}>
      <span className="text-xs font-medium whitespace-nowrap">{from.label} → {to.label}</span>
      <span className="text-sm font-bold whitespace-nowrap">-{pct}%</span>
    </div>
  )
}

function FunnelSection({ funnel, salespeople, winRate }: { funnel: BreakdownData['funnel']; salespeople: PersonStat[]; winRate: number | null }) {
  const [person, setPerson] = useState('all')
  const stages = person === 'all' ? funnel.overall : (funnel.bySalesperson[person] ?? [])
  const activeWinRate = person === 'all' ? winRate : (salespeople.find(p => p.name === person)?.winRate ?? null)

  const colors = stageColors(stages)
  const topCount = stages[0]?.count ?? 0
  // Drop % is always relative to the stage directly above it, not the top of the
  // funnel — the bars themselves still shrink from the true top-of-funnel count.
  const pctLabelFor = (s: FunnelStage, i: number) => {
    if (i === stages.length - 1) return activeWinRate !== null ? `${activeWinRate}% close rate` : 'no closed deals'
    if (i === 0) return '0% drop'
    const prev = stages[i - 1].count
    return prev > 0 ? `${Math.round((1 - s.count / prev) * 100)}% drop` : '0% drop'
  }
  const isEmpty = stages.every(s => s.count === 0)
  const excluded = person === 'all' ? funnel.excludedCount : (funnel.excludedBySalesperson[person] ?? 0)

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold text-gray-900">Pipeline Funnel</h2>
          <p className="text-sm text-gray-400">Deals closed this FY (won or lost) · where they fell off, based on every stage each one ever occupied</p>
          {excluded > 0 && (
            <p className="text-xs text-amber-600 mt-1">
              {excluded} closed deal{excluded !== 1 ? 's' : ''} excluded — HubSpot has no reliable stage history for {excluded !== 1 ? 'them' : 'it'} (likely old records reset by a past data sync)
            </p>
          )}
        </div>
        <select
          value={person}
          onChange={e => setPerson(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-offset-1"
        >
          <option value="all">All salespeople</option>
          {salespeople.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>
      </div>
      <div className="p-6">
        {isEmpty ? (
          <p className="text-sm text-gray-400 text-center py-10">No deals for this filter</p>
        ) : (
          <>
            <div className="space-y-1.5">
              {stages.map((s, i) => {
                const widthPct = topCount > 0 ? Math.max((s.count / topCount) * 100, 3) : 0
                return (
                  <div key={s.id} className="flex items-center gap-3">
                    <div className="w-40 sm:w-56 shrink-0 text-right">
                      <p className="text-sm font-medium text-gray-800 truncate">{s.label}</p>
                      <p className="text-xs text-gray-400">{pctLabelFor(s, i)}</p>
                    </div>
                    <div className="flex-1 h-9 bg-gray-50 rounded-md overflow-hidden">
                      <div
                        className="h-full rounded-md flex items-center justify-end px-3"
                        style={{ width: `${widthPct}%`, backgroundColor: colors[i] }}
                        title={`${s.label}: ${s.count} deals`}
                      >
                        <span className="text-sm font-bold text-gray-900">{s.count}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 pt-4 border-t border-gray-100">Drop-off between stages</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {stages.slice(0, -1).map((s, i) => <DropOffPill key={s.id} from={s} to={stages[i + 1]} />)}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const BREAKDOWN_VIEWS = [
  ['stages', 'Pipeline Stages'],
  ['funnel', 'Funnel'],
  ['winloss', 'Win / Loss'],
  ['salespeople', 'Salespeople'],
  ['corridors', 'Corridors'],
  ['pipesplit', 'Pipe Split'],
] as const
type BreakdownView = typeof BREAKDOWN_VIEWS[number][0]

export default function SalesBreakdown() {
  const [data, setData] = useState<BreakdownData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<BreakdownView>('stages')
  const [from, setFrom] = useState(CUR_FY.from)
  const [to, setTo] = useState(CUR_FY.to)

  // Refetch when the range changes. Keep showing the previous data while the new range
  // loads (stale-while-revalidate) so the picker + view don't flash away on every toggle;
  // only the very first load shows the skeleton.
  useEffect(() => {
    let cancelled = false
    if (!data) setLoading(true)
    setError(null)
    cachedGet('/api/sales/breakdown', { params: { from, to } })
      .then(r => { if (!cancelled) { setData(r.data); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.response?.data?.error || e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !data) return <div className="flex items-center justify-center py-20 text-red-500 text-sm">Failed to load: {error}</div>
  if (loading && !data) return (
    <div className="space-y-4">
      {[...Array(4)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-gray-200 h-48 animate-pulse" />)}
    </div>
  )
  if (!data) return null

  const rangeLabel = fmtRangeLabel(from, to)
  const { stages, totalOpen, winLoss, corridors, hasCorridorData, salespeople, pipeSplit } = data

  const tableCls = 'w-full text-sm'
  const thCls = 'px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider'
  const thRCls = 'px-4 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider'
  const tdCls = 'px-4 py-3 text-gray-700'
  const tdRCls = 'px-4 py-3 text-right text-gray-700'

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Sales Breakdown</h1>
          <p className="text-sm text-gray-400">{rangeLabel} · Current open pipeline + closed deals in range</p>
        </div>
        {/* Date range — scopes the closed-deal figures (Win/Loss, Salespeople, Corridors,
            Funnel). Open pipeline + Pipe Split are always "as of now". */}
        <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} min={HISTORY_MIN} max={RANGE_MAX} presets={RANGE_PRESETS} />
      </div>

      {/* Section toggle — one view at a time, same pattern as Client Development */}
      <div className="inline-flex flex-wrap rounded-lg border border-gray-200 bg-white p-0.5">
        {BREAKDOWN_VIEWS.map(([v, label]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${view === v ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Pipeline Stages ── */}
      {view === 'stages' && (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Pipeline Stages</h2>
          <p className="text-sm text-gray-400">
            Open deals by stage — count, total value, average age.
            {data?.stageWinRateMeta && ` Win % = of closed deals (last ${data.stageWinRateMeta.windowMonths} months, ${data.stageWinRateMeta.closedCount.toLocaleString()} deals) that reached the stage, the share won — value-weighted.`}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className={tableCls}>
            <thead className="border-b border-gray-100">
              <tr>
                <th className={thCls + ' pl-6'}>Stage</th>
                <th className={thCls}>Win %</th>
                <th className={thRCls}>Deals</th>
                <th className={thRCls}>Total Value</th>
                <th className={thRCls + ' pr-6'}>Avg Age</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {stages.map(s => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className={tdCls + ' pl-6 font-medium text-gray-800'}>{s.label}</td>
                  <td className={tdCls}><ActualWinCell s={s} /></td>
                  <td className={tdRCls}>{s.count || '—'}</td>
                  <td className={tdRCls}>{s.count > 0 ? fmt(s.value) : '—'}</td>
                  <td className={tdRCls + ' pr-6'}>{s.count > 0 ? `${s.avgAgeDays}d` : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-200 bg-gray-50">
              <tr>
                <td className="px-4 py-3 pl-6 font-semibold text-gray-900" colSpan={2}>Total</td>
                <td className={tdRCls + ' font-semibold text-gray-900'}>{totalOpen.count}</td>
                <td className={tdRCls + ' font-semibold text-gray-900'}>{fmt(totalOpen.value)}</td>
                <td className={tdRCls + ' pr-6 font-semibold text-gray-700'}>{totalOpen.avgAgeDays}d avg</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      )}

      {/* ── Pipeline Funnel ── */}
      {view === 'funnel' && (
      <FunnelSection funnel={data.funnel} salespeople={salespeople} winRate={winLoss.winRate} />
      )}

      {/* ── Win / Loss ── */}
      {view === 'winloss' && (
      <div>
        <h2 className="text-base font-bold text-gray-900 mb-4">Win / Loss Analysis <span className="text-sm font-normal text-gray-400">— {rangeLabel}</span></h2>
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Won', value: winLoss.won.value, count: winLoss.won.count, color: 'text-green-600' },
            { label: 'Lost', value: winLoss.lost.value, count: winLoss.lost.count, color: 'text-red-500' },
            { label: 'Win Rate', value: null, rate: winLoss.winRate, count: winLoss.won.count + winLoss.lost.count, color: 'text-gray-900' },
          ].map(card => (
            <div key={card.label} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">{card.label}</p>
              <p className={`text-2xl font-bold ${card.color}`}>
                {card.value !== null ? fmt(card.value) : card.rate !== null ? `${card.rate}%` : '—'}
              </p>
              <p className="text-sm text-gray-400 mt-1">
                {card.label === 'Win Rate' ? `${card.count} total closed` : `${card.count} deal${card.count !== 1 ? 's' : ''}`}
              </p>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* ── Salespeople ── */}
      {view === 'salespeople' && (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Salespeople</h2>
          <p className="text-sm text-gray-400">Open pipeline (now) + won/lost in the selected range, per person</p>
        </div>
        <div className="overflow-x-auto">
          <table className={tableCls}>
            <thead className="border-b border-gray-100">
              <tr>
                <th className={thCls + ' pl-6'}>Person</th>
                <th className={thRCls}>Open Deals</th>
                <th className={thRCls}>Open Value</th>
                <th className={thRCls}>Won</th>
                <th className={thRCls}>Won Value</th>
                <th className={thRCls}>Lost</th>
                <th className={thRCls}>Lost Value</th>
                <th className={thRCls + ' pr-6'}>Win Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {salespeople.map(p => (
                <tr key={p.name} className="hover:bg-gray-50">
                  <td className={tdCls + ' pl-6 font-medium text-gray-800'}>{p.name}</td>
                  <td className={tdRCls}>{p.open.count || '—'}</td>
                  <td className={tdRCls}>{p.open.count > 0 ? fmt(p.open.value) : '—'}</td>
                  <td className={tdRCls + ' text-green-600 font-medium'}>{p.won.count || '—'}</td>
                  <td className={tdRCls + ' text-green-600'}>{p.won.count > 0 ? fmt(p.won.value) : '—'}</td>
                  <td className={tdRCls + ' text-red-500'}>{p.lost.count || '—'}</td>
                  <td className={tdRCls + ' text-red-500'}>{p.lost.count > 0 ? fmt(p.lost.value) : '—'}</td>
                  <td className={tdRCls + ' pr-6'}><WinBadge rate={p.winRate} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* ── Corridors ── */}
      {view === 'corridors' && (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Corridors</h2>
          <p className="text-sm text-gray-400">Open pipeline (now) + won/lost in the selected range, by corridor segment</p>
        </div>
        {!hasCorridorData ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-gray-500 font-medium">No corridor data found</p>
            <p className="text-xs text-gray-400 mt-1">Add a <code className="bg-gray-100 px-1 py-0.5 rounded">corridor</code> custom property to your HubSpot deals to enable this breakdown.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead className="border-b border-gray-100">
                <tr>
                  <th className={thCls + ' pl-6'}>Corridor</th>
                  <th className={thRCls}>Open Deals</th>
                  <th className={thRCls}>Open Value</th>
                  <th className={thRCls}>Won</th>
                  <th className={thRCls}>Lost</th>
                  <th className={thRCls + ' pr-6'}>Win Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {corridors.map(c => (
                  <tr key={c.name} className="hover:bg-gray-50">
                    <td className={tdCls + ' pl-6 font-medium text-gray-800'}>{c.name}</td>
                    <td className={tdRCls}>{c.open.count || '—'}</td>
                    <td className={tdRCls}>{c.open.count > 0 ? fmt(c.open.value) : '—'}</td>
                    <td className={tdRCls + ' text-green-600'}>{c.won.count > 0 ? `${c.won.count} (${fmt(c.won.value)})` : '—'}</td>
                    <td className={tdRCls + ' text-red-500'}>{c.lost.count || '—'}</td>
                    <td className={tdRCls + ' pr-6'}><WinBadge rate={c.winRate} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {/* ── Pipe Split ── */}
      {view === 'pipesplit' && (
      <div>
        <h2 className="text-base font-bold text-gray-900 mb-4">Pipe Split</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[
            { label: 'Closing 1–4 Weeks', sub: 'Next 28 days', deals: pipeSplit.next1to4, accent: 'text-green-600' },
            { label: 'Closing 5–8 Weeks', sub: 'Days 29–56',   deals: pipeSplit.next5to8, accent: 'text-blue-600' },
            { label: 'Closing 9–12 Weeks', sub: 'Days 57–84',  deals: pipeSplit.next9to12, accent: 'text-purple-600' },
            { label: 'Top 20% by Value',   sub: 'Highest-value open deals', deals: pipeSplit.top20pct, accent: 'text-amber-600', badge: true },
          ].map(({ label, sub, deals, accent, badge }) => (
            <div key={label} className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-900 text-sm">{label}</p>
                  <p className="text-xs text-gray-400">{sub} · {deals.length} deal{deals.length !== 1 ? 's' : ''}</p>
                </div>
                <div className="text-right">
                  {badge && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-medium">Top 20%</span>}
                  <p className={`text-sm font-bold ${accent} ${badge ? 'mt-1' : ''}`}>{fmt(deals.reduce((s, d) => s + d.value, 0))}</p>
                </div>
              </div>
              <div className="px-5 divide-y divide-gray-50 max-h-80 overflow-y-auto">
                {deals.length === 0 ? (
                  <p className="text-sm text-gray-400 py-6 text-center">No deals in this window</p>
                ) : (
                  deals.map(d => <DealRow key={d.id} deal={d} />)
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      )}
    </div>
  )
}
