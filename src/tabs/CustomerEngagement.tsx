import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { cachedGet } from '../lib/apiCache'
import { useAuth } from '../lib/fakeAuth'
import TargetsPanel from '../components/TargetsPanel'

interface CardDeal { id: string; name: string; value: number; stage: string; status: 'won' | 'open' | 'lost'; manual: boolean }
interface Account {
  id: string | null; name: string; manager: string
  ytdWon: number; ytdTarget: number | null; pctOfTarget: number | null; onTrack: boolean | null
  openPipeline: number; openCount: number; wonCount: number; lostCount: number
  convRate: number | null; designerCount: number | null; engagedDesignerCount: number | null
  winRate12m: number | null; won12mCount: number; lost12mCount: number
  tier: string | null
  isGeneric: boolean
  deals: CardDeal[]
}
interface DealSearchResult { id: string; name: string; value: number; closeDate: string | null }
interface CompanyDetails { id: string; name: string | null; domain: string | null; industry: string | null; city: string | null; phone: string | null; numberOfEmployees: string | null; description: string | null }
interface CompanyContact { id: string; name: string; email: string | null; jobTitle: string | null; isDesigner: boolean; lastContact: string | null; score: 'A' | 'B' | 'C' }
interface DesignerScoreCounts { A: number; B: number; C: number }
interface CompanyProfile { company: CompanyDetails; contacts: CompanyContact[]; designerCount: number; designerScoreCounts: DesignerScoreCounts }
interface RevenueSummary {
  target: number; cardTarget: number; nzWon: number; nzOpen: number; nzLost: number; auOpen: number; auWon: number; auLost: number
  nzConv: number | null; auConv: number | null; openWonInPipeline: number; projected: number; shortfall: number
  projectedInFY: number; shortfallInFY: number; auPipelineFound: boolean
}
interface EngagementData { accounts: Account[]; fyLabel: string; hasTargets: boolean; hubspotOwners: string[]; ceSalespeople: string[]; revenueSummary?: RevenueSummary }
interface ParsedTarget { name: string; ytdTarget: number; ytdActual: number; manager?: string }
// One dropdown entry = a customer grouped by base name (per-location HubSpot records
// collapsed), split by country when it spans NZ + AU. companyIds are every location
// the picked card should aggregate/pin.
interface CompanyGroup { key: string; label: string; country: 'NZ' | 'AU'; companyIds: string[]; count: number; locations: string[]; domain: string | null }
interface ActivityMeta { key: string; label: string; staleDays: number; derived?: boolean; sourceLabel?: string }
interface ActivityStatus { lastDate: string | null; daysSince: number | null; status: 'green' | 'red'; count: number; derived?: boolean }
interface ActivityLocation { companyId: string; name: string; city?: string; activity: Record<string, ActivityStatus> }
interface ActivityAccount { name: string; manager: string; activity: Record<string, ActivityStatus>; locations?: ActivityLocation[] }
interface ActivityData { accounts: ActivityAccount[]; activities: ActivityMeta[] }
interface ActivityEntry { date: string; note: string | null }
// Per-location (region) data for the card pop-up: each HubSpot branch location with
// its BD-cadence completion flags and the contacts linked to that location.
interface RegionContact { id: string; name: string; email: string | null; jobTitle: string | null; lastContacted: string | null; score: 'A' | 'B' | 'C'; isDesigner: boolean }
interface CompletionCell { status: 'green' | 'red'; lastDate: string | null; daysSince: number | null }
interface RegionCompletion { bd_presentation: CompletionCell; f2f: CompletionCell; monthly_admin: CompletionCell }
interface RegionLocation { companyId: string; name: string; city: string | null; confirmed: boolean; contacts: RegionContact[]; completion: RegionCompletion }
interface RegionsData { card: string; cardNorm: string; locations: RegionLocation[]; undefined?: { contacts: RegionContact[] } }
// Prior-year won revenue for the card pop-up (three completed FYs before the current one).
interface SalesHistoryYear { fyStartYear: number; fyLabel: string; won: number; dealCount: number }
interface SalesHistory { years: SalesHistoryYear[] }

// Human phrasing for a derived-column rolling window (365 → "12 months", etc.).
const windowText = (days: number) =>
  days >= 360 ? '12 months' : days >= 85 ? 'quarter' : days >= 28 ? 'month' : `${days} days`

const fmtShort = (v: number) => v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`
const fmtFull  = (v: number) => new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD', maximumFractionDigits: 0 }).format(v)

const SCORE_BADGE_CLASS: Record<'A' | 'B' | 'C', string> = {
  A: 'bg-green-100 text-green-700',
  B: 'bg-amber-100 text-amber-700',
  C: 'bg-gray-200 text-gray-500',
}
const SCORE_ROW_CLASS: Record<'A' | 'B' | 'C', string> = {
  A: 'bg-green-50 hover:bg-green-100',
  B: 'bg-amber-50 hover:bg-amber-100',
  C: 'bg-red-50 hover:bg-red-100',
}
const fmtLastContact = (lastContact: string | null) => {
  if (!lastContact) return 'Never contacted'
  const days = Math.floor((Date.now() - new Date(lastContact).getTime()) / 86400000)
  return days <= 0 ? 'Contacted today' : `Contacted ${days}d ago`
}

// Green when the region has met a BD cadence in its window, grey otherwise. The
// tooltip shows the rule plus when it was last done.
function CompletionPill({ cell, label, rule }: { cell?: CompletionCell; label: string; rule: string }) {
  const ok = cell?.status === 'green'
  const title = `${rule}${cell?.lastDate ? ` · last ${cell.lastDate}` : ' · none in window'}`
  return (
    <span title={title} className={`px-2 py-0.5 rounded text-[11px] font-semibold ${ok ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
      {label}
    </span>
  )
}

// A contact row inside a region — same look/behaviour as the old Designers list:
// score-tinted when a designer, untick the checkbox to demote to "Other employees".
function RegionContactRow({ c, companyId, onToggle }: { c: RegionContact; companyId: string; onToggle: (companyId: string, contactId: string, next: boolean) => void }) {
  return (
    <label className={`flex items-center justify-between px-4 py-2 cursor-pointer transition-colors ${c.isDesigner ? SCORE_ROW_CLASS[c.score] : 'bg-gray-50 hover:bg-gray-100'}`}>
      <div className="min-w-0 flex-1 pr-3">
        <div className="flex items-center gap-1.5">
          <p className="text-sm text-gray-800 font-medium truncate">{c.name}</p>
          {c.isDesigner && (
            <span className={`shrink-0 text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center ${SCORE_BADGE_CLASS[c.score]}`} title={`Engagement score: ${c.score}`}>{c.score}</span>
          )}
        </div>
        <p className="text-xs text-gray-400 truncate">{[c.jobTitle, c.email].filter(Boolean).join(' · ') || '—'}</p>
        {c.isDesigner && <p className="text-xs text-gray-400">{fmtLastContact(c.lastContacted)}</p>}
      </div>
      <span className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-gray-500">Buyer</span>
        <input type="checkbox" checked={c.isDesigner} onChange={e => onToggle(companyId, c.id, e.target.checked)}
          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
      </span>
    </label>
  )
}

// Corridor/sector rollup rows that sit in the "Direct" sector alongside real named
// accounts (e.g. "Hospitality", "Workspace" — matching HubSpot's deal_corridor values,
// sometimes split by region as "Hospitality - North" / "Hospitality - South").
// These aren't customers and shouldn't show up as their own account tiles.
const CORRIDOR_ROLLUP_BASE_NAMES = new Set([
  'accommodation', 'aged care/wellness/health', 'healthcare/aged care', 'airports/transport',
  'education', 'hospitality', 'public', 'retail & reception', 'retail/reception', 'workspace',
])
function isCorridorRollup(name: string) {
  const base = name.toLowerCase().replace(/\s*-\s*(north|south)\s*$/i, '').trim()
  return CORRIDOR_ROLLUP_BASE_NAMES.has(base)
}

async function parseExcel(file: File): Promise<ParsedTarget[]> {
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })

  // Prefer a sheet whose name contains "Budget by Customer" — if there are multiple
  // (e.g. a dated snapshot like "...Jun26" alongside the base sheet), take the LAST
  // one, since newer dated variants get appended after the base sheet.
  const budgetSheets = wb.SheetNames.filter(n => n.toLowerCase().includes('budget by customer'))
  const sheetName = budgetSheets[budgetSheets.length - 1] ?? wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as string[][]
  if (rows.length < 2) throw new Error('Sheet appears empty')

  // Find the header row — first row (within first 6) that contains "Customer"
  let headerIdx = rows.slice(0, 6).findIndex(r =>
    r.some(c => String(c).trim().toLowerCase() === 'customer')
  )
  if (headerIdx < 0) headerIdx = 0
  const headers = rows[headerIdx].map(c => String(c ?? '').toLowerCase().trim())

  // Name column — cell that is exactly "customer", or contains "account"/"company"/"name"
  const nameCol = headers.findIndex(h => h === 'customer') >= 0
    ? headers.findIndex(h => h === 'customer')
    : headers.findIndex(h => ['account','company','client','name'].some(k => h.includes(k)))

  // Manager — prefer "am1", else first column containing "am" or "manager"/"rep"
  const managerCol = headers.findIndex(h => h === 'am1') >= 0
    ? headers.findIndex(h => h === 'am1')
    : headers.findIndex(h => ['am','manager','rep','owner','salesperson'].some(k => h.includes(k)))

  // Target — take the LAST column whose header contains "target" (most recent year)
  let targetCol = -1
  for (let i = headers.length - 1; i >= 0; i--) {
    if (headers[i].includes('target')) { targetCol = i; break }
  }
  // Fallback to any column containing budget/goal/spend
  if (targetCol < 0) {
    targetCol = headers.findIndex(h => ['budget','goal','spend','revenue'].some(k => h.includes(k)))
  }

  // Actual-to-date — the column containing "ytd" (labelled with last FY's year but is a
  // running total of this FY's monthly columns, updated each time the sheet is re-uploaded)
  const ytdCol = headers.findIndex(h => h.includes('ytd'))

  if (nameCol < 0)   throw new Error('Could not find a Customer/Account column. Check that row 1 or 2 has a header like "Customer" or "Account".')
  if (targetCol < 0) throw new Error('Could not find a Target column. Check that a column header contains "Target".')

  const toNum = (raw: unknown) => {
    if (raw === '-' || raw === '' || raw == null) return 0
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[$,\s]/g, ''))
    return isNaN(n) ? 0 : n
  }

  const targets: ParsedTarget[] = []
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    const name = String(row[nameCol] ?? '').trim()
    const rawTarget = row[targetCol]
    // Skip blank names, corridor/sector rollup rows, dash targets, zero or negative targets
    if (!name) continue
    if (isCorridorRollup(name)) continue
    if (rawTarget === '-' || rawTarget === '' || rawTarget == null) continue
    const ytdTarget = toNum(rawTarget)
    if (ytdTarget <= 0) continue
    const ytdActual = ytdCol >= 0 ? toNum(row[ytdCol]) : 0
    const manager = managerCol >= 0 ? String(row[managerCol] ?? '').trim() || undefined : undefined
    targets.push({ name, ytdTarget, ytdActual, ...(manager ? { manager } : {}) })
  }
  if (targets.length === 0) throw new Error('No valid rows found. Check that the Customer and Target columns have data.')
  return targets
}

