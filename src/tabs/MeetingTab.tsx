import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { cachedGet } from '../lib/apiCache'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip,
} from 'recharts'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DealBase {
  id: string
  name: string
  owner: string
  amount: number      // NZD (converted)
  nativeAmount: number
  currency: string
  country: 'NZ' | 'AU'
}
interface WinDeal extends DealBase { closeDate: string; overdue: boolean }
interface NewDeal extends DealBase { createDate: string }

// Generic shape the chart consumes (date + optional overdue).
interface ChartDeal extends DealBase { date: string; overdue?: boolean }

interface DealsResponse {
  generatedAt: string
  horizon: string
  deals: WinDeal[]
  newDeals: NewDeal[]
  salespeople: string[]
}

interface CompletedRock {
  name: string
  text: string
  completedAt: string // ISO
}
interface BigRocksResponse {
  rocks: Record<string, string[]>
  completed: CompletedRock[]
  team: string[]
}

interface Tile { label: string; value: number; count: number; cls: string; deals: ChartDeal[]; dateNoun: string }
interface Popup { title: string; sub: string; color?: string; dateNoun: string; deals: ChartDeal[] }

// ── Colour (validated categorical palette — see dataviz skill) ──────────────────
// Fixed 8-hue order; colour follows the salesperson (entity), never their rank, so
// the filter never repaints survivors. A 9th+ salesperson folds into muted "Other".
const PALETTE = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834', '#0891b2', '#a855f7', '#b45309', '#65a30d']
const OTHER = '#898781'

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Group the flat completed-rocks history into a year → month → week tree, newest
// first at every level, so the tab can render it as a collapsible history.
interface WeekGroup { key: string; label: string; items: CompletedRock[] }
interface MonthGroup { key: string; label: string; count: number; weeks: WeekGroup[] }
interface YearGroup { key: string; label: string; count: number; months: MonthGroup[] }

function groupCompleted(list: CompletedRock[]): YearGroup[] {
  // year -> month index -> week-start ms -> items
  const years = new Map<number, Map<number, Map<number, CompletedRock[]>>>()
  for (const c of list) {
    const d = new Date(c.completedAt)
    if (isNaN(d.getTime())) continue
    const y = d.getFullYear()
    const m = d.getMonth()
    const ws = startOfWeek(d).getTime()
    if (!years.has(y)) years.set(y, new Map())
    const months = years.get(y)!
    if (!months.has(m)) months.set(m, new Map())
    const weeks = months.get(m)!
    if (!weeks.has(ws)) weeks.set(ws, [])
    weeks.get(ws)!.push(c)
  }
  const desc = (a: number, b: number) => b - a
  return [...years.keys()].sort(desc).map(y => {
    const months = years.get(y)!
    let yCount = 0
    const monthGroups = [...months.keys()].sort(desc).map(m => {
      const weeks = months.get(m)!
      let mCount = 0
      const weekGroups = [...weeks.keys()].sort(desc).map(ws => {
        const items = weeks.get(ws)!.slice().sort((a, b) => b.completedAt.localeCompare(a.completedAt))
        mCount += items.length
        return {
          key: String(ws),
          label: `Week of ${new Date(ws).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}`,
          items,
        }
      })
      yCount += mCount
      return { key: `${y}-${m}`, label: MONTH_NAMES[m], count: mCount, weeks: weekGroups }
    })
    return { key: String(y), label: String(y), count: yCount, months: monthGroups }
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtDollar = (v: number) => `$${Math.round(v).toLocaleString('en-NZ')}`
const fmtAxis = (v: number) =>
  v === 0 ? '$0' : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${v}`
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: '2-digit' })
const firstName = (full: string) => full.split(/\s+/)[0]

const startOfWeek = (t: Date) => {
  const x = new Date(t); x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)) // back to Monday
  return x
}
const startOfMonth = (t: Date) => new Date(t.getFullYear(), t.getMonth(), 1)
const monthLabel = (d: Date) => d.toLocaleDateString('en-NZ', { month: 'short', ...(d.getMonth() === 0 ? { year: '2-digit' } : {}) })

// ── Card ──────────────────────────────────────────────────────────────────────

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col ${className}`}>
      {children}
    </div>
  )
}

