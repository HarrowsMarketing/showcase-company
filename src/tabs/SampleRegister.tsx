import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../lib/fakeAuth'
import { LogoMark } from '../components/Logo'

// Ported from a standalone prototype (which used a Claude-Artifact-only storage
// API, not available outside that sandbox) into a real Supabase-backed tab —
// same data model and behaviour, rebuilt as proper React against
// /api/production/samples.

interface SpecRow { label: string; value: string }
interface HistoryEntry {
  date: string; action: 'created' | 'out' | 'in'; salesperson: string; jobCard: string
  clientName?: string; deliveryLocation?: string; location: string
}
interface Sample {
  id: string
  display_id: string
  name: string
  photo_url: string | null
  country: 'NZ' | 'AU'
  location: string
  condition: string
  status: 'in' | 'out'
  job_card: string
  salesperson: string
  client_name: string
  delivery_location: string
  review_months: number
  value: number
  specs: SpecRow[]
  date_out: string | null
  date_in: string | null
  estimated_return: string | null
  last_movement_date: string
  created_at: string
  history: HistoryEntry[]
}

const LOCATIONS = ['Timaru', 'Auckland', 'Melbourne', 'Sydney']
const CONDITIONS = ['Excellent', 'Good', 'Fair', 'Poor']
const DEFAULT_REVIEW_MONTHS = 6
const MAX_DIM = 1800
const JPEG_Q = 0.9

function todayISO() { return new Date().toISOString().slice(0, 10) }
function fmtDate(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}
function daysBetween(a: string, b: string) {
  return Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000)
}
function fmtMoney(n: number) {
  return '$' + (Number(n) || 0).toLocaleString('en-NZ', { maximumFractionDigits: 0 })
}

interface Flag { type: 'red' | 'amber'; label: string; key: 'overdue' | 'stagnant' }
function computeFlags(s: Sample): Flag[] {
  const flags: Flag[] = []
  const now = todayISO()
  if (s.status === 'out' && s.estimated_return && s.estimated_return < now) {
    flags.push({ type: 'red', label: `Overdue ${daysBetween(s.estimated_return, now)}d`, key: 'overdue' })
  }
  const lastMove = s.last_movement_date || s.created_at.slice(0, 10)
  const reviewDays = Math.round((s.review_months || DEFAULT_REVIEW_MONTHS) * 30.4)
  if (lastMove && daysBetween(lastMove, now) > reviewDays) {
    flags.push({ type: 'amber', label: `Review — ${Math.floor(daysBetween(lastMove, now) / 30)}mo no movement`, key: 'stagnant' })
  }
  return flags
}
function ballClass(s: Sample) {
  const flags = computeFlags(s)
  if (flags.some(f => f.key === 'overdue')) return 'red'
  if (flags.some(f => f.key === 'stagnant')) return 'amber'
  return s.status === 'out' ? 'blue' : 'green'
}
const BALL_COLORS: Record<string, string> = { red: '#B4402F', amber: '#C98A2C', blue: '#2E5E86', green: '#4C8B5B' }

// Resize client-side before upload — keeps photos fast to load without a
// server-side image pipeline. Matches the original prototype's numbers.
// Returns a data URL (not a Blob) — posted straight to the backend's
// uploadBase64Image() proxy rather than negotiated as a direct-to-Blob client
// upload, which needs a token exchange + a cross-origin PUT to Blob storage
// that can silently hang. Resized images are small enough (typically well under
// 1-2MB) to just go through the function body.
function resizeImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        let w = img.width, h = img.height
        if (w > MAX_DIM || h > MAX_DIM) {
          if (w > h) { h = Math.round(h * MAX_DIM / w); w = MAX_DIM }
          else { w = Math.round(w * MAX_DIM / h); h = MAX_DIM }
        }
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('Canvas not supported')); return }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', JPEG_Q))
      }
      img.onerror = reject
      img.src = String(reader.result)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

type ModalState =
  | { type: 'add' }
  | { type: 'detail'; id: string }
  | { type: 'editSpecs'; id: string; draft: SpecRow[] }
  | { type: 'move'; id: string; action: 'in' | 'out' }
  | { type: 'label'; id: string }
  | null

