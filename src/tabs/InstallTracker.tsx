import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../lib/fakeAuth'

interface EodReport { id: string; date: string; crewMember: string; hours: number; notes: string }
interface InstallJob {
  id: string
  display_id: string
  title: string
  installType: string
  account: string
  country: 'NZ' | 'AU'
  siteAddress: string
  crew: string[]
  scheduledDate: string
  completedDate: string | null
  status: 'scheduled' | 'in_progress' | 'complete' | 'delayed'
  notes: string
  eodReports: EodReport[]
}

const STATUS_LABEL: Record<InstallJob['status'], string> = {
  scheduled: 'Scheduled', in_progress: 'In Progress', complete: 'Complete', delayed: 'Delayed',
}
const STATUS_COLOR: Record<InstallJob['status'], string> = {
  scheduled: 'bg-blue-50 text-blue-700', in_progress: 'bg-amber-50 text-amber-700',
  complete: 'bg-green-50 text-green-700', delayed: 'bg-red-50 text-red-700',
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}
function todayISO() { return new Date().toISOString().slice(0, 10) }

const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</label>
      {children}
    </div>
  )
}
function Overlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl my-8" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

export default function InstallTracker() {
  const { getToken } = useAuth()
  const [jobs, setJobs] = useState<InstallJob[]>([])
  const [crew, setCrew] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('All')
  const [filterCountry, setFilterCountry] = useState('All')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [toast, setToast] = useState('')

  const authFetch = useCallback(async (url: string, opts?: RequestInit) => {
    const token = await getToken()
    const res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts?.headers ?? {}) } })
    return res.json()
  }, [getToken])

  const load = useCallback(async () => {
    setLoading(true)
    const [jobsRes, crewRes] = await Promise.all([authFetch('/api/installs/jobs'), authFetch('/api/installs/crew')])
    setJobs(jobsRes)
    setCrew(crewRes.crew || [])
    setLoading(false)
  }, [authFetch])

  useEffect(() => { load() }, [load])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2600) }

  const patchJob = async (id: string, updates: Record<string, unknown>) => {
    const updated = await authFetch(`/api/installs/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(updates) })
    setJobs(prev => prev.map(j => j.id === id ? updated : j))
  }
  const addEod = async (id: string, report: { crewMember: string; hours: number; notes: string }) => {
    const updated = await authFetch(`/api/installs/jobs/${id}/eod`, { method: 'POST', body: JSON.stringify({ ...report, date: todayISO() }) })
    setJobs(prev => prev.map(j => j.id === id ? updated : j))
    showToast('EOD report logged.')
  }

  const filtered = jobs.filter(j => {
    if (filterStatus !== 'All' && j.status !== filterStatus) return false
    if (filterCountry !== 'All' && j.country !== filterCountry) return false
    if (search) {
      const q = search.toLowerCase()
      if (![j.display_id, j.title, j.account, j.siteAddress].join(' ').toLowerCase().includes(q)) return false
    }
    return true
  })

  const now = todayISO()
  const total = jobs.length
  const scheduledCount = jobs.filter(j => j.status === 'scheduled').length
  const inProgressCount = jobs.filter(j => j.status === 'in_progress').length
  const delayedCount = jobs.filter(j => j.status === 'delayed').length
  const completedThisMonth = jobs.filter(j => j.status === 'complete' && j.completedDate?.slice(0, 7) === now.slice(0, 7)).length
  const eodCount = jobs.reduce((sum, j) => sum + j.eodReports.length, 0)

  const detail = jobs.find(j => j.id === detailId) || null

  if (loading && jobs.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-12">Loading install tracker…</p>
  }

  return (
    <div className="max-w-6xl mx-auto pb-8">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h2 className="text-xl font-extrabold text-gray-900">🛠 Install Tracker</h2>
          <p className="text-xs text-gray-500 mt-0.5">NZ &amp; AU · job cards, crew scheduling &amp; EOD reports</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-full hover:bg-gray-700 transition-colors">
          + New job card
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 mb-4">
        {[
          ['Total jobs', total, 'text-gray-900'],
          ['Scheduled', scheduledCount, 'text-blue-600'],
          ['In progress', inProgressCount, 'text-amber-600'],
          ['Delayed', delayedCount, 'text-red-600'],
          ['Completed (MTD)', completedThisMonth, 'text-green-600'],
          ['EOD reports logged', eodCount, 'text-gray-900'],
        ].map(([label, value, color]) => (
          <div key={label as string} className="bg-white rounded-2xl border border-gray-200 shadow-sm px-4 py-3">
            <p className={`text-2xl font-extrabold ${color}`} style={{ fontFamily: 'Georgia, serif' }}>{value}</p>
            <p className="text-[11px] text-gray-400 uppercase tracking-wide mt-1">{label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-center mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="11" cy="11" r="7" strokeWidth={2} /><path strokeLinecap="round" d="M21 21l-4.3-4.3" strokeWidth={2} /></svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by job #, title, account, address…" className="w-full border border-gray-200 rounded-full pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
        <select value={filterCountry} onChange={e => setFilterCountry(e.target.value)} className="border border-gray-200 rounded-full px-3 py-2 text-sm font-medium text-gray-600 bg-white">
          <option value="All">All countries</option><option value="NZ">NZ</option><option value="AU">AU</option>
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-gray-200 rounded-full px-3 py-2 text-sm font-medium text-gray-600 bg-white">
          <option value="All">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center border-2 border-dashed border-gray-200 rounded-2xl py-12 px-6 text-gray-500">
          <h3 className="text-lg font-bold text-gray-700 mb-1" style={{ fontFamily: 'Georgia, serif' }}>No jobs match these filters</h3>
          <p className="text-sm">Try clearing the search or switching country / status.</p>
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {filtered.map(j => (
            <div
              key={j.id}
              tabIndex={0}
              onClick={() => setDetailId(j.id)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailId(j.id) } }}
              className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all flex flex-col gap-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-[11px] font-bold text-gray-400">{j.display_id}</span>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_COLOR[j.status]}`}>{STATUS_LABEL[j.status]}</span>
              </div>
              <div className="font-bold text-sm text-gray-900 leading-snug">{j.title}</div>
              <div className="text-xs text-gray-500">{j.siteAddress} · {j.country}</div>
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {j.crew.map(c => <span key={c} className="px-2 py-0.5 rounded-full font-semibold bg-gray-100 text-gray-600">{c}</span>)}
              </div>
              <div className="flex justify-between text-[11px] text-gray-400 border-t border-dashed border-gray-200 pt-2 mt-auto">
                <span>{j.status === 'complete' ? `Completed ${fmtDate(j.completedDate)}` : `Scheduled ${fmtDate(j.scheduledDate)}`}</span>
                <span>{j.eodReports.length} EOD report{j.eodReports.length === 1 ? '' : 's'}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm font-semibold px-5 py-2.5 rounded-full shadow-lg z-[100]">{toast}</div>
      )}

      {detail && (
        <DetailModal
          job={detail}
          crew={crew}
          onClose={() => setDetailId(null)}
          onSetStatus={s => patchJob(detail.id, { status: s, completedDate: s === 'complete' ? todayISO() : detail.completedDate })}
          onAddEod={report => addEod(detail.id, report)}
        />
      )}

      {showAdd && (
        <AddModal
          crew={crew}
          onClose={() => setShowAdd(false)}
          onSave={async payload => {
            const created = await authFetch('/api/installs/jobs', { method: 'POST', body: JSON.stringify(payload) })
            setJobs(prev => [created, ...prev])
            setShowAdd(false)
            showToast(`Job ${created.display_id} logged.`)
          }}
        />
      )}
    </div>
  )
}