// ── Bucketing ───────────────────────────────────────────────────────────────────

type EdgeKind = 'overdue' | 'later' | 'earlier'
interface Bucket { key: string; label: string; edge?: EdgeKind; start?: number; end?: number }

// future = close date (Overdue bucket + this period forward + Later)
// past   = created date (Earlier + last N periods up to this one)
function buildBuckets(g: 'week' | 'month', now: Date, orientation: 'future' | 'past'): Bucket[] {
  const out: Bucket[] = []
  const N = g === 'week' ? 8 : 6
  const weekAt = (start: Date): Bucket => {
    const end = new Date(start); end.setDate(end.getDate() + 7)
    return { key: '', label: start.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }), start: start.getTime(), end: end.getTime() }
  }
  const monthAt = (start: Date): Bucket => {
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1)
    return { key: '', label: monthLabel(start), start: start.getTime(), end: end.getTime() }
  }
  const first = g === 'week'
    ? (() => { const m = startOfWeek(now); if (orientation === 'past') m.setDate(m.getDate() - (N - 1) * 7); return m })()
    : (() => { const b = startOfMonth(now); return orientation === 'past' ? new Date(b.getFullYear(), b.getMonth() - (N - 1), 1) : b })()

  if (orientation === 'future') out.push({ key: 'overdue', label: 'Overdue', edge: 'overdue' })
  // past orientation has no leading "Earlier" bucket — deals older than the shown
  // window are simply not charted (see makeBucketFor), so one bar can't dwarf the rest.

  let cur = new Date(first)
  for (let i = 0; i < N; i++) {
    const b = g === 'week' ? weekAt(cur) : monthAt(cur)
    b.key = `${g[0]}${i}`
    out.push(b)
    cur = new Date(b.end!)
  }
  if (orientation === 'future') out.push({ key: 'later', label: 'Later', edge: 'later', start: cur.getTime() })
  return out
}

function makeBucketFor(buckets: Bucket[], orientation: 'future' | 'past') {
  const time = buckets.filter(b => !b.edge)
  return (dl: ChartDeal): string => {
    if (orientation === 'future' && dl.overdue) return 'overdue'
    const t = Date.parse(dl.date)
    for (const b of time) if (t >= (b.start ?? 0) && t < (b.end ?? 0)) return b.key
    if (orientation === 'future') return 'later'
    return '' // past orientation: outside the shown window → not charted
  }
}

// ── Deal popup (shared by chart-segment clicks and summary-tile clicks) ──────────

