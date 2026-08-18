import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { cachedGet } from '../lib/apiCache'
import html2canvas from 'html2canvas'
import { useUser } from '../lib/fakeAuth'
import TargetsPanel from '../components/TargetsPanel'
import {
  ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, ResponsiveContainer, Tooltip,
  BarChart, Bar,
} from 'recharts'

// ── Types ─────────────────────────────────────────────────────────────────────

interface FyMonth {
  label: string
  newDeals: number
  wonDeals: number
  newDealsTarget: number
  wonDealsTarget: number
  cumulativeNewDeals: number
  cumulativeWon: number
  cumulativeNewDealsTarget: number
  cumulativeWonTarget: number
  isCurrentOrPast: boolean
  // Prior FY (complete year — all 12 months carry real figures). Powers the Last FY overlay.
  prevNewDeals?: number
  prevWonDeals?: number
  prevCumulativeNewDeals?: number
  prevCumulativeWon?: number
}

interface Metric { actual: number; target: number }

interface InvoicedMonth {
  label: string
  actual: number
  target: number
  completed: number
  scheduled: number
  source: 'completed' | 'current' | 'scheduled'
  isPast: boolean
  isCurrent: boolean
  isFuture: boolean
}
interface InvoicedFy {
  fyLabel: string
  currentLabel: string
  byMonth: InvoicedMonth[]
  ytd: { actual: number; target: number }
}

interface TrackingData {
  fyLabel: string
  currentMonth: string
  fyMonths: FyMonth[]
  // Weekly equivalents (Mon–Sun buckets) for the Week view toggle — same shape as fyMonths
  fyWeeks?: FyMonth[]
  auFyWeeks?: FyMonth[]
  monthlyNewDeals: Metric & { fullMonthTarget: number; prevMonth: number }
  monthlySales:    Metric & { fullMonthTarget: number; prevMonth: number }
  monthlyKpiPoints: Metric & { fullMonthTarget: number }
  dailyNewDeals:   Metric
  dailySales:      Metric
  dailyKpiPoints:  Metric
  monthlySalesTable: { name: string; total: number }[]
  newDealsAccumulated: { actual: number; annualised: number; target: number }
  yearlySales: { actual: number; prevMonth: number; target: number }
  range?: { from: string; to: string; isFullMonth: boolean }
  // Pipeline breakdown
  pipelineNz: Metric
  pipelineAu: Metric
  pipelineOverall: Metric
  // AU mirror (all AUD)
  auFyMonths: FyMonth[]
  auMonthlyNewDeals: Metric & { fullMonthTarget: number; prevMonth: number }
  auMonthlySales:    Metric & { fullMonthTarget: number; prevMonth: number }
  auDailyNewDeals:   Metric
  auDailySales:      Metric
  auSalesTable: { name: string; total: number }[]
  auNewDealsAccumulated: { actual: number; target: number }
  auYearlySales: { actual: number; target: number }
}

// ── Date range helpers ──────────────────────────────────────────────────────────

const fmtYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const _now = new Date()
const _fyStartYear = _now.getMonth() < 3 ? _now.getFullYear() - 1 : _now.getFullYear()
// Allow going back in time (e.g. 2015); upper bound is the end of the current FY
const HISTORY_MIN = '2010-01-01'
const FY_MAX = `${_fyStartYear + 1}-03-31`
const DEFAULT_FROM = fmtYMD(new Date(_now.getFullYear(), _now.getMonth(), 1))
const DEFAULT_TO   = fmtYMD(new Date(_now.getFullYear(), _now.getMonth() + 1, 0))

const isFullCalendarMonth = (from: string, to: string) => {
  const f = new Date(from + 'T00:00:00'), t = new Date(to + 'T00:00:00')
  const lastDay = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()
  return f.getDate() === 1 && t.getDate() === lastDay &&
    f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear()
}

