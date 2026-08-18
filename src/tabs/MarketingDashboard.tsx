import { useEffect, useRef, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend, PieChart, Pie, Cell
} from 'recharts'
import { cachedGet } from '../lib/apiCache'
import { generateDashboardPDF } from '../utils/generateActivityPDF'
import type { TeamStats } from '../utils/generateActivityPDF'
import { buildTeamStats } from '../utils/smartsheetUtils'
import OurOneNumber from '../components/OurOneNumber'
import MqlManager from '../components/MqlManager'
import MarketingTargetsPanel from '../components/MarketingTargetsPanel'

const COUNTRIES = {
  NZ: { label: 'NZ', bg: '#EBA117', text: '#fff' },
  AU: { label: 'AU', bg: '#526147', text: '#fff' },
}

const PIE_COLORS = ['#2563eb', '#EBA117', '#059669', '#7c3aed', '#dc2626', '#0891b2', '#d97706', '#4f46e5']

// Section toggle — same pattern as the Forecast tab. The old "Revenue" view is now
// its own tab (MarketingRevenue.tsx); everything else lives under "Other" for now.
const MARKETING_VIEWS = [
  ['mql', "MQL's"],
  ['other', 'Other'],
] as const
type MarketingView = typeof MARKETING_VIEWS[number][0]