// ── Upload Modal ───────────────────────────────────────────────────────────────

function UploadModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<ParsedTarget[] | null>(null)
  const [parseErr, setParseErr] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setParsing(true); setParseErr(null); setParsed(null)
    try {
      const targets = await parseExcel(file)
      setParsed(targets)
    } catch (err: unknown) {
      setParseErr(err instanceof Error ? err.message : String(err))
    } finally {
      setParsing(false)
    }
  }

  async function handleSave() {
    if (!parsed) return
    setSaving(true); setSaveErr(null)
    try {
      await axios.post('/api/targets/upload', { targets: parsed })
      onSaved()
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error || err.message : String(err)
      setSaveErr(msg)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white px-6 py-5 border-b border-gray-100 flex items-center justify-between rounded-t-2xl">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Upload Account Targets</h2>
            <p className="text-sm text-gray-400">Excel or CSV · auto-detects Account, Target, and Manager columns</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Drop zone */}
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full border-2 border-dashed border-gray-200 rounded-xl py-10 text-center hover:border-blue-400 hover:bg-blue-50 transition-colors group"
          >
            <svg className="w-8 h-8 text-gray-300 group-hover:text-blue-400 mx-auto mb-3 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <p className="text-sm font-medium text-gray-600 group-hover:text-blue-600">Click to choose file</p>
            <p className="text-xs text-gray-400 mt-1">.xlsx · .xls · .csv</p>
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />

          {parsing && <p className="text-sm text-gray-500 text-center">Parsing…</p>}
          {parseErr && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{parseErr}</p>}

          {parsed && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-800">{parsed.length} accounts detected</p>
                <button onClick={() => fileRef.current?.click()} className="text-xs text-blue-600 hover:underline">Change file</button>
              </div>

              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Account</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">YTD Actual</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">Target</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Manager</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {parsed.slice(0, 8).map((t, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-medium text-gray-800">{t.name}</td>
                        <td className="px-4 py-2.5 text-right text-gray-700">{fmtFull(t.ytdActual)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-700">{fmtFull(t.ytdTarget)}</td>
                        <td className="px-4 py-2.5 text-gray-400">{t.manager || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsed.length > 8 && (
                  <p className="text-xs text-gray-400 text-center py-2 bg-gray-50 border-t border-gray-100">
                    + {parsed.length - 8} more accounts
                  </p>
                )}
              </div>

              {saveErr && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{saveErr}</p>}

              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full py-3 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving…' : `Save ${parsed.length} Account Targets`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Prorated-pace zones ──────────────────────────────────────────────────────────
// Cards are bucketed by how their YTD spend tracks against a *prorated* target — the
// annual target scaled to how far through the financial year we are. So "pace" = YTD
// actual ÷ (annual target × fraction of FY elapsed). 100% means bang on schedule.
type Zone = 'green' | 'blue' | 'amber' | 'red'

const ZONE_META: Record<Zone, { label: string; range: string; border: string; pill: string; bar: string; headerBg: string; headerText: string; headerBorder: string }> = {
  green: { label: 'On Track',   range: '75%+ of pace',      border: 'border-l-green-500', pill: 'bg-green-100 text-green-700', bar: 'bg-green-500', headerBg: 'bg-green-50', headerText: 'text-green-700', headerBorder: 'border-green-200' },
  blue:  { label: 'Watch',      range: '50–75% of pace',    border: 'border-l-blue-500',  pill: 'bg-blue-100 text-blue-700',   bar: 'bg-blue-500',  headerBg: 'bg-blue-50',  headerText: 'text-blue-700',  headerBorder: 'border-blue-200' },
  amber: { label: 'Behind',     range: '25–50% of pace',    border: 'border-l-amber-500', pill: 'bg-amber-100 text-amber-700', bar: 'bg-amber-500', headerBg: 'bg-amber-50', headerText: 'text-amber-700', headerBorder: 'border-amber-200' },
  red:   { label: 'At Risk',    range: 'Under 25% of pace', border: 'border-l-red-500',   pill: 'bg-red-100 text-red-600',     bar: 'bg-red-400',   headerBg: 'bg-red-50',   headerText: 'text-red-600',   headerBorder: 'border-red-200' },
}
// Left-to-right column order: best pace on the left, at-risk on the right.
const ZONE_ORDER: Zone[] = ['green', 'blue', 'amber', 'red']

function zoneForPace(pace: number | null): Zone {
  if (pace === null) return 'red'
  if (pace >= 75) return 'green'
  if (pace >= 50) return 'blue'
  if (pace >= 25) return 'amber'
  return 'red'
}

// Coverage = projected revenue (won + open pipeline × win rate) as a % of target — the
// chance of reaching target from what's already in the pipeline.
function zoneForCoverage(cov: number | null): Zone {
  if (cov === null) return 'red'
  if (cov >= 100) return 'green'
  if (cov >= 75) return 'blue'
  if (cov >= 50) return 'amber'
  return 'red'
}
const COVERAGE_RANGE: Record<Zone, string> = {
  green: '100%+ projected', blue: '75–100% projected', amber: '50–75% projected', red: 'Under 50% projected',
}

// ── Account Tile ───────────────────────────────────────────────────────────────

const TIER_STYLE: Record<string, string> = {
  Bronze: 'bg-orange-100 text-orange-800',
  Silver: 'bg-gray-200 text-gray-700',
  Gold: 'bg-yellow-100 text-yellow-800',
  Platinum: 'bg-indigo-100 text-indigo-800',
}
function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return null
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${TIER_STYLE[tier] || 'bg-gray-100 text-gray-600'}`}>{tier}</span>
}

function AccountTile({ account, zone, proratedPct, metricLabel, onClick }: { account: Account; zone: Zone; proratedPct: number | null; metricLabel: string; onClick: () => void }) {
  const { name, manager, ytdWon, ytdTarget, openPipeline, designerCount, engagedDesignerCount, winRate12m, tier } = account
  const z = ZONE_META[zone]
  const barPct = Math.min(proratedPct ?? 0, 100)
  const convRate = winRate12m != null ? Math.round(winRate12m * 100) : null

  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-white rounded-xl border border-gray-200 border-l-4 ${z.border} shadow-sm hover:shadow-md transition-all p-4`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1 pr-2">
          <div className="flex items-center gap-1.5">
            <p className="font-semibold text-gray-900 text-sm leading-tight truncate">{name}</p>
            <TierBadge tier={tier} />
          </div>
          <p className="text-xs text-gray-400 mt-0.5 truncate">{manager}</p>
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded shrink-0 ${z.pill}`}>{z.label}</span>
      </div>

      {ytdTarget !== null ? (
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-gray-500">YTD Spend</span>
            <span className="font-semibold text-gray-800">{fmtShort(ytdWon)} / {fmtShort(ytdTarget)}</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${z.bar} transition-all`} style={{ width: `${barPct}%` }} />
          </div>
          <p className="text-xs text-gray-400 mt-1">
            <span className="font-semibold text-gray-600">{proratedPct ?? 0}%</span> {metricLabel}
          </p>
        </div>
      ) : (
        <div className="mb-3">
          <p className="text-xs text-gray-400">YTD Won</p>
          <p className="text-sm font-bold text-gray-800">{fmtShort(ytdWon)}</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-1 text-center border-t border-gray-50 pt-3">
        <div>
          <p className="text-xs text-gray-400">Pipeline</p>
          <p className="text-xs font-bold text-blue-600 mt-0.5">{fmtShort(openPipeline)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Conv.</p>
          <p className="text-xs font-bold text-gray-700 mt-0.5">{convRate !== null ? `${convRate}%` : '—'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Buyers</p>
          <p className="text-xs font-bold text-gray-700 mt-0.5">
            {designerCount !== null ? `${engagedDesignerCount ?? 0}/${designerCount}` : '—'}
          </p>
        </div>
      </div>
    </button>
  )
}

// ── HubSpot company search (shared by the single and batch link UIs) ───────────

function useCompanySearch(query: string) {
  const [results, setResults] = useState<CompanyGroup[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    setSearching(true)
    const timer = setTimeout(() => {
      cachedGet('/api/hubspot/companies/search', { params: { q } })
        .then(r => setResults(r.data.results))
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  return { results, searching }
}

function CompanyResultsList({ results, onPick, disabled }: { results: CompanyGroup[]; onPick: (companyIds: string[], name: string) => void; disabled?: boolean }) {
  return (
    <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 bg-white overflow-hidden">
      {results.map(r => (
        <button
          key={r.key + r.country}
          onClick={() => onPick(r.companyIds, r.label)}
          disabled={disabled}
          className="w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors disabled:opacity-50"
        >
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-gray-800 truncate">{r.label}</p>
            {r.country === 'AU' && <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">AU</span>}
            {r.count > 1 && <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{r.count} locations</span>}
          </div>
          {r.count > 1 && <p className="text-xs text-gray-400 truncate">{r.locations.join(', ')}</p>}
        </button>
      ))}
    </div>
  )
}

// ── Link-to-HubSpot-company panel ───────────────────────────────────────────────
// Shown when the normalized-name auto-match couldn't find this account in HubSpot.
// Lets a human search and confirm the right company once; the pairing is then
// remembered (keyed by normalized account name) so it survives future re-uploads.

function LinkCompanyPanel({ accountName, onLinked }: { accountName: string; onLinked: () => void }) {
  const [query, setQuery] = useState('')
  const { results, searching } = useCompanySearch(query)
  const [linking, setLinking] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function handleLink(companyIds: string[], companyName: string) {
    setLinking(true); setErr(null)
    axios.post('/api/customer/link', { accountName, companyIds, companyName })
      .then(onLinked)
      .catch(e => { setErr(e.response?.data?.error || e.message); setLinking(false) })
  }
  function markGeneric() {
    setLinking(true); setErr(null)
    axios.post('/api/customer/generic', { accountName, generic: true })
      .then(onLinked)
      .catch(e => { setErr(e.response?.data?.error || e.message); setLinking(false) })
  }

  return (
    <div className="bg-gray-50 rounded-xl p-4 space-y-3">
      <p className="text-sm text-gray-600">
        No matching HubSpot company found for this account, so contact/company details aren't available.
      </p>
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search HubSpot companies to link…"
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      {searching && <p className="text-xs text-gray-400">Searching…</p>}
      {err && <p className="text-xs text-red-600">{err}</p>}
      {results.length > 0 && <CompanyResultsList results={results} onPick={handleLink} disabled={linking} />}
      <button onClick={markGeneric} disabled={linking} className="text-xs text-gray-400 hover:text-gray-600 underline disabled:opacity-50">
        This isn't a customer — mark as a generic category
      </button>
    </div>
  )
}

// ── Batch account matcher ────────────────────────────────────────────────────────
// Lets a user work through every unmatched account in one sitting. Each link is
// saved immediately, but the engagement data (which requires refetching from
// HubSpot) only reloads once, when the panel is closed — not after every row.

function MatchRow({ account, linkedTo, onLinked, onGeneric }: { account: Account; linkedTo?: string; onLinked: (companyName: string) => void; onGeneric: (accountName: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { results, searching } = useCompanySearch(query)
  const [linking, setLinking] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function handleLink(companyIds: string[], companyName: string) {
    setLinking(true); setErr(null)
    axios.post('/api/customer/link', { accountName: account.name, companyIds, companyName })
      .then(() => { onLinked(companyName); setOpen(false); setQuery('') })
      .catch(e => { setErr(e.response?.data?.error || e.message); setLinking(false) })
  }
  function markGeneric() {
    setLinking(true); setErr(null)
    axios.post('/api/customer/generic', { accountName: account.name, generic: true })
      .then(() => { onGeneric(account.name); setOpen(false) })
      .catch(e => { setErr(e.response?.data?.error || e.message); setLinking(false) })
  }

  if (linkedTo) {
    const generic = linkedTo === '__generic__'
    return (
      <div className={`flex items-center justify-between px-4 py-3 rounded-xl border ${generic ? 'bg-gray-50 border-gray-200' : 'bg-green-50 border-green-100'}`}>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate">{account.name}</p>
          <p className={`text-xs truncate ${generic ? 'text-gray-500' : 'text-green-600'}`}>{generic ? 'Marked as generic category' : `Linked to ${linkedTo}`}</p>
        </div>
        <svg className={`w-5 h-5 shrink-0 ${generic ? 'text-gray-400' : 'text-green-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
      </div>
    )
  }

  return (
    <div className="border border-gray-200 rounded-xl p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-800 truncate">{account.name}</p>
          <p className="text-xs text-gray-400 truncate">{account.manager}{account.ytdTarget !== null ? ` · Target ${fmtShort(account.ytdTarget)}` : ''}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={markGeneric} disabled={linking} className="px-2.5 py-1.5 text-xs font-medium text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50" title="Not a customer — mark as generic category">
            Not a customer
          </button>
          <button
            onClick={() => setOpen(o => !o)}
            className="px-3 py-1.5 text-xs font-semibold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            {open ? 'Cancel' : 'Search & Link'}
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-3 space-y-2">
          <input
            type="text"
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search HubSpot companies…"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          {searching && <p className="text-xs text-gray-400">Searching…</p>}
          {err && <p className="text-xs text-red-600">{err}</p>}
          {results.length > 0 && <CompanyResultsList results={results} onPick={handleLink} disabled={linking} />}
        </div>
      )}
    </div>
  )
}

function MatchAccountsModal({ accounts, onClose }: { accounts: Account[]; onClose: () => void }) {
  const [linked, setLinked] = useState<Record<string, string>>({})
  const remaining = accounts.length - Object.keys(linked).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white px-6 py-5 border-b border-gray-100 flex items-center justify-between rounded-t-2xl">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Match Accounts to HubSpot</h2>
            <p className="text-sm text-gray-400">{remaining} of {accounts.length} remaining · links are saved instantly and remembered for future uploads</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-6 space-y-3 overflow-y-auto">
          {accounts.map(acc => (
            <MatchRow
              key={acc.name}
              account={acc}
              linkedTo={linked[acc.name]}
              onLinked={companyName => setLinked(l => ({ ...l, [acc.name]: companyName }))}
              onGeneric={name => setLinked(l => ({ ...l, [name]: '__generic__' }))}
            />
          ))}
        </div>

        <div className="sticky bottom-0 bg-white px-6 py-4 border-t border-gray-100 flex justify-end rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-700 transition-colors">
            Done — refresh dashboard
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Drill-Down Modal ───────────────────────────────────────────────────────────

function AccountModal({ account, owners, isAdmin, onClose, onLinked, onDeleted, onOwnerChanged }: { account: Account; owners: string[]; isAdmin: boolean; onClose: () => void; onLinked: () => void; onDeleted: () => void; onOwnerChanged: (accountName: string, manager: string) => void }) {
  const { id, name, manager, ytdTarget, pctOfTarget, onTrack, designerCount } = account
  const { getToken } = useAuth()

  const [profile, setProfile] = useState<CompanyProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileErr, setProfileErr] = useState<string | null>(null)
  const [scoreFilter, setScoreFilter] = useState<'all' | 'A' | 'B' | 'C'>('all')
  const [showOthers, setShowOthers] = useState(false)
  const [ownerDraft, setOwnerDraft] = useState(manager)
  const [savingOwner, setSavingOwner] = useState(false)
  const [ownerErr, setOwnerErr] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  // Regions (branch locations) — fetched per card; admins can curate the genuine branches.
  const [regions, setRegions] = useState<RegionsData | null>(null)
  const [regionsLoading, setRegionsLoading] = useState(false)
  const [regionsErr, setRegionsErr] = useState<string | null>(null)
  const [confirmSel, setConfirmSel] = useState<Set<string>>(new Set())
  const [savingLocs, setSavingLocs] = useState(false)
  const [editingLocs, setEditingLocs] = useState(false)          // pencil-gated curation (admin)
  const [openOthers, setOpenOthers] = useState<Set<string>>(new Set()) // per-location "Other employees" expand
  // Prior-year sales (three completed FYs) — fetched per card, lazily, like Regions.
  const [history, setHistory] = useState<SalesHistory | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyErr, setHistoryErr] = useState<string | null>(null)
  const [targetDraft, setTargetDraft] = useState(String(ytdTarget ?? ''))
  const [savingTarget, setSavingTarget] = useState(false)
  const [editingTarget, setEditingTarget] = useState(false)
  const targetVal = Number(String(targetDraft).replace(/[$,\s]/g, ''))
  const targetChanged = String(targetDraft).trim() !== '' && targetVal >= 0 && targetVal !== ytdTarget

  function saveTarget() {
    if (!targetChanged) return
    setSavingTarget(true); setOwnerErr(null)
    axios.post('/api/customer/target', { accountName: name, ytdTarget: targetVal })
      .then(() => { onLinked(); onClose() }) // reload — target drives pace/zone
      .catch(e => { setOwnerErr(e.response?.data?.error || e.message); setSavingTarget(false) })
  }
  const ownerChanged = ownerDraft.trim().length > 0 && ownerDraft.trim() !== manager

  // Local, optimistic deal list so add/remove feel instant; the dashboard re-pulls
  // once on close if anything changed (the engagement fetch is slow).
  const [deals, setDeals] = useState<CardDeal[]>(account.deals)
  const [dealErr, setDealErr] = useState<string | null>(null)
  const [dealQuery, setDealQuery] = useState('')
  const [dealResults, setDealResults] = useState<DealSearchResult[]>([])
  const [dealSearching, setDealSearching] = useState(false)
  const [dealsChanged, setDealsChanged] = useState(false)
  const wonList = deals.filter(d => d.status === 'won')
  const openList = deals.filter(d => d.status === 'open')
  const lostCount = deals.filter(d => d.status === 'lost').length
  const ytdWon = wonList.reduce((s, d) => s + d.value, 0)
  const wonCount = wonList.length
  const openPipeline = openList.reduce((s, d) => s + d.value, 0)
  const openCount = openList.length
  // Win rate = this customer's rolling-12-month conversion (value-weighted, across all
  // their grouped companies) — computed server-side so a short FY doesn't read as 100%.
  const winRateValue = account.winRate12m
  const won12mCount = account.won12mCount, lost12mCount = account.lost12mCount
  const convRate = winRateValue != null ? Math.round(winRateValue * 100) : null

  // Current NZ financial year label (Apr–Mar) for the sales-history row — Jan–Mar belongs
  // to the prior FY. The server does the precise bucketing; this is just the heading.
  const _now = new Date()
  const _fyStart = _now.getMonth() < 3 ? _now.getFullYear() - 1 : _now.getFullYear()
  const currentFyLabel = `FY${String(_fyStart).slice(2)}/${String(_fyStart + 1).slice(2)}`

  // Chance to hit target: apply that win rate to the deals currently open, add to what's
  // already won this FY, and compare to target.
  const expectedFromPipeline = winRateValue != null ? openPipeline * winRateValue : null
  const projectedTotal = ytdWon + (expectedFromPipeline || 0)
  const targetAttainment = (ytdTarget && ytdTarget > 0 && winRateValue != null) ? Math.round((projectedTotal / ytdTarget) * 100) : null

  function handleClose() {
    if (dealsChanged) onLinked() // deal totals need a full re-pull; reuse parent reload
    onClose()
  }

  useEffect(() => {
    const q = dealQuery.trim()
    if (q.length < 2) { setDealResults([]); return }
    setDealSearching(true)
    const timer = setTimeout(() => {
      cachedGet('/api/hubspot/deals/search', { params: { q } })
        .then(r => setDealResults(r.data.results))
        .catch(() => setDealResults([]))
        .finally(() => setDealSearching(false))
    }, 300)
    return () => clearTimeout(timer)
  }, [dealQuery])

  function removeDeal(dealId: string) {
    setDeals(ds => ds.filter(d => d.id !== dealId)); setDealsChanged(true); setDealErr(null)
    axios.post('/api/customer/deal-allocation', { accountName: name, dealId, action: 'remove' })
      .catch(e => setDealErr(e.response?.data?.error || e.message))
  }

  function allocateDeal(d: DealSearchResult) {
    if (deals.some(x => x.id === d.id)) return
    setDeals(ds => [...ds, { id: d.id, name: d.name, value: d.value, stage: '', status: 'won', manual: true }])
    setDealsChanged(true); setDealErr(null); setDealQuery(''); setDealResults([])
    axios.post('/api/customer/deal-allocation', { accountName: name, dealId: d.id, action: 'add' })
      .catch(e => setDealErr(e.response?.data?.error || e.message))
  }

  function saveOwner() {
    if (!ownerChanged) return
    const next = ownerDraft.trim()
    setSavingOwner(true); setOwnerErr(null)
    axios.post('/api/customer/owner', { accountName: name, manager: next })
      .then(() => { onOwnerChanged(name, next); handleClose() }) // patch locally — no slow re-pull
      .catch(e => { setOwnerErr(e.response?.data?.error || e.message); setSavingOwner(false) })
  }

  async function deleteAccount() {
    if (!window.confirm(`Delete the "${name}" card? This removes its target, HubSpot link, manual deals and activity log. A card from the target sheet will return on the next upload.`)) return
    setDeleting(true); setOwnerErr(null)
    try {
      const token = await getToken()
      await axios.delete('/api/customer/account', {
        data: { accountName: name },
        headers: { Authorization: `Bearer ${token}` },
      })
      onDeleted() // clears selection + full re-pull
    } catch (e: any) {
      setOwnerErr(e.response?.data?.error || e.message)
      setDeleting(false)
    }
  }

  useEffect(() => {
    if (!id) return
    setProfileLoading(true); setProfileErr(null); setScoreFilter('all'); setShowOthers(false)
    cachedGet(`/api/customer/company/${id}`)
      .then(r => setProfile(r.data))
      .catch(e => setProfileErr(e.response?.data?.error || e.message))
      .finally(() => setProfileLoading(false))
  }, [id])

  function loadRegions(force = false) {
    setRegionsLoading(true); setRegionsErr(null)
    cachedGet('/api/customer/regions', { params: { card: name }, force })
      .then(r => {
        const data: RegionsData = r.data
        setRegions(data)
        const confirmed = (data.locations || []).filter(l => l.confirmed).map(l => l.companyId)
        // Default-tick everything until the branches have been curated.
        const sel = confirmed.length ? confirmed : (data.locations || []).map(l => l.companyId)
        setConfirmSel(new Set(sel))
      })
      .catch(e => setRegionsErr(e.response?.data?.error || e.message))
      .finally(() => setRegionsLoading(false))
  }
  useEffect(() => { loadRegions() }, [name]) // eslint-disable-line react-hooks/exhaustive-deps

  // Prior-year sales history — skip generic buckets (corridors / YourCompany Australia),
  // which have no key-account company to attribute historical deals to.
  useEffect(() => {
    if (account.isGeneric) { setHistory(null); return }
    setHistoryLoading(true); setHistoryErr(null)
    cachedGet('/api/customer/history', { params: { card: name } })
      .then(r => setHistory(r.data))
      .catch(e => setHistoryErr(e.response?.data?.error || e.message))
      .finally(() => setHistoryLoading(false))
  }, [name, account.isGeneric])

  function toggleLoc(cid: string) {
    setConfirmSel(s => { const n = new Set(s); if (n.has(cid)) n.delete(cid); else n.add(cid); return n })
  }
  function saveLocations() {
    if (!regions) return
    setSavingLocs(true); setRegionsErr(null)
    axios.post('/api/customer/confirm-locations', { cardNorm: regions.cardNorm, companyIds: [...confirmSel] })
      .then(() => { setEditingLocs(false); return loadRegions(true) })
      .catch(e => setRegionsErr(e.response?.data?.error || e.message))
      .finally(() => setSavingLocs(false))
  }
  function toggleOthers(cid: string) {
    setOpenOthers(s => { const n = new Set(s); n.has(cid) ? n.delete(cid) : n.add(cid); return n })
  }
  // Untick a designer (or re-tick) on a location's contact list. The flag is per-contact
  // in HubSpot, so update every occurrence across locations + Undefined optimistically.
  function toggleRegionDesigner(companyId: string, contactId: string, next: boolean) {
    const apply = (r: RegionsData): RegionsData => ({
      ...r,
      locations: r.locations.map(l => ({ ...l, contacts: l.contacts.map(c => c.id === contactId ? { ...c, isDesigner: next } : c) })),
      undefined: r.undefined ? { contacts: r.undefined.contacts.map(c => c.id === contactId ? { ...c, isDesigner: next } : c) } : r.undefined,
    })
    setRegions(r => r ? apply(r) : r)
    axios.post(`/api/customer/company/${companyId}/designer`, { contactId, isDesigner: next })
      .catch(() => setRegions(r => { // revert on failure
        if (!r) return r
        const back = (c: RegionContact) => c.id === contactId ? { ...c, isDesigner: !next } : c
        return { ...r, locations: r.locations.map(l => ({ ...l, contacts: l.contacts.map(back) })), undefined: r.undefined ? { contacts: r.undefined.contacts.map(back) } : r.undefined }
      }))
  }

  function shiftScoreCounts(counts: DesignerScoreCounts, score: 'A' | 'B' | 'C', delta: number): DesignerScoreCounts {
    return { ...counts, [score]: counts[score] + delta }
  }

  function toggleDesigner(contactId: string, next: boolean) {
    if (!id || !profile) return
    const contact = profile.contacts.find(c => c.id === contactId)
    if (!contact) return
    setProfile({
      ...profile,
      contacts: profile.contacts.map(c => c.id === contactId ? { ...c, isDesigner: next } : c),
      designerCount: profile.designerCount + (next ? 1 : -1),
      designerScoreCounts: shiftScoreCounts(profile.designerScoreCounts, contact.score, next ? 1 : -1),
    })
    axios.post(`/api/customer/company/${id}/designer`, { contactId, isDesigner: next }).catch(() => {
      // revert on failure
      setProfile(p => p && ({
        ...p,
        contacts: p.contacts.map(c => c.id === contactId ? { ...c, isDesigner: !next } : c),
        designerCount: p.designerCount + (next ? -1 : 1),
        designerScoreCounts: shiftScoreCounts(p.designerScoreCounts, contact.score, next ? -1 : 1),
      }))
    })
  }

  // Designer summary — derived from the Regions data (unique designers across all
  // locations + Undefined), so it agrees with the per-location lists below.
  const regionContactsAll = regions ? [...regions.locations.flatMap(l => l.contacts), ...(regions.undefined?.contacts ?? [])] : []
  const uniqueDesigners = [...new Map(regionContactsAll.filter(c => c.isDesigner).map(c => [c.id, c])).values()]
  const shownDesignerCount = regions ? uniqueDesigners.length : (designerCount ?? null)
  const designerScoreCounts = { A: uniqueDesigners.filter(c => c.score === 'A').length, B: uniqueDesigners.filter(c => c.score === 'B').length, C: uniqueDesigners.filter(c => c.score === 'C').length }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={handleClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white px-6 py-5 border-b border-gray-100 flex items-center justify-between rounded-t-2xl">
          <div className="min-w-0">
            <div className="flex items-center gap-2"><h2 className="text-lg font-bold text-gray-900">{name}</h2><TierBadge tier={account.tier} /></div>
            <div className="flex items-center gap-2 mt-1">
              <label className="text-sm text-gray-400 shrink-0">Owner</label>
              <select
                value={ownerDraft}
                onChange={e => setOwnerDraft(e.target.value)}
                className="px-2 py-1 text-sm border border-gray-200 rounded-lg text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 min-w-0 w-44 cursor-pointer"
              >
                {/* keep the current owner selectable even if they're no longer on the roster */}
                {ownerDraft && !owners.includes(ownerDraft) && <option value={ownerDraft}>{ownerDraft}</option>}
                {!ownerDraft && <option value="">Unassigned</option>}
                {owners.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              {ownerChanged && (
                <button
                  onClick={saveOwner}
                  disabled={savingOwner}
                  className="shrink-0 px-3 py-1 text-xs font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
                >
                  {savingOwner ? 'Saving…' : 'Save'}
                </button>
              )}
            </div>
            {ownerErr && <p className="text-xs text-red-600 mt-1">{ownerErr}</p>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {isAdmin && (
              <button
                onClick={deleteAccount}
                disabled={deleting}
                title="Delete this card"
                className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            )}
            <button onClick={handleClose} className="p-2 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {ytdTarget !== null && (
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs text-gray-400 mb-1">YTD Target</p>
                {isAdmin && editingTarget ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      value={targetDraft}
                      onChange={e => setTargetDraft(e.target.value)}
                      inputMode="numeric"
                      className="w-24 text-xl font-bold text-gray-900 bg-white border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                    <button onClick={saveTarget} disabled={savingTarget || !targetChanged} className="shrink-0 text-xs font-semibold bg-gray-900 text-white rounded px-2 py-1 hover:bg-gray-700 disabled:opacity-50">{savingTarget ? '…' : 'Save'}</button>
                    <button onClick={() => { setEditingTarget(false); setTargetDraft(String(ytdTarget ?? '')) }} className="shrink-0 text-gray-400 hover:text-gray-700" title="Cancel">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <p className="text-xl font-bold text-gray-900">{fmtFull(ytdTarget)}</p>
                    {isAdmin && (
                      <button onClick={() => setEditingTarget(true)} className="shrink-0 text-gray-300 hover:text-gray-600 transition-colors" title="Edit target (syncs to HubSpot)">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      </button>
                    )}
                  </div>
                )}
                <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${onTrack ? 'bg-green-500' : 'bg-red-400'}`} style={{ width: `${Math.min(pctOfTarget ?? 0, 100)}%` }} />
                </div>
                <p className="text-xs text-gray-400 mt-1">{pctOfTarget ?? 0}% achieved</p>
              </div>
            )}
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">YTD Sales Won</p>
              <p className="text-xl font-bold text-green-600">{fmtFull(ytdWon)}</p>
              <p className="text-xs text-gray-400 mt-1">{wonCount} deal{wonCount !== 1 ? 's' : ''} closed</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">Open Pipeline</p>
              <p className="text-xl font-bold text-blue-600">{fmtFull(openPipeline)}</p>
              <p className="text-xs text-gray-400 mt-1">{openCount} open deal{openCount !== 1 ? 's' : ''}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">Conversion Rate</p>
              <p className="text-xl font-bold text-gray-900">{convRate !== null ? `${convRate}%` : '—'}</p>
              <p className="text-xs text-gray-400 mt-1">{won12mCount}W / {lost12mCount}L · last 12 months</p>
            </div>
          </div>

          {/* Chance to hit target — this customer's win rate applied to their open pipeline */}
          {targetAttainment !== null && (
            <div className={`rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4 border ${targetAttainment >= 100 ? 'bg-green-50 border-green-100' : targetAttainment >= 80 ? 'bg-amber-50 border-amber-100' : 'bg-red-50 border-red-100'}`}>
              <div className="shrink-0 text-center sm:border-r sm:border-black/5 sm:pr-5">
                <p className={`text-3xl font-bold ${targetAttainment >= 100 ? 'text-green-700' : targetAttainment >= 80 ? 'text-amber-700' : 'text-red-600'}`}>{targetAttainment}%</p>
                <p className="text-xs text-gray-500">of target projected</p>
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-800 mb-0.5">Chance to hit target</p>
                <p className="text-sm text-gray-600">
                  Applying this customer's <span className="font-semibold">{Math.round(winRateValue! * 100)}%</span> win rate to their {fmtFull(openPipeline)} open pipeline gives
                  {' '}~<span className="font-semibold">{fmtFull(expectedFromPipeline!)}</span> more, for a projected <span className="font-semibold">{fmtFull(projectedTotal)}</span> against the {fmtFull(ytdTarget!)} target.
                </p>
              </div>
            </div>
          )}

          {/* ── Sales by financial year — prior three years vs. this year + target ── */}
          {!account.isGeneric && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Sales by financial year</p>
              {historyErr ? (
                <p className="text-xs text-red-600">{historyErr}</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {history
                    ? history.years.map(y => (
                        <div key={y.fyStartYear} className="bg-gray-50 rounded-xl p-4">
                          <p className="text-xs text-gray-400 mb-1">{y.fyLabel}</p>
                          <p className="text-lg font-bold text-gray-900">{fmtFull(y.won)}</p>
                          <p className="text-xs text-gray-400 mt-1">{y.dealCount} deal{y.dealCount !== 1 ? 's' : ''} won</p>
                        </div>
                      ))
                    : historyLoading && [0, 1, 2].map(i => (
                        <div key={i} className="bg-gray-50 rounded-xl p-4 animate-pulse h-[92px]" />
                      ))}
                  {/* Current FY — sales so far and target (both already authoritative on the card) */}
                  <div className="bg-green-50 rounded-xl p-4 border border-green-100">
                    <p className="text-xs text-gray-500 mb-1">{currentFyLabel} · this year</p>
                    <p className="text-lg font-bold text-green-700">{fmtFull(ytdWon)}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {ytdTarget != null && ytdTarget > 0
                        ? `Target ${fmtFull(ytdTarget)} · ${pctOfTarget ?? 0}%`
                        : `${wonCount} deal${wonCount !== 1 ? 's' : ''} won`}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Regions (branch locations) ──────────────────────────── */}
          <div>
            <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
              <p className="text-sm font-semibold text-gray-700">Regions</p>
              {isAdmin && regions && regions.locations.length > 0 && (
                editingLocs ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => { setEditingLocs(false); const conf = regions.locations.filter(l => l.confirmed).map(l => l.companyId); setConfirmSel(new Set(conf.length ? conf : regions.locations.map(l => l.companyId))) }}
                      className="px-3 py-1 text-xs font-semibold text-gray-500 hover:text-gray-700">Cancel</button>
                    <button onClick={saveLocations} disabled={savingLocs}
                      className="px-3 py-1 text-xs font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50">
                      {savingLocs ? 'Saving…' : 'Save branches'}
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setEditingLocs(true)} title="Edit which records are genuine branch locations"
                    className="shrink-0 p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  </button>
                )
              )}
            </div>
            <p className="text-xs text-gray-400 mb-3">Each HubSpot branch location for this customer — its BD cadence and the contacts linked to it.{editingLocs ? ' Tick the genuine branches; untick duplicates or sub-entities, then Save.' : ''}</p>
            {regionsLoading && <div className="space-y-2">{[0, 1].map(i => <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />)}</div>}
            {regionsErr && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{regionsErr}</p>}
            {regions && !regionsLoading && regions.locations.length === 0 && (
              <p className="text-sm text-gray-400 bg-gray-50 rounded-xl px-4 py-3">No HubSpot branch locations found for this customer.</p>
            )}
            {regions && regions.locations.length > 0 && (
              <div className="space-y-3">
                {regions.locations.map(loc => {
                  const designers = loc.contacts.filter(c => c.isDesigner)
                  const others = loc.contacts.filter(c => !c.isDesigner)
                  const othersOpen = openOthers.has(loc.companyId)
                  return (
                    <div key={loc.companyId} className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="flex items-center gap-3 px-4 py-3 bg-gray-50">
                        {editingLocs && (
                          <input type="checkbox" checked={confirmSel.has(loc.companyId)} onChange={() => toggleLoc(loc.companyId)}
                            className="w-4 h-4 shrink-0 cursor-pointer" title="Genuine branch location" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-gray-800 truncate">{loc.name}</p>
                          {loc.city && <p className="text-xs text-gray-400">{loc.city}</p>}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                          <CompletionPill cell={loc.completion?.bd_presentation} label="BD" rule="Full team BD presentation — BD Visit in last 12 months" />
                          <CompletionPill cell={loc.completion?.f2f} label="F2F" rule="Quarterly F2F — BD/CE/Project Visit in last quarter" />
                          <CompletionPill cell={loc.completion?.monthly_admin} label="Monthly" rule="Monthly call/admin — any call or visit in last month" />
                        </div>
                      </div>
                      {designers.length > 0 ? (
                        <div className="divide-y divide-gray-100">
                          {designers.map(c => <RegionContactRow key={c.id} c={c} companyId={loc.companyId} onToggle={toggleRegionDesigner} />)}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 px-4 py-2">No designers linked to this location.</p>
                      )}
                      {others.length > 0 && (
                        <div className="border-t border-gray-100">
                          <button type="button" onClick={() => toggleOthers(loc.companyId)}
                            className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700 transition-colors px-4 py-2">
                            <svg className={`w-3.5 h-3.5 transition-transform ${othersOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                            Other employees ({others.length})
                          </button>
                          {othersOpen && (
                            <div className="divide-y divide-gray-100">
                              {others.map(c => <RegionContactRow key={c.id} c={c} companyId={loc.companyId} onToggle={toggleRegionDesigner} />)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
                {(regions.undefined?.contacts?.length ?? 0) > 0 && (
                  <div className="border border-dashed border-gray-300 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50">
                      <p className="text-sm font-semibold text-gray-600">Undefined</p>
                      <p className="text-xs text-gray-400">Linked to the parent company — no specific branch</p>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {regions.undefined!.contacts.map(c => <RegionContactRow key={c.id} c={c} companyId="parent" onToggle={toggleRegionDesigner} />)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {shownDesignerCount !== null && (
            <div className="bg-blue-50 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-blue-900">Buyers</p>
                <p className="text-xs text-blue-500 mt-0.5">everyone across this account's branch locations, minus anyone unticked in Regions</p>
                {regions && (
                  <p className="text-xs text-blue-600 mt-1.5 font-medium">
                    {designerScoreCounts.A} A · {designerScoreCounts.B} B · {designerScoreCounts.C} C
                  </p>
                )}
              </div>
              <p className="text-2xl font-bold text-blue-700">{shownDesignerCount}</p>
            </div>
          )}

          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">Deals ({deals.length})</p>
            <p className="text-xs text-gray-400 mb-3">Every HubSpot deal counted for this customer. Remove one with ✕, or search below to add a deal to this customer.</p>
            {dealErr && <p className="text-xs text-red-600 mb-2">{dealErr}</p>}
            {deals.length > 0 && (
              <div className="bg-gray-50 rounded-xl divide-y divide-gray-100 mb-3">
                {deals.map(d => {
                  const badge = d.status === 'won' ? 'bg-green-100 text-green-700' : d.status === 'lost' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-700'
                  const label = d.status === 'won' ? 'Won' : d.status === 'lost' ? 'Lost' : 'Open'
                  return (
                    <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-gray-800 truncate font-medium">{d.name}</p>
                        <p className="text-xs text-gray-400 flex items-center gap-1.5">
                          <span className={`px-1.5 py-0.5 rounded font-semibold ${badge}`}>{label}</span>
                          {d.stage && <span className="truncate">{d.stage}</span>}
                          {d.manual && <span className="text-gray-300">· manually added</span>}
                        </p>
                      </div>
                      <p className="text-sm font-semibold text-gray-800 shrink-0">{fmtFull(d.value)}</p>
                      <button
                        onClick={() => removeDeal(d.id)}
                        title="Remove this deal from this customer"
                        className="shrink-0 p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            <input
              type="text"
              value={dealQuery}
              onChange={e => setDealQuery(e.target.value)}
              placeholder="Search HubSpot deals to add…"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            {dealSearching && <p className="text-xs text-gray-400 mt-1">Searching…</p>}
            {dealResults.length > 0 && (
              <div className="mt-2 border border-gray-200 rounded-lg divide-y divide-gray-100 bg-white overflow-hidden">
                {dealResults.map(r => {
                  const already = deals.some(d => d.id === r.id)
                  return (
                    <button
                      key={r.id}
                      onClick={() => allocateDeal(r)}
                      disabled={already}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors flex items-center justify-between gap-3 disabled:opacity-40"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-gray-800 truncate">{r.name}</span>
                        <span className="block text-xs text-gray-400">{r.closeDate ? new Date(r.closeDate).toLocaleDateString('en-NZ') : '—'}</span>
                      </span>
                      <span className="text-sm font-semibold text-gray-700 shrink-0">{already ? 'Added' : fmtFull(r.value)}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {!id && <LinkCompanyPanel accountName={name} onLinked={() => { onLinked(); handleClose() }} />}

          {id && profileLoading && (
            <div className="space-y-2">
              {[0, 1, 2].map(i => <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />)}
            </div>
          )}

          {id && profileErr && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{profileErr}</p>}

          {profile && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-3">Company Details</p>
              <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-gray-400">Domain</p><p className="text-gray-800">{profile.company.domain || '—'}</p></div>
                <div><p className="text-xs text-gray-400">Industry</p><p className="text-gray-800">{profile.company.industry || '—'}</p></div>
                <div><p className="text-xs text-gray-400">City</p><p className="text-gray-800">{profile.company.city || '—'}</p></div>
                <div><p className="text-xs text-gray-400">Employees</p><p className="text-gray-800">{profile.company.numberOfEmployees || '—'}</p></div>
                <div className="col-span-2"><p className="text-xs text-gray-400">Phone</p><p className="text-gray-800">{profile.company.phone || '—'}</p></div>
                {profile.company.description && (
                  <div className="col-span-2"><p className="text-xs text-gray-400 mb-1">About</p><p className="text-gray-600 text-xs whitespace-pre-line">{profile.company.description}</p></div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Log Activity Modal ───────────────────────────────────────────────────────────
// History is fetched lazily on open (not bundled into the matrix load) so the
// summary view stays a single lightweight request regardless of how much history
// each account/activity pair has built up.

function LogActivityModal({ accountName, activity, onClose, onChange }: {
  accountName: string
  activity: ActivityMeta
  onClose: () => void
  onChange: (entries: ActivityEntry[]) => void
}) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null)
  // Local (NZ) calendar day — toISOString() is UTC and shows yesterday during the NZ morning.
  const [date, setDate] = useState(() => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` })
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    cachedGet('/api/customer/activity/log', { params: { accountName, activity: activity.key } })
      .then(r => setEntries(r.data.entries))
      .catch(() => setEntries([]))
  }, [accountName, activity.key])

  function handleLog() {
    setSaving(true); setErr(null)
    axios.post('/api/customer/activity/log', { accountName, activity: activity.key, date, note: note.trim() || undefined })
      .then(r => { setEntries(r.data.entries); onChange(r.data.entries); setNote('') })
      .catch(e => setErr(e.response?.data?.error || e.message))
      .finally(() => setSaving(false))
  }

  function handleUndo() {
    setSaving(true); setErr(null)
    axios.delete('/api/customer/activity/log', { data: { accountName, activity: activity.key } })
      .then(r => { setEntries(r.data.entries); onChange(r.data.entries) })
      .catch(e => setErr(e.response?.data?.error || e.message))
      .finally(() => setSaving(false))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white px-6 py-5 border-b border-gray-100 flex items-center justify-between rounded-t-2xl">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{activity.label}</h2>
            <p className="text-sm text-gray-400">{accountName} · turns red after {activity.staleDays} days</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-xs text-gray-500">Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <button
              onClick={handleLog}
              disabled={saving}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              Log
            </button>
          </div>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          {err && <p className="text-sm text-red-600">{err}</p>}

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-2">History</p>
            {entries === null ? (
              <p className="text-sm text-gray-400">Loading…</p>
            ) : entries.length === 0 ? (
              <p className="text-sm text-gray-400">No entries yet.</p>
            ) : (
              <div className="bg-gray-50 rounded-xl divide-y divide-gray-100">
                {[...entries].reverse().map((e, i) => (
                  <div key={i} className="px-4 py-2.5 flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800">{e.date}</p>
                      {e.note && <p className="text-xs text-gray-400 truncate">{e.note}</p>}
                    </div>
                    {i === 0 && (
                      <button onClick={handleUndo} disabled={saving} className="text-xs text-red-500 hover:underline disabled:opacity-50 shrink-0">Undo</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Engagement Hub matrix ─────────────────────────────────────────────────────────
// Purely manual, ad-hoc activity tracking — independent of the account grid above
// (which needs a slow HubSpot pull), so this loads and updates fast on its own.

function EngagementHub({ managerFilter, onManagerFilterChange, hiddenNames }: { managerFilter: string; onManagerFilterChange: (m: string) => void; hiddenNames?: Set<string> }) {
  const [data, setData] = useState<ActivityData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [logging, setLogging] = useState<{ accountName: string; activityKey: string } | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set()) // customers whose branches are open
  const toggleExpand = (name: string) => setExpanded(s => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n })

  useEffect(() => {
    cachedGet('/api/customer/activity')
      .then(r => { setData(r.data); setLoading(false) })
      .catch(e => { setError(e.response?.data?.error || e.message); setLoading(false) })
  }, [])

  function patchEntries(accountName: string, activityKey: string, entries: ActivityEntry[]) {
    setData(d => {
      if (!d) return d
      const meta = d.activities.find(a => a.key === activityKey)
      const staleDays = meta?.staleDays ?? Infinity
      const lastDate = entries.length ? entries[entries.length - 1].date : null
      const daysSince = lastDate ? Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000) : null
      const status: ActivityStatus['status'] = (lastDate !== null && daysSince! <= staleDays) ? 'green' : 'red'
      return {
        ...d,
        accounts: d.accounts.map(acc => acc.name !== accountName ? acc : {
          ...acc,
          activity: { ...acc.activity, [activityKey]: { lastDate, daysSince, status, count: entries.length } },
        }),
      }
    })
  }

  if (loading) return <div className="px-6 py-10 text-center text-sm text-gray-400">Loading engagement activity…</div>
  if (error) return <div className="px-6 py-10 text-center text-sm text-red-500">Failed to load: {error}</div>
  if (!data) return null

  if (data.accounts.length === 0) return (
    <div className="px-6 py-10 text-center text-sm text-gray-400">Upload account targets above to start tracking engagement activity.</div>
  )

  // Hide generic categories / unlinked accounts from the hub.
  const visible = hiddenNames ? data.accounts.filter(a => !hiddenNames.has(a.name)) : data.accounts
  const managers = [...new Set(visible.map(a => a.manager))].sort((a, b) => a.localeCompare(b))
  const rows = managerFilter === 'all' ? visible : visible.filter(a => a.manager === managerFilter)

  // Shared cell renderers so per-location sub-rows reuse the exact look of account rows.
  const cellInner = (s: ActivityStatus) => {
    const isRed = s.status !== 'green'
    return (
      <>
        {!isRed && <span className="w-3 h-3 rounded-full bg-green-500 group-hover:ring-2 group-hover:ring-offset-1 group-hover:ring-gray-300 transition-all" />}
        <span className={`text-[10px] ${isRed ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>{s.lastDate ? `${s.daysSince}d` : 'never'}</span>
      </>
    )
  }
  const cellTitle = (a: ActivityMeta, s: ActivityStatus) => a.derived
    ? (s.lastDate ? `Last ${a.label.toLowerCase()}: ${s.lastDate} (${s.daysSince}d ago) · ${s.count} in the last 12 months · auto from HubSpot` : 'No qualifying HubSpot activity in the last 12 months')
    : (s.lastDate ? `Last: ${s.lastDate} (${s.daysSince}d ago) · ${s.count} logged` : 'No activity logged')
  // A filled status cell. Manual columns are clickable (open the log editor) when
  // clickAccount is set; derived columns are always read-only.
  const filledCell = (a: ActivityMeta, s: ActivityStatus | undefined, clickAccount: string | null) => {
    if (!s) return <td key={a.key} className="px-3 py-3" />
    const isRed = s.status !== 'green'
    return (
      <td key={a.key} className={`px-3 py-3 text-center transition-colors ${isRed ? 'bg-red-100' : ''}`}>
        {(a.derived || !clickAccount) ? (
          <div className="inline-flex flex-col items-center justify-center gap-1 min-h-[28px] w-full cursor-default" title={cellTitle(a, s)}>{cellInner(s)}</div>
        ) : (
          <button onClick={() => setLogging({ accountName: clickAccount, activityKey: a.key })} className="inline-flex flex-col items-center justify-center gap-1 group min-h-[28px] w-full" title={cellTitle(a, s)}>{cellInner(s)}</button>
        )}
      </td>
    )
  }
  const emptyCell = (a: ActivityMeta) => <td key={a.key} className="px-3 py-3" />
  const dashCell = (a: ActivityMeta) => <td key={a.key} className="px-3 py-3 text-center text-gray-300">—</td>
  // Trim the leading customer name from a location label ("Unispace - Wellington" → "Wellington").
  // If stripping leaves nothing meaningful (empty, or only corporate words like "Group Ltd"),
  // keep the full company name rather than showing a bare suffix.
  const CORP_ONLY = /^(group|ltd|limited|pty|llc|inc|incorporated|corp|corporation|co|holdings?|nz|new zealand|and|&|[-–:\s])+$/i
  const locLabel = (loc: ActivityLocation, accName: string) => {
    const stripped = loc.name.replace(new RegExp('^' + accName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-–:]?\\s*', 'i'), '').trim()
    if (stripped && !CORP_ONLY.test(stripped)) return stripped // e.g. "Unispace - Wellington" → "Wellington"
    if (loc.city) return loc.city                              // no suffix in the name → use the city ("Wingates" → "Auckland")
    return loc.name
  }
  // Collapsed-header summary for a derived column: how many of the customer's branches are green.
  const rollupCell = (a: ActivityMeta, locs: ActivityLocation[]) => {
    const greens = locs.filter(l => l.activity[a.key]?.status === 'green').length
    const ok = greens === locs.length && locs.length > 0
    return (
      <td key={a.key} className={`px-3 py-3 text-center ${ok ? '' : 'bg-red-100'}`} title={`${greens}/${locs.length} branches in the last ${windowText(a.staleDays)}`}>
        <span className={`text-[11px] font-semibold ${ok ? 'text-green-700' : 'text-red-600'}`}>{greens}/{locs.length}</span>
      </td>
    )
  }

  return (
    <>
      <div className="px-4 pt-4 flex items-center gap-2">
        <label className="text-xs font-semibold text-gray-500">Salesperson</label>
        <select
          value={managerFilter}
          onChange={e => onManagerFilterChange(e.target.value)}
          className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="all">All ({data.accounts.length})</option>
          {managers.map(m => (
            <option key={m} value={m}>{m} ({data.accounts.filter(a => a.manager === m).length})</option>
          ))}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 whitespace-nowrap">Account</th>
              {managerFilter === 'all' && <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 whitespace-nowrap">Manager</th>}
              {data.activities.map(a => (
                <th
                  key={a.key}
                  className="px-3 py-3 text-xs font-semibold text-gray-500 text-center whitespace-nowrap"
                  title={a.derived
                    ? `Auto from HubSpot — green if ${a.sourceLabel} in the last ${windowText(a.staleDays)}`
                    : `Manual — turns red after ${a.staleDays} days without one`}
                >
                  <span className="inline-flex items-center gap-1">
                    {a.label}
                    {a.derived && <span className="text-[9px] font-semibold uppercase tracking-wide text-blue-400" title="Auto-tracked from HubSpot">auto</span>}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.length === 0 && (
              <tr><td colSpan={data.activities.length + (managerFilter === 'all' ? 2 : 1)} className="px-4 py-8 text-center text-sm text-gray-400">No accounts for this salesperson</td></tr>
            )}
            {rows.flatMap(acc => {
              // Only split into per-branch sub-rows when there are 2+ locations. A single
              // branch (or none) renders as one clean customer row — no redundant sub-row.
              const curated = (acc.locations?.length ?? 0) > 1
              // Uncurated / single-location → single row with all 5 columns (unchanged behaviour).
              if (!curated) {
                return [(
                  <tr key={acc.name} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{acc.name}</td>
                    {managerFilter === 'all' && <td className="px-3 py-3 text-gray-400 whitespace-nowrap">{acc.manager}</td>}
                    {data.activities.map(a => filledCell(a, acc.activity[a.key], acc.name))}
                  </tr>
                )]
              }
              // Curated → a collapsible customer header row (manual columns clickable; the
              // auto columns show a branches-green rollup) + one sub-row per branch when open.
              const open = expanded.has(acc.name)
              return [
                <tr key={acc.name} className="bg-gray-50/60 border-t border-gray-100">
                  <td className="px-4 py-3 font-semibold text-gray-800 whitespace-nowrap">
                    <button onClick={() => toggleExpand(acc.name)} className="inline-flex items-center gap-1.5 hover:text-gray-900" title={open ? 'Hide branches' : 'Show branches'}>
                      <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                      {acc.name}
                      <span className="text-[10px] font-medium text-gray-400">({acc.locations!.length})</span>
                    </button>
                  </td>
                  {managerFilter === 'all' && <td className="px-3 py-3 text-gray-400 whitespace-nowrap">{acc.manager}</td>}
                  {/* Header shows the CLIENT-level status (green dot, as before); expand for
                      the per-branch breakdown. Derived read-only; manual clickable to log. */}
                  {data.activities.map(a => filledCell(a, acc.activity[a.key], a.derived ? null : acc.name))}
                </tr>,
                ...(open ? acc.locations!.map(loc => (
                  <tr key={`${acc.name}::${loc.companyId}`} className="hover:bg-gray-50">
                    <td className="pl-9 pr-4 py-2 text-gray-600 text-xs whitespace-nowrap">{locLabel(loc, acc.name)}</td>
                    {managerFilter === 'all' && <td className="px-3 py-2" />}
                    {data.activities.map(a => a.derived ? filledCell(a, loc.activity[a.key], null) : emptyCell(a))}
                  </tr>
                )) : []),
              ]
            })}
          </tbody>
        </table>
      </div>

      {logging && (
        <LogActivityModal
          accountName={logging.accountName}
          activity={data.activities.find(a => a.key === logging.activityKey)!}
          onClose={() => setLogging(null)}
          onChange={entries => patchEntries(logging.accountName, logging.activityKey, entries)}
        />
      )}
    </>
  )
}

// ── Add Account Modal ────────────────────────────────────────────────────────────
// Manually create an account with a typed-in target, and optionally link it to a
// HubSpot company so its live sales data for the current FY starts pulling through.

function AddAccountModal({ owners, onClose, onSaved }: { owners: string[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [owner, setOwner] = useState('')
  const [company, setCompany] = useState<{ ids: string[]; name: string } | null>(null)
  const [query, setQuery] = useState('')
  const { results, searching } = useCompanySearch(query)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const targetNum = Number(target.replace(/[$,\s]/g, ''))
  const canSave = name.trim().length > 0 && targetNum > 0

  function handleSave() {
    if (!canSave) return
    setSaving(true); setErr(null)
    axios.post('/api/customer/account', {
      name: name.trim(),
      ytdTarget: targetNum,
      manager: owner.trim() || undefined,
      companyIds: company?.ids,
      companyName: company?.name,
    })
      .then(onSaved)
      .catch(e => { setErr(e.response?.data?.error || e.message); setSaving(false) })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white px-6 py-5 border-b border-gray-100 flex items-center justify-between rounded-t-2xl">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Add Account</h2>
            <p className="text-sm text-gray-400">Create a card with a manual target · optionally link HubSpot for live sales</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-500">Account name</label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Acme Interiors"
              className="w-full mt-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500">YTD Target (NZD)</label>
              <input
                type="text"
                inputMode="numeric"
                value={target}
                onChange={e => setTarget(e.target.value)}
                placeholder="50000"
                className="w-full mt-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500">Owner</label>
              <select
                value={owner}
                onChange={e => setOwner(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 cursor-pointer"
              >
                <option value="">Unassigned</option>
                {owners.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500">HubSpot company (optional)</label>
            {company ? (
              <div className="mt-1 flex items-center justify-between px-3 py-2 bg-green-50 border border-green-100 rounded-lg">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{company.name}</p>
                  <p className="text-xs text-green-600">Live sales will pull from this company</p>
                </div>
                <button onClick={() => { setCompany(null); setQuery('') }} className="text-xs text-gray-400 hover:text-gray-700 shrink-0 ml-2">Change</button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search HubSpot companies to link…"
                  className="w-full mt-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                {searching && <p className="text-xs text-gray-400 mt-1">Searching…</p>}
                {results.length > 0 && (
                  <div className="mt-2">
                    <CompanyResultsList results={results} onPick={(ids, nm) => { setCompany({ ids, name: nm }); setName(cur => cur.trim() ? cur : nm) }} />
                  </div>
                )}
              </>
            )}
          </div>

          {err && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{err}</p>}

          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="w-full py-3 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Add Account'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function CustomerEngagement({ isAdmin = false }: { isAdmin?: boolean }) {
  const [data, setData] = useState<EngagementData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Account | null>(null)
  // '' = collapsed (columns + counts only, no cards); 'all' = every card; else a salesperson
  const [ownerFilter, setOwnerFilter] = useState('')
  const [viewMode, setViewMode] = useState<'pace' | 'coverage'>('pace')
  const [showUpload, setShowUpload] = useState(false)
  const [showMatch, setShowMatch] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [mainView, setMainView] = useState<'cards' | 'hub'>('cards')
  const [showEdit, setShowEdit] = useState(false)

  function load() {
    // Only show the full-page skeleton on the very first load. Refreshes (after a deal
    // add/remove, owner/target edit, etc.) update in place so the page doesn't blank out.
    if (!data) setLoading(true)
    cachedGet('/api/customer/engagement')
      .then(r => { setData(r.data); setLoading(false) })
      .catch(e => { setError(e.response?.data?.error || e.message); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  if (loading) return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[...Array(3)].map((_, i) => <div key={i} className="bg-white rounded-lg border border-gray-200 h-9 w-28 animate-pulse" />)}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {[...Array(8)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-gray-200 h-52 animate-pulse" />)}
      </div>
    </div>
  )

  if (error) return <div className="flex items-center justify-center py-20 text-red-500 text-sm">Failed to load: {error}</div>
  if (!data) return null

  const { accounts, fyLabel, hasTargets, hubspotOwners, ceSalespeople } = data
  // "Still to be linked" excludes generic categories (buckets/aggregates + manually flagged).
  const unmatched = accounts.filter(a => !a.id && !a.isGeneric)
  // The hub shows only real, linked customers — hide unlinked and generic categories.
  const hubHidden = new Set(accounts.filter(a => !a.id || a.isGeneric).map(a => a.name))
  // The curated Customer Engagement roster (chosen in the Edit panel) drives the
  // owner filter and the card owner pickers. Before it's configured, fall back to
  // the owners already on cards (filter) / all HubSpot owners (pickers).
  const cardOwners = [...new Set(accounts.map(a => a.manager))].sort((a, b) => a.localeCompare(b))
  const owners = ceSalespeople.length ? ceSalespeople : cardOwners
  const pickerOwners = ceSalespeople.length ? ceSalespeople : hubspotOwners

  // Fraction of the NZ financial year (Apr 1 – Mar 31) elapsed so far, used to
  // prorate each account's annual target down to "where it should be by today".
  const now = new Date()
  const fyStartYear = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear()
  const fyStartMs = new Date(fyStartYear, 3, 1).getTime()
  const fyEndMs = new Date(fyStartYear + 1, 3, 1).getTime()
  const fyFraction = Math.min(1, Math.max(0.0001, (now.getTime() - fyStartMs) / (fyEndMs - fyStartMs)))

  // Cards are hidden until "All" or a salesperson is chosen; the zone columns and
  // their counts always show. When collapsed ('') or 'all', counts span every
  // account; when a salesperson is selected, they narrow to that person's accounts.
  const showCards = ownerFilter !== ''
  const isSalesperson = ownerFilter !== '' && ownerFilter !== 'all'
  const population = isSalesperson ? accounts.filter(a => a.manager === ownerFilter) : accounts
  // Fallback win rate for coverage: a card's own 12-month rate, else the company NZ rate.
  const fallbackRate = data.revenueSummary?.nzConv ?? 0
  const paced = population.map(a => {
    if (viewMode === 'coverage') {
      // Coverage = (won + open pipeline × win rate) ÷ target — chance of hitting target.
      const rate = a.winRate12m ?? fallbackRate
      const projected = a.ytdWon + (a.openPipeline || 0) * rate
      const pct = a.ytdTarget != null && a.ytdTarget > 0 ? Math.round((projected / a.ytdTarget) * 100) : null
      return { account: a, pct, zone: zoneForCoverage(pct) }
    }
    const proratedTarget = a.ytdTarget != null && a.ytdTarget > 0 ? a.ytdTarget * fyFraction : null
    const pace = proratedTarget ? Math.round((a.ytdWon / proratedTarget) * 100) : null
    return { account: a, pct: pace, zone: zoneForPace(pace) }
  })
  // Keep the engagement hub below in lock-step with the card selection.
  const hubManager = isSalesperson ? ownerFilter : 'all'

  // Company-wide revenue picture (all NZ + AU pipeline deals from HubSpot, not just key
  // accounts) — computed server-side. Drives the three top cards; independent of the
  // owner filter, since target vs. pipeline vs. shortfall is a whole-company view.
  const rs = data.revenueSummary

  return (
    <>
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Client Development</h1>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap text-sm">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 font-medium text-xs">
              <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              {fyLabel}
            </span>
            <span className="text-gray-500"><span className="font-semibold text-gray-800">{accounts.length}</span> active accounts</span>
            <span className="text-gray-300 hidden sm:inline">·</span>
            <span className="text-gray-400 text-xs hidden sm:inline">Click a card for details</span>
          </div>
          {isSalesperson && (
            <p className="mt-1 text-sm font-semibold text-gray-900">
              <span className="text-2xl font-bold">{population.length}</span>
              <span className="ml-1.5 font-medium text-gray-500">client{population.length !== 1 ? 's' : ''} for {ownerFilter}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5" title="Switch between the account cards and the engagement hub">
            {([['cards', 'Cards'], ['hub', 'Engagement Hub']] as const).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMainView(m)}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${mainView === m ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {/* Kept mounted in Hub view (just hidden) so the controls to its right don't shift position when toggling. */}
          <div
            className={`inline-flex rounded-lg border border-gray-200 bg-white p-0.5 ${mainView === 'cards' ? '' : 'invisible pointer-events-none'}`}
            aria-hidden={mainView !== 'cards'}
            title="Switch between YTD progress and projected pipeline coverage"
          >
            {([['pace', 'YTD Progress'], ['coverage', 'Pipeline Coverage']] as const).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                tabIndex={mainView === 'cards' ? 0 : -1}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${viewMode === m ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            value={ownerFilter}
            onChange={e => {
              const v = e.target.value
              setOwnerFilter(v)
            }}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors cursor-pointer"
            title="Filter by salesperson"
          >
            <option value="" disabled hidden>Filter by owner…</option>
            <option value="all">All</option>
            {owners.map(o => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          {ownerFilter !== '' && (
            <button
              onClick={() => setOwnerFilter('')}
              className="flex items-center gap-1 px-2.5 py-1.5 text-sm font-medium rounded-lg bg-white border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
              title="Clear filter — back to default view"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              Clear
            </button>
          )}
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add Account
          </button>
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
            {hasTargets ? 'Update Targets' : 'Upload Targets'}
          </button>
          {unmatched.length > 0 && (
            <button
              onClick={() => setShowMatch(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 010 5.656l-4 4a4 4 0 01-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 010-5.656l4-4a4 4 0 015.656 5.656l-1.5 1.5" /></svg>
              Match Accounts ({unmatched.length})
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setShowEdit(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-900 text-white hover:bg-gray-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Company-wide revenue: target vs. pipeline vs. conversion-adjusted shortfall */}
      {rs && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 mb-1">Revenue Target</p>
            <div className="flex items-baseline gap-2 flex-wrap">
              <p className="text-2xl font-bold text-gray-900">{fmtFull(rs.target)}</p>
              <p className="text-sm font-semibold text-gray-400">{fmtShort(rs.cardTarget)} on cards</p>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">company FY target · sum of card targets beside</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 mb-1">Open + Won in Pipeline</p>
            <p className="text-2xl font-bold text-blue-600">{fmtFull(rs.openWonInPipeline)}</p>
            <p className="text-xs text-gray-400 mt-0.5">Won {fmtShort(rs.nzWon)} · Open {fmtShort(rs.nzOpen)} NZ + {fmtShort(rs.auOpen)} AU</p>
          </div>
          <div className={`rounded-xl border p-4 ${rs.shortfallInFY > 0 ? 'bg-red-50 border-red-100' : 'bg-green-50 border-green-100'}`}>
            <p className="text-xs text-gray-500 mb-1">{rs.shortfallInFY > 0 ? 'Projected Shortfall' : 'Projected Surplus'}</p>
            <p className={`text-2xl font-bold ${rs.shortfallInFY > 0 ? 'text-red-600' : 'text-green-600'}`}>{fmtFull(Math.abs(rs.shortfallInFY))}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Projected {fmtFull(rs.projectedInFY)} to close by FY end
              {rs.nzConv != null ? ` · NZ ${Math.round(rs.nzConv * 100)}%` : ''}{rs.auConv != null ? ` / AU ${Math.round(rs.auConv * 100)}%` : ''} win rate
            </p>
            <p className="text-[11px] text-gray-400 mt-1">Best case {fmtFull(rs.projected)} if all open pipeline closed this FY</p>
          </div>
        </div>
      )}

      {!hasTargets && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800">No account targets configured</p>
            <p className="text-xs text-amber-600 mt-0.5">Upload your Excel targets sheet to enable on-track / off-track status. Accounts without targets still show live pipeline and spend data.</p>
          </div>
          <button onClick={() => setShowUpload(true)} className="shrink-0 px-3 py-1.5 bg-amber-600 text-white text-xs font-semibold rounded-lg hover:bg-amber-700 transition-colors">
            Upload now
          </button>
        </div>
      )}

      {mainView === 'cards' && (paced.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-gray-400 text-sm">No accounts for this filter</div>
      ) : (
        <div className="space-y-3">
          {!showCards && (
            <p className="text-xs text-gray-400">
              Showing the account count in each {viewMode === 'coverage' ? 'coverage' : 'pace'} zone — click <span className="font-medium text-gray-600">All</span> or choose a salesperson to see the cards.
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {ZONE_ORDER.map(zone => {
              const meta = ZONE_META[zone]
              const rangeText = viewMode === 'coverage' ? COVERAGE_RANGE[zone] : meta.range
              const metricLabel = viewMode === 'coverage' ? 'projected coverage' : 'of YTD pace'
              const col = paced
                .filter(p => p.zone === zone)
                .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))
              return (
                <div key={zone} className="space-y-3">
                  <div className={`rounded-xl border ${meta.headerBorder} ${meta.headerBg} ${showCards ? 'px-3 py-2.5 flex items-center justify-between' : 'p-5 flex flex-col justify-center items-start min-h-[150px]'}`}>
                    {showCards ? (
                      <>
                        <div>
                          <p className={`text-sm font-bold ${meta.headerText}`}>{meta.label}</p>
                          <p className="text-[11px] text-gray-500 mt-0.5">{rangeText}</p>
                        </div>
                        <span className={`text-lg font-bold ${meta.headerText}`}>{col.length}</span>
                      </>
                    ) : (
                      <>
                        <span className={`text-4xl font-bold ${meta.headerText}`}>{col.length}</span>
                        <p className={`text-base font-bold ${meta.headerText} mt-1.5`}>{meta.label}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{rangeText}</p>
                      </>
                    )}
                  </div>
                  {showCards && (
                    col.length === 0
                      ? <p className="text-xs text-gray-300 text-center py-8">No accounts</p>
                      : col.map(({ account, zone: z, pct }) => (
                          <AccountTile key={account.id || account.name} account={account} zone={z} proratedPct={pct} metricLabel={metricLabel} onClick={() => setSelected(account)} />
                        ))
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {mainView === 'hub' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-base font-bold text-gray-900">Client Development Hub</h2>
            <p className="text-sm text-gray-400">Engagement activity matrix — click a cell to log or review activity for that account</p>
          </div>
          <EngagementHub
            managerFilter={hubManager}
            onManagerFilterChange={m => setOwnerFilter(m === 'all' ? 'all' : m)}
            hiddenNames={hubHidden}
          />
        </div>
      )}
    </div>

    {selected && (
      <AccountModal
        account={selected}
        owners={pickerOwners}
        isAdmin={isAdmin}
        onClose={() => setSelected(null)}
        onLinked={load}
        onDeleted={() => { setSelected(null); load() }}
        onOwnerChanged={(accountName, mgr) =>
          setData(d => d ? { ...d, accounts: d.accounts.map(a => a.name === accountName ? { ...a, manager: mgr } : a) } : d)
        }
      />
    )}
    {showAdd && (
      <AddAccountModal
        owners={pickerOwners}
        onClose={() => setShowAdd(false)}
        onSaved={() => { setShowAdd(false); load() }}
      />
    )}
    {showEdit && (
      <TargetsPanel
        initialTab="customer"
        onClose={() => setShowEdit(false)}
        onSaved={load}
      />
    )}
    {showUpload && (
      <UploadModal
        onClose={() => setShowUpload(false)}
        onSaved={() => { setShowUpload(false); load() }}
      />
    )}
    {showMatch && (
      <MatchAccountsModal
        accounts={unmatched}
        onClose={() => { setShowMatch(false); load() }}
      />
    )}
    </>
  )
}
