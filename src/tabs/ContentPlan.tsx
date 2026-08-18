import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { cachedGet } from '../lib/apiCache'

// "Content Plan FY26/27" — a big, horizontally-scrolling FY content calendar.
// Rebuilds the marketing lead's spreadsheet (Marketing Content Plan): an overall theme banner,
// four quarter-goal banners, and editable category rows (Campaigns, Events, etc.)
// whose entries span one or more weeks as a bar — same idea as MarketingPlan.tsx's
// GanttView, but with fixed columns instead of date-proportional ones.
//
// Two view modes, same underlying (always week-precise) data:
//  - Week view: big, one column per week — click-and-drag directly on a row's lane
//    to place a new entry, or use "+ Add entry" for exact week pickers.
//  - Month view: the same rows/entries condensed to one column per month, for a
//    zoomed-out look at the whole FY without the wide scroll.
//
// Deliberately full-bleed (breaks out of the app shell's max-w-screen-2xl) — this
// is meant to hold a lot of content, so it fills the browser edge-to-edge.

const BRAND = '#EBA117'
const FY_YEAR = '2026/27'
const FY_START_YEAR = 2026 // FY runs April FY_START_YEAR → March FY_START_YEAR+1

interface ContentPlanEntry {
  id: string
  row_id: string
  title: string
  start_date: string // YYYY-MM-DD, always the Monday of a week
  end_date: string
  notes: string | null
  due_date: string | null // YYYY-MM-DD, an actual specific day — not week-snapped like start/end
}
interface ContentPlanRow {
  id: string
  label: string
  sort_order: number
  content_plan_entries: ContentPlanEntry[]
}
interface ContentPlanData {
  theme: string
  quarterGoals: string[]
  rows: ContentPlanRow[]
}

type ViewMode = 'week' | 'month'
interface Unit { key: string; label: string; quarterLabel: string }

const ROW_COLORS = ['#2563EB', '#059669', '#7C3AED', '#DC2626', '#0891B2', '#D97706', '#DB2777', '#4F46E5']

function mondayOf(d: Date) {
  const m = new Date(d)
  m.setHours(0, 0, 0, 0)
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7))
  return m
}
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
function quarterLabelFor(monthOffsetFromApril: number) {
  return `Quarter ${Math.min(3, Math.max(0, Math.floor(monthOffsetFromApril / 3))) + 1}`
}

// Every Monday-of-week within the FY — the data is always stored at this precision,
// regardless of which view mode is currently displayed.
const WEEK_UNITS: (Unit & { monthLabel: string })[] = (() => {
  const start = new Date(FY_START_YEAR, 3, 1) // 1 Apr
  const end = new Date(FY_START_YEAR + 1, 3, 1) // 1 Apr next year (exclusive)
  const weeks: (Unit & { monthLabel: string })[] = []
  let cur = mondayOf(start)
  while (cur < end) {
    const monthOffset = (cur.getFullYear() - FY_START_YEAR) * 12 + (cur.getMonth() - 3)
    weeks.push({
      key: ymd(cur),
      label: cur.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }),
      monthLabel: cur.toLocaleDateString('en-NZ', { month: 'short' }),
      quarterLabel: quarterLabelFor(monthOffset),
    })
    const next = new Date(cur)
    next.setDate(next.getDate() + 7)
    cur = next
  }
  return weeks
})()

// One unit per calendar month of the FY — used for the condensed month view.
const MONTH_UNITS: Unit[] = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(FY_START_YEAR, 3 + i, 1)
  return {
    key: ymd(d),
    label: d.toLocaleDateString('en-NZ', { month: 'short' }),
    quarterLabel: quarterLabelFor(i),
  }
})

// FY date range, for positioning the "today" line. Computed from FY_START_YEAR
// directly (not by re-parsing a unit's `key` string) to avoid local-vs-UTC drift —
// `new Date('2026-08-17')` parses as UTC midnight, which can land on the wrong side
// of a day boundary compared to `new Date()` (local time).
const FY_RANGE_START = new Date(FY_START_YEAR, 3, 1)
const FY_RANGE_END = new Date(FY_START_YEAR + 1, 3, 1)
const WEEK_RANGE_START = mondayOf(FY_RANGE_START)
const WEEK_RANGE_END = (() => { const d = new Date(WEEK_RANGE_START); d.setDate(d.getDate() + WEEK_UNITS.length * 7); return d })()

