import { useEffect, useMemo, useState } from 'react'
import { cachedGet } from '../lib/apiCache'

// Pipeline clean-up worklist. Every OPEN deal in the NZ + AU sales pipelines, grouped so
// the stale ones surface, with every total clickable through to the deals behind it.
//
// Why it matters (31 Jul 2026 forecast investigation, FORECAST_AUDIT.md §H): historically
// ~97% of a month's deals resolved to won or lost, but the FY24/25 and FY25/26 cohorts sit
// at 30.5% and 44.8% still open. That abandoned value stays in the forecast's conversion
// denominator forever and can never reach the numerator, so it quietly drags the projection
// down. Closing dead deals out barely moves the forecast (the curve already treats them as
// lost) — it just makes the pipeline honest.

interface Deal {
  id: string
  name: string
  value: number
  pipeline: 'NZ' | 'AU'
  stageId: string
  stage: string
  prob: number
  stageOrder: number
  createdAt: number | null
  ageMonths: number
  owner: string
  daysSinceTouch: number | null
  installMonthsPast: number | null
  ageKey: string
  probKey: string
  sizeKey: string
  stale: boolean
}
interface Group { key: string; label: string; count: number; value: number; staleCount: number; staleValue: number; prob?: number; pipeline?: string; order?: number }
interface CleanupData {
  staleMonths: number
  portalId: number | null
  installProp: string | null
  totals: {
    openCount: number; openValue: number
    staleCount: number; staleValue: number
    lowStaleCount: number; lowStaleValue: number
    lateStaleCount: number; lateStaleValue: number
    pastInstallCount: number; pastInstallValue: number
  }
  groups: { age: Group[]; prob: Group[]; size: Group[]; stage: Group[] }
  deals: Deal[]
}

const GROUP_BY = [
  ['age', 'By age'],
  ['stage', 'By stage'],
  ['prob', 'By stage probability'],
  ['size', 'By deal size'],
] as const
type GroupBy = typeof GROUP_BY[number][0]

