import { useEffect, useRef, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Legend, PieChart, Pie, Cell,
} from 'recharts'
import axios from 'axios'
import { cachedGet } from '../lib/apiCache'

const SEO_RED = '#e11d48'
const SEO_INDIGO = '#6366f1'

const COUNTRIES = {
  NZ: { label: 'NZ', bg: '#EBA117', text: '#fff' },
  AU: { label: 'AU', bg: '#526147', text: '#fff' },
}

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function SectionHeader({ title, badge }: { title: string; badge?: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <h2 className="text-sm font-semibold tracking-widest text-gray-500 uppercase">{title}</h2>
      {badge && <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded-full">{badge}</span>}
    </div>
  )
}

function KpiCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">{label}</p>
      <p className="text-3xl font-bold" style={{ color: accent || '#111827' }}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

export default function SEODashboard() {
  const [country, setCountry] = useState<'NZ' | 'AU'>('NZ')
  const [overview, setOverview] = useState<any>(null)
  const [queries, setQueries] = useState<any>(null)
  const [pages, setPages] = useState<any>(null)
  const [analytics, setAnalytics] = useState<any>(null)
  const [deepAnalytics, setDeepAnalytics] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [loadingDetails, setLoadingDetails] = useState(true)
  const [loadingAnalytics, setLoadingAnalytics] = useState(true)
  const [loadingDeep, setLoadingDeep] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const sessionsChartRef = useRef<HTMLDivElement>(null)

  // GSC data — NZ only, load once
  useEffect(() => {
    setLoading(true)
    setError(null)
    cachedGet('/api/seo')
      .then(r => setOverview(r.data))
      .catch(e => {
        // The underlying Google error can come back in several shapes depending on
        // where the call failed (GSC API error vs. OAuth token-endpoint error vs.
        // something else) — try each before falling back to axios's generic
        // "Request failed with status code 500", which hides the real cause.
        const detail = e.response?.data?.detail
        const msg = detail?.error?.message
          || detail?.error_description
          || (typeof detail?.error === 'string' ? detail.error : null)
          || e.response?.data?.error
          || e.message
          || 'Failed to load SEO data'
        console.error('SEO load error — full detail:', e.response?.data)
        setError(msg)
      })
      .finally(() => setLoading(false))

    setLoadingDetails(true)
    Promise.allSettled([
      cachedGet('/api/seo/queries'),
      cachedGet('/api/seo/pages'),
    ]).then(([q, p]) => {
      if (q.status === 'fulfilled') setQueries(q.value.data)
      if (p.status === 'fulfilled') setPages(p.value.data)
    }).finally(() => setLoadingDetails(false))
  }, [])

  // GA4 website analytics — reloads on country change
  useEffect(() => {
    setAnalytics(null)
    setDeepAnalytics(null)
    setLoadingAnalytics(true)
    setLoadingDeep(true)

    cachedGet(`/api/analytics?country=${country}`)
      .then(r => setAnalytics(r.data))
      .catch(console.error)
      .finally(() => setLoadingAnalytics(false))

    cachedGet(`/api/analytics/deep?country=${country}`)
      .then(r => setDeepAnalytics(r.data))
      .catch(console.error)
      .finally(() => setLoadingDeep(false))
  }, [country])

  const c = COUNTRIES[country]

  if (!loading && error) {
    return (
      <div className="bg-white rounded-xl border border-red-200 p-8 text-center">
        <p className="text-sm font-semibold text-red-600 mb-2">SEO data unavailable</p>
        <p className="text-xs text-gray-500 mb-4">{error}</p>
        <div className="text-left max-w-lg mx-auto text-xs text-gray-500 space-y-1 bg-gray-50 rounded-lg p-4">
          <p className="font-semibold text-gray-700 mb-2">To enable Google Search Console:</p>
          <p>1. The GA_REFRESH_TOKEN needs the <code className="bg-gray-200 px-1 rounded">webmasters.readonly</code> OAuth scope.</p>
          <p>2. Re-authorise via Google OAuth and include that scope, then update <code className="bg-gray-200 px-1 rounded">GA_REFRESH_TOKEN</code> in Vercel.</p>
          <p>3. Optionally set <code className="bg-gray-200 px-1 rounded">GSC_SITE_URL</code> in Vercel (default: https://yourcompany.io/).</p>
        </div>
      </div>
    )
  }

  const s = overview?.summary
  const o = overview?.organic

  return (
    <div className="space-y-6">

      {/* Country toggle */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(Object.entries(COUNTRIES) as [keyof typeof COUNTRIES, typeof COUNTRIES['NZ']][]).map(([key, cfg]) => (
            <button
              key={key}
              onClick={() => setCountry(key)}
              className="px-6 py-2 rounded-lg text-sm font-semibold transition-all"
              style={country === key
                ? { backgroundColor: cfg.bg, color: cfg.text, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }
                : { backgroundColor: '#fff', color: '#6b7280', border: '1px solid #e5e7eb' }
              }
            >
              {cfg.label}
            </button>
          ))}
        </div>
        <p className="hidden sm:block text-xs text-gray-400">Search Console data is NZ only · Website Analytics follows toggle</p>
      </div>

      {/* ── SEO KPI Overview ──────────────────────────────────────────────────── */}
      <section>
        <SectionHeader title="SEO Overview" badge="Last 90 days · Google Search Console · NZ" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KpiCard label="Organic Clicks" value={loading ? '—' : fmt(s?.clicks ?? 0)} sub="Non-paid Google search clicks" accent={SEO_RED} />
          <KpiCard label="Impressions" value={loading ? '—' : fmt(s?.impressions ?? 0)} sub="Times shown in search results" />
          <KpiCard label="Organic Sessions" value={loading ? '—' : fmt(o?.sessions ?? 0)} sub="From GA4 · organic channel" accent={SEO_INDIGO} />
          <KpiCard label="Avg Position" value={loading ? '—' : s?.position ?? '—'} sub="Lower = higher in results" />
        </div>
      </section>

      {/* ── Search Performance ────────────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <SectionHeader title="Search Performance" badge="Google Search Console · NZ" />
        {loading ? (
          <div className="h-48 flex items-center justify-center text-gray-400">Loading...</div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              {[
                { label: 'Impressions', value: fmt(s?.impressions ?? 0), color: 'text-gray-900' },
                { label: 'Clicks', value: fmt(s?.clicks ?? 0), color: 'text-gray-900' },
                { label: 'Site CTR', value: `${s?.ctr ?? '—'}%`, color: 'text-blue-600' },
                { label: 'Avg Position', value: s?.position ?? '—', color: 'text-gray-900' },
              ].map(stat => (
                <div key={stat.label} className="bg-gray-50 rounded-xl p-4">
                  <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-1">{stat.label}</p>
                  <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
                </div>
              ))}
            </div>
            <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-3">Monthly Clicks & Impressions</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={overview?.monthly || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `${(v / 1000).toFixed(0)}K`} />
                <Tooltip />
                <Legend />
                <Bar yAxisId="left" dataKey="clicks" fill={SEO_RED} name="Clicks" radius={[3, 3, 0, 0]} />
                <Bar yAxisId="right" dataKey="impressions" fill={SEO_INDIGO} name="Impressions" radius={[3, 3, 0, 0]} opacity={0.7} />
              </BarChart>
            </ResponsiveContainer>
          </>
        )}
      </section>

      {/* ── Average Position Trend ────────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <SectionHeader title="Average Search Position" badge="Last 12 months · lower = better · NZ" />
        {loading ? (
          <div className="h-40 flex items-center justify-center text-gray-400">Loading...</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={overview?.positionTrend || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <YAxis reversed tick={{ fontSize: 11, fill: '#9ca3af' }} domain={['dataMin - 2', 'dataMax + 5']} />
              <Tooltip formatter={(v: any) => [v, 'Avg Position']} />
              <Line type="monotone" dataKey="avgPosition" stroke={SEO_RED} strokeWidth={2} dot={{ r: 4, fill: SEO_RED }} name="Avg Position" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* ── Website Analytics (GA4) ───────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader title="Website Analytics" badge={`Last 30 days · GA4 · ${country}`} />

        {loadingAnalytics ? (
          <div className="h-24 flex items-center justify-center text-gray-400 bg-white rounded-xl border border-gray-200">Loading...</div>
        ) : !analytics ? (
          <div className="text-sm text-gray-400 py-4">Analytics unavailable.</div>
        ) : (
          <>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {[
                { label: 'Sessions', value: analytics.summary.sessions.toLocaleString() },
                { label: 'Users', value: analytics.summary.users.toLocaleString() },
                { label: 'New Users', value: analytics.summary.newUsers?.toLocaleString() ?? '—' },
                { label: 'Bounce Rate', value: `${analytics.summary.bounceRate}%` },
                { label: 'Engagement', value: `${analytics.summary.engagementRate}%` },
                { label: 'Pages/Session', value: analytics.summary.pagesPerSession },
                { label: 'Avg Duration', value: `${Math.floor(analytics.summary.avgSessionDuration / 60)}m ${analytics.summary.avgSessionDuration % 60}s` },
              ].map(stat => (
                <div key={stat.label} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm text-center">
                  <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                  <p className="text-xs text-gray-400 mt-1">{stat.label}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm" ref={sessionsChartRef}>
                <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-3">Sessions — Last 6 Months</p>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={analytics.monthly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                    <Tooltip />
                    <Bar dataKey="sessions" fill={c.bg} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-3">Channel Breakdown</p>
                <div className="space-y-2">
                  {(analytics.sources || []).map((src: any) => {
                    const max = analytics.sources[0]?.sessions || 1
                    return (
                      <div key={src.source} className="flex items-center gap-3">
                        <span className="text-xs text-gray-600 w-32 truncate capitalize">{src.source.toLowerCase().replace(/_/g, ' ')}</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-2">
                          <div className="bg-indigo-500 h-2 rounded-full" style={{ width: `${(src.sessions / max) * 100}%` }} />
                        </div>
                        <span className="text-xs text-gray-500 w-10 text-right">{src.sessions.toLocaleString()}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </>
        )}

        {loadingDeep ? (
          <div className="h-16 flex items-center justify-center text-gray-400 bg-white rounded-xl border border-gray-200 text-sm">Loading detailed analytics...</div>
        ) : deepAnalytics && (
          <>
            <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-3">Daily Sessions — Last 30 Days</p>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={deepAnalytics.dailyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} interval={4} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="sessions" stroke="#6366f1" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-4">Devices</p>
                <div className="flex items-center gap-4">
                  <PieChart width={100} height={100}>
                    <Pie data={deepAnalytics.devices} dataKey="sessions" cx={50} cy={50} innerRadius={28} outerRadius={46}>
                      {deepAnalytics.devices.map((_: any, i: number) => (
                        <Cell key={i} fill={['#6366f1', '#f97316', '#22c55e'][i % 3]} />
                      ))}
                    </Pie>
                  </PieChart>
                  <div className="space-y-2 flex-1">
                    {deepAnalytics.devices.map((d: any, i: number) => (
                      <div key={d.device} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: ['#6366f1', '#f97316', '#22c55e'][i % 3] }} />
                          <span className="text-xs text-gray-700 capitalize">{d.device}</span>
                        </div>
                        <span className="text-xs font-semibold text-gray-600">{d.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-4">New vs Returning</p>
                {analytics && (() => {
                  const total = (analytics.summary.newUsers || 0) + (analytics.summary.returningUsers || 0) || 1
                  const newPct = Math.round((analytics.summary.newUsers / total) * 100)
                  return (
                    <>
                      <div className="flex gap-3 mb-4">
                        <div className="flex-1 bg-indigo-50 rounded-xl p-3 text-center">
                          <p className="text-2xl font-bold text-indigo-600">{newPct}%</p>
                          <p className="text-xs text-gray-400 mt-1">New</p>
                        </div>
                        <div className="flex-1 bg-orange-50 rounded-xl p-3 text-center">
                          <p className="text-2xl font-bold text-orange-500">{100 - newPct}%</p>
                          <p className="text-xs text-gray-400 mt-1">Returning</p>
                        </div>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div className="bg-indigo-500 h-2 rounded-full" style={{ width: `${newPct}%` }} />
                      </div>
                    </>
                  )
                })()}
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-3">Top Cities</p>
                <div className="space-y-2">
                  {deepAnalytics.geographic.slice(0, 6).map((g: any) => {
                    const max = deepAnalytics.geographic[0]?.sessions || 1
                    return (
                      <div key={g.city} className="flex items-center gap-2">
                        <span className="text-xs text-gray-600 w-24 truncate">{g.city}</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                          <div className="bg-indigo-400 h-1.5 rounded-full" style={{ width: `${(g.sessions / max) * 100}%` }} />
                        </div>
                        <span className="text-xs text-gray-500 w-8 text-right">{g.sessions}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase">Top Pages</p>
                </div>
                <div className="divide-y divide-gray-50">
                  {deepAnalytics.topPages.slice(0, 8).map((p: any) => (
                    <div key={p.page} className="flex items-center gap-3 px-5 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-800 truncate">{p.page}</p>
                      </div>
                      <span className="text-xs text-gray-500 shrink-0">{p.views.toLocaleString()} views</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase">Acquisition</p>
                </div>
                <div className="divide-y divide-gray-50">
                  {deepAnalytics.acquisition.slice(0, 8).map((a: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 px-5 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-800 truncate">{a.source} / {a.medium}</p>
                      </div>
                      <span className="text-xs text-gray-500 shrink-0">{a.sessions.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase">Events</p>
                </div>
                <div className="divide-y divide-gray-50">
                  {deepAnalytics.conversions.slice(0, 8).map((e: any) => (
                    <div key={e.event} className="flex items-center gap-3 px-5 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-800 truncate">{e.event}</p>
                      </div>
                      <span className="text-xs text-gray-500 shrink-0">{e.count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {/* ── GA4 Organic Breakdown ─────────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <SectionHeader title="Organic Traffic Breakdown" badge={`Last 90 days · GA4 · ${country}`} />
        {loading ? (
          <div className="h-32 flex items-center justify-center text-gray-400">Loading...</div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              {[
                { label: 'Total Users via Organic', value: o?.users?.toLocaleString(), highlight: true },
                { label: 'Organic Sessions', value: o?.sessions?.toLocaleString(), highlight: true },
                { label: 'Key Events via Organic', value: o?.keyEvents?.toLocaleString(), highlight: true },
                { label: 'Site CTR', value: s?.ctr ? `${s.ctr}%` : '—', highlight: false },
              ].map(stat => (
                <div key={stat.label} className={`rounded-xl p-4 ${stat.highlight ? 'bg-rose-50' : 'bg-gray-50'}`}>
                  <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-1">{stat.label}</p>
                  <p className={`text-2xl font-bold ${stat.highlight ? 'text-rose-600' : 'text-gray-900'}`}>{stat.value ?? '—'}</p>
                </div>
              ))}
            </div>
            <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-3">Monthly Users & Key Events</p>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={overview?.ga4Monthly || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="users" stroke={SEO_RED} strokeWidth={2} dot={false} name="Total Users" />
                <Line type="monotone" dataKey="keyEvents" stroke={SEO_INDIGO} strokeWidth={2} dot={false} name="Key Events" />
              </LineChart>
            </ResponsiveContainer>
          </>
        )}
      </section>

      {/* ── Top Queries + Top Pages ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <p className="text-xs font-semibold tracking-widest text-gray-500 uppercase">Top Search Queries</p>
            <p className="text-xs text-gray-400 mt-0.5">By impressions · Last 90 days · NZ</p>
          </div>
          {loadingDetails ? (
            <div className="h-32 flex items-center justify-center text-gray-400 text-sm">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-100">
                    {['Query', 'Impr.', 'Clicks', 'Pos.', 'CTR'].map(h => (
                      <th key={h} className="px-4 py-2 text-xs font-semibold tracking-widest text-gray-400 uppercase whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(queries?.queries || []).map((q: any) => (
                    <tr key={q.rank} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-sm text-gray-800 max-w-[160px] truncate">{q.query}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-600">{q.impressions.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-600">{q.clicks.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-600">{q.position}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-sm font-medium ${q.ctr >= 5 ? 'text-green-600' : q.ctr >= 1 ? 'text-yellow-600' : 'text-gray-400'}`}>
                          {q.ctr}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <p className="text-xs font-semibold tracking-widest text-gray-500 uppercase">Top Landing Pages</p>
            <p className="text-xs text-gray-400 mt-0.5">By impressions · Last 90 days · NZ</p>
          </div>
          {loadingDetails ? (
            <div className="h-32 flex items-center justify-center text-gray-400 text-sm">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-100">
                    {['Page', 'Impr.', 'Clicks', 'Pos.', 'CTR'].map(h => (
                      <th key={h} className="px-4 py-2 text-xs font-semibold tracking-widest text-gray-400 uppercase whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(pages?.pages || []).map((p: any) => (
                    <tr key={p.rank} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-sm text-gray-800 max-w-[200px] truncate" title={p.fullUrl}>{p.page || '/'}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-600">{p.impressions.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-600">{p.clicks.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-600">{p.position}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-sm font-medium ${p.ctr >= 2 ? 'text-green-600' : p.ctr >= 0.5 ? 'text-yellow-600' : 'text-gray-400'}`}>
                          {p.ctr}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

      </div>

    </div>
  )
}
