import React, { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { cachedGet } from '../lib/apiCache'
import html2canvas from 'html2canvas'
import { useUser } from '../lib/fakeAuth'
import TargetsPanel from '../components/TargetsPanel'
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip,
} from 'recharts'

interface PersonData {
  id: string
  name: string
  initials: string
  pointsTarget: number
  pointsTargetFullMonth: number
  targets: Record<string, number>
  ce_visit: number
  project_visit: number
  ce_call: number
  project_call: number
  bd_visit: number
  bd_call: number
  points: number
  hidden?: boolean
  noTarget?: boolean
}

interface KpiData {
  month: string
  from?: string
  to?: string
  targetFactor?: number
  people: PersonData[]
}

// ── Date range helpers ──────────────────────────────────────────────────────────

const fmtYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const _now = new Date()
const _fyStartYear = _now.getMonth() < 3 ? _now.getFullYear() - 1 : _now.getFullYear()
const HISTORY_MIN = '2010-01-01'
const FY_MAX = `${_fyStartYear + 1}-03-31`
const DEFAULT_FROM = fmtYMD(new Date(_now.getFullYear(), _now.getMonth(), 1))
const DEFAULT_TO   = fmtYMD(new Date(_now.getFullYear(), _now.getMonth() + 1, 0))
const fmtRangeLabel = (from: string, to: string) => {
  const opt: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
  const f = new Date(from + 'T00:00:00').toLocaleDateString('en-NZ', opt)
  const t = new Date(to + 'T00:00:00').toLocaleDateString('en-NZ', opt)
  return `${f} – ${t}`
}

// ── KPI trend charts (this-FY / last-FY overlay, same format as the sales dashboard) ──

interface KpiTrendMonth {
  label: string
  kpiPoints: number | null
  kpiPointsTarget: number
  cumulativeKpiPoints: number | null
  cumulativeKpiTarget: number
  isCurrentOrPast: boolean
  prevKpiPoints?: number | null
  prevCumulativeKpiPoints?: number | null
}
interface KpiTrendData { fyLabel: string; fyMonths: KpiTrendMonth[] }

interface SupportPerson { id: string; name: string; initials: string; quotes: number; totalValue: number; avgValue: number }
interface SupportData { from: string; to: string; people: SupportPerson[]; totals: { quotes: number; totalValue: number; avgValue: number } }
const fmtMoney = (v: number) => `$${Math.round(v).toLocaleString('en-NZ')}`

// Top-level view switcher for the KPIs tab (segmented control, same pattern as Sales Breakdown)
const KPI_VIEWS = [
  ['gauges', 'Gauges'],
  ['tables', 'Leaderboards'],
  ['trend', 'Trend'],
  ['support', 'Sales Support'],
] as const
type KpiView = typeof KPI_VIEWS[number][0]

const KPI_COLOR = '#526147' // olive — same palette as the sales dashboard charts
const fmtPts = (v: number) => Math.round(v).toLocaleString('en-NZ')
const fmtAxisPts = (v: number) => v === 0 ? '0' : v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : String(Math.round(v))

function KpiChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-gray-500 mb-1">{label}</p>
      {payload.map((p: any, i: number) =>
        p.value != null ? (
          <p key={i} style={{ color: p.color }}>{p.name}: {fmtPts(p.value)} pts</p>
        ) : null
      )}
    </div>
  )
}