// Fractional position (0–100) of today within the FY range for the current view mode.
// Outside 0–100 means today isn't in this financial year at all.
function pctOfDateMs(dateMs: number, mode: ViewMode) {
  const [start, end] = mode === 'week' ? [WEEK_RANGE_START, WEEK_RANGE_END] : [FY_RANGE_START, FY_RANGE_END]
  return ((dateMs - start.getTime()) / (end.getTime() - start.getTime())) * 100
}
function computeTodayPct(mode: ViewMode) {
  return pctOfDateMs(Date.now(), mode)
}
// Same coordinate space as the week/month columns and the today line — a due date
// positions correctly relative to the grid without needing to know anything about
// the entry's own bar.
function pctOfDateStr(dateStr: string, mode: ViewMode) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return pctOfDateMs(new Date(y, m - 1, d).getTime(), mode)
}
function fmtDueDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}
// Short weekday + day, for the Upcoming Due Dates list — e.g. "Mon 24".
function fmtDueDateShort(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric' })
}
function daysAwayLabel(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const target = new Date(y, m - 1, d).getTime()
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diffDays = Math.round((target - today.getTime()) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  return `In ${diffDays} days`
}

// Consecutive same-key runs, in order — used to build header bands out of a flat unit list.
function groupRuns<K>(items: { key: K }[]) {
  const runs: { key: K; start: number; count: number }[] = []
  items.forEach((item, i) => {
    const last = runs[runs.length - 1]
    if (last && last.key === item.key) last.count++
    else runs.push({ key: item.key, start: i, count: 1 })
  })
  return runs
}
const WEEK_MONTH_BAND = groupRuns(WEEK_UNITS.map(w => ({ key: w.monthLabel })))
const WEEK_QUARTER_BAND = groupRuns(WEEK_UNITS.map(w => ({ key: w.quarterLabel })))
const MONTH_QUARTER_BAND = groupRuns(MONTH_UNITS.map(m => ({ key: m.quarterLabel })))

// Weeks grouped by month, for the "+ Add entry" form's start/end <select>s — always
// week-precision regardless of the current view mode (the view toggle only changes
// how existing entries are DISPLAYED, not the precision they're stored at).
const WEEK_OPTION_GROUPS = WEEK_MONTH_BAND.map(run => ({
  label: run.key,
  options: WEEK_UNITS.slice(run.start, run.start + run.count).map((w, i) => ({ index: run.start + i, label: w.label })),
}))

function unitsFor(mode: ViewMode) {
  return mode === 'week' ? WEEK_UNITS : MONTH_UNITS
}
function unitIndexForDate(dateStr: string, mode: ViewMode) {
  if (mode === 'week') return WEEK_UNITS.findIndex(u => u.key === dateStr)
  const [y, m] = dateStr.split('-').map(Number)
  return MONTH_UNITS.findIndex(u => { const [uy, um] = u.key.split('-').map(Number); return uy === y && um === m })
}
// Naive singular for a row label, for placeholder text — "Events" -> "Event",
// "Campaigns" -> "Campaign", "EDMs" -> "EDM". Good enough for a hint, not aiming
// for perfect English (e.g. "Social posts" -> "Social post" is a bit clunky but fine).
function singularize(label: string) {
  const trimmed = label.trim()
  return /[a-z]s$/.test(trimmed) ? trimmed.slice(0, -1) : trimmed
}
// Converts a drag/click selection (in the current view's unit indices) back into the
// week-precise dates the API stores. In month mode this snaps to the Monday nearest
// each month's edges, so an entry created while zoomed out still lands on real weeks.
function dateRangeFromUnits(startIdx: number, endIdx: number, mode: ViewMode) {
  if (mode === 'week') return { start_date: WEEK_UNITS[startIdx].key, end_date: WEEK_UNITS[endIdx].key }
  const [sy, sm] = MONTH_UNITS[startIdx].key.split('-').map(Number)
  const [ey, em] = MONTH_UNITS[endIdx].key.split('-').map(Number)
  const firstDay = new Date(sy, sm - 1, 1)
  const lastDay = new Date(ey, em, 0) // day 0 of next month = last day of this one
  return { start_date: ymd(mondayOf(firstDay)), end_date: ymd(mondayOf(lastDay)) }
}

// Sizing per view mode — week view is big and scrolls; month view condenses a lot.
const LABEL_W = 280
const SIZING: Record<ViewMode, { unitW: number; laneH: number; barText: string; headerText: string }> = {
  week: { unitW: 150, laneH: 46, barText: 'text-sm', headerText: 'text-xs' },
  month: { unitW: 110, laneH: 30, barText: 'text-xs', headerText: 'text-xs' },
}

// First-fit lane packing so overlapping entries within a row stack instead of collide.
function packLanes(entries: ContentPlanEntry[], mode: ViewMode) {
  const unitCount = unitsFor(mode).length
  const withIdx = entries
    .map(e => ({ entry: e, startIdx: Math.max(0, unitIndexForDate(e.start_date, mode)), endIdx: Math.min(unitCount - 1, unitIndexForDate(e.end_date, mode)) }))
    .filter(e => e.startIdx >= 0 && e.endIdx >= 0)
    .sort((a, b) => a.startIdx - b.startIdx)
  const laneEnds: number[] = []
  const placed = withIdx.map(e => {
    let lane = laneEnds.findIndex(end => end < e.startIdx)
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(e.endIdx) }
    else laneEnds[lane] = e.endIdx
    return { ...e, lane }
  })
  return { placed, laneCount: Math.max(1, laneEnds.length) }
}

