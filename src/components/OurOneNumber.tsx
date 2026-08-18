import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import { cachedGet } from '../lib/apiCache'

// "Our One Number" (MQLs) — styled to match the rest of the Marketing KPIs
// dashboard (white cards, brand yellow used only as an accent). Fetches its own
// snapshot / trend / pipeline data and carries the three drill-down modals.

const BRAND = '#EBA117'

interface MqlSnapshot { total: number; newThisMonth: number; sqlThisMonth: number }

interface MqlPipelineData {
  newPipelineThisMonth: number
  newPipelineLastMonth: number
  wonThisMonth: number
  wonLastMonth: number
  history: { month: string; newPipeline: number; won: number }[]
}

interface MqlContactRow {
  id: string
  name: string
  email: string | null
  company: string | null
  jobTitle: string | null
  date: string
}

interface SqlContact {
  id: string
  name: string
  email: string | null
  company: string | null
  jobTitle: string | null
  lifecyclestage: string
  source: 'SQL' | 'Opportunity' | 'Customer'
  date: string
}

interface PipelineDeal {
  id: string
  dealname: string
  amount: number
  contactName: string | null
  company: string | null
  date: string
}

function fmtCurrency(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`
  return `$${n.toFixed(0)}`
}

function pctChange(current: number, previous: number): number | null {
  if (!previous || previous <= 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

function DeltaChip({ pct }: { pct: number }) {
  const up = pct >= 0
  return (
    <span className={`text-xs font-semibold ${up ? 'text-green-600' : 'text-red-500'}`}>
      {up ? '↑' : '↓'}{Math.abs(pct)}%
    </span>
  )
}

// Progress against a monthly target, shown under a KPI number. Only rendered when
// a target is actually set for the current month (see MarketingTargetsPanel).
function TargetBar({ value, target }: { value: number; target: number }) {
  const pct = Math.round((value / target) * 100)
  const hit = value >= target
  return (
    <div className="mt-2.5">
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-1.5 rounded-full transition-all"
          style={{ width: `${Math.min(100, pct)}%`, backgroundColor: hit ? '#059669' : BRAND }}
        />
      </div>
      <p className="text-[11px] text-gray-400 mt-1">
        {pct}% of {target.toLocaleString('en-NZ')} target{hit ? ' · target hit' : ''}
      </p>
    </div>
  )
}

// A clickable KPI tile in the standard dashboard card style.
function KpiCard({
  label, sub, accent, loading, onClick, children,
}: {
  label: string
  sub?: string
  accent?: string
  loading?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  const clickable = !!onClick
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className={`text-left bg-white rounded-2xl border border-gray-200 p-5 shadow-sm transition-all ${clickable ? 'hover:shadow-md hover:border-gray-300 cursor-pointer' : 'cursor-default'}`}
      style={accent ? { borderTop: `3px solid ${accent}` } : undefined}
    >
      <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">{label}</p>
      {loading ? <div className="h-9 w-24 bg-gray-100 rounded animate-pulse" /> : children}
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}{clickable && <span className="text-gray-300"> · view →</span>}</p>}
    </button>
  )
}

export default function OurOneNumber({ country = 'NZ' }: { country?: 'NZ' | 'AU' }) {
  const [mql, setMql] = useState<MqlSnapshot | null>(null)
  const [loadingSnapshot, setLoadingSnapshot] = useState(true)
  const [mqlTrend, setMqlTrend] = useState<{ month: string; count: number }[]>([])

  const [showMqlModal, setShowMqlModal] = useState(false)
  const [mqlContacts, setMqlContacts] = useState<MqlContactRow[] | null>(null)
  const [mqlContactsLoading, setMqlContactsLoading] = useState(false)

  const [showSqlModal, setShowSqlModal] = useState(false)
  const [sqlContacts, setSqlContacts] = useState<SqlContact[] | null>(null)
  const [sqlContactsLoading, setSqlContactsLoading] = useState(false)

  // This month's MQL / SQL targets, set in the tab's Edit Targets panel. 0 = unset.
  const [targets, setTargets] = useState<{ mql: number; sql: number }>({ mql: 0, sql: 0 })

  function openMqlContactsModal() {
    setShowMqlModal(true)
    if (mqlContacts) return
    setMqlContactsLoading(true)
    cachedGet('/api/meeting/mql-contacts')
      .then(r => setMqlContacts(r.data.contacts))
      .catch(() => setMqlContacts([]))
      .finally(() => setMqlContactsLoading(false))
  }

  function openSqlContactsModal() {
    setShowSqlModal(true)
    if (sqlContacts) return
    setSqlContactsLoading(true)
    cachedGet('/api/meeting/sql-contacts')
      .then(r => setSqlContacts(r.data.contacts))
      .catch(() => setSqlContacts([]))
      .finally(() => setSqlContactsLoading(false))
  }

  // MQL snapshot number — country-dependent, re-fetches when the toggle changes
  useEffect(() => {
    setLoadingSnapshot(true)
    setMql(null)
    cachedGet('/api/meeting/snapshot', { params: { country } })
      .then(r => setMql(r.data.mql))
      .catch(console.error)
      .finally(() => setLoadingSnapshot(false))
  }, [country])

  // MQL trend + pipeline values — fetched once (not country-dependent)
  useEffect(() => {
    cachedGet('/api/meeting/mql-trend')
      .then(r => setMqlTrend(r.data))
      .catch(console.error)
  }, [])

  useEffect(() => {
    cachedGet('/api/marketing/targets')
      .then(r => setTargets({ mql: r.data?.current?.mql ?? 0, sql: r.data?.current?.sql ?? 0 }))
      .catch(console.error)
  }, [])

  return (
    <div className="space-y-6">
      {/* ── Our One Number — MQLs ──────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-sm font-semibold tracking-widest text-gray-500 uppercase">Our One Number</h2>
          <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded-full">MQLs</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Hero — total MQLs */}
          <KpiCard label="Marketing Qualified Leads" sub="currently at MQL stage" accent={BRAND} loading={loadingSnapshot}>
            <p className="text-5xl font-extrabold leading-none" style={{ color: BRAND }}>{mql?.total ?? '—'}</p>
          </KpiCard>

          {/* New MQLs this month — with progress against this month's target */}
          <KpiCard label="New MQLs" sub="this month" loading={loadingSnapshot} onClick={openMqlContactsModal}>
            <div className="flex items-baseline gap-2">
              <p className="text-4xl font-bold text-gray-900 leading-none">+{mql?.newThisMonth ?? 0}</p>
              {targets.mql > 0 && <span className="text-xs text-gray-400">of {targets.mql.toLocaleString('en-NZ')}</span>}
            </div>
            {targets.mql > 0 && <TargetBar value={mql?.newThisMonth ?? 0} target={targets.mql} />}
          </KpiCard>

          {/* Pushed to SQL this month — i.e. new SQLs, against this month's target */}
          <KpiCard label="Pushed to SQL" sub="this month" loading={loadingSnapshot} onClick={openSqlContactsModal}>
            <div className="flex items-baseline gap-2">
              <p className="text-4xl font-bold text-gray-900 leading-none">{mql?.sqlThisMonth ?? 0}</p>
              {targets.sql > 0 && <span className="text-xs text-gray-400">of {targets.sql.toLocaleString('en-NZ')}</span>}
            </div>
            {targets.sql > 0 && <TargetBar value={mql?.sqlThisMonth ?? 0} target={targets.sql} />}
          </KpiCard>
        </div>
      </section>

      {/* ── MQL Trend ──────────────────────────────────────────────────────────── */}
      {mqlTrend.length > 0 && (
        <section className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-4">MQL Trend</p>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={mqlTrend} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
              <defs>
                <linearGradient id="mqlGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={BRAND} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={BRAND} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', fontSize: 12 }}
                formatter={(v: any) => [v, 'MQLs']}
              />
              <Area type="monotone" dataKey="count" stroke={BRAND} strokeWidth={2} fill="url(#mqlGrad)" dot={{ fill: BRAND, r: 3 }} />
            </AreaChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* Drill-down modals */}
      {showMqlModal && (
        <MqlContactsModal contacts={mqlContacts} loading={mqlContactsLoading} onClose={() => setShowMqlModal(false)} />
      )}
      {showSqlModal && (
        <SqlContactsModal contacts={sqlContacts} loading={sqlContactsLoading} onClose={() => setShowSqlModal(false)} />
      )}
    </div>
  )
}

// ── Sales-from-marketing money tiles (New Pipeline + Sales Won) ────────────────
// Lives on the Marketing KPIs → Revenue tab. Both figures use the deal-level
// lead_source_team = "Marketing Team" field (same as the by-lead-source graphs):
// New Pipeline = deals created this month; Sales Won = won-stage deals closed this
// month. Totals + drill-down deal lists come from /api/meeting/marketing-won.
interface MoneyBucket { thisMonth: number; lastMonth: number; deals: PipelineDeal[] }

export function SalesFromMarketingTiles() {
  const [data, setData] = useState<{ won: MoneyBucket; newPipeline: MoneyBucket } | null>(null)
  const [modal, setModal] = useState<'new' | 'won' | null>(null)

  useEffect(() => {
    const empty: MoneyBucket = { thisMonth: 0, lastMonth: 0, deals: [] }
    cachedGet('/api/meeting/marketing-won')
      .then(r => setData(r.data))
      .catch(() => setData({ won: empty, newPipeline: empty }))
  }, [])

  const newPct = data ? pctChange(data.newPipeline.thisMonth, data.newPipeline.lastMonth) : null
  const wonPct = data ? pctChange(data.won.thisMonth, data.won.lastMonth) : null

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <KpiCard label="New Pipeline" sub="marketing lead source · this month" onClick={() => setModal('new')}>
          {data ? (
            <div className="flex items-baseline gap-2">
              <p className="text-4xl font-bold text-gray-900 leading-none">{fmtCurrency(data.newPipeline.thisMonth)}</p>
              {newPct !== null && <DeltaChip pct={newPct} />}
            </div>
          ) : (
            <div className="h-9 w-24 bg-gray-100 rounded animate-pulse" />
          )}
        </KpiCard>
        <KpiCard label="Sales Won" sub="marketing lead source · this month" accent="#059669" onClick={() => setModal('won')}>
          {data ? (
            <div className="flex items-baseline gap-2">
              <p className="text-4xl font-bold text-green-700 leading-none">{fmtCurrency(data.won.thisMonth)}</p>
              {wonPct !== null && <DeltaChip pct={wonPct} />}
            </div>
          ) : (
            <div className="h-9 w-24 bg-gray-100 rounded animate-pulse" />
          )}
        </KpiCard>
      </div>
      {modal && (
        <PipelineDealsModal
          title={modal === 'new' ? 'New Pipeline From Marketing This Month' : 'Sales Won From Marketing This Month'}
          emptyText={modal === 'new' ? 'No new pipeline from marketing (lead source) yet this month.' : 'No deals won from marketing (lead source) yet this month.'}
          deals={modal === 'new' ? data?.newPipeline.deals ?? null : data?.won.deals ?? null}
          loading={data === null}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

const SQL_SOURCE_BADGE: Record<SqlContact['source'], string> = {
  SQL: 'bg-amber-50 text-amber-700',
  Opportunity: 'bg-blue-50 text-blue-700',
  Customer: 'bg-green-50 text-green-700',
}

// Generic scrollable drill-down modal — same backdrop/scroll pattern as the
// Marketing Meeting tab, reused for every "click a number, see the list" popup.
function DrilldownModal<T extends { id: string }>({
  title, items, loading, emptyText, renderRow, onClose,
}: {
  title: string
  items: T[] | null
  loading: boolean
  emptyText: string
  renderRow: (item: T) => ReactNode
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-6 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900 leading-tight">{title}</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {loading ? 'Loading…' : `${items?.length ?? 0} result${items?.length === 1 ? '' : 's'}`}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none transition-colors" aria-label="Close">
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {loading && (
            <div className="p-6 space-y-3">
              {[0, 1, 2, 3].map(i => <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />)}
            </div>
          )}
          {!loading && items?.length === 0 && (
            <p className="text-sm text-gray-400 px-6 py-8 text-center">{emptyText}</p>
          )}
          {!loading && items?.map(item => renderRow(item))}
        </div>
      </div>
    </div>
  )
}

function MqlContactsModal({ contacts, loading, onClose }: { contacts: MqlContactRow[] | null; loading: boolean; onClose: () => void }) {
  return (
    <DrilldownModal
      title="New MQLs This Month"
      items={contacts}
      loading={loading}
      emptyText="No new MQLs this month yet."
      onClose={onClose}
      renderRow={c => (
        <div key={c.id} className="flex items-center justify-between gap-3 px-6 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{c.name}</p>
            <p className="text-xs text-gray-400 truncate">
              {[c.jobTitle, c.company].filter(Boolean).join(' · ') || c.email || '—'}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-gray-400">
              {new Date(c.date).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
            </p>
          </div>
        </div>
      )}
    />
  )
}

function SqlContactsModal({ contacts, loading, onClose }: { contacts: SqlContact[] | null; loading: boolean; onClose: () => void }) {
  return (
    <DrilldownModal
      title="Pushed to SQL+ This Month"
      items={contacts}
      loading={loading}
      emptyText="No contacts reached SQL+ this month yet."
      onClose={onClose}
      renderRow={c => (
        <div key={c.id} className="flex items-center justify-between gap-3 px-6 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{c.name}</p>
            <p className="text-xs text-gray-400 truncate">
              {[c.company, c.email].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          <div className="text-right shrink-0">
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${SQL_SOURCE_BADGE[c.source]}`}>
              {c.source}
            </span>
            <p className="text-xs text-gray-400 mt-1">
              {new Date(c.date).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
            </p>
          </div>
        </div>
      )}
    />
  )
}

function PipelineDealsModal({ title, emptyText, deals, loading, onClose }: { title: string; emptyText: string; deals: PipelineDeal[] | null; loading: boolean; onClose: () => void }) {
  return (
    <DrilldownModal
      title={title}
      items={deals}
      loading={loading}
      emptyText={emptyText}
      onClose={onClose}
      renderRow={d => (
        <div key={d.id} className="flex items-center justify-between gap-3 px-6 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{d.dealname}</p>
            <p className="text-xs text-gray-400 truncate">
              {[d.contactName, d.company].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-bold text-gray-900">{fmtCurrency(d.amount)}</p>
            <p className="text-xs text-gray-400 mt-1">
              {new Date(d.date).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
            </p>
          </div>
        </div>
      )}
    />
  )
}