// Mirrors SalesTracking's TrendChart: a filled Area (actual) plus an optional compare
// Line (the other year) and a dashed Target line. Points instead of dollars.
function KpiTrendChart({
  data, actualKey, targetKey, compareKey, title, subtitle, leftValue, rightValue,
  color = KPI_COLOR, actualName = 'Actual', compareName = 'This FY', compareColor = KPI_COLOR,
}: {
  data: any[]; actualKey: string; targetKey?: string; compareKey?: string
  title: string; subtitle: string
  leftValue?: string; rightValue?: string; color?: string
  actualName?: string; compareName?: string; compareColor?: string
}) {
  const allVals = data
    .flatMap(d => [d[actualKey], targetKey ? d[targetKey] : null, compareKey ? d[compareKey] : null])
    .filter((v): v is number => v != null && v > 0)
  const maxVal = allVals.length ? Math.max(...allVals) * 1.18 : 1000

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 h-full flex flex-col">
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-xs font-semibold tracking-widest text-gray-500 uppercase leading-tight">{title}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">{subtitle}</p>
        </div>
        {(leftValue || rightValue) && (
          <div className="text-right text-[10px] leading-snug ml-2 shrink-0">
            {leftValue && <p className="text-gray-400">{leftValue}</p>}
            {rightValue && <p className="text-gray-600 font-medium">{rightValue}</p>}
          </div>
        )}
      </div>
      <div className="flex-1" style={{ minHeight: 100 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: -12 }}>
            <defs>
              <linearGradient id={`kag-${actualKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
                <stop offset="95%" stopColor={color} stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke="#f0f0f0" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 9 }} axisLine={false} tickLine={false} interval={0} />
            <YAxis tickFormatter={fmtAxisPts} tick={{ fill: '#9ca3af', fontSize: 9 }} axisLine={false} tickLine={false} domain={[0, maxVal]} width={32} />
            <Tooltip content={<KpiChartTooltip />} />
            <Area type="monotone" dataKey={actualKey} name={actualName} stroke={color} fill={`url(#kag-${actualKey})`} strokeWidth={2} dot={false} connectNulls={false} />
            {compareKey && (
              <Line type="monotone" dataKey={compareKey} name={compareName} stroke={compareColor} strokeWidth={2} dot={false} connectNulls={false} />
            )}
            {targetKey && (
              <Line type="monotone" dataKey={targetKey} name="Target" stroke="#d1d5db" strokeDasharray="4 4" strokeWidth={1.5} dot={false} connectNulls />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

type ActivityKey = 'ce_visit' | 'project_visit' | 'ce_call' | 'project_call' | 'bd_visit' | 'bd_call'

const ACTIVITY_KEYS: ActivityKey[] = ['bd_visit', 'ce_visit', 'project_visit', 'bd_call', 'ce_call', 'project_call']

const ACTIVITY_LABELS: Record<ActivityKey, string> = {
  ce_visit: 'CE Visit',
  project_visit: 'Project Visit',
  ce_call: 'CE Call',
  project_call: 'Project Call / Follow-up',
  bd_visit: 'BD Visit',
  bd_call: 'BD Call',
}

const ACTIVITY_POINTS: Record<ActivityKey, number> = {
  ce_visit: 5,
  project_visit: 4,
  ce_call: 3,
  project_call: 2,
  bd_visit: 5,
  bd_call: 3,
}

// ── Gauge ─────────────────────────────────────────────────────────────────────

function describeArc(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number) {
  const rad = (d: number) => (d * Math.PI) / 180
  const x1 = cx + r * Math.cos(rad(startDeg))
  const y1 = cy + r * Math.sin(rad(startDeg))
  const x2 = cx + r * Math.cos(rad(startDeg + sweepDeg))
  const y2 = cy + r * Math.sin(rad(startDeg + sweepDeg))
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

const GAUGE_START = 145
const GAUGE_SWEEP = 250

function gaugeColor(pct: number) {
  if (pct >= 1) return '#22c55e'
  if (pct >= 0.5) return '#f59e0b'
  return '#ef4444'
}

function GaugeCard({ person }: { person: PersonData }) {
  const noTarget = !!person.noTarget
  const target = person.pointsTarget
  const pct = target > 0 ? person.points / target : 0
  const exceeded = pct > 1
  const color = noTarget ? '#3b82f6' : gaugeColor(pct)
  const cx = 80, cy = 75, r = 56
  const overflowSweep = exceeded ? Math.min(pct - 1, 1) * GAUGE_SWEEP : 0

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col items-center pt-5 pb-3 px-4">
      <p className="text-sm font-semibold text-gray-800 text-center leading-tight">{person.name}</p>
      <p className="text-xs text-gray-400 mb-2">Monthly Points</p>
      <svg viewBox="0 0 160 120" className="w-full h-auto">
        {noTarget ? (
          /* No target — just the points total in black, nothing else */
          <text x={cx} y={cy + 4} textAnchor="middle" dominantBaseline="middle" fill="#111827" fontSize="40" fontWeight="800">{person.points}</text>
        ) : (
          <>
            {/* Track */}
            <path d={describeArc(cx, cy, r, GAUGE_START, GAUGE_SWEEP)} fill="none" stroke="#f3f4f6" strokeWidth={13} strokeLinecap="round" />
            {/* Progress vs target */}
            {pct > 0.004 && (
              <path d={describeArc(cx, cy, r, GAUGE_START, exceeded ? GAUGE_SWEEP : pct * GAUGE_SWEEP)} fill="none" stroke={color} strokeWidth={13} strokeLinecap="round" />
            )}
            {overflowSweep > 1 && (
              <path d={describeArc(cx, cy, r, GAUGE_START, overflowSweep)} fill="none" stroke="#16a34a" strokeWidth={13} strokeLinecap="round" />
            )}
            <text x={cx} y={cy + 2} textAnchor="middle" dominantBaseline="middle" fill={color} fontSize="30" fontWeight="800">{person.points}</text>
            <text x={cx} y={cy + 24} textAnchor="middle" dominantBaseline="middle" fill="#9ca3af" fontSize="14">{target}</text>
          </>
        )}
      </svg>
    </div>
  )
}

// ── Leaderboard Card ──────────────────────────────────────────────────────────

interface RecentItem { date: string; contact: string | null; title: string | null; organisation?: string | null }

function pctBadge(actual: number, target: number) {
  if (target === 0) return { pct: 0, cls: 'bg-red-500 text-white' }
  const pct = Math.round((actual / target) * 100)
  const cls = pct >= 100 ? 'bg-green-500 text-white' : pct >= 50 ? 'bg-amber-500 text-white' : 'bg-red-500 text-white'
  return { pct, cls }
}

function LeaderboardCard({ activity, people, month, targetFactor = 1, from, to }: {
  activity: ActivityKey
  people: PersonData[]
  month: string
  targetFactor?: number
  from: string
  to: string
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [cache, setCache] = useState<Record<string, RecentItem[] | 'loading'>>({})

  const pts = ACTIVITY_POINTS[activity]
  const rows = people
    .map(p => ({ person: p, count: p[activity] as number, actual: (p[activity] as number) * pts, target: Math.round((p.targets[activity] ?? 0) * targetFactor) }))
    .filter(r => r.actual > 0)
    .sort((a, b) => b.actual - a.actual)

  const shortLabel = ACTIVITY_LABELS[activity].replace('Project Call / Follow-up', 'Proj. Calls').toUpperCase()

  function toggle(personId: string) {
    if (expandedId === personId) { setExpandedId(null); return }
    setExpandedId(personId)
    if (cache[personId]) return
    setCache(c => ({ ...c, [personId]: 'loading' }))
    cachedGet(`/api/hubspot/kpis/recent?ownerId=${personId}&type=${activity}&from=${from}&to=${to}`)
      .then(r => setCache(c => ({ ...c, [personId]: r.data.items })))
      .catch(() => setCache(c => ({ ...c, [personId]: [] })))
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-gray-100">
        <p className="text-sm font-semibold text-gray-800">{ACTIVITY_LABELS[activity]}</p>
        <p className="text-xs text-gray-400">{month}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6 px-4">No activity recorded</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-4 py-2 text-left text-xs font-semibold tracking-widest text-gray-400 uppercase">Employee</th>
              <th className="px-3 py-2 text-right text-xs font-semibold tracking-widest text-gray-400 uppercase">Pts</th>
              <th className="px-3 py-2 text-right text-xs font-semibold tracking-widest text-gray-400 uppercase">Target</th>
              <th className="px-3 py-2 text-right text-xs font-semibold tracking-widest text-gray-400 uppercase">{shortLabel} %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((row, i) => {
              const isOpen = expandedId === row.person.id
              const recent = cache[row.person.id]
              const { pct, cls } = pctBadge(row.actual, row.target)
              return (
                <React.Fragment key={row.person.id}>
                  <tr
                    onClick={() => toggle(row.person.id)}
                    className="hover:bg-gray-50 transition-colors cursor-pointer select-none"
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-3 shrink-0">{i + 1}</span>
                        <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0">
                          {row.person.initials}
                        </div>
                        <span className="text-gray-800 truncate">{row.person.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-gray-700">{row.actual}</td>
                    <td className="px-3 py-2.5 text-right text-gray-500">{row.person.noTarget ? '—' : row.target}</td>
                    <td className="px-3 py-2.5 text-right">
                      {row.person.noTarget ? (
                        <span className="text-xs text-gray-300">—</span>
                      ) : (
                        <span className={`inline-block min-w-[46px] text-center text-xs font-bold px-2 py-0.5 rounded ${cls}`}>
                          {pct}%
                        </span>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr key={`${row.person.id}-expanded`} className="bg-gray-50">
                      <td colSpan={4} className="px-4 py-2">
                        {recent === 'loading' ? (
                          <p className="text-xs text-gray-400 py-1">Loading...</p>
                        ) : !recent || recent.length === 0 ? (
                          <p className="text-xs text-gray-400 py-1">No recent activity found</p>
                        ) : (
                          <>
                            <p className="text-[11px] font-medium text-gray-400 mb-1">
                              {recent.length} {recent.length === 1 ? 'activity' : 'activities'} in range
                            </p>
                            <ul className="space-y-1 max-h-72 overflow-y-auto pr-1">
                              {recent.map((item, j) => (
                                <li key={j} className="flex items-center gap-2 text-xs text-gray-600">
                                  <span className="text-gray-400 shrink-0">
                                    {new Date(item.date).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                                  </span>
                                  <span className="truncate">
                                    {item.contact || item.title || '—'}
                                    {item.organisation && <span className="text-gray-400"> · {item.organisation}</span>}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function KPIDashboard() {
  const { user } = useUser()
  const isAdmin = ['admin', 'super_admin'].includes((user?.publicMetadata as any)?.role)
  const [data, setData] = useState<KpiData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [from, setFrom] = useState(DEFAULT_FROM)
  const [to, setTo] = useState(DEFAULT_TO)
  const [view, setView] = useState<KpiView>('gauges')
  const [yearMode, setYearMode] = useState<'this' | 'last'>('this')
  const [trend, setTrend] = useState<KpiTrendData | null>(null)
  const [trendLoading, setTrendLoading] = useState(true)
  const [trendError, setTrendError] = useState<string | null>(null)
  const [support, setSupport] = useState<SupportData | null>(null)
  const [supportLoading, setSupportLoading] = useState(true)
  const [supportError, setSupportError] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const rangeLabel = fmtRangeLabel(from, to)
  function setThisMonth() {
    const n = new Date()
    setFrom(fmtYMD(new Date(n.getFullYear(), n.getMonth(), 1)))
    setTo(fmtYMD(new Date(n.getFullYear(), n.getMonth() + 1, 0)))
  }
  function setLastMonth() {
    const n = new Date()
    setFrom(fmtYMD(new Date(n.getFullYear(), n.getMonth() - 1, 1)))
    setTo(fmtYMD(new Date(n.getFullYear(), n.getMonth(), 0)))
  }

  async function exportJpeg() {
    if (!contentRef.current) return
    setExporting(true)
    try {
      const canvas = await html2canvas(contentRef.current, {
        useCORS: true, scale: 2, backgroundColor: '#f5f5f5',
      })
      const link = document.createElement('a')
      const today = new Date().toISOString().split('T')[0]
      link.download = `kpis-${today}.jpg`
      link.href = canvas.toDataURL('image/jpeg', 0.92)
      link.click()
    } finally {
      setExporting(false)
    }
  }

  useEffect(() => {
    if (!data) setLoading(true) // full skeleton only on first load; date-range changes refresh in place
    setError(null)
    cachedGet('/api/hubspot/kpis', { params: { from, to } })
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false))
  }, [refreshKey, from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  // KPI trend (full FY, independent of the snapshot date range). Last FY is only
  // fetched when the compare toggle is on, mirroring the sales dashboard's prevFy gate.
  useEffect(() => {
    if (view !== 'trend') return // heavy full-FY query — only load when the Trend view is open
    setTrendLoading(true)
    setTrendError(null)
    cachedGet('/api/hubspot/kpis/monthly', { params: yearMode === 'last' ? { prevFy: 1 } : {} })
      .then(r => setTrend(r.data))
      .catch(e => setTrendError(e.response?.data?.error || e.message))
      .finally(() => setTrendLoading(false))
  }, [refreshKey, yearMode, view]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sales-support quotes for the selected range — loaded only when that view is open.
  useEffect(() => {
    if (view !== 'support') return
    setSupportLoading(true)
    setSupportError(null)
    cachedGet('/api/hubspot/sales-support', { params: { from, to } })
      .then(r => setSupport(r.data))
      .catch(e => setSupportError(e.response?.data?.error || e.message))
      .finally(() => setSupportLoading(false))
  }, [refreshKey, view, from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  // In This-FY mode: filled Area = this year, dashed Target line. In Last-FY mode: the
  // Area becomes last year (grey) and this year overlays as a solid Line. (Same as sales.)
  const kpiYearProps = (base: string, prev: string, target: string) =>
    yearMode === 'last'
      ? { actualKey: prev, actualName: 'Last FY', color: '#94a3b8', compareKey: base, compareName: 'This FY', compareColor: KPI_COLOR }
      : { actualKey: base, targetKey: target, color: KPI_COLOR }
  const trendRows = (trend?.fyMonths ?? []).map(m => ({
    ...m,
    prevKpiPoints: m.prevKpiPoints ?? null,
    prevCumulativeKpiPoints: m.prevCumulativeKpiPoints ?? null,
  }))
  const lastCur = [...(trend?.fyMonths ?? [])].reverse().find(m => m.isCurrentOrPast)

  if (error) return (
    <div className="flex items-center justify-center py-20 text-red-500 text-sm">
      Failed to load KPI data: {error}
    </div>
  )

  return (
    <>
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">KPIs</h1>
          <p className="text-sm text-gray-400">{rangeLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-3 py-1.5 shadow-sm">
          <input type="date" value={from} min={HISTORY_MIN} max={FY_MAX} onChange={e => setFrom(e.target.value)} className="text-sm text-gray-700 bg-transparent outline-none" aria-label="From date" />
          <span className="text-gray-400 text-sm">→</span>
          <input type="date" value={to} min={HISTORY_MIN} max={FY_MAX} onChange={e => setTo(e.target.value)} className="text-sm text-gray-700 bg-transparent outline-none" aria-label="To date" />
        </div>
        <button onClick={setThisMonth} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">This month</button>
        <button onClick={setLastMonth} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">Last month</button>
        {isAdmin && (
          <button
            onClick={() => setEditOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit Targets
          </button>
        )}
        <button
          onClick={exportJpeg}
          disabled={exporting || loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-800 text-white text-sm font-medium hover:bg-gray-700 disabled:opacity-50 transition-colors"
        >
          {exporting ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
            </svg>
          )}
          {exporting ? 'Exporting…' : 'Export JPEG'}
        </button>
        </div>{/* end button group */}
      </div>

      {/* View switcher — one section at a time (same pattern as Sales Breakdown) */}
      <div className="inline-flex flex-wrap rounded-lg border border-gray-200 bg-white p-0.5">
        {KPI_VIEWS.map(([v, label]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${view === v ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div ref={contentRef} className="space-y-6">
      {loading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 shadow-sm h-52 animate-pulse" />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 shadow-sm h-44 animate-pulse" />
            ))}
          </div>
        </div>
      ) : data && (
        <div className="space-y-6">
          {/* Monthly points gauges — every visible member (show/hide + order set in admin panel) */}
          {view === 'gauges' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {data.people.filter((p: any) => !p.hidden).map(person => (
              <GaugeCard key={person.id || person.name} person={person} />
            ))}
          </div>
          )}

          {/* Activity leaderboards — full width, responsive columns */}
          {view === 'tables' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {ACTIVITY_KEYS.map(key => (
              <LeaderboardCard key={key} activity={key} people={data.people} month={data.month} targetFactor={data.targetFactor ?? 1} from={from} to={to} />
            ))}
          </div>
          )}

          {/* Sales Support — quotes done + average value, per support member */}
          {view === 'support' && (
            supportError ? (
              <div className="text-sm text-red-500 bg-white rounded-xl border border-gray-200 shadow-sm p-4">Couldn't load sales support: {supportError}</div>
            ) : supportLoading && !support ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {Array.from({ length: 3 }).map((_, i) => <div key={i} className="bg-white rounded-xl border border-gray-200 shadow-sm h-28 animate-pulse" />)}
              </div>
            ) : support && support.people.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
                <p className="text-sm font-medium text-gray-700">No sales-support team members yet</p>
                <p className="text-xs text-gray-400 mt-1 max-w-md mx-auto">Tick “support” next to a person in Edit Targets → KPI Team to include their quotes here.</p>
              </div>
            ) : support && (
              <div className="space-y-4">
                {/* Team totals */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                    <p className="text-xs text-gray-400 mb-1">Quotes done</p>
                    <p className="text-2xl font-bold text-gray-900">{fmtPts(support.totals.quotes)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">team total · {rangeLabel}</p>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                    <p className="text-xs text-gray-400 mb-1">Average quote value</p>
                    <p className="text-2xl font-bold text-gray-900">{fmtMoney(support.totals.avgValue)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">across quotes with a linked deal</p>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                    <p className="text-xs text-gray-400 mb-1">Total quoted value</p>
                    <p className="text-2xl font-bold text-gray-900">{fmtMoney(support.totals.totalValue)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">sum of linked deal values</p>
                  </div>
                </div>
                {/* Per-person */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {support.people.map(p => (
                    <div key={p.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-600 text-xs font-semibold flex items-center justify-center shrink-0">{p.initials}</div>
                        <p className="text-sm font-semibold text-gray-900 truncate">{p.name}</p>
                      </div>
                      <div className="flex items-end justify-between">
                        <div>
                          <p className="text-2xl font-bold text-gray-900 leading-none">{fmtPts(p.quotes)}</p>
                          <p className="text-xs text-gray-400 mt-1">quotes</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-semibold text-gray-700 leading-none">{fmtMoney(p.avgValue)}</p>
                          <p className="text-xs text-gray-400 mt-1">avg value</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}

          {/* KPI trend — points by month + accumulated across the FY, with this/last-FY overlay */}
          {view === 'trend' && (
          <div>
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <div>
                <h2 className="text-base font-bold text-gray-900">KPI trend</h2>
                <p className="text-xs text-gray-400">Team KPI points across the financial year{trend?.fyLabel ? ` · ${trend.fyLabel}` : ''}</p>
              </div>
              <button
                onClick={() => setYearMode(m => m === 'this' ? 'last' : 'this')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${yearMode === 'last' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {yearMode === 'last' ? 'Comparing last FY' : 'Compare last FY'}
              </button>
            </div>
            {trendError ? (
              <div className="text-sm text-red-500 bg-white rounded-xl border border-gray-200 shadow-sm p-4">Couldn't load KPI trend: {trendError}</div>
            ) : trendLoading && !trend ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm h-64 md:h-56 animate-pulse" />
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm h-64 md:h-56 animate-pulse" />
              </div>
            ) : trend && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="h-64 md:h-56">
                  <KpiTrendChart data={trendRows} {...kpiYearProps('kpiPoints', 'prevKpiPoints', 'kpiPointsTarget')}
                    title="Monthly KPI Points" subtitle={trend.fyLabel}
                    leftValue={lastCur ? `This mo ${fmtPts(lastCur.kpiPoints ?? 0)}` : undefined}
                    rightValue={lastCur ? `Target ${fmtPts(lastCur.kpiPointsTarget)}` : undefined} />
                </div>
                <div className="h-64 md:h-56">
                  <KpiTrendChart data={trendRows} {...kpiYearProps('cumulativeKpiPoints', 'prevCumulativeKpiPoints', 'cumulativeKpiTarget')}
                    title="KPI Points — Accumulated" subtitle={trend.fyLabel}
                    leftValue={lastCur ? fmtPts(lastCur.cumulativeKpiPoints ?? 0) : undefined}
                    rightValue={lastCur ? fmtPts(lastCur.cumulativeKpiTarget) : undefined} />
                </div>
              </div>
            )}
          </div>
          )}
        </div>
      )}
      </div>{/* end contentRef */}
    </div>

    {editOpen && (
      <TargetsPanel
        onClose={() => setEditOpen(false)}
        onSaved={() => setRefreshKey(k => k + 1)}
      />
    )}
    </>
  )
}