// Click-to-edit, blur-to-save text — used for the theme banner and quarter goals.
function InlineText({ value, placeholder, onSave, className }: { value: string; placeholder: string; onSave: (v: string) => void; className?: string }) {
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState(value)
  useEffect(() => { if (!editing) setInput(value) }, [value, editing])
  const commit = () => {
    setEditing(false)
    if (input.trim() !== value) onSave(input.trim())
  }
  if (editing) {
    return (
      <input
        autoFocus
        value={input}
        onChange={e => setInput(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setInput(value); setEditing(false) } }}
        className={`w-full bg-white/70 border border-blue-300 rounded px-3 py-1.5 focus:outline-none ${className || ''}`}
      />
    )
  }
  return (
    <button onClick={() => setEditing(true)} className={`w-full text-left hover:bg-black/5 rounded px-3 py-1.5 transition-colors ${className || ''}`}>
      {value || <span className="text-gray-400 italic">{placeholder}</span>}
    </button>
  )
}

// Add/edit modal — title, exact week pickers with a plain-English date range, and a
// proper multi-line notes box, plus the row it belongs to for context. Replaces an
// earlier cramped inline row of tiny inputs that was hard to actually use. Always
// operates at week precision, matching the data's actual precision regardless of
// the current view mode.
function EntryModal({
  rowLabel, rowColor, initial, onSave, onCancel, onDelete,
}: {
  rowLabel: string
  rowColor: string
  initial?: ContentPlanEntry
  onSave: (v: { title: string; start_date: string; end_date: string; notes: string; due_date: string | null }) => void
  onCancel: () => void
  onDelete?: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [startIdx, setStartIdx] = useState(initial ? Math.max(0, unitIndexForDate(initial.start_date, 'week')) : 0)
  const [endIdx, setEndIdx] = useState(initial ? Math.max(0, unitIndexForDate(initial.end_date, 'week')) : 0)
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [dueDate, setDueDate] = useState(initial?.due_date ?? '')

  const s = Math.min(startIdx, endIdx)
  const e = Math.max(startIdx, endIdx)
  const spanWeeks = e - s + 1
  const rangeLabel = s === e ? `Week of ${WEEK_UNITS[s].label}` : `${WEEK_UNITS[s].label} – ${WEEK_UNITS[e].label} · ${spanWeeks} weeks`

  const submit = () => {
    if (!title.trim()) return
    onSave({ title: title.trim(), start_date: WEEK_UNITS[s].key, end_date: WEEK_UNITS[e].key, notes: notes.trim(), due_date: dueDate || null })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-6 border-b border-gray-100 rounded-t-2xl" style={{ borderTop: `4px solid ${rowColor}` }}>
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-widest uppercase mb-1 truncate" style={{ color: rowColor }}>{rowLabel}</p>
            <h2 className="text-lg font-bold text-gray-900">{initial ? 'Edit entry' : 'New entry'}</h2>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-lg leading-none transition-colors shrink-0" aria-label="Close">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Title</label>
            <input
              autoFocus
              value={title}
              onChange={ev => setTitle(ev.target.value)}
              onKeyDown={ev => { if (ev.key === 'Enter' && title.trim()) submit() }}
              placeholder={`${singularize(rowLabel)} name…`}
              className="w-full text-base border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">When</label>
            <div className="flex items-center gap-2">
              <select value={startIdx} onChange={ev => setStartIdx(Number(ev.target.value))} className="flex-1 min-w-0 text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-400">
                {WEEK_OPTION_GROUPS.map(g => (
                  <optgroup key={g.label} label={g.label}>
                    {g.options.map(o => <option key={o.index} value={o.index}>{o.label}</option>)}
                  </optgroup>
                ))}
              </select>
              <span className="text-gray-300 shrink-0">→</span>
              <select value={endIdx} onChange={ev => setEndIdx(Number(ev.target.value))} className="flex-1 min-w-0 text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-400">
                {WEEK_OPTION_GROUPS.map(g => (
                  <optgroup key={g.label} label={g.label}>
                    {g.options.map(o => <option key={o.index} value={o.index}>{o.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <p className="text-xs text-gray-400 mt-1.5">{rangeLabel}</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">Due / event date <span className="normal-case font-normal text-gray-400">(optional)</span></label>
              {dueDate && <button onClick={() => setDueDate('')} className="text-xs text-gray-400 hover:text-red-500">Clear</button>}
            </div>
            <input
              type="date"
              value={dueDate}
              onChange={ev => setDueDate(ev.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            <p className="text-xs text-gray-400 mt-1.5">Shows as a marker on the bar — the exact day something's due or happening, separate from the week range above.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Notes</label>
            <textarea
              value={notes}
              onChange={ev => setNotes(ev.target.value)}
              rows={4}
              placeholder="Any extra detail worth capturing here…"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 p-6 border-t border-gray-100">
          {onDelete ? (
            <button onClick={onDelete} className="text-sm font-medium text-red-500 hover:text-red-700">Delete entry</button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button onClick={onCancel} className="text-sm font-medium text-gray-500 hover:text-gray-700 px-4 py-2.5">Cancel</button>
            <button onClick={submit} disabled={!title.trim()} className="text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 px-5 py-2.5 rounded-full transition-colors">Save</button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface DragState { rowId: string; rectLeft: number; rectWidth: number; anchorIdx: number; currentIdx: number }
interface QuickAdd { rowId: string; startIdx: number; endIdx: number }
type EntryDragMode = 'move' | 'resize-start' | 'resize-end'
interface EntryDragState {
  entry: ContentPlanEntry
  rowId: string
  mode: EntryDragMode
  origStartIdx: number
  origEndIdx: number
  rectLeft: number
  rectWidth: number
  startClientX: number
  curStartIdx: number
  curEndIdx: number
  moved: boolean
}

export default function ContentPlan() {
  const [data, setData] = useState<ContentPlanData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [addingEntryRow, setAddingEntryRow] = useState<string | null>(null)
  const [editingEntry, setEditingEntry] = useState<ContentPlanEntry | null>(null)
  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const [addingRow, setAddingRow] = useState(false)
  const [newRowLabel, setNewRowLabel] = useState('')
  const [drag, setDrag] = useState<DragState | null>(null)
  const [quickAdd, setQuickAdd] = useState<QuickAdd | null>(null)
  const [quickAddText, setQuickAddText] = useState('')
  const quickAddSubmitting = useRef(false)
  const [entryDrag, setEntryDrag] = useState<EntryDragState | null>(null)

  const units = unitsFor(viewMode)
  const { unitW, laneH, barText, headerText } = SIZING[viewMode]
  const gridW = LABEL_W + units.length * unitW
  const quarterBand = viewMode === 'week' ? WEEK_QUARTER_BAND : MONTH_QUARTER_BAND
  const todayPct = computeTodayPct(viewMode)
  const showTodayLine = todayPct >= 0 && todayPct <= 100
  const todayLeftPx = LABEL_W + (todayPct / 100) * (gridW - LABEL_W)

  // Upcoming Due Dates — only entries with a due_date set, only ones still in the
  // current calendar month, and only ones that haven't already passed.
  const now = new Date()
  const todayStr = ymd(now)
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const upcomingDueDates = (data?.rows ?? [])
    .flatMap((row, ri) => row.content_plan_entries.map(entry => ({ entry, rowLabel: row.label, color: ROW_COLORS[ri % ROW_COLORS.length] })))
    .filter(({ entry }) => entry.due_date && entry.due_date.startsWith(monthPrefix) && entry.due_date >= todayStr)
    .sort((a, b) => a.entry.due_date!.localeCompare(b.entry.due_date!))

  const load = () => {
    setLoading(true)
    // No need for force:true here — installApiCache()'s interceptor already clears the
    // whole cache on any successful mutation, so by the time a caller (below) re-invokes
    // load() after a save, this GET is already past the stale cache entry.
    cachedGet('/api/content/plan', { params: { fy: FY_YEAR } })
      .then(r => { setData(r.data); setError('') })
      .catch(e => setError(e.response?.data?.error || 'Failed to load content plan'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  // Drag-to-create: track mousemove/mouseup on the whole window while a drag is in
  // progress, since the cursor will leave the lane div being dragged across.
  useEffect(() => {
    if (!drag) return
    const clamp = (i: number) => Math.min(units.length - 1, Math.max(0, i))
    const idxAt = (clientX: number) => clamp(Math.floor(((clientX - drag.rectLeft) / drag.rectWidth) * units.length))
    const onMove = (e: MouseEvent) => setDrag(d => (d ? { ...d, currentIdx: idxAt(e.clientX) } : d))
    const onUp = (e: MouseEvent) => {
      const finalIdx = idxAt(e.clientX)
      setDrag(d => {
        if (d) setQuickAdd({ rowId: d.rowId, startIdx: Math.min(d.anchorIdx, finalIdx), endIdx: Math.max(d.anchorIdx, finalIdx) })
        return null
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [drag, units.length])

  useEffect(() => { setQuickAddText('') }, [quickAdd])

  // Move/resize an existing entry by dragging it, Outlook-Calendar style — drag the
  // body to shift both ends, drag an edge to resize just that end. A drag that never
  // actually moves is treated as a click and opens the edit modal instead.
  useEffect(() => {
    if (!entryDrag) return
    const unitCount = units.length
    const idxAt = (clientX: number) => Math.min(unitCount - 1, Math.max(0, Math.floor(((clientX - entryDrag.rectLeft) / entryDrag.rectWidth) * unitCount)))
    const onMove = (e: MouseEvent) => {
      setEntryDrag(d => {
        if (!d) return d
        const moved = d.moved || Math.abs(e.clientX - d.startClientX) > 4
        let curStartIdx = d.origStartIdx, curEndIdx = d.origEndIdx
        if (d.mode === 'move') {
          const deltaUnits = Math.round((e.clientX - d.startClientX) / (d.rectWidth / unitCount))
          const span = d.origEndIdx - d.origStartIdx
          curStartIdx = Math.min(unitCount - 1 - span, Math.max(0, d.origStartIdx + deltaUnits))
          curEndIdx = curStartIdx + span
        } else if (d.mode === 'resize-start') {
          curStartIdx = Math.min(d.origEndIdx, Math.max(0, idxAt(e.clientX)))
        } else {
          curEndIdx = Math.max(d.origStartIdx, Math.min(unitCount - 1, idxAt(e.clientX)))
        }
        return { ...d, curStartIdx, curEndIdx, moved }
      })
    }
    const onUp = () => {
      setEntryDrag(d => {
        if (d) {
          if (d.moved) {
            const range = dateRangeFromUnits(d.curStartIdx, d.curEndIdx, viewMode)
            axios.patch(`/api/content/plan/entries/${d.entry.id}`, range).then(load).catch(load)
          } else {
            setEditingEntry(d.entry)
          }
        }
        return null
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [entryDrag, units.length, viewMode])

  const saveSettings = (patch: Partial<Pick<ContentPlanData, 'theme' | 'quarterGoals'>>) => {
    if (!data) return
    const next = { ...data, ...patch }
    setData(next)
    axios.put('/api/content/plan/settings', { fy_year: FY_YEAR, theme: next.theme, quarterGoals: next.quarterGoals }).catch(load)
  }

  const addRow = async () => {
    if (!newRowLabel.trim()) return
    try {
      await axios.post('/api/content/plan/rows', { fy_year: FY_YEAR, label: newRowLabel.trim() })
      setNewRowLabel('')
      setAddingRow(false)
      load()
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to add row')
    }
  }
  const renameRow = async (id: string, label: string) => {
    if (!label.trim()) return
    await axios.patch(`/api/content/plan/rows/${id}`, { label: label.trim() }).catch(() => {})
    load()
  }
  const deleteRow = async (id: string, label: string) => {
    if (!confirm(`Delete the "${label}" row and everything in it?`)) return
    await axios.delete(`/api/content/plan/rows/${id}`).catch(() => {})
    load()
  }

  const saveEntry = async (rowId: string, existing: ContentPlanEntry | undefined, v: { title: string; start_date: string; end_date: string; notes: string; due_date?: string | null }) => {
    try {
      if (existing) {
        await axios.patch(`/api/content/plan/entries/${existing.id}`, v)
      } else {
        await axios.post('/api/content/plan/entries', { row_id: rowId, ...v })
      }
      setAddingEntryRow(null)
      setEditingEntry(null)
      setQuickAdd(null)
      load()
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to save entry')
    }
  }
  const deleteEntry = async (id: string) => {
    await axios.delete(`/api/content/plan/entries/${id}`).catch(() => {})
    setEditingEntry(null)
    load()
  }

  // Guards against a double-submit when Enter fires saveEntry and the resulting blur
  // (as focus leaves the input) fires it again before the first request resolves.
  const submitQuickAdd = (rowId: string, qa: QuickAdd, text: string) => {
    if (quickAddSubmitting.current) return
    if (!text.trim()) { setQuickAdd(null); return }
    quickAddSubmitting.current = true
    saveEntry(rowId, undefined, { title: text.trim(), notes: '', ...dateRangeFromUnits(qa.startIdx, qa.endIdx, viewMode) })
      .finally(() => { quickAddSubmitting.current = false })
  }

  const startDrag = (rowId: string) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const idx = Math.min(units.length - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * units.length)))
    setDrag({ rowId, rectLeft: rect.left, rectWidth: rect.width, anchorIdx: idx, currentIdx: idx })
  }

  const startEntryDrag = (entry: ContentPlanEntry, rowId: string, mode: EntryDragMode) => (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.stopPropagation() // don't also start the lane's create-drag
    const lane = (e.currentTarget as HTMLElement).closest('[data-lane="true"]') as HTMLElement | null
    if (!lane) return
    const rect = lane.getBoundingClientRect()
    const s0 = Math.max(0, unitIndexForDate(entry.start_date, viewMode))
    const e0 = Math.min(units.length - 1, unitIndexForDate(entry.end_date, viewMode))
    setEntryDrag({ entry, rowId, mode, origStartIdx: s0, origEndIdx: e0, rectLeft: rect.left, rectWidth: rect.width, startClientX: e.clientX, curStartIdx: s0, curEndIdx: e0, moved: false })
  }

  if (loading && !data) return <p className="text-sm text-gray-400 text-center py-12">Loading…</p>

  return (
    // Full-bleed breakout: the app shell centers every tab in a max-w-screen-2xl
    // container, but this grid is meant to run edge-to-edge (see file header comment).
    <div style={{ width: '100vw', position: 'relative', left: '50%', right: '50%', marginLeft: '-50vw', marginRight: '-50vw' }} className="px-4 sm:px-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h2 className="text-2xl font-extrabold text-gray-900">Content Plan {FY_YEAR}</h2>
        <div className="flex items-center bg-gray-100 rounded-full p-1 text-sm font-medium">
          {(['week', 'month'] as ViewMode[]).map(m => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className={`px-4 py-1.5 rounded-full capitalize transition-colors ${viewMode === m ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {m} view
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-2 mb-4">{error}</p>}

      {data && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: `4px solid ${BRAND}` }}>
          {/* Overall theme banner */}
          <div className="px-6 py-4 border-b border-gray-100" style={{ background: `linear-gradient(135deg, ${BRAND}26, ${BRAND}08)` }}>
            <p className="text-xs font-semibold tracking-widest text-gray-500 uppercase mb-1.5">Overall Theme / Focus</p>
            <InlineText value={data.theme} placeholder="Set the theme for this financial year…" onSave={theme => saveSettings({ theme })} className="text-lg font-semibold text-gray-800" />
          </div>

          <div className="overflow-x-auto">
            <div style={{ minWidth: `${gridW}px`, position: 'relative' }}>
              {/* "Today" line, spanning the whole grid including the header bands */}
              {showTodayLine && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-red-400 pointer-events-none"
                  style={{ left: `${todayLeftPx}px` }}
                  title="Today"
                >
                  <span className="absolute -top-0.5 left-1 text-[10px] font-semibold text-red-500 uppercase tracking-wide whitespace-nowrap">Today</span>
                </div>
              )}

              {/* Quarter goal banners */}
              <div className="flex border-b border-gray-100">
                <div className="shrink-0 sticky left-0 z-30 bg-white border-r border-gray-200" style={{ width: `${LABEL_W}px` }} />
                {quarterBand.map((q, qi) => (
                  <div key={q.key} className="border-r border-gray-100 last:border-r-0 px-3 py-3 bg-gray-50/60" style={{ width: `${q.count * unitW}px` }}>
                    <p className="text-xs font-semibold tracking-wide text-gray-400 uppercase mb-1">{q.key} Goal</p>
                    <InlineText
                      value={data.quarterGoals[qi] || ''}
                      placeholder="Set this quarter's goal…"
                      onSave={v => {
                        const next = [...data.quarterGoals]
                        next[qi] = v
                        saveSettings({ quarterGoals: next })
                      }}
                      className="text-sm text-gray-700"
                    />
                  </div>
                ))}
              </div>

              {/* Month band — only shown in week view, since in month view each column is already a month */}
              {viewMode === 'week' && (
                <div className="flex border-b border-gray-100 bg-gray-50/40">
                  <div className="shrink-0 sticky left-0 z-30 bg-gray-50 border-r border-gray-200" style={{ width: `${LABEL_W}px` }} />
                  {WEEK_MONTH_BAND.map(m => (
                    <div key={m.start} className="text-center py-1.5 text-sm font-bold text-gray-600 border-r border-gray-100" style={{ width: `${m.count * unitW}px` }}>
                      {m.key}
                    </div>
                  ))}
                </div>
              )}

              {/* Unit header (weeks or months, depending on view mode) */}
              <div className="flex border-b border-gray-100 sticky top-0 bg-white z-10">
                <div className="shrink-0 sticky left-0 z-30 bg-white border-r border-gray-200" style={{ width: `${LABEL_W}px` }} />
                {units.map((u, i) => (
                  <div key={i} className={`text-center py-2 ${headerText} font-medium text-gray-500 border-r border-gray-50`} style={{ width: `${unitW}px` }}>
                    {u.label}
                  </div>
                ))}
              </div>

              {/* Category rows */}
              {data.rows.map((row, ri) => {
                const { placed, laneCount } = packLanes(row.content_plan_entries, viewMode)
                const rowH = laneCount * laneH + 16
                const color = ROW_COLORS[ri % ROW_COLORS.length]
                const rowDrag = drag && drag.rowId === row.id ? drag : null
                const rowQuickAdd = quickAdd && quickAdd.rowId === row.id ? quickAdd : null
                return (
                  <div key={row.id}>
                    <div className="flex items-stretch border-b border-gray-100" style={{ minHeight: `${rowH}px` }}>
                      <div className="shrink-0 sticky left-0 z-30 bg-white border-r border-gray-200 flex items-center justify-between gap-1 px-3" style={{ width: `${LABEL_W}px`, borderLeft: `4px solid ${color}` }}>
                        {editingRowId === row.id ? (
                          <input
                            autoFocus
                            defaultValue={row.label}
                            onBlur={e => { renameRow(row.id, e.target.value); setEditingRowId(null) }}
                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingRowId(null) }}
                            className="flex-1 min-w-0 text-base font-semibold border border-blue-300 rounded px-2 py-1.5 focus:outline-none"
                          />
                        ) : (
                          <button onClick={() => setEditingRowId(row.id)} className="flex-1 min-w-0 text-left text-base font-semibold text-gray-700 truncate hover:bg-gray-50 rounded px-2 py-1.5">
                            {row.label}
                          </button>
                        )}
                        <div className="flex items-center gap-2 shrink-0">
                          <button onClick={() => setAddingEntryRow(row.id)} title="Add entry (exact weeks)" className="text-blue-400 hover:text-blue-600 text-xl leading-none px-0.5">＋</button>
                          <button onClick={() => deleteRow(row.id, row.label)} title="Delete row" className="text-gray-300 hover:text-red-500 text-sm leading-none px-0.5">✕</button>
                        </div>
                      </div>
                      <div
                        data-lane="true"
                        className="flex-1 relative select-none cursor-crosshair"
                        style={{ minHeight: `${rowH}px` }}
                        onMouseDown={startDrag(row.id)}
                      >
                        {units.map((_, i) => (
                          <div key={i} className="absolute top-0 bottom-0 border-r border-gray-50 pointer-events-none" style={{ left: `${(i / units.length) * 100}%`, width: `${(1 / units.length) * 100}%` }} />
                        ))}
                        {row.content_plan_entries.length === 0 && !rowDrag && !rowQuickAdd && (
                          <p className="absolute inset-0 flex items-center px-2.5 text-xs text-gray-300 pointer-events-none">Click and drag here to add an entry…</p>
                        )}
                        {placed.map(({ entry, startIdx, endIdx, lane }) => {
                          const dragging = entryDrag?.entry.id === entry.id ? entryDrag : null
                          const showStart = dragging ? dragging.curStartIdx : startIdx
                          const showEnd = dragging ? dragging.curEndIdx : endIdx
                          const duePct = entry.due_date ? pctOfDateStr(entry.due_date, viewMode) : null
                          const dueVisible = duePct !== null && duePct >= 0 && duePct <= 100
                          return (
                            <div key={entry.id}>
                              <div
                                className={`absolute rounded-md group/bar ${dragging ? 'ring-2 ring-white shadow-lg z-10' : ''}`}
                                style={{
                                  left: `${(showStart / units.length) * 100}%`,
                                  width: `${((showEnd - showStart + 1) / units.length) * 100}%`,
                                  top: `${8 + lane * laneH}px`,
                                  height: `${laneH - 8}px`,
                                  backgroundColor: color + 'CC',
                                }}
                                title={entry.notes || entry.title}
                              >
                                <div
                                  onMouseDown={startEntryDrag(entry, row.id, 'resize-start')}
                                  className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-l-md hover:bg-black/25"
                                />
                                <div
                                  onMouseDown={startEntryDrag(entry, row.id, 'move')}
                                  className="absolute inset-0 px-2.5 flex items-center overflow-hidden cursor-move"
                                >
                                  <span className={`${barText} text-white truncate font-medium pointer-events-none`}>{entry.title}</span>
                                </div>
                                <div
                                  onMouseDown={startEntryDrag(entry, row.id, 'resize-end')}
                                  className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-r-md hover:bg-black/25"
                                />
                              </div>
                              {/* Due/event date marker — a small diamond pin at the exact day, independent of the bar's week-snapped left/width */}
                              {dueVisible && !dragging && (
                                <div
                                  className="absolute pointer-events-none z-10 bg-white rounded-[2px]"
                                  style={{
                                    left: `${duePct}%`,
                                    top: `${8 + lane * laneH + (laneH - 8) / 2}px`,
                                    width: '9px',
                                    height: '9px',
                                    border: `2px solid ${color}`,
                                    transform: 'translate(-50%, -50%) rotate(45deg)',
                                  }}
                                  title={`Due ${fmtDueDate(entry.due_date!)}`}
                                />
                              )}
                            </div>
                          )
                        })}
                        {/* Live drag preview */}
                        {rowDrag && (() => {
                          const s = Math.min(rowDrag.anchorIdx, rowDrag.currentIdx)
                          const e = Math.max(rowDrag.anchorIdx, rowDrag.currentIdx)
                          return (
                            <div
                              className="absolute rounded-md border-2 border-dashed border-blue-400 bg-blue-200/40 pointer-events-none"
                              style={{ left: `${(s / units.length) * 100}%`, width: `${((e - s + 1) / units.length) * 100}%`, top: '8px', height: `${laneH - 8}px` }}
                            />
                          )
                        })()}
                        {/* Quick-add name input, placed right where the drag/click landed */}
                        {rowQuickAdd && (
                          <input
                            autoFocus
                            onMouseDown={e => e.stopPropagation()}
                            value={quickAddText}
                            onChange={e => setQuickAddText(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') submitQuickAdd(row.id, rowQuickAdd, quickAddText)
                              if (e.key === 'Escape') setQuickAdd(null)
                            }}
                            onBlur={() => submitQuickAdd(row.id, rowQuickAdd, quickAddText)}
                            placeholder={`${singularize(row.label)} name…`}
                            className={`absolute rounded-md px-2.5 ${barText} font-medium border-2 border-blue-400 bg-white focus:outline-none`}
                            style={{
                              left: `${(rowQuickAdd.startIdx / units.length) * 100}%`,
                              width: `${((rowQuickAdd.endIdx - rowQuickAdd.startIdx + 1) / units.length) * 100}%`,
                              top: '8px',
                              height: `${laneH - 8}px`,
                            }}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}

              {/* Add category row — sticky left like the row labels above it, so it's
                  always reachable without scrolling back to the start of the grid */}
              <div className="flex items-center px-3 py-3 sticky left-0 z-30 bg-white border-r border-gray-200 w-fit" style={{ minWidth: `${LABEL_W}px` }}>
                {addingRow ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={newRowLabel}
                      onChange={e => setNewRowLabel(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addRow(); if (e.key === 'Escape') { setAddingRow(false); setNewRowLabel('') } }}
                      placeholder="Category name (e.g. Campaigns)…"
                      className="text-sm border border-blue-300 rounded px-3 py-2 focus:outline-none w-64"
                    />
                    <button onClick={addRow} disabled={!newRowLabel.trim()} className="text-sm font-medium px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40">Add</button>
                    <button onClick={() => { setAddingRow(false); setNewRowLabel('') }} className="text-sm text-gray-400 hover:text-gray-600">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setAddingRow(true)} className="text-sm text-gray-400 hover:text-blue-500 font-medium">＋ Add category</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {data && (
        <div className="max-w-2xl bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mt-6" style={{ borderTop: `4px solid ${BRAND}` }}>
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="text-base font-bold text-gray-900">Upcoming Due Dates</h3>
            <p className="text-xs text-gray-400 mt-0.5">{now.toLocaleDateString('en-NZ', { month: 'long', year: 'numeric' })} — entries with a due/event date set</p>
          </div>
          {upcomingDueDates.length === 0 ? (
            <p className="text-sm text-gray-400 px-6 py-8 text-center">Nothing due for the rest of this month.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {upcomingDueDates.map(({ entry, rowLabel, color }) => (
                <button
                  key={entry.id}
                  onClick={() => setEditingEntry(entry)}
                  className="w-full flex items-center gap-4 px-6 py-3 text-left hover:bg-gray-50 transition-colors"
                >
                  <div className="shrink-0 w-14 text-center">
                    <p className="text-xs font-semibold uppercase tracking-wide" style={{ color }}>{fmtDueDateShort(entry.due_date!)}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-800 truncate">{entry.title}</p>
                    <p className="text-xs text-gray-400 truncate">{rowLabel}</p>
                  </div>
                  <span className="shrink-0 text-xs font-medium text-gray-400">{daysAwayLabel(entry.due_date!)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {data && (addingEntryRow || editingEntry) && (() => {
        const activeRowId = editingEntry?.row_id ?? addingEntryRow!
        const activeIdx = data.rows.findIndex(r => r.id === activeRowId)
        const activeRow = data.rows[activeIdx]
        if (!activeRow) return null
        return (
          <EntryModal
            rowLabel={activeRow.label}
            rowColor={ROW_COLORS[activeIdx % ROW_COLORS.length]}
            initial={editingEntry ?? undefined}
            onSave={v => saveEntry(activeRow.id, editingEntry ?? undefined, v)}
            onCancel={() => { setAddingEntryRow(null); setEditingEntry(null) }}
            onDelete={editingEntry ? () => deleteEntry(editingEntry.id) : undefined}
          />
        )
      })()}
    </div>
  )
}
