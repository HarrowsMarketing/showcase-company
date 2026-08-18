import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { cachedGet, clearApiCache } from '../lib/apiCache'

// ── MQL Contacts manager ──────────────────────────────────────────────────────
// Lists every contact currently at the MQL lifecycle stage (the "one number") and
// lets marketing change a contact's status inline. Writing a new stage PATCHes the
// contact in HubSpot via /api/mql/set-lifecycle; a contact moved off MQL drops out
// of the list on the next load.

const MQL_STAGE = 'marketingqualifiedlead'

interface MqlContact {
  id: string
  name: string
  email: string
  company: string
  jobTitle: string
  score: number
  createdAt: string | null
  leadSource: string
}

interface Stage { value: string; label: string }

// Fallback if the property fetch fails — standard HubSpot lifecycle stages.
const FALLBACK_STAGES: Stage[] = [
  { value: 'subscriber', label: 'Subscriber' },
  { value: 'lead', label: 'Lead' },
  { value: 'marketingqualifiedlead', label: 'Marketing Qualified Lead' },
  { value: 'salesqualifiedlead', label: 'Sales Qualified Lead' },
  { value: 'opportunity', label: 'Opportunity' },
  { value: 'customer', label: 'Customer' },
  { value: 'evangelist', label: 'Evangelist' },
  { value: 'other', label: 'Other' },
]

type RowState = { saving?: boolean; movedTo?: string; error?: string }

export default function MqlManager() {
  const [contacts, setContacts] = useState<MqlContact[] | null>(null)
  const [stages, setStages] = useState<Stage[]>(FALLBACK_STAGES)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [search, setSearch] = useState('')
  const [rowState, setRowState] = useState<Record<string, RowState>>({})

  function load() {
    setLoading(true)
    setLoadError(false)
    cachedGet('/api/mql')
      .then(r => setContacts(r.data.contacts || []))
      .catch(() => { setContacts([]); setLoadError(true) })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    cachedGet('/api/contacts/lifecycle-stages')
      .then(r => { if (r.data.stages?.length) setStages(r.data.stages) })
      .catch(() => { /* keep fallback */ })
  }, [])

  const stageLabel = (value: string) => stages.find(s => s.value === value)?.label || value

  async function changeStage(contact: MqlContact, stage: string) {
    if (stage === MQL_STAGE) return
    setRowState(s => ({ ...s, [contact.id]: { saving: true } }))
    try {
      await axios.post('/api/mql/set-lifecycle', { contactId: contact.id, stage })
      // Success — this contact is no longer an MQL. Flash the outcome, then drop it.
      setRowState(s => ({ ...s, [contact.id]: { movedTo: stageLabel(stage) } }))
      setTimeout(() => {
        setContacts(list => (list || []).filter(c => c.id !== contact.id))
        setRowState(s => { const next = { ...s }; delete next[contact.id]; return next })
      }, 1400)
    } catch (e: any) {
      const msg = e?.response?.data?.error || 'Update failed'
      setRowState(s => ({ ...s, [contact.id]: { error: msg } }))
    }
  }

  const filtered = useMemo(() => {
    if (!contacts) return []
    const q = search.trim().toLowerCase()
    if (!q) return contacts
    return contacts.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.company.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q)
    )
  }, [contacts, search])

  return (
    <section className="bg-white rounded-2xl border border-gray-200 shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold tracking-widest text-gray-500 uppercase">MQL Contacts</h2>
          {contacts && (
            <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded-full">
              {contacts.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, company, email…"
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-300 w-48 sm:w-64"
          />
          <button
            onClick={() => { clearApiCache(); load() }}
            className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            title="Reload from HubSpot"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Column header (desktop only) */}
      <div className="hidden sm:grid grid-cols-[1fr_auto_auto] gap-4 px-5 py-2 border-b border-gray-100 bg-gray-50/60">
        <span className="text-xs font-semibold tracking-wide text-gray-400 uppercase">Contact</span>
        <span className="text-xs font-semibold tracking-wide text-gray-400 uppercase text-right w-16">Score</span>
        <span className="text-xs font-semibold tracking-wide text-gray-400 uppercase w-52">Status</span>
      </div>

      {/* Body */}
      <div className="divide-y divide-gray-50 max-h-[560px] overflow-y-auto">
        {loading && (
          <div className="p-5 space-y-3">
            {[0, 1, 2, 3, 4].map(i => <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />)}
          </div>
        )}

        {!loading && loadError && (
          <p className="text-sm text-red-500 px-5 py-8 text-center">Couldn’t load MQL contacts. Try Refresh.</p>
        )}

        {!loading && !loadError && filtered.length === 0 && (
          <p className="text-sm text-gray-400 px-5 py-8 text-center">
            {contacts?.length ? 'No contacts match your search.' : 'No contacts are currently at the MQL stage.'}
          </p>
        )}

        {!loading && filtered.map(c => {
          const st = rowState[c.id] || {}
          return (
            <div key={c.id} className="sm:grid sm:grid-cols-[1fr_auto_auto] sm:items-center gap-4 px-5 py-3 flex flex-col">
              {/* Contact */}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{c.name}</p>
                <p className="text-xs text-gray-400 truncate">
                  {[c.jobTitle, c.company].filter(Boolean).join(' · ') || c.email || '—'}
                </p>
                {c.leadSource && <p className="text-xs text-gray-300 truncate mt-0.5">via {c.leadSource}</p>}
              </div>

              {/* Score */}
              <div className="text-left sm:text-right sm:w-16 mt-1 sm:mt-0">
                <span className="text-xs text-gray-400 sm:hidden">Score: </span>
                <span className="text-sm font-semibold text-gray-700">{c.score}</span>
              </div>

              {/* Status control */}
              <div className="sm:w-52 mt-2 sm:mt-0">
                {st.movedTo ? (
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    Moved to {st.movedTo}
                  </span>
                ) : (
                  <>
                    <select
                      value={MQL_STAGE}
                      disabled={st.saving}
                      onChange={e => changeStage(c, e.target.value)}
                      className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-300 disabled:opacity-50"
                    >
                      {stages.map(s => (
                        <option key={s.value} value={s.value}>
                          {s.value === MQL_STAGE ? `${s.label} (current)` : `Move to ${s.label}`}
                        </option>
                      ))}
                    </select>
                    {st.saving && <p className="text-xs text-gray-400 mt-1">Saving…</p>}
                    {st.error && <p className="text-xs text-red-500 mt-1">{st.error}</p>}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
