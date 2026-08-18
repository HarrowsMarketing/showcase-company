import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth, useUser } from '../lib/fakeAuth'
import { TEAM } from '../utils/teamConfig'

// Marketing is just these three — not the whole TEAM (which also includes Morgan,
// on a different dept) — per-person sections should only show marketing's people.
const MARKETING_PEOPLE = TEAM.filter(m => ['alex', 'cara', 'sam'].includes(m.email))

const IMAGE_MAX_DIM = 1800
const IMAGE_JPEG_Q = 0.85

// Resizes to a data URL and posts it to the backend's uploadBase64Image() proxy —
// simpler and more reliable than negotiating a direct-to-Blob client upload (token
// exchange + a cross-origin PUT straight to Blob storage, which can silently hang
// with nothing useful surfaced). A raw screenshot can be several MB; resized it's
// comfortably small enough to go through the function body.
function resizeImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        let w = img.width, h = img.height
        if (w > IMAGE_MAX_DIM || h > IMAGE_MAX_DIM) {
          if (w > h) { h = Math.round(h * IMAGE_MAX_DIM / w); w = IMAGE_MAX_DIM }
          else { w = Math.round(w * IMAGE_MAX_DIM / h); h = IMAGE_MAX_DIM }
        }
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('Canvas not supported')); return }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', IMAGE_JPEG_Q))
      }
      img.onerror = reject
      img.src = String(reader.result)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

interface MarketingSnapshotPeriod { sessions: number; users: number; engagementRate: number; newUsers: number }
interface MarketingSnapshot extends MarketingSnapshotPeriod { rangeLabel: string; lastMonth: MarketingSnapshotPeriod }
interface SalesNumbers {
  newMqlThisMonth: number; newMqlLastMonth: number
  sqlThisMonth: number; sqlLastMonth: number
  newPipelineThisMonth: number; newPipelineLastMonth: number
  wonRevenueThisMonth: number; wonRevenueLastMonth: number
}
interface HuddleSnapshot {
  marketingSnapshot: MarketingSnapshot | null
  salesNumbers: SalesNumbers | null
  computedAt: string
}