const fmtRangeLabel = (from: string, to: string) => {
  const opt: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  const f = new Date(from + 'T00:00:00').toLocaleDateString('en-NZ', opt)
  const t = new Date(to + 'T00:00:00').toLocaleDateString('en-NZ', opt)
  return `${f} – ${t}`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtDollar = (v: number) => `$${Math.round(v).toLocaleString('en-NZ')}`
const fmtAUD    = (v: number) => `A$${Math.round(v).toLocaleString('en-NZ')}`
const fmtNum    = (v: number) => Math.round(v).toLocaleString('en-NZ')
const fmtAxisM  = (v: number) => v === 0 ? '$0' : `$${(v / 1e6).toFixed(0)}M`

function describeArc(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number) {
  const rad = (d: number) => d * Math.PI / 180
  const x1 = cx + r * Math.cos(rad(startDeg))
  const y1 = cy + r * Math.sin(rad(startDeg))
  const x2 = cx + r * Math.cos(rad(startDeg + sweepDeg))
  const y2 = cy + r * Math.sin(rad(startDeg + sweepDeg))
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

const G_START = 143
const G_SWEEP = 254

// ── Card ──────────────────────────────────────────────────────────────────────

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col ${className}`}>
      {children}
    </div>
  )
}

function CardHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-3">
      <p className="text-xs font-semibold tracking-widest text-gray-500 uppercase">{title}</p>
      <p className="text-[10px] text-gray-400 mt-0.5">{subtitle}</p>
    </div>
  )
}

// ── Invoiced Sales vs Target (financial-year bar chart) ───────────────────────
// Mirrors the Leadership dashboard's scheduled-invoiced bars, but across the full
// FY: green when a month's invoiced $ meets/beats its target, red while under,
// with a dashed target line struck across each bar. Future (scheduled-only) bars
// are drawn a touch lighter to read as projections rather than banked figures.
const INVOICED_GREEN = '#22c55e'
const INVOICED_RED = '#ef4444'
const shortMonth = (label: string) => label.split(' ')[0].slice(0, 3)
const fmtMoneyShort = (v: number) => v === 0 ? '$0' : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}k`

function InvoicedBar(props: any) {
  const { x, y, width, height, payload } = props
  const actual = payload?.actual ?? 0
  const target = payload?.target ?? 0
  const fill = actual >= target ? INVOICED_GREEN : INVOICED_RED
  // Bar height encodes actual $ on a 0-based axis, so pixels-per-dollar = height/actual
  // places the target line without needing the axis scale. Skipped when actual is 0.
  const targetY = (actual > 0 && target > 0) ? (y + height) - target * (height / actual) : null
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={3} fill={fill} opacity={payload?.isFuture ? 0.5 : 1} />
      {targetY != null && (
        <line x1={x - 3} x2={x + width + 3} y1={targetY} y2={targetY} stroke="#1f2937" strokeWidth={2} strokeDasharray="4 2" />
      )}
    </g>
  )
}

function InvoicedTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload as InvoicedMonth
  const met = d.actual >= d.target
  const kind = d.isFuture ? 'Scheduled' : d.isCurrent ? 'Invoiced (so far)' : 'Invoiced'
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm px-3 py-2 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{d.label}</p>
      <p style={{ color: met ? INVOICED_GREEN : INVOICED_RED }}>{kind}: {fmtDollar(d.actual)}</p>
      {d.isCurrent && (d.completed > 0 || d.scheduled > 0) && (
        <p className="text-gray-400">Completed {fmtDollar(d.completed)} · To-invoice {fmtDollar(d.scheduled)}</p>
      )}
      <p className="text-gray-500">Target: {fmtDollar(d.target)}</p>
    </div>
  )
}

