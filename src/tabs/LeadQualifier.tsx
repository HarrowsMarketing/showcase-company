import { useEffect, useState } from 'react'
import axios from 'axios'
import { cachedGet } from '../lib/apiCache'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

interface Lead {
  id: string; name: string; title: string; company: string
  owner: string; status: string; score: number
  tags: { label: string; pts: number }[]; country: string; daysAgo: number
}

interface Analysis {
  generatedAt: string
  customerCount: number
  leadCount: number
  averages: {
    customers: Record<string, number>
    leads: Record<string, number>
  }
  trafficSources: {
    customers: { source: string; count: number; pct: string }[]
    leads: { source: string; count: number; pct: string }[]
  }
  titlePatterns: {
    customers: { keyword: string; pct: number }[]
    leads: { keyword: string; pct: number }[]
  }
  avgDaysToConvert: number | null
  conversionDrivers: { key: string; label: string; custAvg: number; leadAvg: number; lift: number }[]
  scoringRules: { category: string; items: { label: string; pts: number }[] }[]
  empty?: boolean
}

function ScoreBadge({ score }: { score: number }) {
  if (score >= 70) return (
    <div className="flex flex-col items-center justify-center bg-red-600 text-white rounded-lg px-3 py-2 min-w-[60px]">
      <span className="text-xl font-bold">{score}</span>
      <span className="text-xs font-semibold">HOT</span>
    </div>
  )
  if (score >= 40) return (
    <div className="flex flex-col items-center justify-center bg-amber-500 text-white rounded-lg px-3 py-2 min-w-[60px]">
      <span className="text-xl font-bold">{score}</span>
      <span className="text-xs font-semibold">WARM</span>
    </div>
  )
  return (
    <div className="flex flex-col items-center justify-center bg-gray-200 text-gray-600 rounded-lg px-3 py-2 min-w-[60px]">
      <span className="text-xl font-bold">{score}</span>
      <span className="text-xs font-semibold">COOL</span>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    'OPEN_DEAL': 'OPPORTUNITY', 'IN_PROGRESS': 'IN PROGRESS',
    'LEAD': 'LEAD', 'NEW': 'NEW', 'CONNECTED': 'CONNECTED',
    'QUALIFIED': 'QUALIFIED', 'UNQUALIFIED': 'UNQUALIFIED',
  }
  const isOpp = ['OPEN_DEAL', 'IN_PROGRESS', 'OPPORTUNITY'].includes(status)
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${isOpp ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-600'}`}>
      {map[status] || status}
    </span>
  )
}

function LiftBar({ label, custVal, leadVal, lift }: { label: string; custVal: number; leadVal: number; lift: number }) {
  const liftColor = lift >= 2 ? 'text-green-600' : lift >= 1.3 ? 'text-yellow-600' : 'text-gray-500'
  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-50">
      <span className="text-sm text-gray-700 w-44 shrink-0">{label}</span>
      <div className="flex-1">
        <div className="flex gap-2 items-center text-xs mb-1">
          <span className="text-blue-600 w-20">Customers: {Number(custVal).toFixed(1)}</span>
          <span className="text-gray-400 w-20">Leads: {Number(leadVal).toFixed(1)}</span>
        </div>
        <div className="flex gap-1 h-2">
          <div className="bg-blue-500 rounded" style={{ width: `${Math.min((custVal / (Math.max(custVal, leadVal) || 1)) * 100, 100)}%`, minWidth: custVal > 0 ? '4px' : '0' }} />
          <div className="bg-gray-200 rounded" style={{ width: `${Math.min((leadVal / (Math.max(custVal, leadVal) || 1)) * 100, 100)}%`, minWidth: leadVal > 0 ? '4px' : '0' }} />
        </div>
      </div>
      <span className={`text-sm font-bold w-16 text-right ${liftColor}`}>{lift}x lift</span>
    </div>
  )
}

