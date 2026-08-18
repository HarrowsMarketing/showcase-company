import { useEffect, useState } from 'react'
import axios from 'axios'
import { cachedGet } from '../lib/apiCache'
import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Legend, ReferenceLine,
} from 'recharts'

interface CurvePoint { lag: number; pct: number }
interface HistMonth { label: string; leadValue: number; won: number }
// actualWon is present on the current month only — revenue already banked this month.
interface ForecastMonth { label: string; projectedWon: number; fromExistingLeads: number; fromFutureLeads: number; actualWon?: number; isCurrentMonth?: boolean }
// forecastRemaining splits into fromExistingLeads (leads already landed) and
// fromAssumedInflow (assumed future leads) — very different levels of confidence.
interface FyForecast { label: string; actualToDate: number; forecastRemaining: number; fromExistingLeads?: number; fromAssumedInflow?: number; total: number }
interface ForecastData {
  curve: CurvePoint[]
  overallConversionPct: number
  projectedMonthlyLead: number
  inflowTrendPct: number
  totalProjected12mo: number
  fyForecast: FyForecast
  dealsAnalysed: number
  history: HistMonth[]
  forecast: ForecastMonth[]
}
interface InstallRow { label: string; won: number; open: number; pastDue: number }
interface InstallData {
  installProp: string
  currentMonthLabel: string
  rows: InstallRow[]
  totals: { pastDue: number; won: number; open: number }
}

const FORECAST_VIEWS = [
  ['forecast', 'Revenue forecast'],
  ['install', 'Install schedule'],
] as const
type ForecastView = typeof FORECAST_VIEWS[number][0]