function Overlay({ onClose, children, maxWidth = 'max-w-lg' }: { onClose: () => void; children: React.ReactNode; maxWidth?: string }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${maxWidth} my-8`} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
function ModalHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
      <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none p-1" aria-label="Close">✕</button>
    </div>
  )
}
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  )
}
const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"

function SpecEditor({ specs, onChange }: { specs: SpecRow[]; onChange: (specs: SpecRow[]) => void }) {
  const update = (i: number, field: keyof SpecRow, value: string) => {
    onChange(specs.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
  }
  return (
    <div className="space-y-2">
      {specs.map((s, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input value={s.label} onChange={e => update(i, 'label', e.target.value)} placeholder="e.g. Fabric" className={inputCls} />
          <input value={s.value} onChange={e => update(i, 'value', e.target.value)} placeholder="e.g. Charcoal Weave" className={inputCls} />
          <button
            type="button"
            onClick={() => onChange(specs.filter((_, idx) => idx !== i))}
            className="w-7 h-7 flex-shrink-0 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 font-bold"
          >✕</button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...specs, { label: '', value: '' }])}
        className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-50"
      >+ Add spec</button>
    </div>
  )
}

export default function SampleRegister() {
  const { getToken } = useAuth()
  const [samples, setSamples] = useState<Sample[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filterCountry, setFilterCountry] = useState('All')
  const [filterLocation, setFilterLocation] = useState('All')
  const [filterStatus, setFilterStatus] = useState('All')
  const [modal, setModal] = useState<ModalState>(null)
  const [labelPrefs, setLabelPrefs] = useState({ photo: true, name: true })
  const [toast, setToast] = useState('')
  const [saving, setSaving] = useState(false)

  const authFetch = useCallback(async (url: string, opts?: RequestInit) => {
    const token = await getToken()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20000)
    try {
      const res = await fetch(url, {
        ...opts,
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts?.headers ?? {}) },
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText)
      return res.json()
    } catch (e: any) {
      if (e.name === 'AbortError') throw new Error('Request timed out — check your connection and try again.')
      throw e
    } finally {
      clearTimeout(timeout)
    }
  }, [getToken])

  const loadSamples = useCallback(async () => {
    setLoading(true)
    setError('')
    try { setSamples(await authFetch('/api/production/samples')) }
    catch (e: any) { setError(e.message || 'Failed to load samples') }
    finally { setLoading(false) }
  }, [authFetch])

  useEffect(() => { loadSamples() }, [loadSamples])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2600) }

  const patchSample = async (id: string, updates: Record<string, unknown>) => {
    const updated = await authFetch(`/api/production/samples/${id}`, { method: 'PATCH', body: JSON.stringify(updates) })
    setSamples(prev => prev.map(s => s.id === id ? updated : s))
    return updated as Sample
  }

  const deleteSample = async (s: Sample) => {
    if (!confirm(`Remove ${s.display_id} — ${s.name}? This cannot be undone.`)) return
    setSamples(prev => prev.filter(x => x.id !== s.id))
    setModal(null)
    try { await authFetch(`/api/production/samples/${s.id}`, { method: 'DELETE' }); showToast('Sample removed.') }
    catch { showToast('Could not remove — try again.'); loadSamples() }
  }

  const sampleById = (id: string) => samples.find(s => s.id === id)

  const filtered = samples.filter(s => {
    if (filterCountry !== 'All' && s.country !== filterCountry) return false
    if (filterLocation !== 'All' && s.location !== filterLocation) return false
    if (filterStatus === 'in' && s.status !== 'in') return false
    if (filterStatus === 'out' && s.status !== 'out') return false
    if (filterStatus === 'overdue' && !computeFlags(s).some(f => f.key === 'overdue')) return false
    if (filterStatus === 'stagnant' && !computeFlags(s).some(f => f.key === 'stagnant')) return false
    if (search) {
      const q = search.toLowerCase()
      const hay = [s.display_id, s.name, s.job_card, s.salesperson, s.location].join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  // Stat tiles reflect whatever's currently filtered/searched, not the whole register.
  const total = filtered.length
  const inCount = filtered.filter(s => s.status === 'in').length
  const outCount = filtered.filter(s => s.status === 'out').length
  const overdueCount = filtered.filter(s => computeFlags(s).some(f => f.key === 'overdue')).length
  const stagnantCount = filtered.filter(s => computeFlags(s).some(f => f.key === 'stagnant')).length
  const totalValue = filtered.reduce((sum, s) => sum + (Number(s.value) || 0), 0)

  if (loading && samples.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-12">Loading sample register…</p>
  }

  return (
    <div className="max-w-6xl mx-auto pb-8">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #sample-print-label, #sample-print-label * { visibility: visible; }
          #sample-print-label {
            display: flex !important; position: fixed; top: 0; left: 0; width: 3.2in; height: 2in;
            border: 3px solid #21262B; box-sizing: border-box; font-family: Arial, sans-serif; overflow: hidden;
          }
        }
      `}</style>

      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h2 className="text-xl font-extrabold text-gray-900">📦 Sample Register</h2>
          <p className="text-xs text-gray-500 mt-0.5">NZ &amp; AU · shared team tracker</p>
        </div>
        <button
          onClick={() => setModal({ type: 'add' })}
          className="px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-full hover:bg-gray-700 transition-colors"
        >+ Log new sample</button>
      </div>

      {error && <p className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-2 mb-4">{error}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 mb-4">
        {[
          ['Total samples', total.toLocaleString('en-NZ'), 'text-gray-900'],
          ['In storage', inCount.toLocaleString('en-NZ'), 'text-green-600'],
          ['Out with client', outCount.toLocaleString('en-NZ'), 'text-blue-600'],
          ['Overdue', overdueCount.toLocaleString('en-NZ'), 'text-red-600'],
          ['Needs review', stagnantCount.toLocaleString('en-NZ'), 'text-amber-600'],
          ['Total value', fmtMoney(totalValue), 'text-gray-900'],
        ].map(([label, value, color]) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-200 shadow-sm px-4 py-3">
            <p className={`text-2xl font-extrabold ${color}`} style={{ fontFamily: 'Georgia, serif' }}>{value}</p>
            <p className="text-[11px] text-gray-400 uppercase tracking-wide mt-1">{label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-center mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="11" cy="11" r="7" strokeWidth={2} /><path strokeLinecap="round" d="M21 21l-4.3-4.3" strokeWidth={2} /></svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by ID, name, job card, salesperson…"
            className="w-full border border-gray-200 rounded-full pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
        <select value={filterCountry} onChange={e => setFilterCountry(e.target.value)} className="border border-gray-200 rounded-full px-3 py-2 text-sm font-medium text-gray-600 bg-white">
          <option value="All">All countries</option>
          <option value="NZ">NZ</option>
          <option value="AU">AU</option>
        </select>
        <select value={filterLocation} onChange={e => setFilterLocation(e.target.value)} className="border border-gray-200 rounded-full px-3 py-2 text-sm font-medium text-gray-600 bg-white">
          <option value="All">All locations</option>
          {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-gray-200 rounded-full px-3 py-2 text-sm font-medium text-gray-600 bg-white">
          <option value="All">All statuses</option>
          <option value="in">In storage</option>
          <option value="out">Out with client</option>
          <option value="overdue">Overdue only</option>
          <option value="stagnant">Needs review</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center border-2 border-dashed border-gray-200 rounded-2xl py-12 px-6 text-gray-500">
          <h3 className="text-lg font-bold text-gray-700 mb-1" style={{ fontFamily: 'Georgia, serif' }}>
            {samples.length === 0 ? 'No samples logged yet' : 'No samples match these filters'}
          </h3>
          <p className="text-sm">
            {samples.length === 0
              ? 'Every sample scattered around the building starts here. Log the first one and give it a number.'
              : 'Try clearing the search or switching country / location / status.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {filtered.map(s => {
            const flags = computeFlags(s)
            const ball = ballClass(s)
            return (
              <div
                key={s.id}
                tabIndex={0}
                onClick={() => setModal({ type: 'detail', id: s.id })}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setModal({ type: 'detail', id: s.id }) } }}
                className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all flex flex-col"
              >
                <div className="h-36 bg-gray-100 relative">
                  {s.photo_url ? (
                    <img src={s.photo_url} alt={s.name} className="w-full h-full object-contain bg-gray-100" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-gray-300 text-xs">
                      <span className="text-2xl">📦</span><span>No photo</span>
                    </div>
                  )}
                  <div className="absolute top-2.5 left-2.5 w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-extrabold text-white shadow" style={{ backgroundColor: BALL_COLORS[ball] }}>
                    {(s.display_id || '').split('-')[1] || '?'}
                  </div>
                  <div className="absolute top-2.5 right-2.5 bg-black/70 text-white text-[10px] font-bold px-2 py-1 rounded-md tracking-wide">{s.display_id}</div>
                </div>
                <div className="p-3.5 flex flex-col gap-2 flex-1">
                  <div className="font-bold text-sm text-gray-900 leading-snug">{s.name}</div>
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    <span className={`px-2 py-0.5 rounded-full font-semibold ${s.status === 'in' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
                      {s.status === 'in' ? 'In storage' : 'Out with client'}
                    </span>
                    <span className="px-2 py-0.5 rounded-full font-semibold bg-gray-100 text-gray-600">{s.location} · {s.country}</span>
                    <span className="px-2 py-0.5 rounded-full font-semibold bg-gray-100 text-gray-600">{s.condition}</span>
                    {s.value > 0 && <span className="px-2 py-0.5 rounded-full font-semibold bg-gray-100 text-gray-600">{fmtMoney(s.value)}</span>}
                  </div>
                  {flags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {flags.map(f => (
                        <span key={f.key} className={`text-[11px] font-bold px-2 py-1 rounded-lg ${f.type === 'red' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>⚠ {f.label}</span>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-between text-[11px] text-gray-400 border-t border-dashed border-gray-200 pt-2 mt-auto">
                    <span>{s.status === 'out' ? (s.client_name || s.job_card || '—') : `Last back ${fmtDate(s.date_in)}`}</span>
                    <span>{s.salesperson || '—'}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm font-semibold px-5 py-2.5 rounded-full shadow-lg z-[100]">
          {toast}
        </div>
      )}

      {modal?.type === 'add' && (
        <AddModal
          onClose={() => setModal(null)}
          saving={saving}
          onSave={async (payload, photoFile) => {
            setSaving(true)
            try {
              let photoUrl: string | undefined
              if (photoFile) {
                const dataUrl = await resizeImageToDataUrl(photoFile)
                const uploaded = await authFetch('/api/production/sample-upload', { method: 'POST', body: JSON.stringify({ dataUrl }) })
                photoUrl = uploaded.url
              }
              const created = await authFetch('/api/production/samples', { method: 'POST', body: JSON.stringify({ ...payload, photoUrl }) })
              setSamples(prev => [created, ...prev])
              setModal(null)
              showToast(`Sample ${created.display_id} logged.`)
            } catch (e: any) {
              showToast(e.message || 'Could not save — check your connection and try again.')
            } finally {
              setSaving(false)
            }
          }}
        />
      )}

      {modal?.type === 'detail' && sampleById(modal.id) && (
        <DetailModal
          sample={sampleById(modal.id)!}
          onClose={() => setModal(null)}
          onEditSpecs={() => setModal({ type: 'editSpecs', id: modal.id, draft: JSON.parse(JSON.stringify(sampleById(modal.id)!.specs || [])) })}
          onMove={action => setModal({ type: 'move', id: modal.id, action })}
          onLabel={() => setModal({ type: 'label', id: modal.id })}
          onDelete={() => deleteSample(sampleById(modal.id)!)}
          onUpdateValue={async v => { try { await patchSample(modal.id, { value: v }); showToast('Value updated.') } catch { showToast('Could not save that change — try again.') } }}
          onUpdateReviewMonths={async v => { try { await patchSample(modal.id, { review_months: v }); showToast(`Review reminder set to ${v} months.`) } catch { showToast('Could not save that change — try again.') } }}
        />
      )}

      {modal?.type === 'editSpecs' && sampleById(modal.id) && (
        <EditSpecsModal
          draft={modal.draft}
          onChange={draft => setModal({ ...modal, draft })}
          onCancel={() => setModal({ type: 'detail', id: modal.id })}
          onSave={async () => {
            try { await patchSample(modal.id, { specs: modal.draft }); showToast('Specs updated.') } catch { showToast('Could not save that change — try again.') }
            setModal({ type: 'detail', id: modal.id })
          }}
        />
      )}

      {modal?.type === 'move' && sampleById(modal.id) && (
        <MoveModal
          sample={sampleById(modal.id)!}
          action={modal.action}
          onCancel={() => setModal({ type: 'detail', id: modal.id })}
          onConfirm={async updates => {
            try {
              await patchSample(modal.id, updates)
              showToast(`Updated ${sampleById(modal.id)!.display_id}.`)
            } catch { showToast('Could not save the update — try again.') }
            setModal({ type: 'detail', id: modal.id })
          }}
        />
      )}

      {modal?.type === 'label' && sampleById(modal.id) && (
        <LabelModal
          sample={sampleById(modal.id)!}
          prefs={labelPrefs}
          onPrefsChange={setLabelPrefs}
          onCancel={() => setModal({ type: 'detail', id: modal.id })}
          onPrint={() => window.print()}
        />
      )}

      {/* Kept in sync with the label modal's live sample+prefs by React, not
          imperative DOM writes — @media print swaps visibility, window.print()
          just triggers the browser dialog. */}
      <div id="sample-print-label" className="hidden">
        {modal?.type === 'label' && sampleById(modal.id) && <LabelBody s={sampleById(modal.id)!} prefs={labelPrefs} />}
      </div>
    </div>
  )
}

// ── Add modal ────────────────────────────────────────────────────────────────
function AddModal({ onClose, onSave, saving }: {
  onClose: () => void
  saving: boolean
  onSave: (payload: Record<string, unknown>, photoFile: File | null) => void
}) {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [specs, setSpecs] = useState<SpecRow[]>([])
  const [country, setCountry] = useState<'NZ' | 'AU'>('NZ')
  const [location, setLocation] = useState(LOCATIONS[0])
  const [condition, setCondition] = useState(CONDITIONS[1])
  const [reviewMonths, setReviewMonths] = useState(String(DEFAULT_REVIEW_MONTHS))
  const [status, setStatus] = useState<'in' | 'out'>('in')
  const [jobCard, setJobCard] = useState('')
  const [salesperson, setSalesperson] = useState('')
  const [clientName, setClientName] = useState('')
  const [deliveryLocation, setDeliveryLocation] = useState('')
  const [estimatedReturn, setEstimatedReturn] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)

  const handlePhoto = (file: File | undefined) => {
    if (!file) return
    setPhotoFile(file)
    const reader = new FileReader()
    reader.onload = () => setPhotoPreview(String(reader.result))
    reader.readAsDataURL(file)
  }

  const save = () => {
    if (!name.trim()) return
    onSave({
      name, value: parseFloat(value.replace(/,/g, '')) || 0, specs: specs.filter(s => s.label.trim() || s.value.trim()),
      country, location, condition, reviewMonths: parseFloat(reviewMonths) || DEFAULT_REVIEW_MONTHS,
      status, jobCard: status === 'out' ? jobCard : '', salesperson: status === 'out' ? salesperson : '',
      clientName: status === 'out' ? clientName : '', deliveryLocation: status === 'out' ? deliveryLocation : '',
      estimatedReturn: status === 'out' ? estimatedReturn : '',
    }, photoFile)
  }

  return (
    <Overlay onClose={onClose}>
      <ModalHead title="Log a new sample" onClose={onClose} />
      <div className="p-5 space-y-4">
        <Field label="Photo">
          <label className="block border-2 border-dashed border-gray-200 rounded-xl p-4 text-center cursor-pointer hover:border-gray-300 text-gray-400 text-sm">
            {photoPreview ? <img src={photoPreview} alt="preview" className="max-h-40 mx-auto rounded-lg" /> : (
              <>📷 Click to add a photo<p className="text-xs text-gray-400 mt-1">JPEG/PNG, resized automatically to keep things fast</p></>
            )}
            <input type="file" accept="image/*" className="hidden" onChange={e => handlePhoto(e.target.files?.[0])} />
          </label>
        </Field>
        <Field label="Sample description" required>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. 8ft Slate Pool Table — Oak Cabinet" className={inputCls} />
        </Field>
        <Field label="Value ($)">
          <input value={value} onChange={e => setValue(e.target.value)} inputMode="decimal" placeholder="e.g. 4500" className={inputCls} />
        </Field>
        <Field label="Specs"><SpecEditor specs={specs} onChange={setSpecs} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Country" required>
            <select value={country} onChange={e => setCountry(e.target.value as 'NZ' | 'AU')} className={inputCls}>
              <option value="NZ">NZ</option><option value="AU">AU</option>
            </select>
          </Field>
          <Field label="Location" required>
            <select value={location} onChange={e => setLocation(e.target.value)} className={inputCls}>
              {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Condition">
            <select value={condition} onChange={e => setCondition(e.target.value)} className={inputCls}>
              {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Review reminder (months)">
            <input value={reviewMonths} onChange={e => setReviewMonths(e.target.value)} inputMode="numeric" className={inputCls} />
          </Field>
        </div>
        <Field label="Current status">
          <select value={status} onChange={e => setStatus(e.target.value as 'in' | 'out')} className={inputCls}>
            <option value="in">In storage</option>
            <option value="out">Already out with a client</option>
          </select>
        </Field>
        {status === 'out' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Job card number / reference"><input value={jobCard} onChange={e => setJobCard(e.target.value)} placeholder="e.g. JC-4821 (if any)" className={inputCls} /></Field>
              <Field label="Salesperson responsible"><input value={salesperson} onChange={e => setSalesperson(e.target.value)} placeholder="Name" className={inputCls} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Client name"><input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Who it's going to" className={inputCls} /></Field>
              <Field label="Delivery location"><input value={deliveryLocation} onChange={e => setDeliveryLocation(e.target.value)} placeholder="Site / address" className={inputCls} /></Field>
            </div>
            <Field label="Estimated return date"><input type="date" value={estimatedReturn} onChange={e => setEstimatedReturn(e.target.value)} className={inputCls} /></Field>
          </div>
        )}
        <div className="flex gap-3 justify-end pt-2">
          <button onClick={onClose} className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving || !name.trim()} className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save sample'}
          </button>
        </div>
      </div>
    </Overlay>
  )
}

// ── Detail modal ─────────────────────────────────────────────────────────────
function DetailModal({ sample: s, onClose, onEditSpecs, onMove, onLabel, onDelete, onUpdateValue, onUpdateReviewMonths }: {
  sample: Sample
  onClose: () => void
  onEditSpecs: () => void
  onMove: (action: 'in' | 'out') => void
  onLabel: () => void
  onDelete: () => void
  onUpdateValue: (v: number) => void
  onUpdateReviewMonths: (v: number) => void
}) {
  const flags = computeFlags(s)
  const history = (s.history || []).slice().reverse()
  return (
    <Overlay onClose={onClose} maxWidth="max-w-xl">
      <ModalHead title={`${s.display_id} · ${s.name}`} onClose={onClose} />
      <div className="p-5 space-y-4">
        {s.photo_url && <img src={s.photo_url} alt={s.name} className="w-full h-56 object-contain bg-gray-100 rounded-xl" />}
        {flags.map(f => (
          <div key={f.key} className={`px-3 py-2 rounded-lg text-sm font-semibold ${f.type === 'red' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>⚠ {f.label}</div>
        ))}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div><p className="text-[11px] font-bold text-gray-400 uppercase">Status</p><p>{s.status === 'in' ? 'In storage' : 'Out with client'}</p></div>
          <div><p className="text-[11px] font-bold text-gray-400 uppercase">Location</p><p>{s.location} ({s.country})</p></div>
          <div><p className="text-[11px] font-bold text-gray-400 uppercase">Condition</p><p>{s.condition}</p></div>
          <div><p className="text-[11px] font-bold text-gray-400 uppercase">Salesperson</p><p>{s.salesperson || '—'}</p></div>
          {s.status === 'out' && <div><p className="text-[11px] font-bold text-gray-400 uppercase">Job card / reference</p><p className="font-mono">{s.job_card || '—'}</p></div>}
          {s.status === 'out' && <div><p className="text-[11px] font-bold text-gray-400 uppercase">Client</p><p>{s.client_name || '—'}</p></div>}
          {s.status === 'out' && <div><p className="text-[11px] font-bold text-gray-400 uppercase">Delivery location</p><p>{s.delivery_location || '—'}</p></div>}
          <div><p className="text-[11px] font-bold text-gray-400 uppercase">Last sent out</p><p>{fmtDate(s.date_out)}</p></div>
          <div><p className="text-[11px] font-bold text-gray-400 uppercase">Estimated return</p><p>{fmtDate(s.estimated_return)}</p></div>
          <div><p className="text-[11px] font-bold text-gray-400 uppercase">Last back in storage</p><p>{fmtDate(s.date_in)}</p></div>
          <div>
            <p className="text-[11px] font-bold text-gray-400 uppercase">Value</p>
            <input
              defaultValue={s.value || ''}
              onBlur={e => onUpdateValue(parseFloat(e.target.value.replace(/,/g, '')) || 0)}
              inputMode="decimal"
              className="w-24 border border-gray-200 rounded-lg px-2 py-1 text-sm"
            />
          </div>
          <div>
            <p className="text-[11px] font-bold text-gray-400 uppercase">Review reminder</p>
            <div className="flex items-center gap-1">
              <input
                defaultValue={s.review_months || DEFAULT_REVIEW_MONTHS}
                onBlur={e => { const v = parseFloat(e.target.value); onUpdateReviewMonths(isNaN(v) || v <= 0 ? DEFAULT_REVIEW_MONTHS : v) }}
                inputMode="numeric"
                className="w-14 border border-gray-200 rounded-lg px-2 py-1 text-sm"
              /> months
            </div>
          </div>
        </div>

        <details className="border border-gray-200 rounded-xl overflow-hidden">
          <summary className="px-3 py-2 cursor-pointer font-semibold text-sm bg-gray-50">Specs{s.specs?.length ? ` (${s.specs.length})` : ''}</summary>
          <div className="px-3 py-2.5">
            {s.specs?.length ? (
              <div className="divide-y divide-dashed divide-gray-100">
                {s.specs.map((sp, i) => (
                  <div key={i} className="flex justify-between gap-3 text-sm py-1.5">
                    <span className="text-gray-500 font-medium">{sp.label}</span><span>{sp.value}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-gray-400">No specs added yet.</p>}
            <button onClick={onEditSpecs} className="mt-2 px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-50">Edit specs</button>
          </div>
        </details>

        <hr className="border-gray-100" />
        <div className="flex flex-wrap gap-2">
          {s.status === 'in'
            ? <button onClick={() => onMove('out')} className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-700">↗ Send to client</button>
            : <button onClick={() => onMove('in')} className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-700">↙ Return to storage</button>}
          <button onClick={onLabel} className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-50">🏷 Print tag</button>
          <button onClick={onDelete} className="px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-semibold hover:bg-red-100">Remove sample</button>
        </div>
        <hr className="border-gray-100" />
        <div>
          <p className="text-[11px] font-bold text-gray-400 uppercase mb-2">Movement history</p>
          <div className="space-y-2.5 max-h-52 overflow-y-auto pr-1">
            {history.length ? history.map((h, i) => (
              <div key={i} className="flex gap-2.5 text-xs">
                <span className="w-2 h-2 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: h.action === 'out' ? '#2E5E86' : h.action === 'in' ? '#4C8B5B' : '#EBA117' }} />
                <div>
                  <p className="font-bold">{h.action === 'out' ? 'Sent to client' : h.action === 'in' ? 'Returned to storage' : 'Logged'} — {fmtDate(h.date)}</p>
                  <p className="text-gray-400">{[h.salesperson, h.clientName || null, h.jobCard ? `Ref ${h.jobCard}` : null, h.deliveryLocation || h.location].filter(Boolean).join(' · ')}</p>
                </div>
              </div>
            )) : <p className="text-xs text-gray-400">No movement recorded yet.</p>}
          </div>
        </div>
      </div>
    </Overlay>
  )
}

function EditSpecsModal({ draft, onChange, onCancel, onSave }: {
  draft: SpecRow[]; onChange: (d: SpecRow[]) => void; onCancel: () => void; onSave: () => void
}) {
  return (
    <Overlay onClose={onCancel}>
      <ModalHead title="Edit specs" onClose={onCancel} />
      <div className="p-5 space-y-4">
        <SpecEditor specs={draft} onChange={onChange} />
        <div className="flex gap-3 justify-end pt-2">
          <button onClick={onCancel} className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={onSave} className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-700">Save specs</button>
        </div>
      </div>
    </Overlay>
  )
}

// ── Move modal ───────────────────────────────────────────────────────────────
function MoveModal({ sample: s, action, onCancel, onConfirm }: {
  sample: Sample
  action: 'in' | 'out'
  onCancel: () => void
  onConfirm: (updates: Record<string, unknown>) => void
}) {
  const [jobCard, setJobCard] = useState('')
  const [salesperson, setSalesperson] = useState(s.salesperson || '')
  const [clientName, setClientName] = useState('')
  const [deliveryLocation, setDeliveryLocation] = useState('')
  const [estimatedReturn, setEstimatedReturn] = useState(todayISO())
  const [location, setLocation] = useState(s.location)
  const [condition, setCondition] = useState(s.condition)
  const [warn, setWarn] = useState('')

  // A job card isn't always involved — only salesperson is actually required here.
  const confirmOut = () => {
    if (!salesperson.trim()) { setWarn('Salesperson is required.'); return }
    const now = todayISO()
    onConfirm({
      status: 'out', job_card: jobCard.trim(), salesperson: salesperson.trim(),
      client_name: clientName.trim(), delivery_location: deliveryLocation.trim(),
      date_out: now, estimated_return: estimatedReturn || null, last_movement_date: now,
      history: [...(s.history || []), {
        date: now, action: 'out', salesperson: salesperson.trim(), jobCard: jobCard.trim(),
        clientName: clientName.trim(), deliveryLocation: deliveryLocation.trim(), location: s.location,
      }],
    })
  }
  const confirmIn = () => {
    const now = todayISO()
    const finalSalesperson = salesperson.trim() || s.salesperson
    onConfirm({
      status: 'in', salesperson: finalSalesperson, location, condition,
      date_in: now, last_movement_date: now, job_card: '',
      history: [...(s.history || []), { date: now, action: 'in', salesperson: finalSalesperson, jobCard: s.job_card, location }],
    })
  }

  return (
    <Overlay onClose={onCancel}>
      <ModalHead title={action === 'out' ? `Send ${s.display_id} to client` : `Return ${s.display_id} to storage`} onClose={onCancel} />
      <div className="p-5 space-y-4">
        {action === 'out' ? (
          <>
            <Field label="Salesperson responsible" required><input value={salesperson} onChange={e => setSalesperson(e.target.value)} placeholder="Name" className={inputCls} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Client name"><input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Who it's going to" className={inputCls} /></Field>
              <Field label="Delivery location"><input value={deliveryLocation} onChange={e => setDeliveryLocation(e.target.value)} placeholder="Site / address" className={inputCls} /></Field>
            </div>
            <Field label="Job card number / reference"><input value={jobCard} onChange={e => setJobCard(e.target.value)} placeholder="e.g. JC-4821 (if any)" className={inputCls} /></Field>
            <Field label="Estimated return date"><input type="date" value={estimatedReturn} onChange={e => setEstimatedReturn(e.target.value)} className={inputCls} /></Field>
            {warn && <p className="text-xs text-red-500">{warn}</p>}
            <div className="flex gap-3 justify-end pt-2">
              <button onClick={onCancel} className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={confirmOut} className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-700">Confirm sent out</button>
            </div>
          </>
        ) : (
          <>
            <Field label="Salesperson who returned it"><input value={salesperson} onChange={e => setSalesperson(e.target.value)} placeholder="Name" className={inputCls} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Returning to location">
                <select value={location} onChange={e => setLocation(e.target.value)} className={inputCls}>{LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}</select>
              </Field>
              <Field label="Condition on return">
                <select value={condition} onChange={e => setCondition(e.target.value)} className={inputCls}>{CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}</select>
              </Field>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button onClick={onCancel} className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={confirmIn} className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-700">Confirm returned</button>
            </div>
          </>
        )}
      </div>
    </Overlay>
  )
}

// ── Label modal (printable tag) ──────────────────────────────────────────────
function LabelBody({ s, prefs }: { s: Sample; prefs: { photo: boolean; name: boolean } }) {
  const hasPhoto = prefs.photo && s.photo_url
  return (
    <div className="flex w-full h-full">
      <div className="flex flex-col" style={{ width: '52%' }}>
        <div className="bg-black text-white flex items-center justify-between px-3 py-1">
          <span className="text-[9px] font-extrabold tracking-widest uppercase">YourCompany Sample</span>
          <LogoMark tone="white" className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 px-3.5 py-3 flex flex-col justify-center">
          <div className="font-mono font-black text-2xl leading-tight text-gray-900">{s.display_id}</div>
          {prefs.name && <div className="font-bold text-sm mt-1 text-gray-900">{s.name}</div>}
        </div>
      </div>
      <div className="flex items-center justify-center overflow-hidden border-l-2 border-black bg-gray-100" style={{ width: '48%' }}>
        {hasPhoto ? <img src={s.photo_url!} alt="" className="w-full h-full object-contain" /> : <span className="text-[10px] text-gray-400 text-center px-2">{prefs.photo ? 'No photo on file' : ''}</span>}
      </div>
    </div>
  )
}
function LabelModal({ sample: s, prefs, onPrefsChange, onCancel, onPrint }: {
  sample: Sample
  prefs: { photo: boolean; name: boolean }
  onPrefsChange: (p: { photo: boolean; name: boolean }) => void
  onCancel: () => void
  onPrint: () => void
}) {
  return (
    <Overlay onClose={onCancel}>
      <ModalHead title={`Print tag — ${s.display_id}`} onClose={onCancel} />
      <div className="p-5 space-y-4">
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={prefs.photo} onChange={e => onPrefsChange({ ...prefs, photo: e.target.checked })} /> Sample photo</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={prefs.name} onChange={e => onPrefsChange({ ...prefs, name: e.target.checked })} /> Sample name</label>
        </div>
        <div className="border-2 border-gray-800 mx-auto overflow-hidden" style={{ width: '3.2in', height: '2in' }}>
          <LabelBody s={s} prefs={prefs} />
        </div>
        <div className="flex gap-3 justify-center pt-2">
          <button onClick={onCancel} className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={onPrint} className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-700">🏷 Print</button>
        </div>
      </div>
    </Overlay>
  )
}