export default function LeadQualifier() {
  const [leads, setLeads] = useState<{ total: number; leads: Lead[] } | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [loadingLeads, setLoadingLeads] = useState(true)
  const [loadingAnalysis, setLoadingAnalysis] = useState(true)
  const [runningAnalysis, setRunningAnalysis] = useState(false)
  const [activeSection, setActiveSection] = useState<'leads' | 'analysis'>('leads')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [activities, setActivities] = useState<Record<string, any[]>>({})
  const [loadingActivities, setLoadingActivities] = useState<Set<string>>(new Set())

  useEffect(() => {
    cachedGet('/api/hubspot/leads')
      .then(r => setLeads(r.data))
      .catch(console.error)
      .finally(() => setLoadingLeads(false))

    cachedGet('/api/analysis/results')
      .then(r => setAnalysis(r.data))
      .catch(console.error)
      .finally(() => setLoadingAnalysis(false))
  }, [])

  const runAnalysis = async () => {
    setRunningAnalysis(true)
    try {
      await cachedGet('/api/analysis/run')
      const r = await cachedGet('/api/analysis/results')
      setAnalysis(r.data)
    } catch (e) {
      console.error(e)
    } finally {
      setRunningAnalysis(false)
    }
  }

  const toggleExpand = async (id: string) => {
    const next = new Set(expanded)
    if (next.has(id)) {
      next.delete(id)
      setExpanded(next)
      return
    }
    next.add(id)
    setExpanded(next)
    if (!activities[id]) {
      setLoadingActivities(prev => new Set(prev).add(id))
      try {
        const r = await cachedGet(`/api/hubspot/contact/${id}/activities`)
        setActivities(prev => ({ ...prev, [id]: r.data.activities || [] }))
      } catch {
        setActivities(prev => ({ ...prev, [id]: [] }))
      } finally {
        setLoadingActivities(prev => { const s = new Set(prev); s.delete(id); return s })
      }
    }
  }

  const hot = leads?.leads.filter(l => l.score >= 70).length ?? 0
  const warm = leads?.leads.filter(l => l.score >= 40 && l.score < 70).length ?? 0

  const sourceChartData = analysis?.trafficSources
    ? (() => {
        const allSources = new Set([
          ...analysis.trafficSources.customers.map(s => s.source),
          ...analysis.trafficSources.leads.map(s => s.source),
        ])
        return Array.from(allSources).map(src => ({
          source: src.replace(/_/g, ' ').replace('TRAFFIC', '').trim(),
          Customers: parseFloat(analysis.trafficSources.customers.find(s => s.source === src)?.pct || '0'),
          Leads: parseFloat(analysis.trafficSources.leads.find(s => s.source === src)?.pct || '0'),
        })).sort((a, b) => b.Customers - a.Customers).slice(0, 6)
      })()
    : []

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Lead Qualifier</h1>
            <span className="text-xs px-2 py-1 bg-blue-50 text-blue-600 border border-blue-200 rounded-full">Data-driven</span>
          </div>
          <p className="text-sm text-gray-400 mt-1">{leads?.total ?? '—'} leads scanned · scored against {analysis?.customerCount ?? '—'} real customers</p>
        </div>
        <button
          onClick={runAnalysis}
          disabled={runningAnalysis}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
        >
          <svg className={`w-4 h-4 ${runningAnalysis ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {runningAnalysis ? 'Analysing… (~30s)' : 'Run Analysis Now'}
        </button>
      </div>

      {/* Section toggle */}
      <div className="flex gap-2 border-b border-gray-200">
        {([['leads', 'Ranked Leads'], ['analysis', 'Conversion Analysis']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveSection(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${activeSection === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {label}
          </button>
        ))}
        {analysis && !analysis.empty && (
          <span className="ml-auto text-xs text-gray-400 self-center pb-2">
            Last run: {new Date(analysis.generatedAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · Runs daily weekdays 7am
          </span>
        )}
      </div>

      {/* ── RANKED LEADS ─────────────────────────────────────────────────── */}
      {activeSection === 'leads' && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">Leads Scanned</p>
              <p className="text-4xl font-bold text-gray-900">{leads?.total ?? '—'}</p>
              <p className="text-xs text-gray-400 mt-1">Last 90 days</p>
            </div>
            <div className="bg-white rounded-xl border-2 border-red-200 p-5 shadow-sm">
              <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">Hot Leads</p>
              <p className="text-4xl font-bold text-red-600">{hot}</p>
              <p className="text-xs text-gray-400 mt-1">Score 70+</p>
            </div>
            <div className="bg-white rounded-xl border-2 border-amber-200 p-5 shadow-sm">
              <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">Warm Leads</p>
              <p className="text-4xl font-bold text-amber-500">{warm}</p>
              <p className="text-xs text-gray-400 mt-1">Score 40–69</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-widest text-gray-500 uppercase">
                Top {leads?.leads.length ?? 0} Leads — Ranked by Buying Signal Score
              </h2>
            </div>
            {loadingLeads ? (
              <div className="flex items-center justify-center py-16 text-gray-400">Loading leads...</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {(leads?.leads || []).map((lead, i) => {
                  const isExpanded = expanded.has(lead.id)
                  const isLoadingAct = loadingActivities.has(lead.id)
                  const leadActivities = activities[lead.id] || []
                  const TYPE_ICONS: Record<string, string> = { Email: '✉', Call: '📞', Meeting: '📅', Task: '✓', Note: '📝' }
                  const TYPE_COLORS: Record<string, string> = { Email: 'bg-blue-50 text-blue-600', Call: 'bg-green-50 text-green-600', Meeting: 'bg-purple-50 text-purple-600', Task: 'bg-orange-50 text-orange-600', Note: 'bg-gray-50 text-gray-600' }
                  return (
                    <div key={lead.id} className="border-b border-gray-50 last:border-0">
                      <div
                        className="px-6 py-4 hover:bg-gray-50 transition-colors cursor-pointer"
                        onClick={() => toggleExpand(lead.id)}
                      >
                        <div className="flex items-center gap-4">
                          <span className="text-sm font-bold text-gray-300 w-6 text-right">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-semibold text-gray-900 truncate">{lead.name}</span>
                              <StatusBadge status={lead.status} />
                            </div>
                            <p className="text-xs text-gray-400 truncate">
                              {lead.title}{lead.title && lead.company ? ' · ' : ''}{lead.company}
                              {lead.owner !== 'Unassigned' && <span className="ml-2">· {lead.owner}</span>}
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-2">
                              {lead.tags.map((tag, ti) => (
                                <span key={ti} className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full">
                                  {tag.label} <span className="font-semibold">+{tag.pts}</span>
                                </span>
                              ))}
                              <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">{lead.country}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-xs text-gray-400">{lead.daysAgo}d ago</span>
                            <ScoreBadge score={lead.score} />
                            <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="px-6 pb-4 bg-gray-50 border-t border-gray-100">
                          <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase pt-3 mb-2">Last 5 Activities</p>
                          {isLoadingAct ? (
                            <p className="text-xs text-gray-400 py-2">Loading activities...</p>
                          ) : leadActivities.length === 0 ? (
                            <p className="text-xs text-gray-400 py-2">No activities recorded</p>
                          ) : (
                            <div className="space-y-2">
                              {leadActivities.map((act, ai) => (
                                <div key={ai} className="flex items-start gap-3">
                                  <span className={`text-xs px-2 py-0.5 rounded font-medium shrink-0 ${TYPE_COLORS[act.typeLabel] || 'bg-gray-50 text-gray-500'}`}>
                                    {TYPE_ICONS[act.typeLabel] || '·'} {act.typeLabel}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs text-gray-700 truncate">{act.subject}</p>
                                    {act.duration && <p className="text-xs text-gray-400">{act.duration}</p>}
                                  </div>
                                  <span className="text-xs text-gray-400 shrink-0">
                                    {act.timestamp ? new Date(act.timestamp).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: '2-digit' }) : ''}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── CONVERSION ANALYSIS ──────────────────────────────────────────── */}
      {activeSection === 'analysis' && (
        <>
          {loadingAnalysis ? (
            <div className="flex items-center justify-center py-16 text-gray-400">Loading analysis...</div>
          ) : analysis?.empty ? (
            <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
              <p className="text-gray-500 font-medium mb-2">No analysis run yet</p>
              <p className="text-sm text-gray-400 mb-6">Click "Run Analysis Now" to analyse your {(3564).toLocaleString()} customers and find what triggers conversion at YourCompany.</p>
              <button onClick={runAnalysis} disabled={runningAnalysis} className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60">
                {runningAnalysis ? 'Running… (~30s)' : 'Run Analysis Now'}
              </button>
            </div>
          ) : analysis ? (
            <div className="space-y-6">

              {/* Key stats */}
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                  <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">Customers Analysed</p>
                  <p className="text-3xl font-bold text-gray-900">{analysis.customerCount}</p>
                  <p className="text-xs text-gray-400 mt-1">Used to build scoring model</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                  <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">Leads Compared</p>
                  <p className="text-3xl font-bold text-gray-900">{analysis.leadCount}</p>
                  <p className="text-xs text-gray-400 mt-1">Non-customers baseline</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                  <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">Avg Days to Convert</p>
                  <p className="text-3xl font-bold text-gray-900">{analysis.avgDaysToConvert ?? '—'}</p>
                  <p className="text-xs text-gray-400 mt-1">From first contact to customer</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                  <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">Top Lift Factor</p>
                  <p className="text-3xl font-bold text-green-600">{analysis.conversionDrivers?.[0]?.lift ?? '—'}x</p>
                  <p className="text-xs text-gray-400 mt-1">{analysis.conversionDrivers?.[0]?.label}</p>
                </div>
              </div>

              {/* Conversion drivers */}
              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <h2 className="text-sm font-semibold tracking-widest text-gray-500 uppercase mb-4">
                  Conversion Drivers — Customers vs Non-Customers
                </h2>
                <p className="text-xs text-gray-400 mb-4">Lift = how much more of this behaviour customers show vs non-customers. Higher = stronger signal.</p>
                <div className="flex gap-4 text-xs mb-3">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-500 inline-block" /> Customers (avg)</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-200 inline-block" /> Non-customers (avg)</span>
                </div>
                {analysis.conversionDrivers.map(d => (
                  <LiftBar key={d.key} label={d.label} custVal={d.custAvg} leadVal={d.leadAvg} lift={d.lift} />
                ))}
              </div>

              {/* Traffic source comparison */}
              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <h2 className="text-sm font-semibold tracking-widest text-gray-500 uppercase mb-4">Traffic Source — Customers vs Non-Customers (%)</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={sourceChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="source" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} unit="%" />
                    <Tooltip formatter={(v: any) => `${v}%`} />
                    <Legend />
                    <Bar dataKey="Customers" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Leads" fill="#e5e7eb" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Job title patterns */}
              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <h2 className="text-sm font-semibold tracking-widest text-gray-500 uppercase mb-4">Job Title Patterns — % with this keyword in title</h2>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <p className="text-xs font-semibold text-blue-600 uppercase tracking-widest mb-3">In Customers</p>
                    {analysis.titlePatterns.customers.map(t => (
                      <div key={t.keyword} className="flex items-center gap-3 mb-2">
                        <span className="text-sm text-gray-700 capitalize w-28">{t.keyword}</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-2">
                          <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${Math.min(t.pct * 3, 100)}%` }} />
                        </div>
                        <span className="text-xs text-gray-500 w-10 text-right">{t.pct.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">In Non-Customers</p>
                    {analysis.titlePatterns.leads.map(t => (
                      <div key={t.keyword} className="flex items-center gap-3 mb-2">
                        <span className="text-sm text-gray-700 capitalize w-28">{t.keyword}</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-2">
                          <div className="bg-gray-300 h-2 rounded-full" style={{ width: `${Math.min(t.pct * 3, 100)}%` }} />
                        </div>
                        <span className="text-xs text-gray-500 w-10 text-right">{t.pct.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Derived scoring matrix */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100">
                  <h2 className="text-sm font-semibold tracking-widest text-gray-500 uppercase">Derived Scoring Matrix</h2>
                  <p className="text-xs text-gray-400 mt-1">Built from your actual customer data — updates daily</p>
                </div>
                <div className="divide-y divide-gray-50">
                  {analysis.scoringRules.map(group => (
                    <div key={group.category}>
                      <div className="px-6 py-2 bg-gray-50">
                        <span className="text-xs font-semibold tracking-widest text-gray-400 uppercase">{group.category}</span>
                      </div>
                      {group.items.map((item, i) => (
                        <div key={i} className="flex items-center justify-between px-6 py-3">
                          <span className="text-sm text-gray-700">{item.label}</span>
                          <span className="text-sm font-semibold text-blue-600">+{item.pts} pts</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>

            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