function DealPopup({ popup, sort, setSort, onClose }: {
  popup: Popup
  sort: { by: 'date' | 'value'; dir: 'asc' | 'desc' }
  setSort: (fn: (s: { by: 'date' | 'value'; dir: 'asc' | 'desc' }) => { by: 'date' | 'value'; dir: 'asc' | 'desc' }) => void
  onClose: () => void
}) {
  const deals = useMemo(() => {
    const arr = [...popup.deals]
    arr.sort((a, b) => {
      const d = sort.by === 'value' ? a.amount - b.amount : Date.parse(a.date) - Date.parse(b.date)
      return sort.dir === 'asc' ? d : -d
    })
    return arr
  }, [popup.deals, sort])
  const total = deals.reduce((s, d) => s + d.amount, 0)
  const toggleSort = (by: 'date' | 'value') =>
    setSort(s => s.by === by ? { by, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { by, dir: by === 'value' ? 'desc' : 'asc' })
  const caret = (by: 'date' | 'value') => sort.by === by ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2 min-w-0">
            {popup.color && <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: popup.color }} />}
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900 truncate">{popup.title}</p>
              <p className="text-[11px] text-gray-400">
                {popup.sub ? `${popup.sub} · ` : ''}{deals.length} deal{deals.length === 1 ? '' : 's'} · {fmtDollar(total)}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1 -m-1 shrink-0" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                <th className="text-left font-medium py-1.5 pr-2">Deal</th>
                <th className="text-left font-medium py-1.5 px-2 cursor-pointer select-none hover:text-gray-600" onClick={() => toggleSort('date')}>{popup.dateNoun}{caret('date')}</th>
                <th className="text-right font-medium py-1.5 pl-2 cursor-pointer select-none hover:text-gray-600" onClick={() => toggleSort('value')}>Value{caret('value')}</th>
              </tr>
            </thead>
            <tbody>
              {deals.length === 0 && (
                <tr><td colSpan={3} className="text-center text-gray-400 text-sm py-6">No deals</td></tr>
              )}
              {deals.map(dl => (
                <tr key={dl.id} className={`border-b border-gray-50 ${dl.overdue ? 'bg-red-50/50' : ''}`}>
                  <td className="py-1.5 pr-2">
                    <span className="text-gray-800">{dl.name}</span>
                    {dl.country === 'AU' && <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-gray-100 text-gray-500 align-middle">AU</span>}
                  </td>
                  <td className={`py-1.5 px-2 ${dl.overdue ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                    {fmtDate(dl.date)}{dl.overdue && ' · overdue'}
                  </td>
                  <td className="py-1.5 pl-2 text-right font-semibold text-gray-900 whitespace-nowrap tabular-nums">
                    {fmtDollar(dl.amount)}
                    {dl.currency !== 'NZD' && <span className="block text-[9px] font-normal text-gray-400">{dl.currency} {dl.nativeAmount.toLocaleString('en-NZ')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Deals chart (reused for Deals to Win + New Deals Added) ──────────────────────

function DealsChart({
  title, subtitle, deals, auxDeals, colorOf, orientation, dateNoun, generatedAt,
}: {
  title: string
  subtitle: string
  deals: ChartDeal[]
  auxDeals?: ChartDeal[]           // new-deals dataset, for the "New deals last …" tile
  colorOf: Record<string, string>
  orientation: 'future' | 'past'
  dateNoun: string                 // "Close date" | "Added"
  generatedAt: string
}) {
  const [granularity, setGranularity] = useState<'week' | 'month'>('week')
  const [filter, setFilter] = useState<string>('all')
  const [popup, setPopup] = useState<Popup | null>(null)
  const [sort, setSort] = useState<{ by: 'date' | 'value'; dir: 'asc' | 'desc' }>({ by: 'date', dir: 'asc' })

  const present = useMemo(() => [...new Set(deals.map(d => d.owner))].sort(), [deals])
  const seriesPeople = filter === 'all' ? present : present.filter(sp => sp === filter)
  const now = useMemo(() => new Date(generatedAt), [generatedAt])

  const bucketing = useMemo(() => {
    const bk = buildBuckets(granularity, now, orientation)
    return { bk, bucketFor: makeBucketFor(bk, orientation) }
  }, [granularity, now, orientation])

  const { rows } = useMemo(() => {
    const { bk, bucketFor } = bucketing
    const totals: Record<string, Record<string, number>> = {}
    for (const b of bk) totals[b.key] = {}
    for (const dl of deals) {
      if (filter !== 'all' && dl.owner !== filter) continue
      const k = bucketFor(dl)
      if (!(k in totals)) continue // out-of-window (past orientation) → skip
      totals[k][dl.owner] = (totals[k][dl.owner] ?? 0) + dl.amount
    }
    const bucketTotal = (k: string) => Object.values(totals[k]).reduce((s, v) => s + v, 0)
    const kept = bk.filter(b => b.edge ? bucketTotal(b.key) > 0 : true)
    const rows = kept.map(b => {
      const row: any = { key: b.key, label: b.label, edge: b.edge ?? null, total: 0 }
      for (const sp of seriesPeople) { const v = totals[b.key][sp] ?? 0; row[sp] = v; row.total += v }
      return row
    })
    return { rows }
  }, [deals, bucketing, filter, seriesPeople])

  // Summary tiles (each carries the deals behind it, so the tile is clickable).
  const tiles = useMemo<Tile[]>(() => {
    const mk = (label: string, cls: string, ds: ChartDeal[], dn: string): Tile =>
      ({ label, cls, deals: ds, dateNoun: dn, value: ds.reduce((s, d) => s + d.amount, 0), count: ds.length })
    const pick = (arr: ChartDeal[]) => filter === 'all' ? arr : arr.filter(d => d.owner === filter)
    const curStartDate = granularity === 'week' ? startOfWeek(now) : startOfMonth(now)
    const curStart = curStartDate.getTime()
    const curEnd = granularity === 'week'
      ? (() => { const x = new Date(curStartDate); x.setDate(x.getDate() + 7); return x.getTime() })()
      : new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()
    const prevStart = granularity === 'week'
      ? (() => { const x = new Date(curStartDate); x.setDate(x.getDate() - 7); return x.getTime() })()
      : new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime()
    const inPrev = (d: ChartDeal) => { const t = Date.parse(d.date); return t >= prevStart && t < curStart }

    if (orientation === 'future') {
      const src = pick(deals)
      // To win = open deals closing in the selected period (this week / this month).
      const out = [
        mk(`To win this ${granularity}`, 'blue', src.filter(d => !d.overdue && Date.parse(d.date) < curEnd), dateNoun),
        mk('Overdue', 'red', src.filter(d => d.overdue), dateNoun),
      ]
      if (auxDeals) out.push(mk(`New deals last ${granularity}`, 'green', pick(auxDeals).filter(inPrev), 'Added'))
      return out
    }
    const src = pick(deals)
    return [
      mk(`Added last ${granularity}`, 'green', src.filter(inPrev), dateNoun),
      mk(`This ${granularity}`, 'slate', src.filter(d => Date.parse(d.date) >= curStart), dateNoun),
    ]
  }, [deals, auxDeals, filter, orientation, granularity, now, dateNoun])

  const openSegment = (sp: string, k: string) => {
    const label = bucketing.bk.find(b => b.key === k)?.label ?? ''
    setPopup({ title: sp, sub: label, color: colorOf[sp] || OTHER, dateNoun, deals: deals.filter(d => d.owner === sp && bucketing.bucketFor(d) === k) })
  }
  const openTile = (t: Tile) => setPopup({ title: t.label, sub: '', dateNoun: t.dateNoun, deals: t.deals })

  const AxisTick = ({ x, y, payload }: any) => {
    const row = rows.find(r => r.label === payload.value)
    const od = row?.edge === 'overdue'
    return (
      <text x={x} y={y + 10} textAnchor="middle" fontSize={10} fontWeight={od ? 700 : 400} fill={od ? '#dc2626' : '#9ca3af'}>
        {payload.value}
      </text>
    )
  }

  const ChartTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const total = payload.reduce((s: number, p: any) => s + (p.value || 0), 0)
    const parts = payload.filter((p: any) => p.value > 0).sort((a: any, b: any) => b.value - a.value)
    if (!parts.length) return null
    return (
      <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs shadow-lg max-w-[240px]">
        <p className="text-gray-700 font-semibold mb-1">{label}</p>
        {parts.map((p: any) => (
          <p key={p.dataKey} className="flex items-center gap-1.5" style={{ color: '#374151' }}>
            <span className="w-2 h-2 rounded-sm inline-block" style={{ background: colorOf[p.dataKey] || OTHER }} />
            <span className="flex-1 truncate">{firstName(p.dataKey)}</span>
            <span className="font-medium tabular-nums">{fmtDollar(p.value)}</span>
          </p>
        ))}
        <p className="text-gray-500 mt-1 pt-1 border-t border-gray-100">Total {fmtDollar(total)} · click a segment for deals</p>
      </div>
    )
  }

  const tileCls: Record<string, string> = {
    blue: 'border-blue-100 bg-blue-50 text-blue-700',
    red: 'border-red-100 bg-red-50 text-red-600',
    green: 'border-green-100 bg-green-50 text-green-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-gray-900">{title}</h2>
          <p className="text-xs text-gray-400">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg overflow-hidden border border-gray-200">
            {([['week', 'Week'], ['month', 'Month']] as const).map(([g, lbl]) => (
              <button key={g} onClick={() => { setGranularity(g); setPopup(null) }}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${granularity === g ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                {lbl}
              </button>
            ))}
          </div>
          <select
            value={filter}
            onChange={e => { setFilter(e.target.value); setPopup(null) }}
            className="text-sm text-gray-700 bg-white border border-gray-200 rounded-lg px-3 py-1.5 shadow-sm outline-none"
            aria-label="Filter by salesperson"
          >
            <option value="all">All salespeople</option>
            {present.map(sp => <option key={sp} value={sp}>{sp}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="lg:col-span-2 h-96">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold tracking-widest text-gray-500 uppercase">
              {granularity === 'week' ? 'By week' : 'By month'} · {filter === 'all' ? 'all salespeople' : firstName(filter)}
            </p>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2">
            {present.map(sp => (
              <button key={sp} onClick={() => { setFilter(f => f === sp ? 'all' : sp); setPopup(null) }}
                className={`flex items-center gap-1.5 text-[11px] transition-opacity ${filter !== 'all' && filter !== sp ? 'opacity-35' : ''}`}>
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: colorOf[sp] || OTHER }} />
                <span className="text-gray-600">{firstName(sp)}</span>
              </button>
            ))}
          </div>
          {rows.length === 0 || rows.every(r => r.total === 0) ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400">No deals in this view</div>
          ) : (
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{ top: 4, right: 6, bottom: 0, left: -4 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="label" tick={<AxisTick />} axisLine={false} tickLine={false} interval={0} height={22} />
                  <YAxis tickFormatter={fmtAxis} tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} width={46} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
                  {seriesPeople.map((sp, i) => (
                    <Bar key={sp} dataKey={sp} stackId="v" fill={colorOf[sp] || OTHER}
                      stroke="#ffffff" strokeWidth={1.5} cursor="pointer"
                      onClick={(entry: any) => { const k = entry?.payload?.key ?? entry?.key; if (k) openSegment(sp, k) }}
                      radius={i === seriesPeople.length - 1 ? [3, 3, 0, 0] : undefined} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="text-[10px] text-gray-400 text-center mt-1">Click a salesperson's segment to see their deals for that {granularity}</p>
        </Card>

        <Card className="lg:col-span-1">
          <p className="text-xs font-semibold tracking-widest text-gray-500 uppercase mb-3">
            {filter === 'all' ? 'All salespeople' : filter}
          </p>
          <div className="space-y-3">
            {tiles.map(t => (
              <button key={t.label} onClick={() => openTile(t)}
                className={`w-full text-left rounded-lg border p-3 transition-shadow hover:shadow-sm ${tileCls[t.cls]}`}>
                <div className="flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-wide opacity-80">{t.label}</p>
                  <span className="text-[9px] opacity-60">view →</span>
                </div>
                <p className="text-2xl font-extrabold leading-tight tabular-nums">{fmtDollar(t.value)}</p>
                <p className="text-[11px] opacity-80">{t.count} deal{t.count === 1 ? '' : 's'}</p>
              </button>
            ))}
          </div>
        </Card>
      </div>

      {popup && <DealPopup popup={popup} sort={sort} setSort={setSort} onClose={() => setPopup(null)} />}
    </>
  )
}

// ── Completed Rocks ─────────────────────────────────────────────────────────────
// Collapsed history of every ticked-off rock, as a year → month → week tree using
// native <details> for zero-state collapse. Newest year/month is open by default.

function initials(name: string) {
  return name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

function CompletedRocks({ completed, colorOf, onRestore, restoring }: {
  completed: CompletedRock[]
  colorOf: Record<string, string>
  onRestore: (c: CompletedRock, key: string) => void
  restoring: Set<string>
}) {
  const tree = useMemo(() => groupCompleted(completed), [completed])
  const total = completed.length

  return (
    <Card>
      <details className="group">
        <summary className="flex items-center justify-between cursor-pointer list-none select-none">
          <div>
            <p className="text-xs font-semibold tracking-widest text-gray-500 uppercase">Completed Rocks</p>
            <p className="text-[10px] text-gray-400 mt-0.5">History of every rock ticked off · by year, month &amp; week</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-medium text-gray-500 tabular-nums">{total}</span>
            <svg className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </summary>

        <div className="mt-3 border-t border-gray-100 pt-3">
          {tree.length === 0 ? (
            <p className="text-sm text-gray-300 italic py-2">No rocks completed yet</p>
          ) : (
            <div className="space-y-1">
              {tree.map((year, yi) => (
                <details key={year.key} open={yi === 0} className="group/y">
                  <summary className="flex items-center gap-2 cursor-pointer list-none select-none py-1">
                    <svg className="w-3.5 h-3.5 text-gray-400 transition-transform group-open/y:rotate-90 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-sm font-bold text-gray-800">{year.label}</span>
                    <span className="text-[11px] text-gray-400 tabular-nums">{year.count}</span>
                  </summary>

                  <div className="pl-4 border-l border-gray-100 ml-1.5 space-y-0.5">
                    {year.months.map((month, mi) => (
                      <details key={month.key} open={yi === 0 && mi === 0} className="group/m">
                        <summary className="flex items-center gap-2 cursor-pointer list-none select-none py-1">
                          <svg className="w-3 h-3 text-gray-400 transition-transform group-open/m:rotate-90 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          <span className="text-sm font-semibold text-gray-700">{month.label}</span>
                          <span className="text-[11px] text-gray-400 tabular-nums">{month.count}</span>
                        </summary>

                        <div className="pl-4 border-l border-gray-100 ml-1 space-y-1 py-1">
                          {month.weeks.map(week => (
                            <details key={week.key} className="group/w">
                              <summary className="flex items-center gap-2 cursor-pointer list-none select-none py-0.5">
                                <svg className="w-3 h-3 text-gray-300 transition-transform group-open/w:rotate-90 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                                <span className="text-xs font-medium text-gray-500">{week.label}</span>
                                <span className="text-[10px] text-gray-300 tabular-nums">{week.items.length}</span>
                              </summary>

                              <ul className="pl-5 py-1 space-y-1.5">
                                {week.items.map((c, i) => {
                                  const key = `${c.name}::${c.completedAt}::${c.text}`
                                  const busy = restoring.has(key)
                                  return (
                                    <li key={key} className="flex items-start gap-2 text-sm text-gray-600">
                                      <input
                                        type="checkbox"
                                        checked={!busy}
                                        disabled={busy}
                                        onChange={() => onRestore(c, key)}
                                        title="Un-tick — move back to active"
                                        className="mt-0.5 shrink-0 w-4 h-4 rounded border-gray-300 text-gray-900 cursor-pointer disabled:opacity-50"
                                      />
                                      <span className="w-5 h-5 mt-0.5 rounded-full text-white text-[9px] font-bold flex items-center justify-center shrink-0"
                                        style={{ background: colorOf[c.name] || '#374151' }} title={c.name}>
                                        {initials(c.name)}
                                      </span>
                                      <span className="whitespace-pre-wrap flex-1">{c.text}</span>
                                      <span className="text-[10px] text-gray-300 shrink-0 tabular-nums mt-0.5">{fmtDate(c.completedAt)}</span>
                                    </li>
                                  )
                                })}
                              </ul>
                            </details>
                          ))}
                        </div>
                      </details>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      </details>
    </Card>
  )
}

// ── Main ────────────────────────────────────────────────────────────────────────

export default function MeetingTab() {
  const [data, setData] = useState<DealsResponse | null>(null)
  const [rocksData, setRocksData] = useState<BigRocksResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editRocks, setEditRocks] = useState(false)
  const [draftRocks, setDraftRocks] = useState<Record<string, string[]>>({})
  const [savingRocks, setSavingRocks] = useState(false)
  const [completing, setCompleting] = useState<Set<string>>(new Set()) // keys mid-tick
  const [restoring, setRestoring] = useState<Set<string>>(new Set())   // keys mid-untick

  useEffect(() => {
    let cancelled = false
    setError(null)
    ;(async () => {
      try {
        const [d, r] = await Promise.all([
          cachedGet('/api/sales/deals-to-win'),
          cachedGet('/api/sales/big-rocks'),
        ])
        if (cancelled) return
        setData(d.data)
        setRocksData(r.data)
      } catch (e: any) {
        if (!cancelled) setError(e.response?.data?.error || e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const colorOf = useMemo(() => {
    const m: Record<string, string> = {}
    // Real people get the palette first; a non-person owner (Unassigned) takes grey
    // before a salesperson would, so nobody on the team ends up grey unnecessarily.
    const ordered = [...(data?.salespeople ?? [])].sort((a, b) => {
      const au = a === 'Unassigned' ? 1 : 0, bu = b === 'Unassigned' ? 1 : 0
      return au - bu || a.localeCompare(b)
    })
    ordered.forEach((sp, i) => { m[sp] = i < PALETTE.length ? PALETTE[i] : OTHER })
    return m
  }, [data])

  const winDeals = useMemo<ChartDeal[]>(() => (data?.deals ?? []).map(d => ({ ...d, date: d.closeDate })), [data])
  const newDeals = useMemo<ChartDeal[]>(() => (data?.newDeals ?? []).map(d => ({ ...d, date: d.createDate, overdue: false })), [data])

  function startEditRocks() {
    const seed: Record<string, string[]> = {}
    const names = Array.from(new Set([...(rocksData?.team ?? []), ...Object.keys(rocksData?.rocks ?? {})]))
    for (const name of names) {
      const arr = [...(rocksData?.rocks?.[name] ?? [])]
      seed[name] = arr.length ? arr : [''] // always show one empty input to type into
    }
    setDraftRocks(seed)
    setEditRocks(true)
  }
  function addRockRow(name: string) {
    setDraftRocks(prev => ({ ...prev, [name]: [...(prev[name] ?? []), ''] }))
  }
  function removeRockRow(name: string, i: number) {
    setDraftRocks(prev => {
      const arr = [...(prev[name] ?? [])]
      arr.splice(i, 1)
      return { ...prev, [name]: arr.length ? arr : [''] }
    })
  }
  async function saveRocks() {
    setSavingRocks(true)
    try {
      const payload: Record<string, string[]> = {}
      for (const [k, v] of Object.entries(draftRocks)) {
        const arr = v.map(s => s.trim()).filter(Boolean)
        if (arr.length) payload[k] = arr
      }
      const r = await axios.put('/api/sales/big-rocks', { rocks: payload })
      setRocksData(prev => prev ? { ...prev, rocks: r.data.rocks } : prev)
      setEditRocks(false)
    } catch (e: any) {
      alert('Could not save big rocks: ' + (e.response?.data?.error || e.message))
    } finally {
      setSavingRocks(false)
    }
  }
  // Tick a rock off — moves it into the completed history (server-timestamped).
  async function completeRock(name: string, text: string, key: string) {
    if (completing.has(key)) return
    setCompleting(prev => new Set(prev).add(key))
    try {
      const r = await axios.post('/api/sales/big-rocks/complete', { name, text })
      setRocksData(prev => prev ? { ...prev, rocks: r.data.rocks, completed: r.data.completed } : prev)
    } catch (e: any) {
      alert('Could not complete rock: ' + (e.response?.data?.error || e.message))
    } finally {
      setCompleting(prev => { const n = new Set(prev); n.delete(key); return n })
    }
  }
  // Un-tick a completed rock — moves it back to the person's active list.
  async function restoreRock(c: CompletedRock, key: string) {
    if (restoring.has(key)) return
    setRestoring(prev => new Set(prev).add(key))
    try {
      const r = await axios.post('/api/sales/big-rocks/restore', c)
      setRocksData(prev => prev ? { ...prev, rocks: r.data.rocks, completed: r.data.completed } : prev)
    } catch (e: any) {
      alert('Could not restore rock: ' + (e.response?.data?.error || e.message))
    } finally {
      setRestoring(prev => { const n = new Set(prev); n.delete(key); return n })
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-gray-400 text-sm animate-pulse">Loading meeting…</p>
    </div>
  )
  if (error) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-red-500 text-sm">Error: {error}</p>
    </div>
  )
  if (!data) return null

  const rockNames = Array.from(new Set([...(rocksData?.team ?? []), ...Object.keys(rocksData?.rocks ?? {})]))

  return (
    <div className="space-y-6">

      {/* ── Big Rocks ──────────────────────────────────────────────────── */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs font-semibold tracking-widest text-gray-500 uppercase">Today's Big Rocks</p>
            <p className="text-[10px] text-gray-400 mt-0.5">Top priorities for each salesperson this day/week · tick to complete</p>
          </div>
          {editRocks ? (
            <div className="flex items-center gap-2">
              <button onClick={() => setEditRocks(false)} disabled={savingRocks}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50">Cancel</button>
              <button onClick={saveRocks} disabled={savingRocks}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50">
                {savingRocks ? 'Saving…' : 'Save'}
              </button>
            </div>
          ) : (
            <button onClick={startEditRocks}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-900 text-white hover:bg-gray-700">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rockNames.map(name => {
            const rocks = rocksData?.rocks?.[name] ?? []
            return (
              <div key={name} className="rounded-lg border border-gray-200 p-3 flex flex-col">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-6 h-6 rounded-full text-white text-[10px] font-bold flex items-center justify-center shrink-0"
                    style={{ background: colorOf[name] || '#374151' }}>
                    {name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                  </span>
                  <span className="text-sm font-semibold text-gray-800 truncate">{name}</span>
                </div>
                {editRocks ? (
                  <div className="space-y-1.5">
                    {(draftRocks[name] ?? ['']).map((val, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span className="text-[10px] text-gray-300 w-3 shrink-0">{i + 1}</span>
                        <input
                          value={val}
                          onChange={e => setDraftRocks(prev => {
                            const arr = [...(prev[name] ?? [''])]; arr[i] = e.target.value
                            return { ...prev, [name]: arr }
                          })}
                          placeholder={`Big rock ${i + 1}`}
                          maxLength={500}
                          className="flex-1 text-sm text-gray-700 border border-gray-200 rounded-lg px-2 py-1 outline-none focus:border-gray-400"
                        />
                        <button onClick={() => removeRockRow(name, i)} title="Remove"
                          className="w-5 h-5 shrink-0 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                    <button onClick={() => addRockRow(name)}
                      className="text-xs font-medium text-gray-500 hover:text-gray-800 flex items-center gap-1 pl-4">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add rock
                    </button>
                  </div>
                ) : rocks.length ? (
                  <ul className="space-y-1.5">
                    {rocks.map((r, i) => {
                      const key = `${name}::${i}::${r}`
                      const busy = completing.has(key)
                      return (
                        <li key={key} className="flex gap-2 text-sm text-gray-700 items-start">
                          <input
                            type="checkbox"
                            checked={busy}
                            disabled={busy}
                            onChange={() => completeRock(name, r, key)}
                            title="Mark complete"
                            className="mt-0.5 shrink-0 w-4 h-4 rounded border-gray-300 text-gray-900 cursor-pointer disabled:opacity-50"
                          />
                          <span className={`whitespace-pre-wrap flex-1 ${busy ? 'text-gray-300 line-through' : ''}`}>{r}</span>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-300 italic">No big rocks set</p>
                )}
              </div>
            )
          })}
          {rockNames.length === 0 && (
            <p className="text-sm text-gray-400 col-span-full text-center py-4">No salespeople configured</p>
          )}
        </div>
      </Card>

      {/* ── Completed Rocks (collapsible year → month → week history) ────── */}
      <CompletedRocks completed={rocksData?.completed ?? []} colorOf={colorOf}
        onRestore={restoreRock} restoring={restoring} />

      <div className="space-y-3">
        <DealsChart
          title="Deals to Win"
          subtitle="Open pipeline by close date · NZD"
          deals={winDeals}
          colorOf={colorOf}
          orientation="future"
          dateNoun="Close date"
          generatedAt={data.generatedAt}
        />
      </div>

      <div className="space-y-3">
        <DealsChart
          title="New Deals Added"
          subtitle="NZ + AUS pipelines by created date · NZD"
          deals={newDeals}
          colorOf={colorOf}
          orientation="past"
          dateNoun="Added"
          generatedAt={data.generatedAt}
        />
      </div>

    </div>
  )
}
