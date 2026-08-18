import { useEffect, useState } from 'react'
import {
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Bar, Line, Legend, ComposedChart
} from 'recharts'
import { cachedGet } from '../lib/apiCache'
import { SalesFromMarketingTiles } from '../components/OurOneNumber'

// Stacked lead-source series for the pipeline graphs. Order = bottom→top of each
// bar: Marketing (brand yellow) sits at the bottom, BD and Sales in two greys,
// Unassigned (blank lead_source_team) in the lightest grey and only shown when present.
const SOURCE_SERIES = [
  { key: 'marketing', label: 'Marketing', color: '#EBA117' },
  { key: 'bd', label: 'BD', color: '#6b7280' },
  { key: 'sales', label: 'Sales', color: '#9ca3af' },
  { key: 'unassigned', label: 'Unassigned', color: '#d1d5db' },
] as const

// Filter for the graphs: "All" stacks every source; the others isolate one division
// so month-to-month variation is readable instead of buried in the stack.
const SOURCE_FILTERS = [
  ['all', 'All'],
  ['marketing', 'Marketing'],
  ['bd', 'BD'],
  ['sales', 'Sales'],
] as const
type SourceFilter = typeof SOURCE_FILTERS[number][0]

// Least-squares best-fit line over a series of monthly values — used to overlay a
// straight trend line on the graphs (shows direction even in a filtered view).
function linearTrend(values: number[]): number[] {
  const n = values.length
  if (n === 0) return []
  const sumX = values.reduce((a, _v, i) => a + i, 0)
  const sumY = values.reduce((a, v) => a + v, 0)
  const sumXY = values.reduce((a, v, i) => a + i * v, 0)
  const sumXX = values.reduce((a, _v, i) => a + i * i, 0)
  const denom = n * sumXX - sumX * sumX
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  return values.map((_v, i) => Math.max(0, Math.round(intercept + slope * i)))
}

// Marketing → "Marketing Dashboard" tab (the department's landing tab, first in the
// tab bar). Shows the money view: what marketing put into the pipeline and what it
// closed, split by lead source. This content used to be the "Revenue" section toggle
// on the Marketing KPIs tab (MarketingDashboard.tsx, which still holds MQL's + Other).
export default function MarketingRevenue({ focusMetric, onClearFocus }: { focusMetric?: string | null; onClearFocus?: () => void }) {
  const [bySource, setBySource] = useState<any>(null)
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')

  useEffect(() => {
    cachedGet('/api/marketing/pipeline-by-source')
      .then(r => setBySource(r.data))
      .catch(console.error)
  }, [])

  // Lead-source stack: only show the "Unassigned" series if any month actually has
  // blank-team value, so the common case stays a clean 3-way split.
  const allSourceRows: any[] = [...(bySource?.newPipeline || []), ...(bySource?.won || [])]
  const activeSeries = SOURCE_SERIES.filter(s => s.key !== 'unassigned' || allSourceRows.some(r => r[s.key] > 0))
  // Series actually drawn given the toggle: "all" → the full stack; otherwise the one division.
  const shownSeries = sourceFilter === 'all' ? activeSeries : SOURCE_SERIES.filter(s => s.key === sourceFilter)
  const shownTotal = (m: any) => shownSeries.reduce((sum, s) => sum + (m[s.key] || 0), 0)
  const yAxisMoney = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
  // Attach a best-fit trend value (of the currently-shown total) to each month's row.
  const withTrend = (rows: any[]) => {
    const trend = linearTrend((rows || []).map(shownTotal))
    return (rows || []).map((r, i) => ({ ...r, __trend: trend[i] }))
  }

  // Both graphs are identical apart from their data + title, so build them from one shape.
  const graph = (rows: any[] | undefined, title: string, focusKey: string) => (
    <div className={`bg-white rounded-xl border p-4 sm:p-5 shadow-sm transition-all ${focusMetric === focusKey ? 'border-amber-400 shadow-amber-100' : 'border-gray-200'}`}>
      <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-4">{title}</p>
      {!bySource ? (
        <div className="h-48 bg-gray-50 rounded animate-pulse" />
      ) : rows?.some((m: any) => shownTotal(m) > 0) ? (
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={withTrend(rows)} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9ca3af' }} interval="preserveStartEnd" minTickGap={14} />
            <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickFormatter={yAxisMoney} width={48} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              formatter={(v: any, name: any) => [`$${(v as number).toLocaleString()}`, name]}
            />
            {sourceFilter === 'all' && <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />}
            {shownSeries.map(s => (
              <Bar key={s.key} dataKey={s.key} name={s.label} stackId="src" fill={s.color}
                radius={sourceFilter === 'all' ? undefined : [4, 4, 0, 0]} />
            ))}
            <Line type="linear" dataKey="__trend" name="Trend" stroke="#111827" strokeWidth={2} strokeDasharray="5 4" dot={false} legendType="none" />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-sm text-gray-400 py-8 text-center">No data</p>
      )}
    </div>
  )

  return (
    <div className="space-y-6">
      {/* This-month money tiles — marketing lead source */}
      <SalesFromMarketingTiles />

      <section className={`rounded-2xl transition-all duration-300 ${focusMetric ? 'ring-2 ring-amber-400 ring-offset-2' : ''}`}>
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-sm font-semibold tracking-widest text-gray-500 uppercase">Pipeline by Lead Source</h2>
            {/* Source filter — applies to both graphs below */}
            <div className="inline-flex flex-wrap rounded-lg border border-gray-200 bg-white p-0.5">
              {SOURCE_FILTERS.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setSourceFilter(key)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${sourceFilter === key ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {focusMetric && (
            <button onClick={onClearFocus} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded hover:bg-gray-100 transition-colors">
              ✕ clear focus
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4">
          {graph(bySource?.newPipeline, 'New Pipeline by Lead Source — Last 36 Months', 'newPipeline')}
          {graph(bySource?.won, 'Sales Won by Lead Source — Last 36 Months', 'won')}
        </div>
      </section>
    </div>
  )
}