const fmtShort = (v: number) => v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`
const fmtFull = (v: number) => new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD', maximumFractionDigits: 0 }).format(v)

export default function ForecastDashboard() {
  const [view, setView] = useState<ForecastView>('forecast')
  const [data, setData] = useState<ForecastData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [install, setInstall] = useState<InstallData | null>(null)
  const [installLoading, setInstallLoading] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)

  useEffect(() => {
    cachedGet('/api/sales/forecast')
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false))
  }, [])

  // Lazy-load the install schedule the first time that view is opened (it hits HubSpot
  // separately, so we avoid the extra searches unless the user actually wants it).
  useEffect(() => {
    if (view !== 'install' || install || installLoading || installError) return
    setInstallLoading(true)
    cachedGet('/api/sales/install-schedule')
      .then(r => setInstall(r.data))
      .catch(e => setInstallError(e.response?.data?.error || e.message))
      .finally(() => setInstallLoading(false))
  }, [view]) // eslint-disable-line react-hooks/exhaustive-deps

  // Unified series: actual won for history months, then stacked projected for forecast
  // months. The current month carries both — actual won so far, with the projected rest
  // of the month stacked on top — so all three keys share one stack.
  const chartData = data ? [
    ...data.history.map(h => ({ label: h.label, actualWon: h.won })),
    ...data.forecast.map(f => ({ label: f.label, actualWon: f.actualWon || undefined, fromExisting: f.fromExistingLeads, fromFuture: f.fromFutureLeads })),
  ] : []
  const firstForecastLabel = data?.forecast[0]?.label
  const thisMonth = data?.forecast[0]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Forecast</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          {view === 'forecast'
            ? <>Projected won revenue from the rolling conversion of leads landing each month — based on {data ? data.dealsAnalysed.toLocaleString() : '…'} deals (NZ + AU pipelines) over the last 3 years. AU leads counted at NZ sell value.</>
            : <>Deal value by expected install month. Open deals whose install date sits in a month that's already passed show in red — a nudge to update stale dates. AU deals counted at NZ value.</>}
        </p>
      </div>

      {/* Section toggle — one view at a time, same pattern as Sales Breakdown */}
      <div className="inline-flex flex-wrap rounded-lg border border-gray-200 bg-white p-0.5">
        {FORECAST_VIEWS.map(([v, label]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${view === v ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'forecast' && (loading
        ? <div className="flex items-center justify-center h-64"><p className="text-gray-400 text-sm animate-pulse">Building forecast from 3 years of deals…</p></div>
        : error
        ? <div className="flex items-center justify-center h-64"><p className="text-red-500 text-sm">Error: {error}</p></div>
        : !data
        ? null
        : <div className="space-y-6">

      {/* Full financial-year total: actual won to date + forecast for the rest of the FY */}
      {data.fyForecast && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-5">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <p className="text-sm font-semibold text-blue-900">Full financial year · {data.fyForecast.label}</p>
            <p className="text-xs text-blue-500">actual won to date (incl. this month) + forecast to Mar 31</p>
          </div>
          <p className="text-3xl font-bold text-blue-700 mt-1">{fmtFull(data.fyForecast.total)}</p>
          {/* Three-way split: how much of this number is banked, how much rests on leads
              already in hand, and how much is an assumption about leads not yet received.
              The last one is usually the largest and is the least certain — showing it
              stops the headline being read as though it were all pipeline. */}
          <p className="text-xs text-gray-500 mt-1.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span><span className="font-semibold text-green-700">{fmtFull(data.fyForecast.actualToDate)}</span> banked</span>
            {typeof data.fyForecast.fromExistingLeads === 'number' && typeof data.fyForecast.fromAssumedInflow === 'number' ? (
              <>
                <span className="text-gray-300">+</span>
                <span><span className="font-semibold text-blue-600">{fmtFull(data.fyForecast.fromExistingLeads)}</span> from leads in hand</span>
                <span className="text-gray-300">+</span>
                <span><span className="font-semibold text-blue-400">{fmtFull(data.fyForecast.fromAssumedInflow)}</span> from assumed future leads</span>
              </>
            ) : (
              <>
                <span className="text-gray-300">+</span>
                <span><span className="font-semibold text-blue-600">{fmtFull(data.fyForecast.forecastRemaining)}</span> forecast remaining</span>
              </>
            )}
          </p>
          {typeof data.fyForecast.fromAssumedInflow === 'number' && data.fyForecast.total > 0 && (
            <p className="text-[11px] text-blue-500/80 mt-1">
              {Math.round(data.fyForecast.fromAssumedInflow / data.fyForecast.total * 100)}% of this total depends on leads that haven't arrived yet,
              assumed at the trailing-12-month average.
            </p>
          )}
        </div>
      )}

      {/* Stat tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 mb-1">Eventual conversion</p>
          <p className="text-2xl font-bold text-gray-900">{data.overallConversionPct}%</p>
          <p className="text-xs text-gray-400 mt-0.5">of lead value won (value-weighted)</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 mb-1">Assumed monthly leads</p>
          <p className="text-2xl font-bold text-gray-900">{fmtFull(data.projectedMonthlyLead)}</p>
          {/* The YoY trend is still measured and shown, but no longer projected with — it
              compounded one-off steps in entered deal value into an exponential. */}
          <p className="text-xs text-gray-400 mt-0.5">
            trailing-12-month average, held flat
            {typeof data.inflowTrendPct === 'number' && (
              <>
                {' · lead trend '}
                <span className={data.inflowTrendPct >= 0 ? 'text-green-600' : 'text-red-500'}>{data.inflowTrendPct >= 0 ? '+' : ''}{data.inflowTrendPct}%/yr</span>
                {' (shown, not projected)'}
              </>
            )}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 mb-1">This month projected</p>
          <p className="text-2xl font-bold text-blue-600">{fmtFull(thisMonth?.projectedWon || 0)}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {thisMonth?.label} (full month) — incl.{' '}
            <span className="font-semibold text-green-700">{fmtFull(thisMonth?.actualWon || 0)}</span> already won
          </p>
        </div>
      </div>

      {/* Main forecast chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-base font-bold text-gray-900 mb-1">Won revenue — actual &amp; projected</h2>
        <p className="text-xs text-gray-400 mb-4">Last 12 months actual; current month + next 11 projected. The current month starts from the revenue already won this month (green) and stacks only the projected rest of the month on top — split by leads landed in prior months vs. this month's landed-so-far + assumed future leads.</p>
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} />
            <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#9ca3af' }} width={54} />
            <Tooltip formatter={(v: any, n: any) => [fmtFull(Number(v) || 0), n === 'actualWon' ? 'Actual won' : n === 'fromExisting' ? 'Projected (existing leads)' : 'Projected (new + future leads)']} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {firstForecastLabel && <ReferenceLine x={firstForecastLabel} stroke="#cbd5e1" strokeDasharray="4 4" label={{ value: 'forecast →', fontSize: 10, fill: '#94a3b8', position: 'insideTopRight' }} />}
            {/* One stack for all three: history rows only carry actualWon, forecast rows
                carry the projected split, and the current month carries both. */}
            <Bar dataKey="actualWon" name="Actual won" stackId="f" fill="#16a34a" radius={[3, 3, 0, 0]} />
            <Bar dataKey="fromExisting" name="Projected · existing leads" stackId="f" fill="#2563eb" radius={[0, 0, 0, 0]} />
            <Bar dataKey="fromFuture" name="Projected · new + future leads" stackId="f" fill="#93c5fd" radius={[3, 3, 0, 0]} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Conversion-by-lag curve */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-base font-bold text-gray-900 mb-1">Conversion by lag</h2>
        <p className="text-xs text-gray-400 mb-4">Of the lead value landing in a month, the % won this many months later (the curve that drives the forecast).</p>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={data.curve} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="lag" tick={{ fontSize: 11, fill: '#9ca3af' }} label={{ value: 'months after lead lands', fontSize: 11, fill: '#9ca3af', position: 'insideBottom', offset: -2 }} />
            <YAxis tickFormatter={v => `${v}%`} tick={{ fontSize: 11, fill: '#9ca3af' }} width={44} />
            <Tooltip formatter={(v: any) => [`${v}%`, 'Won at this lag']} labelFormatter={(l: any) => `${l} month${l === 1 ? '' : 's'} after`} />
            <Bar dataKey="pct" fill="#6366f1" radius={[3, 3, 0, 0]} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
        </div>
      )}

      {view === 'install' && (installLoading
        ? <div className="flex items-center justify-center h-64"><p className="text-gray-400 text-sm animate-pulse">Loading install schedule…</p></div>
        : installError
        ? <div className="flex items-center justify-center h-64"><p className="text-red-500 text-sm">Error: {installError}</p></div>
        : !install
        ? null
        : <div className="space-y-6">

      {/* Past-due callout — the number this view exists to surface */}
      <div className="bg-red-50 border border-red-100 rounded-xl p-5">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <p className="text-sm font-semibold text-red-900">Open deals with a past install date</p>
          <p className="text-xs text-red-400">expected install date is in a month already passed</p>
        </div>
        <p className="text-3xl font-bold text-red-700 mt-1">{fmtFull(install.totals.pastDue)}</p>
        <p className="text-xs text-gray-500 mt-1.5">Still open but scheduled to install in the past — the sales team likely needs to update these dates.</p>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 mb-1">Won · in window</p>
          <p className="text-2xl font-bold text-green-700">{fmtFull(install.totals.won)}</p>
          <p className="text-xs text-gray-400 mt-0.5">by month won</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 mb-1">Open · scheduled</p>
          <p className="text-2xl font-bold text-blue-600">{fmtFull(install.totals.open)}</p>
          <p className="text-xs text-gray-400 mt-0.5">this month onward</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 mb-1">Open · past-due</p>
          <p className="text-2xl font-bold text-red-600">{fmtFull(install.totals.pastDue)}</p>
          <p className="text-xs text-gray-400 mt-0.5">install date needs updating</p>
        </div>
      </div>

      {/* Install-schedule chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-base font-bold text-gray-900 mb-1">Value required by install date</h2>
        <p className="text-xs text-gray-400 mb-4">Won deals (green) sit in the month they were won; open deals sit by expected install date — blue for this month onward, red for months already passed (install dates need updating).</p>
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={install.rows} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} />
            <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#9ca3af' }} width={54} />
            <Tooltip formatter={(v: any, n: any) => [fmtFull(Number(v) || 0), n === 'won' ? 'Won' : n === 'pastDue' ? 'Open · past-due' : 'Open · scheduled']} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine x={install.currentMonthLabel} stroke="#cbd5e1" strokeDasharray="4 4" label={{ value: 'this month', fontSize: 10, fill: '#94a3b8', position: 'insideTopRight' }} />
            <Bar dataKey="won" name="Won" stackId="i" fill="#16a34a" radius={[0, 0, 0, 0]} />
            <Bar dataKey="pastDue" name="Open · past-due (update needed)" stackId="i" fill="#dc2626" radius={[3, 3, 0, 0]} />
            <Bar dataKey="open" name="Open · scheduled" stackId="i" fill="#2563eb" radius={[3, 3, 0, 0]} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
        </div>
      )}
    </div>
  )
}