function InvoicedFyChart({ fy }: { fy: InvoicedFy }) {
  const data = fy.byMonth.map(m => ({ ...m, name: shortMonth(m.label) }))
  const maxVal = Math.max(...data.map(d => Math.max(d.actual, d.target)), 0)
  const domainMax = maxVal > 0 ? Math.ceil(maxVal * 1.15) : 1
  return (
    <Card className="h-full">
      <CardHeader title="Invoiced Sales vs Target" subtitle={`${fy.fyLabel} · completed + scheduled · dashed line = target`} />
      <div className="flex-1 w-full min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap="18%">
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9ca3af' }} interval={0} />
            <YAxis domain={[0, domainMax]} tickFormatter={fmtMoneyShort} tick={{ fontSize: 11, fill: '#9ca3af' }} width={48} />
            <Tooltip content={<InvoicedTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
            <Bar dataKey="actual" shape={<InvoicedBar />} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

// ── Gauge colour ──────────────────────────────────────────────────────────────

function gaugeColor(pct: number) {
  if (pct >= 1)    return '#22c55e' // bright green — at/over target
  if (pct >= 0.75) return '#f59e0b' // amber — getting close
  return '#ef4444'                  // red — far behind
}

// ── Gauge ─────────────────────────────────────────────────────────────────────

function Gauge({
  actual, target, uid, format = fmtDollar,
}: {
  actual: number; target: number; uid: string
  format?: (v: number) => string
}) {
  const pct      = target > 0 ? actual / target : 0
  const exceeded = pct > 1
  const filled   = Math.min(pct, 1)
  const overflow = exceeded ? Math.min(pct - 1, 1) * G_SWEEP : 0
  const color    = gaugeColor(pct)
  const cx = 100, cy = 92, r = 68
  const valStr = format(actual)
  const tgtStr = format(target)
  const valSize = valStr.length > 10 ? 16 : valStr.length > 7 ? 20 : 26

  return (
    <div className="flex items-center justify-center flex-1 min-h-0">
      <svg viewBox="0 0 200 170" className="w-full h-full" style={{ maxHeight: 200 }}>
        {/* Track */}
        <path d={describeArc(cx, cy, r, G_START, G_SWEEP)} fill="none" stroke="#e5e7eb" strokeWidth={14} strokeLinecap="round" />
        {/* Progress arc */}
        {filled > 0.008 && (
          <path d={describeArc(cx, cy, r, G_START, exceeded ? G_SWEEP : filled * G_SWEEP)} fill="none" stroke={color} strokeWidth={14} strokeLinecap="round" />
        )}
        {/* Overflow arc — darker green second lap */}
        {overflow > 1 && (
          <path d={describeArc(cx, cy, r, G_START, overflow)} fill="none" stroke="#16a34a" strokeWidth={14} strokeLinecap="round" />
        )}
        <text x={cx} y={cy - 14} textAnchor="middle" dominantBaseline="middle" fill={color} fontSize={valSize} fontWeight="800">
          {valStr}
        </text>
        <text x={cx} y={cy + 11} textAnchor="middle" dominantBaseline="middle" fill="#9ca3af" fontSize={15}>
          {tgtStr}
        </text>
        {target > 0 && (
          <text x={cx} y={cy + 36} textAnchor="middle" dominantBaseline="middle" fill={color} fontSize={16} fontWeight="700">
            {Math.round(pct * 100)}%
          </text>
        )}
      </svg>
    </div>
  )
}

function MiniGauge({
  actual, target, uid, format = fmtDollar,
}: {
  actual: number; target: number; uid: string
  format?: (v: number) => string
}) {
  const pct      = target > 0 ? actual / target : 0
  const exceeded = pct > 1
  const filled   = Math.min(pct, 1)
  const overflow = exceeded ? Math.min(pct - 1, 1) * G_SWEEP : 0
  const color    = gaugeColor(pct)
  const cx = 60, cy = 56, r = 42
  const valStr = format(actual)
  const valSize = valStr.length > 8 ? 11 : 13

  return (
    <div className="flex items-center justify-center">
      <svg viewBox="0 0 120 105" className="w-full" style={{ maxHeight: 85 }}>
        <path d={describeArc(cx, cy, r, G_START, G_SWEEP)} fill="none" stroke="#e5e7eb" strokeWidth={9} strokeLinecap="round" />
        {filled > 0.008 && (
          <path d={describeArc(cx, cy, r, G_START, exceeded ? G_SWEEP : filled * G_SWEEP)} fill="none" stroke={color} strokeWidth={9} strokeLinecap="round" />
        )}
        {overflow > 1 && (
          <path d={describeArc(cx, cy, r, G_START, overflow)} fill="none" stroke="#16a34a" strokeWidth={9} strokeLinecap="round" />
        )}
        <text x={cx} y={cy - 9} textAnchor="middle" dominantBaseline="middle" fill={color} fontSize={valSize} fontWeight="700">
          {valStr}
        </text>
        <text x={cx} y={cy + 6} textAnchor="middle" dominantBaseline="middle" fill="#9ca3af" fontSize={10}>
          {format(target)}
        </text>
        {target > 0 && (
          <text x={cx} y={cy + 21} textAnchor="middle" dominantBaseline="middle" fill={color} fontSize={11} fontWeight="700">
            {Math.round(pct * 100)}%
          </text>
        )}
      </svg>
    </div>
  )
}

// ── Chart ─────────────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-gray-500 mb-1">{label}</p>
      {payload.map((p: any, i: number) =>
        p.value != null ? (
          <p key={i} style={{ color: p.color }}>{p.name}: {fmtDollar(p.value)}</p>
        ) : null
      )}
    </div>
  )
}

function TrendChart({
  data, actualKey, targetKey, compareKey, title, subtitle, leftValue, rightValue,
  color = '#EBA117', actualName = 'Actual', compareName = 'This FY', compareColor = '#EBA117',
  xInterval = 1,
}: {
  data: any[]; actualKey: string; targetKey?: string; compareKey?: string
  title: string; subtitle: string
  leftValue?: string; rightValue?: string; color?: string
  actualName?: string; compareName?: string; compareColor?: string
  xInterval?: number
}) {
  const allVals = data
    .flatMap(d => [d[actualKey], targetKey ? d[targetKey] : null, compareKey ? d[compareKey] : null])
    .filter((v): v is number => v != null && v > 0)
  const maxVal = allVals.length ? Math.max(...allVals) * 1.18 : 5000000

  return (
    <Card className="h-full">
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
              <linearGradient id={`ag-${actualKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
                <stop offset="95%" stopColor={color} stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke="#f0f0f0" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 9 }} axisLine={false} tickLine={false} interval={xInterval} />
            <YAxis tickFormatter={fmtAxisM} tick={{ fill: '#9ca3af', fontSize: 9 }} axisLine={false} tickLine={false} domain={[0, maxVal]} width={32} />
            <Tooltip content={<ChartTooltip />} />
            <Area type="monotone" dataKey={actualKey} name={actualName} stroke={color} fill={`url(#ag-${actualKey})`} strokeWidth={2} dot={false} connectNulls={false} />
            {compareKey && (
              <Line type="monotone" dataKey={compareKey} name={compareName} stroke={compareColor} strokeWidth={2} dot={false} connectNulls={false} />
            )}
            {targetKey && (
              <Line type="monotone" dataKey={targetKey} name="Target" stroke="#d1d5db" strokeDasharray="4 4" strokeWidth={1.5} dot={false} connectNulls />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function SalesTracking({ snapshot = false }: { snapshot?: boolean }) {
  const { user } = useUser()
  const isAdmin = !snapshot && ['admin', 'super_admin'].includes((user?.publicMetadata as any)?.role)
  const [data, setData]       = useState<TrackingData | null>(null)
  const [invoicedFy, setInvoicedFy] = useState<InvoicedFy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [from, setFrom] = useState(DEFAULT_FROM)
  const [to, setTo] = useState(DEFAULT_TO)
  const [speedoMarket, setSpeedoMarket] = useState<'NZ' | 'AU'>('NZ')
  const [yearMode, setYearMode] = useState<'this' | 'last'>('this')
  const [granularity, setGranularity] = useState<'month' | 'week'>('month')
  const contentRef = useRef<HTMLDivElement>(null)

  const rangeLabel = fmtRangeLabel(from, to)
  const fullMonth = isFullCalendarMonth(from, to)

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
      link.download = `sales-dashboard-${today}.jpg`
      link.href = canvas.toDataURL('image/jpeg', 0.92)
      link.click()
    } finally {
      setExporting(false)
    }
  }

  useEffect(() => {
    if (!data) setLoading(true) // full skeleton only on first load; date-range changes refresh in place
    setError(null)
    let cancelled = false
    // prevFy=1 pulls prior-FY figures for the Last FY overlay — requested only while
    // that view is active so normal loads stay light on HubSpot's rate limit.
    const params = { from, to, ...(yearMode === 'last' ? { prevFy: 1 } : {}) }
    ;(async () => {
      // Retry transient failures (a HubSpot blip or cold-load burst) a couple of times
      // before surfacing an error, so the dashboard self-heals without a manual refresh.
      for (let attempt = 0; ; attempt++) {
        try {
          const r = await cachedGet('/api/sales/tracking', { params })
          if (!cancelled) setData(r.data)
          break
        } catch (e: any) {
          if (attempt >= 2) { if (!cancelled) setError(e.response?.data?.error || e.message); break }
          await new Promise(res => setTimeout(res, 800 * (attempt + 1)))
        }
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [refreshKey, from, to, yearMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Invoiced Sales vs Target is financial-year-wide (not tied to the date range),
  // so it's fetched on its own. A failure just hides the row rather than erroring
  // the whole dashboard.
  useEffect(() => {
    let cancelled = false
    cachedGet('/api/sales/invoiced-fy')
      .then(r => { if (!cancelled) setInvoicedFy(r.data) })
      .catch(() => { if (!cancelled) setInvoicedFy(null) })
    return () => { cancelled = true }
  }, [refreshKey])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-gray-400 text-sm animate-pulse">Loading sales tracking…</p>
    </div>
  )

  if (error) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-red-500 text-sm">Error: {error}</p>
    </div>
  )

  if (!data) return null

  const mkChartData = (months: FyMonth[]) => months.map(m => ({
    label:                    m.label,
    newDeals:                 m.isCurrentOrPast ? m.newDeals    : null,
    wonDeals:                 m.isCurrentOrPast ? m.wonDeals    : null,
    newDealsTarget:           m.newDealsTarget,
    wonDealsTarget:           m.wonDealsTarget,
    cumulativeNewDeals:       m.isCurrentOrPast ? m.cumulativeNewDeals : null,
    cumulativeWon:            m.isCurrentOrPast ? m.cumulativeWon      : null,
    cumulativeNewDealsTarget: m.cumulativeNewDealsTarget,
    cumulativeWonTarget:      m.cumulativeWonTarget,
    // Prior FY — complete year, so every month carries a real value (no null gating).
    prevNewDeals:             m.prevNewDeals ?? null,
    prevWonDeals:             m.prevWonDeals ?? null,
    prevCumulativeNewDeals:   m.prevCumulativeNewDeals ?? null,
    prevCumulativeWon:        m.prevCumulativeWon ?? null,
  }))
  // Month vs Week view — weekly re-buckets come from the same response (no extra fetch).
  const isWeek = granularity === 'week'
  const chartData   = mkChartData(isWeek ? (data.fyWeeks   ?? data.fyMonths)   : data.fyMonths)
  const auChartData = mkChartData(isWeek ? (data.auFyWeeks ?? data.auFyMonths) : data.auFyMonths)
  // Weekly axes have ~52 points — thin the labels to ~8–9 so the small cards stay readable.
  const xInt = isWeek ? Math.max(1, Math.ceil(chartData.length / 9)) : 1
  const per = isWeek ? 'Weekly' : 'Monthly'

  // This FY / Last FY toggle. In "last" mode each chart fills last FY's actuals (grey)
  // and traces this FY over it for comparison, dropping the target line. `base`/`prev`
  // are the current-FY and prior-FY data keys; `target` is the current-FY target key.
  const yearProps = (base: string, prev: string, target: string, color: string) =>
    yearMode === 'last'
      ? { actualKey: prev, actualName: 'Last FY', color: '#94a3b8',
          compareKey: base, compareName: 'This FY', compareColor: color }
      : { actualKey: base, targetKey: target, color }

  // Speedos + Sales-by-Rep follow the NZ/AU toggle (KPI stays NZ = combined)
  const spNZ    = speedoMarket === 'NZ'
  const spFmt   = spNZ ? fmtDollar : fmtAUD
  const spCur   = spNZ ? 'NZD' : 'AUD'
  const spDailyND = spNZ ? data.dailyNewDeals : data.auDailyNewDeals
  const spDailyS  = spNZ ? data.dailySales    : data.auDailySales
  const spSales   = spNZ ? data.monthlySales  : data.auMonthlySales
  const spNewDeals = spNZ ? data.monthlyNewDeals : data.auMonthlyNewDeals
  const spTable   = spNZ ? data.monthlySalesTable : data.auSalesTable

  return (
    <>
    <div className="space-y-3">

      {/* Toolbar */}
      {!snapshot && (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Charts year toggle — flips all monthly + annualised trend charts between
              this FY and last FY (last FY overlays this FY for comparison) */}
          <div className="flex items-center gap-1.5 pl-1">
            <span className="text-[10px] uppercase tracking-wide text-gray-400">Charts</span>
            <div className="flex rounded-lg overflow-hidden border border-gray-200">
              {([['this', 'This FY'], ['last', 'Last FY']] as const).map(([m, lbl]) => (
                <button key={m} onClick={() => setYearMode(m)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${yearMode === m ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                  {lbl}
                </button>
              ))}
            </div>
            {/* Month vs Week bucketing for the same charts */}
            <div className="flex rounded-lg overflow-hidden border border-gray-200">
              {([['month', 'Month'], ['week', 'Week']] as const).map(([g, lbl]) => (
                <button key={g} onClick={() => setGranularity(g)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${granularity === g ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Date range — right-aligned to match the KPIs / Sales Breakdown tabs */}
          <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-3 py-1.5 shadow-sm">
            <input
              type="date" value={from} min={HISTORY_MIN} max={FY_MAX}
              onChange={e => setFrom(e.target.value)}
              className="text-sm text-gray-700 bg-transparent outline-none"
              aria-label="From date"
            />
            <span className="text-gray-400 text-sm">→</span>
            <input
              type="date" value={to} min={HISTORY_MIN} max={FY_MAX}
              onChange={e => setTo(e.target.value)}
              className="text-sm text-gray-700 bg-transparent outline-none"
              aria-label="To date"
            />
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
            Edit
          </button>
        )}
        <button
          onClick={exportJpeg}
          disabled={exporting}
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
        </div>
      </div>
      )}

      <div
        ref={contentRef}
        className="space-y-3"
        {...(snapshot ? { 'data-snapshot-root': 'true', 'data-snapshot-ready': 'true' } : {})}
      >

      {/* ── Charts (individual NZ + AU) on the left · Sales by Rep + Overall Pipeline on the right ── */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">

        {/* LEFT: NZ charts, speedos (middle), AU charts, pipeline gauges */}
        <div className="lg:col-span-3 space-y-3">

          {/* NZ monthly graphs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="h-64 md:h-56">
              <TrendChart data={chartData} {...yearProps('newDeals', 'prevNewDeals', 'newDealsTarget', '#EBA117')} xInterval={xInt}
                title={`NZ ${per} New Deals`} subtitle={data.fyLabel}
                leftValue={`Last ${fmtDollar(data.monthlyNewDeals.prevMonth)}`}
                rightValue={fmtNum(data.monthlyNewDeals.fullMonthTarget)} />
            </div>
            <div className="h-64 md:h-56">
              <TrendChart data={chartData} {...yearProps('wonDeals', 'prevWonDeals', 'wonDealsTarget', '#526147')} xInterval={xInt}
                title={`NZ ${per} Sales`} subtitle={data.fyLabel}
                leftValue={`Last ${fmtDollar(data.monthlySales.prevMonth)}`}
                rightValue={fmtNum(data.monthlySales.fullMonthTarget)} />
            </div>
          </div>

          {/* AU monthly graphs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="h-64 md:h-56">
              <TrendChart data={auChartData} {...yearProps('newDeals', 'prevNewDeals', 'newDealsTarget', '#EBA117')} xInterval={xInt}
                title={`AU ${per} New Deals (AUD)`} subtitle={data.fyLabel}
                leftValue={`Last ${fmtAUD(data.auMonthlyNewDeals.prevMonth)}`}
                rightValue={fmtNum(data.auMonthlyNewDeals.fullMonthTarget)} />
            </div>
            <div className="h-64 md:h-56">
              <TrendChart data={auChartData} {...yearProps('wonDeals', 'prevWonDeals', 'wonDealsTarget', '#526147')} xInterval={xInt}
                title={`AU ${per} Sales (AUD)`} subtitle={data.fyLabel}
                leftValue={`Last ${fmtAUD(data.auMonthlySales.prevMonth)}`}
                rightValue={fmtNum(data.auMonthlySales.fullMonthTarget)} />
            </div>
          </div>

          {/* Invoiced Sales vs Target (FY) — spans the full left column, so its right
              edge lines up with the AU Sales chart above. The YTD dial lives in the
              sidebar to the right (below Sales by Salesperson). */}
          {invoicedFy && (
            <div className="h-64 md:h-56">
              <InvoicedFyChart fy={invoicedFy} />
            </div>
          )}

        </div>{/* end Section A left */}

        {/* Section A sidebar: Sales by Rep (fills the NZ+AU rows) with the Invoiced
            Sales YTD dial beneath it, aligned to the invoiced chart's row. */}
        <div className="lg:col-span-1 flex flex-col gap-3 min-h-0">
          <Card className="flex-1 min-h-0 overflow-hidden">
            <CardHeader title="Sales by Salesperson" subtitle={`${rangeLabel} · ${spCur}`} />
            <div className="flex justify-between text-[9px] text-gray-400 uppercase tracking-wide px-1 mb-1">
              <span>Employee</span><span>Total</span>
            </div>
            <div className="overflow-y-auto flex-1 space-y-px">
              {spTable.length === 0 && <p className="text-xs text-gray-400 text-center py-4">No sales in period</p>}
              {spTable.slice(0, 20).map((row, i) => (
                <div key={row.name} className="flex items-center justify-between px-1 py-0.5 rounded hover:bg-gray-50">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-gray-400 text-[10px] w-4 shrink-0">{i + 1}</span>
                    <span className="text-gray-700 text-[10px] truncate">{row.name}</span>
                  </div>
                  <span className="text-gray-900 text-[10px] font-semibold shrink-0 ml-1">{spFmt(row.total)}</span>
                </div>
              ))}
            </div>
          </Card>
          {/* Invoiced Sales YTD dial — aligned with the invoiced chart row; its right
              edge lines up with the Sales by Salesperson card above. */}
          {invoicedFy && (
            <div className="h-64 md:h-56 shrink-0">
              <Card className="h-full">
                <CardHeader title="Invoiced Sales YTD" subtitle="vs cumulative target to date" />
                <Gauge actual={invoicedFy.ytd.actual} target={invoicedFy.ytd.target} uid="inv-ytd" format={fmtDollar} />
              </Card>
            </div>
          )}
        </div>

      </div>{/* end Section A grid */}

      {/* ── Speedos — full width (left edge to right edge), NZ | AU toggle ── */}
      <Card>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold tracking-widest text-gray-500 uppercase">Speedos · {spCur}</p>
          <div className="flex rounded-lg overflow-hidden border border-gray-200">
            {(['NZ', 'AU'] as const).map(m => (
              <button key={m} onClick={() => setSpeedoMarket(m)}
                className={`px-3 py-1 text-xs font-semibold transition-colors ${speedoMarket === m ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-12 gap-3">
          <div className="col-span-2 md:col-span-2 flex flex-col gap-3">
            <Card className="flex-1">
              <CardHeader title="Daily New Deals" subtitle={`${fullMonth ? 'Today' : 'Full month only'} · ${spCur}`} />
              <MiniGauge actual={spDailyND.actual} target={spDailyND.target} uid="dnd" format={spFmt} />
            </Card>
            <Card className="flex-1">
              <CardHeader title="Daily Sales" subtitle={`${fullMonth ? 'Today' : 'Full month only'} · ${spCur}`} />
              <MiniGauge actual={spDailyS.actual} target={spDailyS.target} uid="ds" format={spFmt} />
            </Card>
          </div>
          <div className="md:col-span-2">
            <Card className="h-full">
              <CardHeader title="Sales" subtitle={`${rangeLabel} · ${spCur}`} />
              <Gauge actual={spSales.actual} target={spSales.target} uid="ms" format={spFmt} />
            </Card>
          </div>
          <div className="md:col-span-2">
            <Card className="h-full">
              <CardHeader title="New Deals" subtitle={`${rangeLabel} · ${spCur}`} />
              <Gauge actual={spNewDeals.actual} target={spNewDeals.target} uid="mnd" format={spFmt} />
            </Card>
          </div>
          <div className="md:col-span-3">
            <Card className="h-full">
              <CardHeader title="KPI's — Points" subtitle={rangeLabel} />
              <Gauge actual={data.monthlyKpiPoints.actual} target={data.monthlyKpiPoints.target} uid="mkpi" format={fmtNum} />
            </Card>
          </div>
          <div className="md:col-span-3">
            <Card className="h-full">
              <CardHeader title="Daily KPI's — Points" subtitle={fullMonth ? 'Today' : 'Full month only'} />
              <Gauge actual={data.dailyKpiPoints.actual} target={data.dailyKpiPoints.target} uid="dkpi" format={fmtNum} />
            </Card>
          </div>
        </div>
      </Card>

      {/* ── Section B: accumulated graphs + pipeline gauges · Overall Pipeline (top-aligned) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        <div className="lg:col-span-3 space-y-3">

          {/* NZ accumulated graphs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="h-64 md:h-56">
              <TrendChart data={chartData} {...yearProps('cumulativeNewDeals', 'prevCumulativeNewDeals', 'cumulativeNewDealsTarget', '#EBA117')} xInterval={xInt}
                title="NZ New Deals — Accumulated" subtitle={data.fyLabel}
                leftValue={fmtDollar(data.newDealsAccumulated.actual)} rightValue={fmtNum(data.newDealsAccumulated.target)} />
            </div>
            <div className="h-64 md:h-56">
              <TrendChart data={chartData} {...yearProps('cumulativeWon', 'prevCumulativeWon', 'cumulativeWonTarget', '#526147')} xInterval={xInt}
                title="NZ Yearly Sales Accumulated" subtitle={data.fyLabel}
                leftValue={fmtDollar(data.yearlySales.actual)} rightValue={fmtNum(data.yearlySales.target)} />
            </div>
          </div>

          {/* AU accumulated graphs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="h-64 md:h-56">
              <TrendChart data={auChartData} {...yearProps('cumulativeNewDeals', 'prevCumulativeNewDeals', 'cumulativeNewDealsTarget', '#EBA117')} xInterval={xInt}
                title="AU New Deals — Accumulated (AUD)" subtitle={data.fyLabel}
                leftValue={fmtAUD(data.auNewDealsAccumulated.actual)} rightValue={fmtNum(data.auNewDealsAccumulated.target)} />
            </div>
            <div className="h-64 md:h-56">
              <TrendChart data={auChartData} {...yearProps('cumulativeWon', 'prevCumulativeWon', 'cumulativeWonTarget', '#526147')} xInterval={xInt}
                title="AU Yearly Sales Accumulated (AUD)" subtitle={data.fyLabel}
                leftValue={fmtAUD(data.auYearlySales.actual)} rightValue={fmtNum(data.auYearlySales.target)} />
            </div>
          </div>

          {/* Individual pipeline gauges (Overall lives in the sidebar) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card>
              <CardHeader title="NZ Pipeline" subtitle="All open deals · NZD" />
              <Gauge actual={data.pipelineNz.actual} target={data.pipelineNz.target} uid="pnz" />
            </Card>
            <Card>
              <CardHeader title="AU Pipeline" subtitle="All open deals · AUD" />
              <Gauge actual={data.pipelineAu.actual} target={data.pipelineAu.target} uid="pau" format={fmtAUD} />
            </Card>
          </div>

        </div>{/* end Section B left */}

        {/* Section B sidebar: Overall Pipeline — spans full section height
            (top aligns with NZ accumulated, bottom aligns with NZ/AU pipeline tiles) */}
        <div className="lg:col-span-1">
          <Card className="h-full">
            <CardHeader title="Overall Pipeline" subtitle="NZ + AU · NZD" />
            <Gauge actual={data.pipelineOverall.actual} target={data.pipelineOverall.target} uid="pov" />
          </Card>
        </div>

      </div>{/* end Section B grid */}

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