const fmtFull = (v: number) => new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD', maximumFractionDigits: 0 }).format(v)
const fmtShort = (v: number) => v >= 1000000 ? `$${(v / 1000000).toFixed(2)}M` : v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`
const age = (m: number) => m >= 24 ? `${(m / 12).toFixed(1)} yrs` : `${m} mo`
const touched = (d: number | null) => d == null ? 'never' : d >= 365 ? `${(d / 365).toFixed(1)} yrs ago` : d >= 60 ? `${Math.round(d / 30.44)} mo ago` : `${d}d ago`

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

export default function CleanupDashboard() {
  const [data, setData] = useState<CleanupData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [groupBy, setGroupBy] = useState<GroupBy>('age')
  const [staleOnly, setStaleOnly] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showAllIn, setShowAllIn] = useState<string | null>(null)

  useEffect(() => {
    cachedGet('/api/sales/cleanup')
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false))
  }, [])

  // Everything below is derived from the one `deals` payload, so the stale filter and the
  // drill-downs can never disagree with the totals shown above them.
  const shown = useMemo(() => !data ? [] : staleOnly ? data.deals.filter(d => d.stale) : data.deals, [data, staleOnly])

  const rows = useMemo(() => {
    if (!data) return [] as Group[]
    if (groupBy === 'stage') {
      const acc: Record<string, Group> = {}
      for (const d of shown) {
        acc[d.stageId] = acc[d.stageId] || { key: d.stageId, label: d.stage, prob: d.prob, pipeline: d.pipeline, order: d.stageOrder, count: 0, value: 0, staleCount: 0, staleValue: 0 }
        const g = acc[d.stageId]
        g.count++; g.value += d.value
        if (d.stale) { g.staleCount++; g.staleValue += d.value }
      }
      return Object.values(acc).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label))
    }
    // age / prob / size: keep the server's band order and labels, recount from `shown`
    const field = groupBy === 'age' ? 'ageKey' : groupBy === 'prob' ? 'probKey' : 'sizeKey'
    return data.groups[groupBy].map(band => {
      const ds = shown.filter(d => (d as any)[field] === band.key)
      return { ...band, count: ds.length, value: ds.reduce((t, d) => t + d.value, 0) }
    }).filter(g => g.count > 0)
  }, [data, shown, groupBy])

  const dealsIn = (key: string) => {
    if (!data) return []
    const field = groupBy === 'stage' ? 'stageId' : groupBy === 'age' ? 'ageKey' : groupBy === 'prob' ? 'probKey' : 'sizeKey'
    return shown.filter(d => (d as any)[field] === key)
  }
  const dealUrl = (d: Deal) => data?.portalId ? `https://app.hubspot.com/contacts/${data.portalId}/record/0-3/${d.id}` : null
  const shownValue = shown.reduce((t, d) => t + d.value, 0)

  if (loading) return <div className="py-16 text-center text-sm text-gray-400 animate-pulse">Loading open pipeline…</div>
  if (error) return <div className="py-16 text-center text-sm text-red-500">Error: {error}</div>
  if (!data) return null
  const t = data.totals

  return (
    <div className="max-w-screen-2xl mx-auto space-y-6 pb-8 px-4 sm:px-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Clean-up</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Every open deal in the NZ &amp; AU sales pipelines, grouped so the stale ones surface. Deals win a mean of ~1.5 months
          after they're created, so anything open past {data.staleMonths} months is almost certainly dead but never closed out.
          Click any row to see the deals behind it.
        </p>
      </div>

      {/* The number this tab exists to surface */}
      <div className="bg-amber-50 border border-amber-100 rounded-xl p-5">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <p className="text-sm font-semibold text-amber-900">Open more than {data.staleMonths} months</p>
          <p className="text-xs text-amber-500">of {fmtFull(t.openValue)} open in total</p>
        </div>
        <p className="text-2xl sm:text-3xl font-bold text-amber-700 mt-1 tabular-nums">{fmtFull(t.staleValue)}</p>
        <p className="text-xs text-gray-500 mt-1.5">
          across <span className="font-semibold text-gray-700">{t.staleCount}</span> deals
          {t.openCount > 0 && <> — {Math.round(t.staleCount / t.openCount * 100)}% of open deals, {Math.round(t.staleValue / t.openValue * 100)}% of open value</>}
        </p>
      </div>

      {/* Two piles that need completely different treatment */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Bulk-close candidates</p>
          <p className="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums">{fmtFull(t.lowStaleValue)}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {t.lowStaleCount} stale deals at ≤15% stage probability — worth roughly {fmtShort(t.lowStaleValue * 0.15)} expected,
            so closing them out costs almost nothing.
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Need a conversation</p>
          <p className="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums">{fmtFull(t.lateStaleValue)}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {t.lateStaleCount} stale deals sitting at 46%+ — late-stage deals shouldn't age. Each needs a call, not a bulk action.
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex flex-wrap rounded-lg border border-gray-200 bg-white p-0.5">
          {GROUP_BY.map(([v, label]) => (
            <button key={v} onClick={() => { setGroupBy(v); setExpanded(null) }}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${groupBy === v ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input type="checkbox" checked={staleOnly} onChange={e => { setStaleOnly(e.target.checked); setExpanded(null) }}
            className="rounded border-gray-300 text-gray-900 focus:ring-gray-900" />
          Stale only ({data.staleMonths}+ months)
        </label>
        <span className="text-xs text-gray-400 tabular-nums">
          showing {shown.length} deals · {fmtFull(shownValue)}
        </span>
      </div>

      {/* Grouped rows — click to drill into the deals behind the total */}
      {!rows.length
        ? <div className="py-16 text-center text-sm text-gray-400">No deals match this filter.</div>
        : <div className="rounded-2xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
        {rows.map(g => {
          const isOpen = expanded === g.key
          const ds = isOpen ? dealsIn(g.key) : []
          const limit = showAllIn === g.key ? ds.length : 25
          const pctValue = shownValue > 0 ? g.value / shownValue * 100 : 0
          return (
            <div key={g.key}>
              <button onClick={() => { setExpanded(isOpen ? null : g.key); setShowAllIn(null) }}
                className="w-full text-left px-4 py-4 bg-white hover:bg-gray-50 transition-colors">
                {/* Desktop */}
                <div className="hidden sm:grid items-center gap-4" style={{ gridTemplateColumns: '1fr 90px 120px 1fr 20px' }}>
                  <div className="min-w-0 flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900 truncate">{g.label}</p>
                    {g.pipeline === 'AU' && <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 rounded px-1.5 py-0.5 flex-shrink-0">AU</span>}
                    {g.prob != null && <span className="text-xs text-gray-400 flex-shrink-0 tabular-nums">{Math.round(g.prob * 100)}%</span>}
                  </div>
                  <span className="text-right text-sm text-gray-500 tabular-nums">{g.count} deals</span>
                  <span className="text-right text-sm font-bold text-gray-900 tabular-nums">{fmtFull(g.value)}</span>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gray-400 rounded-full" style={{ width: `${pctValue}%` }} />
                    </div>
                    <span className="text-xs text-gray-400 tabular-nums w-9 text-right">{pctValue.toFixed(0)}%</span>
                  </div>
                  <ChevronIcon expanded={isOpen} />
                </div>
                {/* Mobile */}
                <div className="sm:hidden flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {g.label}
                      {g.pipeline === 'AU' && <span className="ml-1.5 text-[10px] font-semibold text-gray-500 bg-gray-100 rounded px-1 py-0.5">AU</span>}
                    </p>
                    <p className="text-xs text-gray-400 tabular-nums">
                      {g.count} deals{g.prob != null && ` · ${Math.round(g.prob * 100)}% stage`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-sm font-bold text-gray-900 tabular-nums">{fmtShort(g.value)}</span>
                    <ChevronIcon expanded={isOpen} />
                  </div>
                </div>
              </button>

              {isOpen && (
                <div className="bg-gray-50 border-t border-gray-100">
                  {/* Desktop column headings */}
                  <div className="hidden sm:grid gap-4 px-4 py-2 text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-200"
                    style={{ gridTemplateColumns: '1fr 110px 80px 90px 140px' }}>
                    <span>Deal</span><span className="text-right">Value</span><span className="text-right">Age</span>
                    <span className="text-right">Last touch</span><span>Owner</span>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {ds.slice(0, limit).map(d => {
                      const url = dealUrl(d)
                      const Row = (
                        <>
                          {/* Desktop */}
                          <div className="hidden sm:grid gap-4 items-center" style={{ gridTemplateColumns: '1fr 110px 80px 90px 140px' }}>
                            <div className="min-w-0 flex items-center gap-2">
                              <span className="text-sm text-gray-700 truncate">{d.name}</span>
                              {d.pipeline === 'AU' && <span className="text-[10px] font-semibold text-gray-500 bg-gray-200 rounded px-1 flex-shrink-0">AU</span>}
                            </div>
                            <span className="text-right text-sm font-semibold text-gray-900 tabular-nums">{fmtFull(d.value)}</span>
                            <span className={`text-right text-sm tabular-nums ${d.ageMonths >= 24 ? 'text-red-600 font-semibold' : d.stale ? 'text-amber-600' : 'text-gray-500'}`}>{age(d.ageMonths)}</span>
                            <span className={`text-right text-xs tabular-nums ${(d.daysSinceTouch ?? 9999) >= 180 ? 'text-red-500' : 'text-gray-400'}`}>{touched(d.daysSinceTouch)}</span>
                            <span className="text-xs text-gray-500 truncate">{d.owner}</span>
                          </div>
                          {/* Mobile */}
                          <div className="sm:hidden space-y-1">
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-sm text-gray-700 min-w-0 break-words">{d.name}</span>
                              <span className="text-sm font-semibold text-gray-900 tabular-nums flex-shrink-0">{fmtFull(d.value)}</span>
                            </div>
                            <div className="flex flex-wrap gap-x-3 text-xs text-gray-400 tabular-nums">
                              <span className={d.ageMonths >= 24 ? 'text-red-600 font-semibold' : d.stale ? 'text-amber-600' : ''}>{age(d.ageMonths)} old</span>
                              <span className={(d.daysSinceTouch ?? 9999) >= 180 ? 'text-red-500' : ''}>touched {touched(d.daysSinceTouch)}</span>
                              <span className="truncate">{d.owner}</span>
                              {groupBy !== 'stage' && <span className="truncate">{d.stage}</span>}
                            </div>
                          </div>
                        </>
                      )
                      return url
                        ? <a key={d.id} href={url} target="_blank" rel="noreferrer" className="block px-4 py-2.5 hover:bg-white transition-colors">{Row}</a>
                        : <div key={d.id} className="px-4 py-2.5">{Row}</div>
                    })}
                  </div>
                  {ds.length > limit && (
                    <button onClick={() => setShowAllIn(g.key)}
                      className="w-full px-4 py-2.5 text-xs font-medium text-gray-500 hover:text-gray-800 hover:bg-white transition-colors border-t border-gray-100">
                      Show all {ds.length} deals ({fmtFull(ds.slice(limit).reduce((s, x) => s + x.value, 0))} more)
                    </button>
                  )}
                  {data.portalId && (
                    <p className="px-4 py-2 text-[11px] text-gray-400 border-t border-gray-100">Click a deal to open it in HubSpot.</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
        </div>}

      <p className="text-xs text-gray-400">
        Open deals only, by creation date, at the value held in HubSpot — AU deals at their converted NZD amount (not the
        margin-stripped value the Forecast tab uses, so these match what you see in the CRM). AU-mirror deals are excluded
        because they're win events rather than live opportunities. Stage probabilities come from the pipeline configuration.
      </p>
    </div>
  )
}