function fmtMoney(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`
  return `$${n.toFixed(0)}`
}

// Same up/down-percent chip as OurOneNumber.tsx's DeltaChip — hidden when there's
// no prior-period value to compare against (avoids a misleading "+∞%").
function pctChange(current: number, previous: number): number | null {
  if (!previous || previous <= 0) return null
  return Math.round(((current - previous) / previous) * 100)
}
function DeltaChip({ pct }: { pct: number | null }) {
  if (pct === null) return null
  const up = pct >= 0
  return (
    <span className={`text-[11px] font-semibold ${up ? 'text-green-600' : 'text-red-500'}`}>
      {up ? '↑' : '↓'}{Math.abs(pct)}%
    </span>
  )
}

type PersonNotes = Record<string, string>
type PersonSection = 'tasks' | 'blockers'
interface GoodBadInteresting { good?: string; bad?: string; interesting?: string }
type ReviewNotes = Record<string, GoodBadInteresting>
interface HuddleNotes {
  review?: ReviewNotes; sales?: string; marketing?: string
  social?: string; socialImages?: string[]; blogs?: string; edms?: string; newsletter?: string
  campaigns?: string; tasks?: PersonNotes; blockers?: PersonNotes
}
interface IdeaPost { id: string; clerk_user_id: string; author_name: string; author_avatar: string | null; body: string; link_url: string | null; created_at: string }
interface HuddleMeeting {
  id: string
  week_start: string
  status: 'open' | 'completed'
  notes: HuddleNotes
  snapshot: HuddleSnapshot
  completed_by: string | null
  completed_at: string | null
}
interface WeekOption { week_start: string; status: 'open' | 'completed'; completed_at: string | null }

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function getMondayOfWeek(d = new Date()) {
  const copy = new Date(d)
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7))
  copy.setHours(0, 0, 0, 0)
  return copy
}
function addDays(d: Date, n: number) {
  const copy = new Date(d)
  copy.setDate(copy.getDate() + n)
  return copy
}
function shortDate(d: string) {
  return new Date(d + 'T12:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}
function relativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
}
const CURRENT_WEEK = localDate(getMondayOfWeek())
// Lets someone prep Monday's huddle ahead of time (e.g. Friday afternoon) —
// once that Monday actually arrives, CURRENT_WEEK naturally becomes this same
// date, so whatever was pre-filled is just sitting there ready to go.
const NEXT_WEEK = localDate(addDays(getMondayOfWeek(), 7))

// The recap email (bold section titles, colored up/down numbers) is now built and
// sent server-side, in api/index.js's /api/huddle/:id/complete route — a mailto:
// draft can only ever be plain text, so there was no way to get that formatting
// through a client-side link. See buildHuddleEmailHtml there.

// One field per manual/notes agenda item, each independently debounce-saved.
function NotesField({ label, hint, value, onChange, disabled, rows = 3 }: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  disabled: boolean
  rows?: number
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs font-semibold text-gray-500">{label}</span>
      </div>
      {hint && <p className="text-xs text-gray-400 italic mb-1">{hint}</p>}
      {disabled ? (
        <p className="text-sm text-gray-700 whitespace-pre-wrap min-h-[1.5rem]">{value || <span className="text-gray-300">—</span>}</p>
      ) : (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={rows}
          placeholder="Type notes for the meeting…"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
        />
      )}
    </div>
  )
}

// One NotesField per marketing person, reusing its styling/placeholder exactly —
// used for Review / Individual task lists / Blockers, which everyone contributes
// their own bit to rather than sharing one box.
function PersonNotesFields({ value, onChange, disabled }: {
  value: PersonNotes | undefined
  onChange: (personKey: string, v: string) => void
  disabled: boolean
}) {
  return (
    <>
      {MARKETING_PEOPLE.map(m => (
        <NotesField
          key={m.email}
          label={m.name}
          value={value?.[m.email] || ''}
          onChange={v => onChange(m.email, v)}
          disabled={disabled}
          rows={4}
        />
      ))}
    </>
  )
}

// Review of last week — The Good / The Bad / The Interesting per person,
// grouped in a bordered block per person since there's more to it than a
// single box now.
function ReviewFields({ value, onChange, disabled }: {
  value: ReviewNotes | undefined
  onChange: (personKey: string, field: keyof GoodBadInteresting, v: string) => void
  disabled: boolean
}) {
  return (
    <>
      {MARKETING_PEOPLE.map(m => {
        const person = value?.[m.email] || {}
        return (
          <div key={m.email} className="border border-gray-100 rounded-xl p-3 space-y-2">
            <p className="text-xs font-bold text-gray-700">{m.name}</p>
            <NotesField label="The Good" value={person.good || ''} onChange={v => onChange(m.email, 'good', v)} disabled={disabled} rows={3} />
            <NotesField label="The Bad" value={person.bad || ''} onChange={v => onChange(m.email, 'bad', v)} disabled={disabled} rows={3} />
            <NotesField label="The Interesting" value={person.interesting || ''} onChange={v => onChange(m.email, 'interesting', v)} disabled={disabled} rows={3} />
          </div>
        )
      })}
    </>
  )
}

// Drag-drop / click-to-browse image uploader for social media draft screenshots.
// Uploads go straight from the browser to Vercel Blob (see POST /api/huddle/
// social-upload) rather than through a normal JSON request, so large screenshots
// don't hit the serverless function's body-size limit.
function ImageDropZone({ images, onUpload, onRemove, uploading, error, disabled }: {
  images: string[]
  onUpload: (file: File) => void
  onRemove: (url: string) => void
  uploading: boolean
  error: string
  disabled: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const pick = (files: FileList | null) => {
    const file = files?.[0]
    if (file) onUpload(file)
  }

  return (
    <div>
      {!disabled && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files) }}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl px-4 py-4 text-center text-xs cursor-pointer transition-colors ${
            dragOver ? 'border-blue-400 bg-blue-50 text-blue-500' : 'border-gray-200 text-gray-400 hover:border-gray-300 hover:bg-gray-50'
          }`}
        >
          {uploading ? 'Uploading…' : '📎 Drop a screenshot here, or click to choose a file'}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => { pick(e.target.files); e.target.value = '' }}
          />
        </div>
      )}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {images.map(url => (
            <div key={url} className="relative group">
              <a href={url} target="_blank" rel="noopener noreferrer">
                <img src={url} alt="" className="w-20 h-20 object-cover rounded-lg border border-gray-200" />
              </a>
              {!disabled && (
                <button
                  onClick={() => onRemove(url)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white border border-gray-200 text-gray-400 hover:text-red-500 flex items-center justify-center text-xs shadow-sm"
                  aria-label="Remove image"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Section({ title, icon, accent, children }: { title: string; icon: string; accent: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm" style={{ borderTop: `3px solid ${accent}` }}>
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2" style={{ backgroundColor: `${accent}0D` }}>
        <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0" style={{ backgroundColor: `${accent}26` }}>
          {icon}
        </span>
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</span>
      </div>
      <div className="px-5 py-4 space-y-3">{children}</div>
    </div>
  )
}

export default function MondayHuddle() {
  const { getToken } = useAuth()
  const { user } = useUser()
  const isAdmin = ['admin', 'super_admin'].includes((user?.publicMetadata as any)?.role)
  const [selectedWeek, setSelectedWeek] = useState(CURRENT_WEEK)
  const [weeks, setWeeks] = useState<WeekOption[]>([])
  const [meeting, setMeeting] = useState<HuddleMeeting | null>(null)
  const [notes, setNotes] = useState<HuddleNotes>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [completing, setCompleting] = useState(false)
  const [sendingTest, setSendingTest] = useState(false)
  const [testEmailMsg, setTestEmailMsg] = useState('')
  // Keyed per top-level notes field (e.g. 'sales', 'review') so editing two
  // different fields within the debounce window doesn't cancel each other's save —
  // a single shared timer meant a quick edit to field B could silently drop field
  // A's pending write.
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const notesRef = useRef<HuddleNotes>({})
  useEffect(() => { notesRef.current = notes }, [notes])

  const [ideas, setIdeas] = useState<IdeaPost[]>([])
  const [ideasLoading, setIdeasLoading] = useState(true)
  const [ideaText, setIdeaText] = useState('')
  const [postingIdea, setPostingIdea] = useState(false)
  const [ideaError, setIdeaError] = useState('')

  const [uploadingImage, setUploadingImage] = useState(false)
  const [imageError, setImageError] = useState('')

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

  const loadWeeks = useCallback(async () => {
    try { setWeeks(await authFetch('/api/huddle/weeks')) } catch (e) { console.error(e) }
  }, [authFetch])

  const loadMeeting = useCallback(async (week: string) => {
    setLoading(true)
    setError('')
    try {
      const data = await authFetch(`/api/huddle?week=${week}`)
      setMeeting(data)
      setNotes(data.notes || {})
    } catch (e: any) {
      setError(e.message || 'Failed to load huddle')
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  const loadIdeas = useCallback(async () => {
    setIdeasLoading(true)
    try { setIdeas(await authFetch('/api/huddle/ideas')) } catch (e) { console.error(e) } finally { setIdeasLoading(false) }
  }, [authFetch])

  useEffect(() => { loadWeeks() }, [loadWeeks])
  useEffect(() => { loadMeeting(selectedWeek) }, [selectedWeek, loadMeeting])
  useEffect(() => { loadIdeas() }, [loadIdeas])

  const isReadOnly = meeting?.status === 'completed'

  // getPatch is evaluated at flush time (not call time) so several rapid edits
  // that reschedule the same timerKey still send whatever's latest in notesRef.
  const scheduleSave = (timerKey: string, getPatch: () => Record<string, unknown>) => {
    if (saveTimers.current[timerKey]) clearTimeout(saveTimers.current[timerKey])
    setSaveState('saving')
    saveTimers.current[timerKey] = setTimeout(async () => {
      delete saveTimers.current[timerKey]
      if (!meeting) return
      try {
        await authFetch(`/api/huddle/${meeting.id}`, { method: 'PATCH', body: JSON.stringify({ notes: getPatch() }) })
        if (Object.keys(saveTimers.current).length === 0) setSaveState('saved')
      } catch (e) {
        console.error(e)
        setSaveState('idle')
      }
    }, 800)
  }

  const updateField = (key: keyof HuddleNotes, value: string) => {
    setNotes(prev => ({ ...prev, [key]: value }))
    scheduleSave(key, () => ({ [key]: notesRef.current[key] }))
  }

  const updatePersonField = (section: PersonSection, personKey: string, value: string) => {
    setNotes(prev => ({ ...prev, [section]: { ...(prev[section] as PersonNotes | undefined), [personKey]: value } }))
    scheduleSave(section, () => ({ [section]: notesRef.current[section] }))
  }

  const updateReviewField = (personKey: string, field: keyof GoodBadInteresting, value: string) => {
    setNotes(prev => {
      const prevPerson = prev.review?.[personKey] || {}
      return { ...prev, review: { ...(prev.review || {}), [personKey]: { ...prevPerson, [field]: value } } }
    })
    scheduleSave('review', () => ({ review: notesRef.current.review }))
  }

  const uploadSocialImage = async (file: File) => {
    if (!meeting) return
    setUploadingImage(true)
    setImageError('')
    try {
      const dataUrl = await resizeImageToDataUrl(file)
      const uploaded = await authFetch('/api/huddle/social-upload', { method: 'POST', body: JSON.stringify({ dataUrl }) })
      setNotes(prev => ({ ...prev, socialImages: [...(prev.socialImages || []), uploaded.url] }))
      scheduleSave('socialImages', () => ({ socialImages: notesRef.current.socialImages }))
    } catch (e: any) {
      setImageError(e.message || 'Failed to upload image')
    } finally {
      setUploadingImage(false)
    }
  }

  const removeSocialImage = (url: string) => {
    setNotes(prev => ({ ...prev, socialImages: (prev.socialImages || []).filter(u => u !== url) }))
    scheduleSave('socialImages', () => ({ socialImages: notesRef.current.socialImages }))
  }

  const postIdea = async () => {
    if (!ideaText.trim()) return
    setPostingIdea(true)
    setIdeaError('')
    const linkMatch = ideaText.match(/(https?:\/\/[^\s]+)/i)
    try {
      const saved = await authFetch('/api/huddle/ideas', {
        method: 'POST',
        body: JSON.stringify({ body: ideaText.trim(), link_url: linkMatch ? linkMatch[1] : null }),
      })
      setIdeas(prev => [saved, ...prev])
      setIdeaText('')
    } catch (e: any) {
      setIdeaError(e.message || 'Failed to post idea')
    } finally {
      setPostingIdea(false)
    }
  }

  const deleteIdea = async (id: string) => {
    if (!confirm('Delete this idea?')) return
    setIdeas(prev => prev.filter(i => i.id !== id))
    await authFetch(`/api/huddle/ideas/${id}`, { method: 'DELETE' }).catch(() => loadIdeas())
  }

  const completeMeeting = async () => {
    if (!meeting || !meeting.snapshot) return
    if (!confirm(`Mark the ${shortDate(meeting.week_start)} huddle as complete? It'll move to Previous meetings, stop being editable, and email the notes to Alex, Cara, Sam and Morgan.`)) return
    setCompleting(true)
    try {
      // Flush any not-yet-saved keystrokes so the emailed/frozen notes match what's on screen.
      const pending = Object.values(saveTimers.current)
      if (pending.length > 0) {
        pending.forEach(clearTimeout)
        saveTimers.current = {}
        await authFetch(`/api/huddle/${meeting.id}`, { method: 'PATCH', body: JSON.stringify({ notes: notesRef.current }) })
      }
      // The recap email is sent server-side now (so section titles can be bold and
      // up/down numbers colored — a mailto: draft can only ever be plain text).
      const result = await authFetch(`/api/huddle/${meeting.id}/complete`, { method: 'POST' })
      if (!result.emailSent) setError('Meeting marked complete, but the recap email failed to send — check Vercel logs.')
      await loadWeeks()
      await loadMeeting(selectedWeek)
    } catch (e: any) {
      setError(e.message || 'Failed to complete meeting')
    } finally {
      setCompleting(false)
    }
  }

  // Sends the exact same recap email, but only to the person who clicked — a way to
  // check the formatting/content before Complete Meeting sends it to everyone.
  const sendTestEmail = async () => {
    if (!meeting) return
    setSendingTest(true)
    setTestEmailMsg('')
    try {
      const result = await authFetch(`/api/huddle/${meeting.id}/test-email`, { method: 'POST' })
      setTestEmailMsg(`Test email sent to ${result.sentTo}.`)
    } catch (e: any) {
      setTestEmailMsg(e.message || 'Failed to send test email.')
    } finally {
      setSendingTest(false)
    }
  }

  if (loading && !meeting) {
    return <p className="text-sm text-gray-400 text-center py-12">Loading…</p>
  }

  const weekEnd = meeting ? localDate(addDays(new Date(meeting.week_start + 'T12:00'), 6)) : ''
  const snapshot = meeting?.snapshot

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-8">
      <div
        className="flex items-center justify-between flex-wrap gap-2 rounded-2xl px-5 py-4"
        style={{ background: 'linear-gradient(135deg, #EBA11726, #EBA11708)' }}
      >
        <div>
          <h2 className="text-xl font-extrabold text-gray-900">☕ Monday Huddle</h2>
          {meeting && (
            <p className="text-xs text-gray-500 mt-0.5">{shortDate(meeting.week_start)} – {shortDate(weekEnd)}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isReadOnly && saveState !== 'idle' && (
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${saveState === 'saving' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
              {saveState === 'saving' ? 'Saving…' : 'Saved ✓'}
            </span>
          )}
          <select
            value={selectedWeek}
            onChange={e => setSelectedWeek(e.target.value)}
            className="border border-gray-200 bg-white rounded-full px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            <option value={CURRENT_WEEK}>This week</option>
            <option value={NEXT_WEEK}>Next week ({shortDate(NEXT_WEEK)})</option>
            {weeks.filter(w => w.week_start !== CURRENT_WEEK && w.week_start !== NEXT_WEEK).map(w => (
              <option key={w.week_start} value={w.week_start}>{shortDate(w.week_start)}{w.status === 'open' ? ' (unfinished)' : ''}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-2">{error}</p>}

      {isReadOnly && meeting?.completed_by && (
        <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-2 text-xs text-green-700">
          ✓ Completed by {meeting.completed_by} on {meeting.completed_at ? shortDate(meeting.completed_at) : ''}
        </div>
      )}

      <Section title="Review of last week" icon="📝" accent="#3B82F6">
        <ReviewFields value={notes.review} onChange={updateReviewField} disabled={isReadOnly} />
      </Section>

      <Section title="Sales numbers" icon="💰" accent="#10B981">
        {snapshot?.salesNumbers ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(() => {
              const s = snapshot.salesNumbers
              return [
                { label: 'New MQLs', value: s.newMqlThisMonth.toLocaleString('en-NZ'), pct: pctChange(s.newMqlThisMonth, s.newMqlLastMonth) },
                { label: 'Pushed to SQL', value: s.sqlThisMonth.toLocaleString('en-NZ'), pct: pctChange(s.sqlThisMonth, s.sqlLastMonth) },
                { label: 'New Pipeline', value: fmtMoney(s.newPipelineThisMonth), pct: pctChange(s.newPipelineThisMonth, s.newPipelineLastMonth) },
                { label: 'Sales Won', value: fmtMoney(s.wonRevenueThisMonth), pct: pctChange(s.wonRevenueThisMonth, s.wonRevenueLastMonth) },
              ]
            })().map(({ label, value, pct }) => (
              <div key={label} className="rounded-xl px-3 py-2 text-center" style={{ backgroundColor: '#10B9811A' }}>
                <p className="text-base font-bold text-gray-900">{value}</p>
                <p className="text-[11px] text-gray-500">{label}</p>
                <DeltaChip pct={pct} />
              </div>
            ))}
            <p className="col-span-2 sm:col-span-4 text-xs text-gray-400">This month vs last month, marketing lead-source (same figures as Marketing KPIs)</p>
          </div>
        ) : (
          <p className="text-sm text-gray-400">Sales numbers unavailable.</p>
        )}
        <NotesField label="Notes" value={notes.sales || ''} onChange={v => updateField('sales', v)} disabled={isReadOnly} />
      </Section>

      <Section title="Marketing performance & key metrics" icon="📈" accent="#8B5CF6">
        {snapshot?.marketingSnapshot ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(() => {
              const s = snapshot.marketingSnapshot
              return [
                { label: 'Sessions', value: s.sessions.toLocaleString('en-NZ'), pct: pctChange(s.sessions, s.lastMonth.sessions) },
                { label: 'Users', value: s.users.toLocaleString('en-NZ'), pct: pctChange(s.users, s.lastMonth.users) },
                { label: 'Engagement', value: `${s.engagementRate}%`, pct: pctChange(s.engagementRate, s.lastMonth.engagementRate) },
                { label: 'New users', value: s.newUsers.toLocaleString('en-NZ'), pct: pctChange(s.newUsers, s.lastMonth.newUsers) },
              ]
            })().map(({ label, value, pct }) => (
              <div key={label} className="rounded-xl px-3 py-2 text-center" style={{ backgroundColor: '#8B5CF61A' }}>
                <p className="text-base font-bold text-gray-900">{value}</p>
                <p className="text-[11px] text-gray-500">{label}</p>
                <DeltaChip pct={pct} />
              </div>
            ))}
            <p className="col-span-2 sm:col-span-4 text-xs text-gray-400">{snapshot.marketingSnapshot.rangeLabel} vs same days last month — website traffic (GA4)</p>
          </div>
        ) : (
          <p className="text-sm text-gray-400">Traffic snapshot unavailable.</p>
        )}
        <NotesField label="Notes" value={notes.marketing || ''} onChange={v => updateField('marketing', v)} disabled={isReadOnly} />
      </Section>

      <Section title="What's going out this week" icon="📣" accent="#F59E0B">
        <NotesField label="Social content" value={notes.social || ''} onChange={v => updateField('social', v)} disabled={isReadOnly} rows={2} />
        <ImageDropZone
          images={notes.socialImages || []}
          onUpload={uploadSocialImage}
          onRemove={removeSocialImage}
          uploading={uploadingImage}
          error={imageError}
          disabled={isReadOnly}
        />
        <NotesField label="Blogs" value={notes.blogs || ''} onChange={v => updateField('blogs', v)} disabled={isReadOnly} rows={2} />
        <NotesField label="EDMs" value={notes.edms || ''} onChange={v => updateField('edms', v)} disabled={isReadOnly} rows={2} />
        <NotesField label="Newsletter" value={notes.newsletter || ''} onChange={v => updateField('newsletter', v)} disabled={isReadOnly} rows={2} />
      </Section>

      <Section title="Current campaigns or upcoming launches" icon="🚀" accent="#EC4899">
        <NotesField label="Notes" value={notes.campaigns || ''} onChange={v => updateField('campaigns', v)} disabled={isReadOnly} />
      </Section>

      <Section title="Individual task lists and priorities" icon="✅" accent="#14B8A6">
        <PersonNotesFields value={notes.tasks} onChange={(p, v) => updatePersonField('tasks', p, v)} disabled={isReadOnly} />
      </Section>

      <Section title="Blockers, decisions or support needed" icon="🚧" accent="#F97316">
        <PersonNotesFields value={notes.blockers} onChange={(p, v) => updatePersonField('blockers', p, v)} disabled={isReadOnly} />
      </Section>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm" style={{ borderTop: '3px solid #6366F1' }}>
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between" style={{ backgroundColor: '#6366F10D' }}>
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0" style={{ backgroundColor: '#6366F126' }}>💡</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Ideas</span>
          </div>
          <span className="text-xs text-gray-400">Builds up over time, not tied to a specific week</span>
        </div>

        <div className="px-5 py-4 border-b border-gray-100">
          <textarea
            value={ideaText}
            onChange={e => setIdeaText(e.target.value)}
            placeholder="Share an idea or link…"
            rows={2}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
          />
          {ideaError && <p className="text-xs text-red-500 mt-1">{ideaError}</p>}
          <div className="flex justify-end mt-2">
            <button
              onClick={postIdea}
              disabled={postingIdea || !ideaText.trim()}
              className="px-4 py-2 bg-indigo-500 text-white text-sm font-semibold rounded-full hover:bg-indigo-600 transition-colors disabled:opacity-50"
            >
              {postingIdea ? 'Posting…' : '💡 Post'}
            </button>
          </div>
        </div>

        {ideasLoading ? (
          <p className="text-sm text-gray-400 text-center py-6">Loading…</p>
        ) : ideas.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No ideas yet — share the first one.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {ideas.map(idea => (
              <div key={idea.id} className="px-5 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">{idea.author_name}</span>
                  <span className="text-xs text-gray-400">{relativeTime(idea.created_at)}</span>
                  {(idea.clerk_user_id === user?.id || isAdmin) && (
                    <button
                      onClick={() => deleteIdea(idea.id)}
                      className="ml-auto text-gray-300 hover:text-red-400 p-1 rounded transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
                {idea.body && <p className="text-sm text-gray-700 mt-0.5 whitespace-pre-wrap break-words">{idea.body}</p>}
                {idea.link_url && (
                  <a
                    href={idea.link_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-sm text-blue-600 hover:underline truncate max-w-full"
                  >
                    {idea.link_url}
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {meeting && (
        <div className="flex justify-end items-center gap-3">
          {testEmailMsg && <span className="text-xs text-gray-400">{testEmailMsg}</span>}
          <button
            onClick={sendTestEmail}
            disabled={sendingTest}
            title="Emails the recap to just you, so you can check the formatting before sending it to everyone"
            className="px-4 py-2.5 bg-white text-gray-600 text-sm font-semibold rounded-full border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {sendingTest ? 'Sending…' : 'Send test to me'}
          </button>
          {!isReadOnly && (
            <button
              onClick={completeMeeting}
              disabled={completing}
              className="px-5 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-full hover:bg-emerald-700 transition-colors disabled:opacity-50 shadow-sm"
            >
              {completing ? 'Completing…' : '✓ Complete this meeting'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
