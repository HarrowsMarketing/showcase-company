import { useEffect, useState } from 'react'
import axios from 'axios'
import { cachedGet } from '../lib/apiCache'
import { Gauge as BigGauge, fmtDollar, fmtNum } from '../components/Gauge'

// ── Helpers ─────────────────────────────────────────────────────────────────────

interface Metric { actual: number; target: number }
interface TrackingData {
  dailyNewDeals: Metric
  dailySales: Metric
  monthlyNewDeals: Metric & { fullMonthTarget: number }
  monthlySales: Metric & { fullMonthTarget: number }
  monthlyKpiPoints: Metric & { fullMonthTarget: number }
  dailyKpiPoints: Metric
  range?: { isFullMonth: boolean }
}

// ── Main ─────────────────────────────────────────────────────────────────────────

export default function DisplayDashboard({ fullscreen = false, snapshot = false }: { fullscreen?: boolean; snapshot?: boolean }) {
  const [data, setData] = useState<TrackingData | null>(null)
  const [invoiced, setInvoiced] = useState<Metric | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    // Initial paint can use a cached copy; the scheduled 5-min refresh forces a live
    // pull so wall displays stay current.
    const load = (force = false) => {
      cachedGet('/api/sales/tracking', { force })
        .then(r => { if (active) { setData(r.data); setError(null) } })
        .catch(e => { if (active) setError(e.response?.data?.error || e.message) })
      // Scheduled invoiced sales — the same figure the Leadership dashboard shows.
      // Kept in its own request so a Smartsheet hiccup here never blanks the display;
      // on failure the tile just keeps its last value (or falls back to 0/0).
      cachedGet('/api/management/manual-metrics', { force })
        .then(r => { if (active && r.data?.monthlyInvoicedSales) setInvoiced(r.data.monthlyInvoicedSales) })
        .catch(() => { /* leave prior value in place */ })
    }
    load()
    const id = setInterval(() => load(true), 5 * 60 * 1000) // refresh every 5 min for wall displays
    return () => { active = false; clearInterval(id) }
  }, [])

  if (error) return (
    <div className="flex items-center justify-center h-[70vh] text-red-500 text-lg">Error: {error}</div>
  )
  if (!data) return (
    <div className="flex items-center justify-center h-[70vh] text-gray-400 text-lg animate-pulse">Loading display…</div>
  )

  const fullMonth = data.range?.isFullMonth ?? true
  const dailySub = fullMonth ? 'Today vs target' : 'Full month only'

  // ── Snapshot mode ──────────────────────────────────────────────────────────
  // Used only by the daily-email cron. Each gauge is rendered as a fixed-size,
  // individually-tagged tile ([data-tile]) so the capture job can screenshot
  // them one-by-one and lay them out as a responsive grid of images in the email
  // (stacked on mobile, multi-column on desktop) rather than one flat picture.
  if (snapshot) {
    const tiles = [
      { key: 'monthly-sales',     node: <BigGauge label="Monthly Sales"      sublabel="This month vs target" actual={data.monthlySales.actual}     target={data.monthlySales.target}     fullMonthTarget={data.monthlySales.fullMonthTarget}     format={fmtDollar} /> },
      { key: 'monthly-new-deals', node: <BigGauge label="Monthly New Deals"  sublabel="This month vs target" actual={data.monthlyNewDeals.actual}  target={data.monthlyNewDeals.target}  fullMonthTarget={data.monthlyNewDeals.fullMonthTarget}  format={fmtDollar} /> },
      { key: 'monthly-kpi',       node: <BigGauge label="Monthly KPI Points" sublabel="This month vs target" actual={data.monthlyKpiPoints.actual} target={data.monthlyKpiPoints.target} format={fmtNum} /> },
      { key: 'daily-new-deals',   node: <BigGauge label="Daily New Deals"    sublabel={dailySub}              actual={data.dailyNewDeals.actual}    target={data.dailyNewDeals.target}    format={fmtDollar} /> },
      { key: 'daily-sales',       node: <BigGauge label="Daily Sales"        sublabel={dailySub}              actual={data.dailySales.actual}       target={data.dailySales.target}       format={fmtDollar} /> },
      { key: 'daily-kpi',         node: <BigGauge label="Daily KPI Points"   sublabel={dailySub}              actual={data.dailyKpiPoints.actual}   target={data.dailyKpiPoints.target}   format={fmtNum} /> },
    ]
    return (
      <div data-snapshot-ready="true" style={{ width: 560 }}>
        {tiles.map(t => (
          <div key={t.key} data-tile={t.key} style={{ width: 560, height: 360, marginBottom: 20 }}>
            {t.node}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      className="flex flex-col gap-3"
      style={{ height: fullscreen ? 'calc(100vh - 2rem)' : 'calc(100vh - 8.5rem)' }}
    >
      {/* Hero row — Monthly Sales + Monthly Invoiced Sales (middle) + Monthly KPI (dominant) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 flex-[2] min-h-0">
        <BigGauge label="Monthly Sales" sublabel="This month vs target" actual={data.monthlySales.actual} target={data.monthlySales.target} fullMonthTarget={data.monthlySales.fullMonthTarget} format={fmtDollar} />
        <BigGauge label="Monthly Invoiced Sales" sublabel="Completed + to-be-invoiced vs target" actual={invoiced?.actual ?? 0} target={invoiced?.target ?? 0} format={fmtDollar} />
        <BigGauge label="Monthly KPI Points" sublabel="This month vs target" actual={data.monthlyKpiPoints.actual} target={data.monthlyKpiPoints.target} format={fmtNum} />
      </div>
      {/* Secondary strip — smaller figures (Monthly New Deals + daily figures) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1 min-h-0">
        <BigGauge compact label="Monthly New Deals" sublabel="This month vs target" actual={data.monthlyNewDeals.actual} target={data.monthlyNewDeals.target} fullMonthTarget={data.monthlyNewDeals.fullMonthTarget} format={fmtDollar} />
        <BigGauge compact label="Daily Sales" sublabel={dailySub} actual={data.dailySales.actual} target={data.dailySales.target} format={fmtDollar} />
        <BigGauge compact label="Daily New Deals" sublabel={dailySub} actual={data.dailyNewDeals.actual} target={data.dailyNewDeals.target} format={fmtDollar} />
        <BigGauge compact label="Daily KPI Points" sublabel={dailySub} actual={data.dailyKpiPoints.actual} target={data.dailyKpiPoints.target} format={fmtNum} />
      </div>
    </div>
  )
}