function DetailModal({ job, crew, onClose, onSetStatus, onAddEod }: {
  job: InstallJob
  crew: string[]
  onClose: () => void
  onSetStatus: (s: InstallJob['status']) => void
  onAddEod: (report: { crewMember: string; hours: number; notes: string }) => void
}) {
  const [crewMember, setCrewMember] = useState(job.crew[0] || crew[0] || '')
  const [hours, setHours] = useState('8')
  const [notes, setNotes] = useState('')

  const submit = () => {
    if (!notes.trim()) return
    onAddEod({ crewMember, hours: parseFloat(hours) || 0, notes: notes.trim() })
    setNotes('')
  }

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
        <h2 className="text-lg font-bold text-gray-900">{job.display_id} · {job.title}</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none p-1" aria-label="Close">✕</button>
      </div>
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div><p className="text-[11px] font-bold text-gray-400 uppercase">Account</p><p>{job.account}</p></div>
          <div><p className="text-[11px] font-bold text-gray-400 uppercase">Install type</p><p>{job.installType}</p></div>
          <div><p className="text-[11px] font-bold text-gray-400 uppercase">Site address</p><p>{job.siteAddress}</p></div>
          <div><p className="text-[11px] font-bold text-gray-400 uppercase">Crew</p><p>{job.crew.join(', ') || '—'}</p></div>
          <div><p className="text-[11px] font-bold text-gray-400 uppercase">Scheduled</p><p>{fmtDate(job.scheduledDate)}</p></div>
          <div><p className="text-[11px] font-bold text-gray-400 uppercase">Completed</p><p>{fmtDate(job.completedDate)}</p></div>
        </div>

        <div className="flex flex-wrap gap-2">
          {(Object.keys(STATUS_LABEL) as InstallJob['status'][]).map(s => (
            <button
              key={s}
              onClick={() => onSetStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${job.status === s ? STATUS_COLOR[s] : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
            >{STATUS_LABEL[s]}</button>
          ))}
        </div>

        <hr className="border-gray-100" />
        <div>
          <p className="text-[11px] font-bold text-gray-400 uppercase mb-2">EOD reports ({job.eodReports.length})</p>
          <div className="space-y-2.5 max-h-52 overflow-y-auto pr-1 mb-3">
            {job.eodReports.length ? job.eodReports.map(r => (
              <div key={r.id} className="text-xs bg-gray-50 rounded-lg p-2.5">
                <p className="font-bold text-gray-700">{fmtDate(r.date)} · {r.crewMember} · {r.hours}h</p>
                <p className="text-gray-500 mt-0.5">{r.notes}</p>
              </div>
            )) : <p className="text-xs text-gray-400">No EOD reports logged yet.</p>}
          </div>
          <div className="border border-gray-200 rounded-xl p-3 space-y-2.5">
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Crew member">
                <select value={crewMember} onChange={e => setCrewMember(e.target.value)} className={inputCls}>
                  {(job.crew.length ? job.crew : crew).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Hours"><input value={hours} onChange={e => setHours(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            </div>
            <Field label="Notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="What happened on-site today…" className={inputCls} /></Field>
            <button onClick={submit} disabled={!notes.trim()} className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-700 disabled:opacity-50">Log EOD report</button>
          </div>
        </div>
      </div>
    </Overlay>
  )
}

function AddModal({ crew, onClose, onSave }: { crew: string[]; onClose: () => void; onSave: (payload: Record<string, unknown>) => void }) {
  const [title, setTitle] = useState('')
  const [installType, setInstallType] = useState('')
  const [account, setAccount] = useState('')
  const [country, setCountry] = useState<'NZ' | 'AU'>('NZ')
  const [siteAddress, setSiteAddress] = useState('')
  const [scheduledDate, setScheduledDate] = useState(todayISO())
  const [selectedCrew, setSelectedCrew] = useState<string[]>([])

  const toggleCrew = (c: string) => setSelectedCrew(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])

  const save = () => {
    if (!title.trim() || !account.trim()) return
    onSave({ title, installType: installType || 'Workshop Tool Storage Fitout', account, country, siteAddress, scheduledDate, crew: selectedCrew })
  }

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
        <h2 className="text-lg font-bold text-gray-900">New job card</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none p-1" aria-label="Close">✕</button>
      </div>
      <div className="p-5 space-y-4">
        <Field label="Job title"><input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Retail Tool Wall Install — Ironclad Hardware Co" className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Account"><input value={account} onChange={e => setAccount(e.target.value)} placeholder="Customer account name" className={inputCls} /></Field>
          <Field label="Country">
            <select value={country} onChange={e => setCountry(e.target.value as 'NZ' | 'AU')} className={inputCls}><option value="NZ">NZ</option><option value="AU">AU</option></select>
          </Field>
        </div>
        <Field label="Site address"><input value={siteAddress} onChange={e => setSiteAddress(e.target.value)} placeholder="Street, city" className={inputCls} /></Field>
        <Field label="Scheduled date"><input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} className={inputCls} /></Field>
        <Field label="Crew assigned">
          <div className="flex flex-wrap gap-2">
            {crew.map(c => (
              <button key={c} type="button" onClick={() => toggleCrew(c)} className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${selectedCrew.includes(c) ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>{c}</button>
            ))}
          </div>
        </Field>
        <div className="flex gap-3 justify-end pt-2">
          <button onClick={onClose} className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={!title.trim() || !account.trim()} className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-700 disabled:opacity-50">Save job card</button>
        </div>
      </div>
    </Overlay>
  )
}
