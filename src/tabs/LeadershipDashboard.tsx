import { useCallback, useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts'
import { cachedGet } from '../lib/apiCache'
import { Gauge, ValueTile, ScaledValue, fmtDollar } from '../components/Gauge'
import ManagementEmailButton from '../components/ManagementEmailButton'
import { SnapshotTiles, type SnapshotTileDef } from '../components/SnapshotTiles'

interface Metric { actual: number; target: number }
interface TrackingData {
  dailySales: Metric
  dailyNewDeals: Metric
  dailyKpiPoints: Metric
  monthlySales: Metric
  monthlyNewDeals: Metric
  monthlyKpiPoints: Metric
}
interface ManualMetrics {
  cashOnHand: { nz: number; au: number }
  forwardOrderValue: Metric
}
// Invoiced Sales across the whole financial year (from /api/sales/invoiced-fy) —
// the same data the sales dashboard's Invoiced Sales chart uses.
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

const STATUS_COLOR: Record<'green' | 'amber' | 'red', string> = { green: '#22c55e', amber: '#f59e0b', red: '#ef4444' }

interface Dial { label: string; m: Metric }

// Success Indicator — the four monthly leadership targets, each showing whether
// we're ahead of (actual ≥ target) or behind it right now: month-to-date taken
// sales, monthly new deals, monthly KPI points, and this month's completed +
// scheduled invoicing. Headline is how many of the four we're ahead on, green
// only when all four are. Daily figures are deliberately left out — leadership
// wants the month-to-date and scheduled-invoicing picture, not today's.
function SuccessIndicator({ dials }: { dials: Dial[] }) {
  const rated = dials.map(d => ({ ...d, ahead: d.m.target > 0 && d.m.actual >= d.m.target }))
  const ahead = rated.filter(d => d.ahead).length
  const total = rated.length
  const sorted = [...rated].sort((a, b) => Number(b.ahead) - Number(a.ahead))
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-3 flex flex-col h-full min-h-0">
      <div className="text-center shrink-0">
        <p className="text-sm xl:text-base font-bold tracking-widest text-gray-600 uppercase leading-tight">Success Indicator</p>
        <p className="text-[10px] text-gray-400">Monthly targets we're ahead of · month-to-date + scheduled invoicing</p>
      </div>
      {/* Big headline count — green only when we're ahead on every target. */}
      <div className="flex-1 min-h-0 w-full flex items-center justify-center">
        <ScaledValue text={`${ahead}/${total}`} color={ahead === total ? STATUS_COLOR.green : STATUS_COLOR.red} />
      </div>
      <p className="shrink-0 text-center text-[11px] text-gray-400 -mt-1">targets ahead</p>
      {/* Per-target breakdown: ahead vs behind. */}
      <div className="shrink-0 border-t border-gray-100 pt-2 mt-2 flex flex-col gap-1">
        {sorted.map(d => (
          <div key={d.label} className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5 text-gray-600">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.ahead ? STATUS_COLOR.green : STATUS_COLOR.red }} />
              {d.label}
            </span>
            <span className="font-semibold" style={{ color: d.ahead ? STATUS_COLOR.green : STATUS_COLOR.red }}>
              {d.ahead ? 'Ahead' : 'Behind'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Compact axis money (e.g. $1.2M, $85k) and a short month label ("Jul 26") so
// the per-month bars stay legible in the tile.
const fmtMoneyShort = (v: number) => v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `$${Math.round(v / 1_000)}k` : `$${Math.round(v)}`
// Just the month abbreviation ("Apr" … "Mar") — the FY chart runs a full 12
// months so the year would only crowd the axis.
const shortMonth = (label: string) => label.split(' ')[0].slice(0, 3)

// An invoiced-sales bar drawn with its own colour (green once it meets/beats the
// month's target, red while under) plus a dashed target line struck across the
// bar. Future (scheduled-only) months are drawn lighter to read as projections.
// The bar's height already encodes the actual $ on a 0-based linear axis, so
// pixels-per-dollar = height / actual lets us place the target line at the right
// height without needing the axis scale. (Skipped when actual is 0 — no bar to
// derive the scale from.)
function InvoicedBar(props: any) {
  const { x, y, width, height, payload } = props
  const actual = payload?.actual ?? 0
  const target = payload?.target ?? 0
  const fill = actual >= target ? STATUS_COLOR.green : STATUS_COLOR.red
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
      <p style={{ color: met ? STATUS_COLOR.green : STATUS_COLOR.red }}>{kind}: {fmtDollar(d.actual)}</p>
      {d.isCurrent && (d.completed > 0 || d.scheduled > 0) && (
        <p className="text-gray-400">Completed {fmtDollar(d.completed)} · To-invoice {fmtDollar(d.scheduled)}</p>
      )}
      <p className="text-gray-500">Target: {fmtDollar(d.target)}</p>
    </div>
  )
}

// Invoiced Sales vs Target — one bar per month across the whole financial year
// (April onward), matching the sales dashboard's chart. Past months show completed
// jobs (Completed Jobs 2), the current month shows completed + still-to-be-invoiced
// (Job Management), and future months show scheduled to-be-invoiced. Green when a
// month meets/beats its target, red while under, with a dashed target line on each
// bar and future bars drawn lighter as projections.
function InvoicedFyChart({ fy }: { fy: InvoicedFy }) {
  const data = fy.byMonth.map(m => ({ ...m, name: shortMonth(m.label) }))
  // Domain must clear the tallest of invoiced OR target so an above-bar target
  // line stays inside the plot area.
  const maxVal = Math.max(...data.map(d => Math.max(d.actual, d.target)), 0)
  const domainMax = maxVal > 0 ? Math.ceil(maxVal * 1.15) : 1
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-3 flex flex-col h-full min-h-0">
      <div className="text-center shrink-0">
        <p className="text-sm xl:text-base font-bold tracking-widest text-gray-600 uppercase leading-tight">Invoiced Sales vs Target</p>
        <p className="text-[10px] text-gray-400">{fy.fyLabel} · completed + scheduled · dashed line = target</p>
      </div>
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
    </div>
  )
}

// The leadership team already receives the daily sales-dashboard email (Monthly
// Sales / New Deals / KPI Points + the daily figures), so this dashboard shows
// only the figures the sales email does NOT cover — the finance/ops metrics from
// the management ops sheet — plus a Success Indicator that rolls up the dial
// colours from BOTH dashboards. (Sales tracking is still fetched to read those
// dials' status, though the sales gauges themselves stay off this tab.)
export default function LeadershipDashboard({ snapshot = false }: { snapshot?: boolean }) {
  const [tracking, setTracking] = useState<TrackingData | null>(null)
  const [manual, setManual] = useState<ManualMetrics | null>(null)
  const [invoicedFy, setInvoicedFy] = useState<InvoicedFy | null>(null)
  const [error, setError] = useState<string | null>(null)

  // force=true bypasses the client read cache — used after saving a target so the
  // gauge reflects the new value immediately instead of the cached figure.
  const load = useCallback((force = false) => {
    Promise.all([
      cachedGet('/api/sales/tracking', { force }),
      cachedGet('/api/management/manual-metrics', { force }),
      cachedGet('/api/sales/invoiced-fy', { force }),
    ])
      .then(([t, m, inv]) => { setTracking(t.data); setManual(m.data); setInvoicedFy(inv.data) })
      .catch(e => setError(e.response?.data?.error || e.message))
  }, [])

  useEffect(() => { load() }, [load])

  if (error) return <div className="flex items-center justify-center py-20 text-red-500 text-sm">Failed to load: {error}</div>
  if (!tracking || !manual || !invoicedFy) return <div className="flex items-center justify-center py-20 text-gray-400 text-sm animate-pulse">Loading…</div>

  // The four monthly targets the Success Indicator rates ahead/behind: MTD taken
  // sales, monthly new deals, monthly KPI points, and this month's invoicing
  // (completed + still-to-be-invoiced vs the month's target — the current-month
  // bar from the FY chart). Daily figures are intentionally excluded.
  const invMonth = invoicedFy.byMonth.find(m => m.isCurrent)
  const dials: Dial[] = [
    { label: 'Monthly Sales', m: tracking.monthlySales },
    { label: 'Monthly New Deals', m: tracking.monthlyNewDeals },
    { label: 'Monthly KPI Points', m: tracking.monthlyKpiPoints },
    { label: 'Invoiced Sales', m: { actual: invMonth?.actual ?? 0, target: invMonth?.target ?? 0 } },
  ]

  // Layout. Desktop (lg+): a fixed-height 4-column grid. The top band is a single
  // row of four columns — Cash on Hand NZ/AU stacked in the first column (each
  // half-height), then Forward Order Value, Invoiced Sales YTD, and the Success
  // Indicator each filling a full-height column. The Invoiced Sales vs Target
  // chart spans all four columns beneath and takes the remaining height (1fr) so
  // it's by far the tallest tile. Mobile: every tile goes full-width and stacks
  // so you just scroll down (fixed per-tile heights so the gauges/chart still
  // render; lg:h-auto lets them stretch to fill the grid rows).
  const tiles = (
    <>
      <div className="h-44 lg:h-auto lg:col-start-1 lg:row-start-1">
        <ValueTile compact label="Cash on Hand NZ" sublabel="Current month" value={manual.cashOnHand.nz} format={fmtDollar} />
      </div>
      <div className="h-44 lg:h-auto lg:col-start-1 lg:row-start-2">
        <ValueTile compact label="Cash on Hand AU" sublabel="Current month" value={manual.cashOnHand.au} format={fmtDollar} />
      </div>
      <div className="h-64 lg:h-auto lg:col-start-2 lg:row-start-1 lg:row-span-2">
        <Gauge compact label="Forward Order Value" sublabel="Current month" actual={manual.forwardOrderValue.actual} target={manual.forwardOrderValue.target} format={fmtDollar} />
      </div>
      <div className="h-64 lg:h-auto lg:col-start-3 lg:row-start-1 lg:row-span-2">
        <Gauge compact label="Invoiced Sales YTD" sublabel="vs cumulative target to date" actual={invoicedFy.ytd.actual} target={invoicedFy.ytd.target} format={fmtDollar} />
      </div>
      <div className="h-72 lg:h-auto lg:col-start-4 lg:row-start-1 lg:row-span-2">
        <SuccessIndicator dials={dials} />
      </div>
      <div className="h-80 lg:h-auto lg:col-start-1 lg:col-span-4 lg:row-start-3">
        <InvoicedFyChart fy={invoicedFy} />
      </div>
    </>
  )

  // Snapshot mode (daily-email capture): render each tile as its own fixed-size,
  // individually-tagged element so the cron can screenshot them one-by-one and
  // compose a responsive grid of images in the email (see SnapshotTiles). Ordered
  // as on the dashboard — the four top tiles, then the Success Indicator, then the
  // full-FY Invoiced Sales chart (given extra height for its 12 bars).
  if (snapshot) {
    const snapshotTiles: SnapshotTileDef[] = [
      { key: 'cash-nz', label: 'Cash on Hand NZ', node: <ValueTile label="Cash on Hand NZ" sublabel="Current month" value={manual.cashOnHand.nz} format={fmtDollar} /> },
      { key: 'cash-au', label: 'Cash on Hand AU', node: <ValueTile label="Cash on Hand AU" sublabel="Current month" value={manual.cashOnHand.au} format={fmtDollar} /> },
      { key: 'forward-order', label: 'Forward Order Value', node: <Gauge label="Forward Order Value" sublabel="Current month" actual={manual.forwardOrderValue.actual} target={manual.forwardOrderValue.target} format={fmtDollar} /> },
      { key: 'invoiced-ytd', label: 'Invoiced Sales YTD', node: <Gauge label="Invoiced Sales YTD" sublabel="vs cumulative target to date" actual={invoicedFy.ytd.actual} target={invoicedFy.ytd.target} format={fmtDollar} /> },
      { key: 'success', label: 'Success Indicator', height: 300, node: <SuccessIndicator dials={dials} /> },
      { key: 'invoiced-fy', label: 'Invoiced Sales vs Target', height: 400, node: <InvoicedFyChart fy={invoicedFy} /> },
    ]
    return <SnapshotTiles tiles={snapshotTiles} />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">Leadership Dashboard</h2>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-xs text-gray-400">Sales figures are in the daily sales email · these sync from the ops Google Sheet</span>
          <ManagementEmailButton dashboard="leadership" snapshot={snapshot} onSaved={() => load(true)} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4 lg:grid-rows-[7rem_7rem_minmax(0,1fr)] lg:h-[calc(100vh-14rem)]">
        {tiles}
      </div>
    </div>
  )
}
