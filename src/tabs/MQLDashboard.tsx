import { useEffect, useState } from 'react'
import axios from 'axios'
import { cachedGet } from '../lib/apiCache'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MqlContact {
  id: string
  name: string
  email: string
  company: string
  jobTitle: string
  phone: string
  score: number
  totalPageViews: number
  formCount: number
  lastVisit: number | null
  createdAt: string | null
  leadSource: string
  recentPages: { url: string; ts: string | null; count: number }[]
}

type View = 'action' | 'mql' | 'sql-pushed'
type Filter = 'all' | 'hot' | 'warm' | 'cold'
type ContactBrief = {
  allPageViews?: { url: string; title: string; ts: string | null }[]
  formSubmissions?: { name: string }[]
  products?: { name: string; count: number }[]
}

interface SqlPushedEntry {
  contactId: string
  name: string
  company: string
  email: string
  phone: string
  jobTitle: string
  pushedAt: number
}

interface SqlTarget {
  id: string
  name: string
  company: string
  email: string
  phone: string
  jobTitle: string
  leadSource?: string
  recentPages?: { url: string; ts: string | null; count: number }[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const HOT = 50
const WARM = 15
const SQL_PUSHED_KEY = 'yourcompany_sql_pushed'
const SQL_PUSHED_EXPIRY_MS = 60 * 24 * 3600 * 1000
const REVIEWED_KEY = 'yourcompany_mql_reviewed'

// ─── localStorage helpers ─────────────────────────────────────────────────────

function readSqlPushed(): SqlPushedEntry[] {
  try {
    const raw = localStorage.getItem(SQL_PUSHED_KEY)
    if (!raw) return []
    const all: SqlPushedEntry[] = JSON.parse(raw)
    return all.filter(e => e.pushedAt > Date.now() - SQL_PUSHED_EXPIRY_MS)
  } catch { return [] }
}

function writeSqlPushed(contactId: string, contact: SqlTarget) {
  const current = readSqlPushed()
  const updated = current.filter(e => e.contactId !== contactId)
  updated.push({ contactId, name: contact.name, company: contact.company, email: contact.email, phone: contact.phone, jobTitle: contact.jobTitle, pushedAt: Date.now() })
  localStorage.setItem(SQL_PUSHED_KEY, JSON.stringify(updated))
}

function readReviewed(): Set<string> {
  try {
    const raw = localStorage.getItem(REVIEWED_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw))
  } catch { return new Set() }
}

function markReviewed(contactId: string) {
  const current = readReviewed()
  current.add(contactId)
  localStorage.setItem(REVIEWED_KEY, JSON.stringify([...current]))
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function scoreStyle(score: number) {
  if (score >= HOT) return { badge: 'bg-green-100 text-green-700 border border-green-200', label: 'Hot', dot: 'bg-green-500', text: 'text-green-600' }
  if (score >= WARM) return { badge: 'bg-amber-100 text-amber-700 border border-amber-200', label: 'Warm', dot: 'bg-amber-500', text: 'text-amber-600' }
  return { badge: 'bg-gray-100 text-gray-500 border border-gray-200', label: 'Cold', dot: 'bg-gray-300', text: 'text-gray-400' }
}

function relativeTime(ts: number | string | null): string {
  if (!ts) return '—'
  const ms = typeof ts === 'string' ? new Date(ts).getTime() : ts
  if (isNaN(ms)) return '—'
  const days = Math.floor((Date.now() - ms) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function buildEmailBody(contact: SqlTarget, brief: any, notes: string): string {
  const lines: string[] = []

  lines.push('Good Morning,')
  lines.push('')
  lines.push('Please see the below MQL from Marketing for you to look into.')
  lines.push('')
  lines.push('--- CONTACT DETAILS ---')
  lines.push(`Name: ${contact.name}`)
  if (contact.company) lines.push(`Company: ${contact.company}`)
  if (contact.email) lines.push(`Email: ${contact.email}`)
  if (contact.phone) lines.push(`Phone: ${contact.phone}`)
  if (contact.jobTitle) lines.push(`Job Title: ${contact.jobTitle}`)
  lines.push('')
  lines.push('Our recommendation:')
  lines.push('• That you give the client a call and see if this is a pending project prior to setting the status to SQL on the contact and getting Lorriel to create you a deal.')
  lines.push('')
  lines.push('Key Insights:')

  // Lead source — prefer brief form submissions, fall back to MQL list data
  const formSubmissions: { name: string }[] = brief?.formSubmissions || []
  if (formSubmissions.length) {
    lines.push('Lead Source:')
    for (const f of formSubmissions) lines.push(`• ${f.name}`)
    lines.push('')
  } else if (contact.leadSource) {
    lines.push('Lead Source:')
    contact.leadSource.split(' → ').forEach(s => lines.push(`• ${s}`))
    lines.push('')
  }

  // Page views — prefer brief allPageViews, fall back to MQL list recentPages
  const pageViews: { url: string; title: string; ts: string | null }[] = brief?.allPageViews || []
  if (pageViews.length) {
    lines.push('Page Views:')
    for (const pv of pageViews.slice(0, 20)) {
      const label = pv.title || pv.url.replace(/https?:\/\/(www\.)?yourcompany\.io/, '') || pv.url
      if (pv.ts) {
        lines.push(new Date(pv.ts).toLocaleString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }))
      }
      lines.push(`• ${contact.name} viewed ${label}`)
    }
    lines.push('')
  } else if (brief?.products?.length) {
    lines.push('Page Views:')
    for (const p of (brief.products as { name: string; count: number }[]).slice(0, 10)) {
      lines.push(`• ${p.name}${p.count > 1 ? ` (viewed ${p.count}×)` : ''}`)
    }
    lines.push('')
  } else if (contact.recentPages?.length) {
    lines.push('Page Views:')
    for (const pv of contact.recentPages) {
      const label = pv.url.replace(/https?:\/\/(www\.)?yourcompany\.io/, '') || pv.url
      lines.push(`• ${contact.name} viewed ${label}${pv.count > 1 ? ` (${pv.count} visits)` : ''}`)
    }
    lines.push('')
  }

  lines.push('Notes:')
  lines.push(notes.trim())

  return lines.join('\r\n')
}

// ─── Salespeople ──────────────────────────────────────────────────────────────

const SALESPEOPLE = [
  { name: 'Vern',   email: 'vern@yourcompany.io' },
  { name: 'Iarnon', email: 'iarnon@yourcompany.io' },
  { name: 'Denver', email: 'denver@yourcompany.io' },
  { name: 'Kelly',  email: 'kelly@yourcompany.io' },
] as const

type Salesperson = typeof SALESPEOPLE[number]

// ─── Contact detail modal ─────────────────────────────────────────────────────

function ContactModal({
  contact,
  isReviewed,
  onClose,
  onSqlSent,
  onStayMql,
}: {
  contact: MqlContact
  isReviewed: boolean
  onClose: () => void
  onSqlSent: () => void
  onStayMql: () => void
}) {
  const [notes, setNotes] = useState('')
  const [assignedTo, setAssignedTo] = useState<Salesperson | null>(null)
  const [brief, setBrief] = useState<ContactBrief | null>(null)
  const [briefLoading, setBriefLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [validationError, setValidationError] = useState(false)

  useEffect(() => {
    cachedGet(`/api/mql/contact-brief?contactId=${contact.id}`)
      .then(r => setBrief(r.data))
      .catch(() => {})
      .finally(() => setBriefLoading(false))
  }, [contact.id])

  async function handleSendAsSql() {
    if (!assignedTo) { setValidationError(true); return }
    setValidationError(false)
    setSending(true)
    const target: SqlTarget = { id: contact.id, name: contact.name, company: contact.company, email: contact.email, phone: contact.phone, jobTitle: contact.jobTitle, leadSource: contact.leadSource, recentPages: contact.recentPages }
    const subject = `New MQL — ${contact.name}${contact.company ? ` (${contact.company})` : ''}`
    const body = buildEmailBody(target, brief, notes)
    window.open(`mailto:${assignedTo.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`)
    await axios.post('/api/mql/promote-to-sql', {
      contactId: contact.id,
      notes,
      salespersonName: assignedTo.name,
      salespersonEmail: assignedTo.email,
      contactName: contact.name,
      company: contact.company,
      jobTitle: contact.jobTitle,
      score: contact.score,
      leadSource: contact.leadSource,
    }).catch(() => {})
    setSending(false)
    onSqlSent()
  }

  function handleStayMql() {
    onStayMql()
    onClose()
  }

  const ss = scoreStyle(contact.score)
  const pageViews: { url: string; title?: string; ts: string | null; count?: number }[] =
    brief?.allPageViews?.length
      ? brief.allPageViews
      : contact.recentPages

  const initials = contact.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-4 p-6 border-b border-gray-100">
          <div className="relative shrink-0">
            <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-700 text-sm font-bold flex items-center justify-center">
              {initials}
            </div>
            <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${ss.dot}`} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-gray-900 leading-tight">{contact.name}</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {[contact.jobTitle, contact.company].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${ss.badge}`}>
              {ss.label} · {contact.score} pts
            </span>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-lg leading-none transition-colors"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Contact details grid */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Contact Details</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              {contact.email && (
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Email</p>
                  <a href={`mailto:${contact.email}`} className="text-sm text-blue-600 hover:underline break-all">{contact.email}</a>
                </div>
              )}
              {contact.phone && (
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Phone</p>
                  <p className="text-sm text-gray-900">{contact.phone}</p>
                </div>
              )}
              {contact.company && (
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Company</p>
                  <p className="text-sm text-gray-900">{contact.company}</p>
                </div>
              )}
              {contact.jobTitle && (
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Job Title</p>
                  <p className="text-sm text-gray-900">{contact.jobTitle}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Last Active</p>
                <p className="text-sm text-gray-900">{relativeTime(contact.lastVisit)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Forms Submitted</p>
                <p className="text-sm text-gray-900">{contact.formCount}</p>
              </div>
              {contact.leadSource && (
                <div className="col-span-2">
                  <p className="text-xs text-gray-400 mb-1.5">Lead Source</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {contact.leadSource.split(' → ').map((src, i, arr) => (
                      <span key={i} className="flex items-center gap-1.5">
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">{src}</span>
                        {i < arr.length - 1 && <span className="text-gray-300 text-xs">→</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Pages seen */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Pages Seen
              {!briefLoading && (
                <span className="ml-1.5 normal-case font-normal text-gray-400">
                  ({pageViews.length} {pageViews.length === 1 ? 'page' : 'pages'})
                </span>
              )}
            </p>
            {briefLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-8 bg-gray-100 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : pageViews.length === 0 ? (
              <p className="text-sm text-gray-400">No page views recorded.</p>
            ) : (
              <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
                {pageViews.map((page, i) => {
                  const url = page.url || ''
                  const label = ('title' in page && page.title)
                    ? page.title
                    : url.replace(/https?:\/\/(www\.)?yourcompany\.io/, '') || url
                  const isProduct = /\/products?\//.test(url)
                  return (
                    <div key={i} className="flex items-center gap-3 text-xs py-2 px-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                      <span className="text-gray-400 shrink-0 w-16">{relativeTime(page.ts)}</span>
                      <span className={`flex-1 truncate ${isProduct ? 'text-blue-600 font-medium' : 'text-gray-600'}`}>
                        {label}
                      </span>
                      <div className="shrink-0 flex items-center gap-1">
                        {isProduct && (
                          <span className="px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded text-xs">product</span>
                        )}
                        {(page.count ?? 0) > 1 && (
                          <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium">{page.count}×</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Assign salesperson */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Assign to Salesperson <span className="text-red-400">*</span>
            </p>
            <div className="flex gap-2 flex-wrap">
              {SALESPEOPLE.map(sp => (
                <button
                  key={sp.name}
                  onClick={() => { setAssignedTo(sp); setValidationError(false) }}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                    assignedTo?.name === sp.name
                      ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-purple-300 hover:text-purple-700'
                  }`}
                >
                  {sp.name}
                </button>
              ))}
            </div>
            {assignedTo && (
              <p className="text-xs text-gray-400 mt-1.5">
                Email will go to <span className="font-medium text-gray-600">{assignedTo.email}</span>
              </p>
            )}
            {validationError && (
              <p className="text-xs text-red-500 mt-1.5 font-medium">Please assign a salesperson before sending.</p>
            )}
          </div>

          {/* Qualifying call notes */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Qualifying Call Notes</p>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add your notes from the qualifying call here — these will be saved to HubSpot and included in the email…"
              rows={4}
              className="w-full text-sm border border-gray-200 rounded-xl px-3.5 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-purple-400 placeholder:text-gray-300"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
          <div className="flex-1" />
          {!isReviewed && (
            <button
              onClick={handleStayMql}
              className="px-5 py-2.5 rounded-xl border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Stay MQL
            </button>
          )}
          <button
            onClick={handleSendAsSql}
            disabled={sending}
            className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center gap-2 ${
              assignedTo
                ? 'bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {sending ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Opening Outlook…
              </>
            ) : assignedTo ? `Send to ${assignedTo.name}` : 'Assign salesperson first'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Re-draft modal (SQL Pushed view) ────────────────────────────────────────

function SendSqlModal({ contact, onClose, onSent }: { contact: SqlTarget; onClose: () => void; onSent: () => void }) {
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleOpen() {
    setLoading(true)
    let brief: ContactBrief | null = null
    try {
      const r = await cachedGet(`/api/mql/contact-brief?contactId=${contact.id}`)
      brief = r.data
    } catch (_) {}
    setLoading(false)

    const subject = `New MQL — ${contact.name}${contact.company ? ` (${contact.company})` : ''}`
    const body = buildEmailBody(contact, brief, notes)
    window.open(`mailto:sales@yourcompany.io?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`)

    axios.post('/api/mql/promote-to-sql', { contactId: contact.id }).catch(() => {})
    onSent()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-gray-900 text-base mb-1">Re-draft SQL Email</h3>
        <p className="text-sm text-gray-500 mb-4">
          Opens a pre-filled email to <span className="font-medium text-gray-700">sales@yourcompany.io</span> — review and send from Outlook.
        </p>
        <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-1 text-sm">
          <p className="font-semibold text-gray-900">{contact.name}</p>
          {contact.company && <p className="text-gray-500">{contact.company}</p>}
          {contact.email && <p className="text-gray-400 text-xs">{contact.email}</p>}
        </div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Notes</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Add your assessment here…"
          rows={3}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mb-5 resize-none focus:outline-none focus:ring-2 focus:ring-purple-400"
        />
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleOpen}
            disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading…
              </>
            ) : 'Open in Outlook'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── SQL Pushed view ──────────────────────────────────────────────────────────

function SqlPushedView({ onReDraft }: { onReDraft: (contact: SqlTarget) => void }) {
  const entries = readSqlPushed().sort((a, b) => b.pushedAt - a.pushedAt)

  if (entries.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm py-16 text-center text-sm text-gray-400">
        No contacts sent to SQL yet.
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="px-5 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Contact</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Pushed</th>
            <th className="px-5 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {entries.map(entry => (
            <tr key={entry.contactId} className="hover:bg-gray-50 transition-colors">
              <td className="px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-green-100 text-green-700 text-xs font-bold flex items-center justify-center shrink-0">
                    {entry.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">{entry.name}</p>
                    <p className="text-xs text-gray-400 truncate">{entry.company || entry.email}</p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3.5 text-sm text-gray-500">{relativeTime(entry.pushedAt)}</td>
              <td className="px-5 py-3.5 text-right">
                <button
                  onClick={() => onReDraft({ id: entry.contactId, name: entry.name, company: entry.company, email: entry.email, phone: entry.phone, jobTitle: entry.jobTitle })}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200 transition-colors"
                >
                  Re-draft
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function MQLDashboard() {
  const [view, setView] = useState<View>('action')
  const [data, setData] = useState<{ contacts: MqlContact[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedContact, setSelectedContact] = useState<MqlContact | null>(null)
  const [sqlModal, setSqlModal] = useState<SqlTarget | null>(null)
  const [pushedIds, setPushedIds] = useState<Set<string>>(() => new Set(readSqlPushed().map(e => e.contactId)))
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(() => readReviewed())

  useEffect(() => {
    if (view !== 'mql' && view !== 'action') return
    if (data) return
    cachedGet('/api/mql')
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false))
  }, [view])

  const allContacts = data?.contacts ?? []
  const contacts = allContacts.filter(c => !pushedIds.has(c.id))

  const byLastVisit = (a: MqlContact, b: MqlContact) => (b.lastVisit || 0) - (a.lastVisit || 0)
  const actionContacts = contacts.filter(c => !reviewedIds.has(c.id)).sort(byLastVisit)
  const mqlListContacts = contacts.filter(c => reviewedIds.has(c.id)).sort(byLastVisit)

  const activeList = view === 'action' ? actionContacts : mqlListContacts
  const hot = activeList.filter(c => c.score >= HOT)
  const warm = activeList.filter(c => c.score >= WARM && c.score < HOT)
  const cold = activeList.filter(c => c.score < WARM)
  const filtered = filter === 'hot' ? hot : filter === 'warm' ? warm : filter === 'cold' ? cold : activeList
  const avgScore = activeList.length > 0 ? Math.round(activeList.reduce((s, c) => s + c.score, 0) / activeList.length) : 0
  const unreviewedCount = actionContacts.length

  function handleStayMql(contactId: string) {
    markReviewed(contactId)
    setReviewedIds(ids => new Set([...ids, contactId]))
  }

  function handleSqlSent(contact: SqlTarget) {
    writeSqlPushed(contact.id, contact)
    setPushedIds(ids => new Set([...ids, contact.id]))
    setSqlModal(null)
  }

  const tabs: { key: View; label: string; badge?: number }[] = [
    { key: 'action', label: 'Action New MQLs', badge: unreviewedCount > 0 ? unreviewedCount : undefined },
    { key: 'mql', label: 'MQL List' },
    { key: 'sql-pushed', label: 'SQL Pushed' },
  ]

  return (
    <div className="space-y-6">

      {/* Tab bar */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex">
          {tabs.map((tab, i) => (
            <button
              key={tab.key}
              onClick={() => setView(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-3 sm:px-6 sm:py-4 text-xs sm:text-sm font-semibold transition-colors border-b-2 ${
                view === tab.key
                  ? 'border-purple-600 text-purple-700 bg-purple-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              } ${i > 0 ? 'border-l border-l-gray-100' : ''}`}
            >
              {tab.label}
              {tab.badge !== undefined && (
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold bg-purple-600 text-white">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Action New MQLs + MQL List (shared table UI) */}
      {(view === 'action' || view === 'mql') && (
        error ? (
          <div className="flex items-center justify-center py-20 text-red-500 text-sm">Failed to load MQL data: {error}</div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: view === 'action' ? 'To Action' : 'Tracked MQLs', value: loading ? '—' : String(activeList.length), sub: view === 'action' ? 'need review' : 'being monitored', color: 'text-gray-900' },
                { label: 'Hot', value: loading ? '—' : String(hot.length), sub: `≥${HOT} pts`, color: 'text-green-600' },
                { label: 'Warm', value: loading ? '—' : String(warm.length), sub: `${WARM}–${HOT - 1} pts`, color: 'text-amber-600' },
                { label: 'Avg Score', value: loading ? '—' : String(avgScore), sub: 'across list', color: 'text-blue-600' },
              ].map(card => (
                <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                  {loading ? (
                    <div className="space-y-2">
                      <div className="h-8 bg-gray-100 rounded animate-pulse" />
                      <div className="h-3 bg-gray-100 rounded w-2/3 animate-pulse" />
                    </div>
                  ) : (
                    <>
                      <p className={`text-3xl font-bold ${card.color}`}>{card.value}</p>
                      <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mt-1">{card.label}</p>
                      <p className="text-xs text-gray-400 mt-1">{card.sub}</p>
                    </>
                  )}
                </div>
              ))}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2 justify-between">
              <div className="flex gap-2 flex-wrap">
                {(['all', 'hot', 'warm', 'cold'] as Filter[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${filter === f ? 'bg-purple-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                  >
                    {f}
                    {!loading && f !== 'all' && (
                      <span className="ml-1.5 opacity-60 text-xs">
                        {f === 'hot' ? hot.length : f === 'warm' ? warm.length : cold.length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="hidden sm:block text-xs text-gray-400">Sorted by most recent activity</div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
              {loading ? (
                <div>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="px-5 py-4 border-b border-gray-50 flex items-center gap-4">
                      <div className="h-4 bg-gray-100 rounded flex-1 animate-pulse" />
                      <div className="h-8 w-14 bg-gray-100 rounded animate-pulse" />
                      <div className="h-4 w-28 bg-gray-100 rounded animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <div className="py-16 text-center text-sm text-gray-400">
                  {view === 'action' ? 'No new MQLs to action — all caught up.' : `No MQLs found${filter !== 'all' ? ` in "${filter}"` : ''}.`}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="px-5 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Contact</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">Score</th>
                      <th className="hidden sm:table-cell px-4 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">Page Views</th>
                      <th className="hidden sm:table-cell px-4 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">Forms</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Last Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(contact => {
                      const ss = scoreStyle(contact.score)
                      return (
                        <tr
                          key={contact.id}
                          onClick={() => setSelectedContact(contact)}
                          className={`border-b border-gray-100 hover:bg-purple-50 transition-colors cursor-pointer ${view === 'action' ? 'bg-green-50 hover:bg-green-100' : ''}`}
                        >
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className="relative shrink-0">
                                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center">
                                  {contact.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                </div>
                                <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${ss.dot}`} />
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium text-gray-900 truncate">{contact.name}</p>
                                <p className="text-xs text-gray-400 truncate">{contact.company || contact.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-center">
                            <div className="flex flex-col items-center gap-1">
                              <span className={`text-2xl font-bold ${ss.text}`}>{contact.score}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full ${ss.badge}`}>{ss.label}</span>
                            </div>
                          </td>
                          <td className="hidden sm:table-cell px-4 py-3.5 text-center">
                            <span className="font-semibold text-gray-800">{contact.totalPageViews}</span>
                            <p className="text-xs text-gray-400">×1 pt</p>
                          </td>
                          <td className="hidden sm:table-cell px-4 py-3.5 text-center">
                            <span className="font-semibold text-gray-800">{contact.formCount}</span>
                            <p className="text-xs text-gray-400">×10 pts</p>
                          </td>
                          <td className="px-4 py-3.5 text-sm text-gray-500">{relativeTime(contact.lastVisit)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )
      )}

      {/* SQL Pushed */}
      {view === 'sql-pushed' && (
        <SqlPushedView onReDraft={target => setSqlModal(target)} />
      )}


      {/* Contact detail modal */}
      {selectedContact && (
        <ContactModal
          contact={selectedContact}
          isReviewed={reviewedIds.has(selectedContact.id)}
          onClose={() => setSelectedContact(null)}
          onSqlSent={() => {
            handleSqlSent(selectedContact)
            setSelectedContact(null)
          }}
          onStayMql={() => handleStayMql(selectedContact.id)}
        />
      )}

      {/* Re-draft modal (SQL Pushed view) */}
      {sqlModal && (
        <SendSqlModal
          contact={sqlModal}
          onClose={() => setSqlModal(null)}
          onSent={() => handleSqlSent(sqlModal)}
        />
      )}

    </div>
  )
}