function fmt(val: number) {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`
  return `$${val.toFixed(0)}`
}

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">{label}</p>
      <p className="text-3xl font-bold" style={{ color: accent || '#111827' }}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

function SectionHeader({ title, badge }: { title: string; badge?: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <h2 className="text-sm font-semibold tracking-widest text-gray-500 uppercase">{title}</h2>
      {badge && <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded-full">{badge}</span>}
    </div>
  )
}

function PlaceholderCard({ label, note }: { label: string; note: string }) {
  return (
    <div className="bg-gray-50 rounded-xl border border-dashed border-gray-300 p-5 flex flex-col gap-1">
      <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase">{label}</p>
      <p className="text-sm text-gray-400 mt-1">{note}</p>
    </div>
  )
}

// FY26/27 Marketing Plan constants
const MKT_BUDGET_TOTAL = 870_000
const MKT_BUDGET_WAGES = 460_000
const MKT_OPEX = MKT_BUDGET_TOTAL - MKT_BUDGET_WAGES // $410k operational
const AD_SPEND = 100_000
const REVENUE_TARGET = 20_000_000
const NZ_REVENUE_TARGET = 18_000_000
const AU_REVENUE_TARGET_AUD = 2_400_000 // A$2.4m from marketing plan

const BUDGET_ITEMS = [
  { name: 'Wages & Misc', value: 460_000, color: '#94a3b8' },
  { name: 'SEO / Google Ads', value: 100_000, color: '#2563eb' },
  { name: 'Milk Branding (NZ)', value: 100_000, color: '#7c3aed' },
  { name: 'AU Brand / Showroom', value: 50_000, color: '#526147' },
  { name: 'HubSpot', value: 40_000, color: '#EBA117' },
  { name: 'Pricing Platform', value: 40_000, color: '#059669' },
  { name: 'Website Dev', value: 40_000, color: '#0891b2' },
  { name: 'Photography', value: 30_000, color: '#d97706' },
  { name: 'Print Marketing', value: 15_000, color: '#dc2626' },
  { name: 'Other', value: 25_000, color: '#9ca3af' },
]

function exportCSV(filename: string, rows: Record<string, string | number>[]) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => r[h]).join(','))].join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = filename
  a.click()
}

// Marketing → "Marketing KPIs" tab. The pipeline-by-lead-source graphs that used to
// sit behind this tab's "Revenue" toggle now live on the Marketing Dashboard tab
// (MarketingRevenue.tsx).
export default function MarketingDashboard() {
  const [country, setCountry] = useState<'NZ' | 'AU'>('NZ')
  const [view, setView] = useState<MarketingView>('mql')
  const [forms, setForms] = useState<any>(null)
  const [pipeline, setPipeline] = useState<any>(null)
  const [emails, setEmails] = useState<any>(null)
  const [contacts, setContacts] = useState<any>(null)
  const [sectors, setSectors] = useState<any>(null)
  const [salesData, setSalesData] = useState<any>(null)
  const [repeatCustomers, setRepeatCustomers] = useState<any>(null)
  const [instagram, setInstagram] = useState<any>(null)
  const [teamStats, setTeamStats] = useState<TeamStats[]>([])
  const [loading, setLoading] = useState(true)
  const [trendMetric, setTrendMetric] = useState<'wonValue' | 'wonCount' | 'created'>('wonValue')
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null)
  // Edit Targets drawer (MQL / SQL monthly targets). Saving bumps targetsKey so the
  // "Our One Number" cards re-mount and pick the new targets up straight away.
  const [showTargets, setShowTargets] = useState(false)
  const [targetsKey, setTargetsKey] = useState(0)

  const formChartRef = useRef<HTMLDivElement>(null)
  const emailChartRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSelectedPipelineId(null)
    setLoading(true)
    Promise.allSettled([
      cachedGet(`/api/hubspot/forms?country=${country}`),
      cachedGet(`/api/hubspot/pipeline?country=${country}`),
      cachedGet('/api/hubspot/emails'),
      cachedGet('/api/hubspot/contacts'),
      cachedGet('/api/hubspot/sectors'),
      cachedGet('/api/sales'),
    ]).then(results => {
      const [forms, pipeline, emails, contacts, sectors, salesData] = results
      if (forms.status === 'fulfilled') setForms(forms.value.data)
      if (pipeline.status === 'fulfilled') setPipeline(pipeline.value.data)
      if (emails.status === 'fulfilled') setEmails(emails.value.data)
      if (contacts.status === 'fulfilled') setContacts(contacts.value.data)
      if (sectors.status === 'fulfilled') setSectors(sectors.value.data)
      if (salesData.status === 'fulfilled') setSalesData(salesData.value.data)
    }).finally(() => setLoading(false))
  }, [country])

  useEffect(() => {
    cachedGet('/api/hubspot/repeatcustomers').then(r => setRepeatCustomers(r.data)).catch(() => setRepeatCustomers({ error: true }))
    cachedGet('/api/social/instagram').then(r => setInstagram(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    cachedGet('/api/smartsheet')
      .then(r => setTeamStats(buildTeamStats(r.data.rows || [])))
      .catch(console.error)
  }, [])

  const c = COUNTRIES[country]
  const sd = salesData?.[country]

  // FY win rate chart data
  const wonVsLost = sd ? [
    { name: 'Won', value: sd.fyWonCount },
    { name: 'Lost', value: sd.fyLostCount },
  ] : []

  // 12-month trend with metric selector
  const trendData = sd?.monthlyTrend || []
  const trendLabel = trendMetric === 'wonValue' ? 'Revenue Won' : trendMetric === 'wonCount' ? 'Deals Won' : 'New Deals'
  const trendColor = trendMetric === 'wonValue' ? '#059669' : trendMetric === 'wonCount' ? '#2563eb' : '#EBA117'

  return (
    <div className="space-y-6">

      {/* View toggle — one view at a time, same pattern as Forecast */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap rounded-lg border border-gray-200 bg-white p-0.5">
          {MARKETING_VIEWS.map(([v, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${view === v ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowTargets(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          Edit Targets
        </button>
      </div>

      {/* ── MQL's — "Our One Number" + manage MQL contacts ─────────────────────── */}
      {view === 'mql' && (
        <div className="space-y-6">
          <OurOneNumber key={targetsKey} country={country} />
          <MqlManager />
        </div>
      )}

      {showTargets && (
        <MarketingTargetsPanel
          onClose={() => setShowTargets(false)}
          onSaved={() => setTargetsKey(k => k + 1)}
        />
      )}

      {/* Country toggle + download (controls the Other view's data) */}
      {view === 'other' && (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {(Object.entries(COUNTRIES) as [keyof typeof COUNTRIES, typeof COUNTRIES['NZ']][]).map(([key, cfg]) => (
            <button key={key} onClick={() => setCountry(key)}
              className="px-4 sm:px-6 py-2 rounded-lg text-sm font-semibold transition-all"
              style={country === key
                ? { backgroundColor: cfg.bg, color: cfg.text, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }
                : { backgroundColor: '#fff', color: '#6b7280', border: '1px solid #e5e7eb' }
              }>{cfg.label}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => exportCSV('form-submissions.csv', (forms?.monthly || []).map((m: any) => ({ month: m.label, submissions: m.count })))}
            disabled={loading || !forms}
            className="hidden sm:flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            Export Forms CSV
          </button>
          <button
            onClick={async () => {
              const h2c = (await import('html2canvas')).default
              const capture = async (ref: React.RefObject<HTMLDivElement | null>) => {
                if (!ref.current) return undefined
                const canvas = await h2c(ref.current, { backgroundColor: '#ffffff', scale: 2, logging: false })
                return canvas.toDataURL('image/png')
              }
              const [formImg, emailImg] = await Promise.all([capture(formChartRef), capture(emailChartRef)])
              generateDashboardPDF({ country, forms, pipeline, emails, contacts, analytics: null, teamStats, chartImages: { form: formImg, email: emailImg, sessions: undefined } })
            }}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
            Download Report
          </button>
        </div>
      </div>
      )}

      {/* Everything below lives on the "Other" view for now */}
      {view === 'other' && <>

      {/* ── Top KPI Overview ──────────────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Key Metrics" badge={country} />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard label="Total New Leads" value={loading ? '—' : sectors?.total?.toLocaleString() ?? '—'} sub="Year to date" accent="#2563eb" />
          <StatCard label="Open Pipeline" value={loading ? '—' : fmt(sd?.openPipeline ?? 0)} sub={`${sd?.openCount?.toLocaleString() ?? '—'} deals · ${country}`} accent="#7c3aed" />
          <StatCard label="Win Rate (FY)" value={loading ? '—' : `${sd?.fyWinRate ?? '—'}%`} sub={sd?.fyLabel ?? 'April–March'} accent="#059669" />
          <StatCard label="Closed Won (FY)" value={loading ? '—' : fmt(sd?.fyWonValue ?? 0)} sub={`${sd?.fyWonCount ?? '—'} deals won`} accent="#059669" />
          <StatCard label="Avg Email Open Rate" value={loading ? '—' : `${emails?.avgOpenRate ?? '—'}%`} sub="Last 10 campaigns" />
        </div>
      </section>

      {/* ── Lead Intelligence ─────────────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <SectionHeader title="Lead Intelligence" badge="Year to date" />
        {loading ? <div className="h-48 flex items-center justify-center text-gray-400">Loading...</div> : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
            {/* 12-month grouped bar chart */}
            <div className="lg:col-span-2">
              <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-4">Leads by Origin — Last 12 Months</p>
              {(() => {
                const monthlyData: any[] = sectors?.monthly || []
                const totals = monthlyData.map((m: any) => m.Marketing + m.Sales).sort((a: number, b: number) => a - b)
                const median = totals[Math.floor(totals.length / 2)] || 100
                const cap = median * 8
                const cappedData = monthlyData.map((m: any) => ({
                  label: m.label,
                  Marketing: Math.min(m.Marketing, cap),
                  Sales: Math.min(m.Sales, cap),
                }))
                return (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={cappedData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="Marketing" fill="#2563eb" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="Sales" fill="#EBA117" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )
              })()}

              <div className="grid grid-cols-2 gap-4 mt-4">
                <div className="bg-blue-50 rounded-lg p-3">
                  <p className="text-xs text-blue-600 font-semibold uppercase tracking-wide">Marketing (12mo)</p>
                  <p className="text-2xl font-bold text-blue-700">{sectors?.marketingTotal?.toLocaleString() ?? '—'}</p>
                  <p className="text-xs text-blue-400">via website / digital</p>
                </div>
                <div className="bg-amber-50 rounded-lg p-3">
                  <p className="text-xs text-amber-600 font-semibold uppercase tracking-wide">Sales (12mo)</p>
                  <p className="text-2xl font-bold text-amber-700">{sectors?.salesTotal?.toLocaleString() ?? '—'}</p>
                  <p className="text-xs text-amber-400">manually added to CRM</p>
                </div>
              </div>
            </div>

            {/* Current month pie */}
            <div>
              <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-4">
                This Month — {sectors?.sourcePieLabel ?? ''}
              </p>
              {sectors?.sourcePie?.some((s: any) => s.count > 0) ? (
                <>
                  <div className="flex justify-center">
                    <PieChart width={160} height={160}>
                      <Pie data={sectors.sourcePie} cx={75} cy={75} innerRadius={45} outerRadius={72} dataKey="count" paddingAngle={3}>
                        <Cell fill="#2563eb" />
                        <Cell fill="#EBA117" />
                      </Pie>
                      <Tooltip formatter={(v: any) => v?.toLocaleString?.()} />
                    </PieChart>
                  </div>
                  <div className="space-y-3 mt-2">
                    {sectors.sourcePie.map((s: any, i: number) => {
                      const total = sectors.sourcePie.reduce((acc: number, x: any) => acc + x.count, 0)
                      const pct = total > 0 ? Math.round((s.count / total) * 100) : 0
                      const color = i === 0 ? '#2563eb' : '#EBA117'
                      return (
                        <div key={s.name} className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                          <span className="text-sm text-gray-700">{s.name}</span>
                          <span className="text-sm font-bold text-gray-900 ml-auto">{s.count}</span>
                          <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-400 italic">No data for current month.</p>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── Win Rate & Closed Deals (FY) ─────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <SectionHeader title="Win Rate & Closed Deals" badge={sd?.fyLabel ?? 'April–March FY'} />
        {loading ? <div className="h-48 flex items-center justify-center text-gray-400">Loading...</div> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
            {/* Won vs Lost donut */}
            <div>
              <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-4">Won vs Lost — {country}</p>
              <div className="flex items-center gap-6">
                <PieChart width={160} height={160}>
                  <Pie data={wonVsLost} cx={75} cy={75} innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3}>
                    <Cell fill="#059669" />
                    <Cell fill="#dc2626" />
                  </Pie>
                  <Tooltip />
                </PieChart>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-green-500" />
                    <span className="text-sm text-gray-600">Won</span>
                    <span className="text-lg font-bold text-gray-900 ml-2">{sd?.fyWonCount ?? '—'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500" />
                    <span className="text-sm text-gray-600">Lost</span>
                    <span className="text-lg font-bold text-gray-900 ml-2">{sd?.fyLostCount ?? '—'}</span>
                  </div>
                  <div className="pt-2 border-t border-gray-100">
                    <p className="text-xs text-gray-400">FY Win Rate</p>
                    <p className="text-2xl font-bold" style={{ color: c.bg }}>{sd?.fyWinRate ?? '—'}%</p>
                  </div>
                </div>
              </div>
            </div>
            {/* Closed deal stats */}
            <div>
              <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-4">Closed Deals — {country}</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-green-50 rounded-xl p-4">
                  <p className="text-xs text-green-700 font-semibold uppercase tracking-wide mb-1">Revenue Won (FY)</p>
                  <p className="text-2xl font-bold text-green-700">{fmt(sd?.fyWonValue ?? 0)}</p>
                  <p className="text-xs text-gray-400 mt-1">{sd?.fyWonCount ?? 0} deals</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4">
                  <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1">Total Closed Won</p>
                  <p className="text-2xl font-bold text-gray-900">{fmt(sd?.closedWonValue ?? 0)}</p>
                  <p className="text-xs text-gray-400 mt-1">{sd?.wonCount ?? 0} deals all time</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4">
                  <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1">Avg Deal Size</p>
                  <p className="text-2xl font-bold text-gray-900">{fmt(sd?.avgDealSize ?? 0)}</p>
                  <p className="text-xs text-gray-400 mt-1">Open deals</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4">
                  <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1">Overall Win Rate</p>
                  <p className="text-2xl font-bold text-gray-900">{sd?.winRate ?? '—'}%</p>
                  <p className="text-xs text-gray-400 mt-1">All time</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── Pipeline Split by Pipe ────────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        {loading ? <div className="h-32 flex items-center justify-center text-gray-400">Loading...</div> : (
          <>
            {(sd?.pipelines || []).length === 0 ? (
              <>
                <SectionHeader title="Pipeline Split by Pipe" badge={`${country} open deals`} />
                <p className="text-sm text-gray-400">No pipeline data.</p>
              </>
            ) : (() => {
              const pipelines: any[] = sd?.pipelines || []
              const activePipId = selectedPipelineId ?? pipelines[0]?.id
              const pip = pipelines.find((p: any) => p.id === activePipId) ?? pipelines[0]
              return (
                <>
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-3">
                      <h2 className="text-sm font-semibold tracking-widest text-gray-500 uppercase">Pipeline Split by Pipe</h2>
                      <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded-full">{country} open deals</span>
                    </div>
                    <select
                      value={activePipId}
                      onChange={e => setSelectedPipelineId(e.target.value)}
                      className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-offset-1"
                      style={{ '--tw-ring-color': c.bg } as any}
                    >
                      {pipelines.map((p: any) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  {pip && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-semibold text-gray-700">{pip.name}</p>
                        <span className="text-sm text-gray-500">{fmt(pip.openValue)} · {pip.openCount} deals</span>
                      </div>
                      <ResponsiveContainer width="100%" height={Math.max(60, pip.stages.length * 30)}>
                        <BarChart data={pip.stages} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} tickFormatter={v => fmt(v)} />
                          <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#9ca3af' }} width={150} />
                          <Tooltip formatter={(v: any) => fmt(v)} />
                          <Bar dataKey="value" fill={c.bg} radius={[0, 3, 3, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </>
              )
            })()}
          </>
        )}
      </section>

      {/* ── 12-Month Performance Trend ────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold tracking-widest text-gray-500 uppercase">12-Month Performance</h2>
            <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded-full">{country}</span>
          </div>
          <select
            value={trendMetric}
            onChange={e => setTrendMetric(e.target.value as any)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 bg-white"
          >
            <option value="wonValue">Revenue Won ($)</option>
            <option value="wonCount">Deals Won (count)</option>
            <option value="created">New Deals Created</option>
          </select>
        </div>
        {loading ? <div className="h-48 flex items-center justify-center text-gray-400">Loading...</div> : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }}
                tickFormatter={trendMetric === 'wonValue' ? (v: number) => `$${(v / 1000).toFixed(0)}K` : undefined} />
              <Tooltip formatter={(v: any) => trendMetric === 'wonValue' ? fmt(v) : v} />
              <Bar dataKey={trendMetric} name={trendLabel} fill={trendColor} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* ── Conversion Rate by Lead Source ───────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <SectionHeader title="Lead Origin Breakdown" badge="Year to date" />
        {loading ? <div className="h-24 flex items-center justify-center text-gray-400">Loading...</div> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
            <div>
              <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-3">New Leads — Sales vs Marketing</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={sectors?.sourcePie || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#6b7280' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    <Cell fill="#2563eb" />
                    <Cell fill="#EBA117" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-4 pt-2">
              {(sectors?.sourcePie || []).map((s: any, i: number) => {
                const total = (sectors?.sourcePie || []).reduce((acc: number, x: any) => acc + x.count, 0)
                const pct = total > 0 ? Math.round((s.count / total) * 100) : 0
                const color = i === 0 ? '#2563eb' : '#EBA117'
                return (
                  <div key={s.name} className="bg-gray-50 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                        <span className="text-sm font-semibold text-gray-700">{s.name}</span>
                      </div>
                      <span className="text-xl font-bold text-gray-900">{s.count.toLocaleString()}</span>
                    </div>
                    <div className="h-2 bg-gray-200 rounded-full">
                      <div className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{pct}% of all new leads</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </section>

      {/* ── Lead Economics & Marketing ROI ───────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <SectionHeader title="Lead Economics & Marketing ROI" badge="FY26/27 Budget" />

        {/* Top KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="bg-gray-50 rounded-xl p-5">
            <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">Total Marketing Budget</p>
            <p className="text-3xl font-bold text-gray-900">$870K</p>
            <p className="text-xs text-gray-400 mt-1">FY26/27 annual</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-5">
            <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">Operational Budget</p>
            <p className="text-3xl font-bold text-gray-900">$410K</p>
            <p className="text-xs text-gray-400 mt-1">Excl. wages ($460K)</p>
          </div>
          <div className="bg-blue-50 rounded-xl p-5">
            <p className="text-xs font-semibold tracking-widest text-blue-400 uppercase mb-2">Cost per Lead</p>
            <p className="text-3xl font-bold text-blue-700">
              {loading || !sectors ? '—' : sectors.marketingTotal > 0
                ? fmt(MKT_OPEX / sectors.marketingTotal)
                : '—'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              $410K OpEx ÷ {sectors?.marketingTotal ?? '—'} mkt leads (12 mo)
            </p>
          </div>
          <div className="bg-gray-50 rounded-xl p-5">
            <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">Ad Spend</p>
            <p className="text-3xl font-bold text-gray-900">{fmt(AD_SPEND)}</p>
            <p className="text-xs text-gray-400 mt-1">SEO / Google Ads budget</p>
            <p className="text-xs text-gray-400 mt-2">
              {loading || !sectors ? '—' : sectors.marketingTotal > 0
                ? `${fmt(AD_SPEND / sectors.marketingTotal)} per mkt lead`
                : '—'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
          {/* Cost per lead trend */}
          <div>
            <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-4">Cost per Lead — 12 Months</p>
            {loading || !sectors ? (
              <div className="h-[240px] flex items-center justify-center text-gray-400 text-sm">Loading...</div>
            ) : (() => {
              const monthlyOpex = MKT_OPEX / 12
              const cplData = (sectors.monthly as { label: string; Marketing: number; Sales: number }[])
                .map(m => ({
                  label: m.label,
                  cpl: m.Marketing >= 5 ? Math.round(monthlyOpex / m.Marketing) : null,
                }))
              return (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={cplData} margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={(v: any) => `$${(v / 1000).toFixed(0)}K`} />
                    <Tooltip formatter={(v: any) => [fmt(v), 'Cost per Lead']} />
                    <Line type="natural" dataKey="cpl" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} connectNulls={true} />
                  </LineChart>
                </ResponsiveContainer>
              )
            })()}
            <p className="text-xs text-gray-400 mt-2 text-center">Monthly OpEx ($410K ÷ 12) ÷ marketing leads that month — null months excluded</p>
          </div>

          {/* Revenue vs target */}
          <div>
            <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-4">Revenue vs Target — FY26/27</p>
            <div className="space-y-5">
              {/* Selected country */}
              <div>
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-sm font-semibold text-gray-700">{country}</span>
                  <span className="text-sm text-gray-600">
                    {loading ? '—' : country === 'NZ' ? fmt(sd?.fyWonValue ?? 0) : `A$${((sd?.fyWonValue ?? 0) / 1_000_000).toFixed(1)}M`}
                    <span className="text-gray-400"> / {country === 'NZ' ? '$18M' : 'A$2.4M'} target</span>
                  </span>
                </div>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-3 rounded-full transition-all"
                    style={{ width: `${Math.min(100, ((sd?.fyWonValue ?? 0) / (country === 'NZ' ? NZ_REVENUE_TARGET : AU_REVENUE_TARGET_AUD)) * 100)}%`, backgroundColor: c.bg }} />
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {(((sd?.fyWonValue ?? 0) / (country === 'NZ' ? NZ_REVENUE_TARGET : AU_REVENUE_TARGET_AUD)) * 100).toFixed(1)}% of {sd?.fyLabel ?? 'FY'} target
                </p>
              </div>

              {/* Avg deal + estimated lead value */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="bg-gray-50 rounded-xl p-4">
                  <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">Avg Deal Size</p>
                  <p className="text-2xl font-bold text-gray-900">{loading ? '—' : fmt(sd?.avgDealSize ?? 0)}</p>
                  <p className="text-xs text-gray-400 mt-1">Open pipeline avg</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4">
                  <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">Est. Value per Lead</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {loading ? '—' : fmt((sd?.avgDealSize ?? 0) * (sd?.fyWinRate ?? 0) / 100)}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">At {sd?.fyWinRate ?? '—'}% FY win rate</p>
                </div>
              </div>

              {/* Target ROI */}
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">Marketing ROI Target</p>
                <p className="text-2xl font-bold text-gray-900">7.5×</p>
                <p className="text-xs text-gray-400">$3.1M target revenue ÷ $410K OpEx · based on FY26/27 plan</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Repeat vs New Customers ───────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <SectionHeader title="Repeat vs New Customers" badge="Deals won — last 3 months" />
        {!repeatCustomers ? (
          <div className="h-32 flex items-center justify-center text-gray-400 text-sm">Loading...</div>
        ) : repeatCustomers.error ? (
          <p className="text-sm text-red-400">Could not load — check Vercel logs for details.</p>
        ) : (
          <div className="flex items-center gap-10">
            {/* Donut */}
            <PieChart width={180} height={180}>
              <Pie data={[
                { name: 'Returning', value: repeatCustomers.returning },
                { name: 'New', value: repeatCustomers.new },
                ...(repeatCustomers.unlinked > 0 ? [{ name: 'No company', value: repeatCustomers.unlinked }] : [])
              ]} innerRadius={52} outerRadius={80} dataKey="value" paddingAngle={2}>
                <Cell fill="#2563eb" />
                <Cell fill="#EBA117" />
                <Cell fill="#e5e7eb" />
              </Pie>
              <Tooltip formatter={(v: any, name: any) => [`${v} deal${v !== 1 ? 's' : ''}`, name]} />
            </PieChart>

            {/* Stats */}
            <div className="flex gap-6">
              <div className="bg-blue-50 rounded-xl p-5 min-w-[140px]">
                <p className="text-xs font-semibold tracking-widest text-blue-400 uppercase mb-2">Returning</p>
                <p className="text-4xl font-bold text-blue-700">{repeatCustomers.returningPct}%</p>
                <p className="text-xs text-gray-400 mt-1">{repeatCustomers.returning} deal{repeatCustomers.returning !== 1 ? 's' : ''}</p>
                <p className="text-xs text-gray-400">Company had a prior win</p>
              </div>
              <div className="bg-amber-50 rounded-xl p-5 min-w-[140px]">
                <p className="text-xs font-semibold tracking-widest text-amber-500 uppercase mb-2">New</p>
                <p className="text-4xl font-bold text-amber-600">{repeatCustomers.newPct}%</p>
                <p className="text-xs text-gray-400 mt-1">{repeatCustomers.new} deal{repeatCustomers.new !== 1 ? 's' : ''}</p>
                <p className="text-xs text-gray-400">First win for this company</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-5 min-w-[120px]">
                <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">Total</p>
                <p className="text-4xl font-bold text-gray-800">{repeatCustomers.total}</p>
                <p className="text-xs text-gray-400 mt-1">Deals won in last 3 months</p>
                {repeatCustomers.unlinked > 0 && (
                  <p className="text-xs text-gray-400 mt-1">{repeatCustomers.unlinked} no company linked</p>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── Form Submissions ──────────────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <SectionHeader title="Form Submissions" badge="Year to date" />
        {loading ? <div className="h-48 flex items-center justify-center text-gray-400">Loading...</div> : (
          <>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-gray-50 rounded-xl p-5">
                <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">Total Submissions</p>
                <p className="text-4xl font-bold text-gray-900">{forms?.total ?? '—'}</p>
                <p className="text-xs text-gray-400 mt-1">Year to date · {country}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-5">
                <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">Avg Per Month</p>
                <p className="text-4xl font-bold text-gray-900">{forms?.avgPerMonth ?? '—'}</p>
                <p className="text-xs text-gray-400 mt-1">Monthly average</p>
              </div>
            </div>
            <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-3">Monthly Form Submissions — {country}</p>
            <div ref={formChartRef}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={forms?.monthly || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                  <Tooltip />
                  <Bar dataKey="count" fill={c.bg} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </section>

      {/* ── Email Marketing ───────────────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <SectionHeader title="Email Marketing" badge="Last 10 campaigns" />
        {loading ? <div className="h-32 flex items-center justify-center text-gray-400">Loading...</div> : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-1">Emails Sent</p>
                <p className="text-2xl font-bold text-gray-900">{emails?.totals?.sent?.toLocaleString() ?? '—'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-1">Delivered</p>
                <p className="text-2xl font-bold text-gray-900">{emails?.totals?.delivered?.toLocaleString() ?? '—'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-1">Avg Open Rate</p>
                <p className="text-2xl font-bold text-green-600">{emails?.avgOpenRate ?? '—'}%</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-1">Avg Click Rate</p>
                <p className="text-2xl font-bold text-blue-600">{emails?.avgClickRate ?? '—'}%</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-1">Unsubscribes</p>
                <p className="text-2xl font-bold text-red-500">{emails?.totals?.unsubscribed?.toLocaleString() ?? '—'}</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-100">
                    {['Campaign', 'Subject', 'Sent', 'Delivered', 'Open Rate', 'Click Rate', 'Bounces', 'Unsubs'].map(h => (
                      <th key={h} className="px-3 py-2 text-xs font-semibold tracking-widest text-gray-400 uppercase whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(emails?.campaigns || []).map((campaign: any) => (
                    <tr key={campaign.id} className="hover:bg-gray-50">
                      <td className="px-3 py-3 text-sm font-medium text-gray-800 max-w-[160px] truncate">{campaign.name}</td>
                      <td className="px-3 py-3 text-xs text-gray-500 max-w-[200px] truncate">{campaign.subject}</td>
                      <td className="px-3 py-3 text-sm text-gray-700">{campaign.sent?.toLocaleString()}</td>
                      <td className="px-3 py-3 text-sm text-gray-700">{campaign.delivered?.toLocaleString()}</td>
                      <td className="px-3 py-3">
                        <span className={`text-sm font-semibold ${parseFloat(campaign.openRate) >= 20 ? 'text-green-600' : parseFloat(campaign.openRate) >= 10 ? 'text-yellow-600' : 'text-red-500'}`}>
                          {campaign.openRate}%
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`text-sm font-semibold ${parseFloat(campaign.clickRate) >= 2 ? 'text-green-600' : 'text-gray-600'}`}>
                          {campaign.clickRate}%
                        </span>
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-600">{campaign.bounce?.toLocaleString()}</td>
                      <td className="px-3 py-3 text-sm text-red-400">{campaign.unsubscribed?.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-6" ref={emailChartRef}>
              <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-3">Open Rate vs Click Rate by Campaign</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={(emails?.campaigns || []).map((cam: any) => ({
                  name: cam.name.length > 18 ? cam.name.slice(0, 18) + '…' : cam.name,
                  'Open Rate': parseFloat(cam.openRate),
                  'Click Rate': parseFloat(cam.clickRate),
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} unit="%" />
                  <Tooltip formatter={(v: any) => `${v}%`} />
                  <Legend />
                  <Bar dataKey="Open Rate" fill="#059669" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Click Rate" fill="#2563eb" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </section>

      {/* ── Contact Database ──────────────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <SectionHeader title="Contact Database" badge="CRM" />
        {loading ? <div className="h-32 flex items-center justify-center text-gray-400">Loading...</div> : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="bg-gray-50 rounded-xl p-5">
                <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">Total Contacts</p>
                <p className="text-4xl font-bold text-gray-900">{contacts?.total?.toLocaleString() ?? '—'}</p>
                <p className="text-xs text-gray-400 mt-1">In HubSpot CRM</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-5">
                <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">New This Month</p>
                <p className="text-4xl font-bold text-gray-900">
                  {contacts?.monthly?.length ? contacts.monthly[contacts.monthly.length - 1]?.count ?? '—' : '—'}
                </p>
                <p className="text-xs text-gray-400 mt-1">Current month</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-5">
                <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">Avg New / Month</p>
                <p className="text-4xl font-bold text-gray-900">
                  {contacts?.monthly?.length
                    ? Math.round(contacts.monthly.reduce((s: number, m: any) => s + m.count, 0) / contacts.monthly.length)
                    : '—'}
                </p>
                <p className="text-xs text-gray-400 mt-1">Year to date</p>
              </div>
            </div>
            <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-3">New Contacts Per Month</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={contacts?.monthly || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <Tooltip />
                <Bar dataKey="count" fill={c.bg} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </>
        )}
      </section>

      {/* ── Recent Instagram Posts ────────────────────────────────────────────── */}
      {instagram?.configured && (
        <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold tracking-widest text-gray-500 uppercase">Recent Instagram Posts</h2>
              {instagram.followersCount && (
                <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded-full">
                  {instagram.followersCount.toLocaleString()} followers
                </span>
              )}
            </div>
            <a href={`https://www.instagram.com/${instagram.username}`} target="_blank" rel="noreferrer"
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
              @{instagram.username}
            </a>
          </div>
          {instagram.error ? (
            <p className="text-sm text-red-400">Could not load Instagram posts.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {(instagram.recentPosts || []).map((post: any, i: number) => (
                <a key={i} href={post.permalink} target="_blank" rel="noreferrer"
                  className="bg-gray-50 rounded-xl p-4 hover:bg-gray-100 transition-colors group">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      {post.mediaType === 'VIDEO' ? 'Reel / Video' : post.mediaType === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Photo'}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(post.timestamp).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 line-clamp-3 mb-3 min-h-[60px]">
                    {post.caption || <span className="italic text-gray-400">No caption</span>}
                  </p>
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span>❤️ {post.likeCount.toLocaleString()}</span>
                    <span>💬 {post.commentsCount.toLocaleString()}</span>
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>
      )}

      </>}

    </div>
  )
}
