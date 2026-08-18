import { useEffect, useState } from 'react'
import { cachedGet } from '../lib/apiCache'
import { Gauge, fmtDollar, fmtPct } from '../components/Gauge'
import ManagementEmailButton from '../components/ManagementEmailButton'
import { SnapshotTiles, type SnapshotTileDef } from '../components/SnapshotTiles'

interface Metric { actual: number; target: number }
interface TrackingData {
  monthlySales: Metric
  yesterdaySales: Metric
  monthlyNewDeals: Metric
  yesterdayNewDeals: Metric
}
interface ManualBucket { mtdActual: number; mtdTarget: number; yesterdayActual: number; yesterdayTarget: number }
interface ManualMetrics {
  difot: ManualBucket
  invoicedSales: ManualBucket
  forwardOrderValue: Metric
}

export default function TopFiveScoreboard({ snapshot = false }: { snapshot?: boolean }) {
  const [tracking, setTracking] = useState<TrackingData | null>(null)
  const [manual, setManual] = useState<ManualMetrics | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      cachedGet('/api/sales/tracking'),
      cachedGet('/api/management/manual-metrics'),
    ])
      .then(([t, m]) => { setTracking(t.data); setManual(m.data) })
      .catch(e => setError(e.response?.data?.error || e.message))
  }, [])

  if (error) return <div className="flex items-center justify-center py-20 text-red-500 text-sm">Failed to load: {error}</div>
  if (!tracking || !manual) return <div className="flex items-center justify-center py-20 text-gray-400 text-sm animate-pulse">Loading…</div>

  const row1 = (
    <>
      <Gauge compact label="Sales Won $ MTD Total" sublabel="Current month" actual={tracking.monthlySales.actual} target={tracking.monthlySales.target} format={fmtDollar} />
      <Gauge compact label="Sales Won Yesterday" sublabel="Yesterday" actual={tracking.yesterdaySales.actual} target={tracking.yesterdaySales.target} format={fmtDollar} />
      <Gauge compact label="DIFOT MTD Total" sublabel="Current month" actual={manual.difot.mtdActual} target={manual.difot.mtdTarget} format={fmtPct} />
      <Gauge compact label="DIFOT Yesterday" sublabel="Yesterday" actual={manual.difot.yesterdayActual} target={manual.difot.yesterdayTarget} format={fmtPct} />
    </>
  )
  const row2 = (
    <>
      <Gauge compact label="New Deals MTD Total" sublabel="Current month" actual={tracking.monthlyNewDeals.actual} target={tracking.monthlyNewDeals.target} format={fmtDollar} />
      <Gauge compact label="New Deals Yesterday" sublabel="Yesterday" actual={tracking.yesterdayNewDeals.actual} target={tracking.yesterdayNewDeals.target} format={fmtDollar} />
      <Gauge compact label="Invoiced Sales MTD Total" sublabel="Current month" actual={manual.invoicedSales.mtdActual} target={manual.invoicedSales.mtdTarget} format={fmtDollar} />
      <Gauge compact label="Invoiced Sales Yesterday" sublabel="Yesterday" actual={manual.invoicedSales.yesterdayActual} target={manual.invoicedSales.yesterdayTarget} format={fmtDollar} />
    </>
  )
  const forwardOrder = (
    <Gauge compact label="Forward Order Value" sublabel="Current month" actual={manual.forwardOrderValue.actual} target={manual.forwardOrderValue.target} format={fmtDollar} />
  )

  // Snapshot mode (daily-email capture): render each gauge as its own fixed-size,
  // individually-tagged element so the cron can screenshot them one-by-one and
  // compose a responsive grid of images in the email (see SnapshotTiles).
  if (snapshot) {
    const snapshotTiles: SnapshotTileDef[] = [
      { key: 'sales-mtd', label: 'Sales Won $ MTD Total', node: <Gauge label="Sales Won $ MTD Total" sublabel="Current month" actual={tracking.monthlySales.actual} target={tracking.monthlySales.target} format={fmtDollar} /> },
      { key: 'sales-yesterday', label: 'Sales Won Yesterday', node: <Gauge label="Sales Won Yesterday" sublabel="Yesterday" actual={tracking.yesterdaySales.actual} target={tracking.yesterdaySales.target} format={fmtDollar} /> },
      { key: 'difot-mtd', label: 'DIFOT MTD Total', node: <Gauge label="DIFOT MTD Total" sublabel="Current month" actual={manual.difot.mtdActual} target={manual.difot.mtdTarget} format={fmtPct} /> },
      { key: 'difot-yesterday', label: 'DIFOT Yesterday', node: <Gauge label="DIFOT Yesterday" sublabel="Yesterday" actual={manual.difot.yesterdayActual} target={manual.difot.yesterdayTarget} format={fmtPct} /> },
      { key: 'new-deals-mtd', label: 'New Deals MTD Total', node: <Gauge label="New Deals MTD Total" sublabel="Current month" actual={tracking.monthlyNewDeals.actual} target={tracking.monthlyNewDeals.target} format={fmtDollar} /> },
      { key: 'new-deals-yesterday', label: 'New Deals Yesterday', node: <Gauge label="New Deals Yesterday" sublabel="Yesterday" actual={tracking.yesterdayNewDeals.actual} target={tracking.yesterdayNewDeals.target} format={fmtDollar} /> },
      { key: 'invoiced-mtd', label: 'Invoiced Sales MTD Total', node: <Gauge label="Invoiced Sales MTD Total" sublabel="Current month" actual={manual.invoicedSales.mtdActual} target={manual.invoicedSales.mtdTarget} format={fmtDollar} /> },
      { key: 'invoiced-yesterday', label: 'Invoiced Sales Yesterday', node: <Gauge label="Invoiced Sales Yesterday" sublabel="Yesterday" actual={manual.invoicedSales.yesterdayActual} target={manual.invoicedSales.yesterdayTarget} format={fmtDollar} /> },
      { key: 'forward-order', label: 'Forward Order Value', node: <Gauge label="Forward Order Value" sublabel="Current month" actual={manual.forwardOrderValue.actual} target={manual.forwardOrderValue.target} format={fmtDollar} /> },
    ]
    return <SnapshotTiles tiles={snapshotTiles} />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">Top 5 - Scoreboard</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">DIFOT & Invoiced Sales synced from the ops Google Sheet</span>
          <ManagementEmailButton dashboard="top5" snapshot={snapshot} />
        </div>
      </div>

      <div className="flex flex-col gap-3" style={{ height: 'calc(100vh - 14rem)' }}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 flex-1 min-h-0">{row1}</div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 flex-1 min-h-0">{row2}</div>
        <div className="flex-1 min-h-0">{forwardOrder}</div>
      </div>
    </div>
  )
}
