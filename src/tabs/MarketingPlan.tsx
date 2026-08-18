import { useEffect, useState, useCallback, useMemo, useRef, Component } from 'react'
import axios from 'axios'
import { cachedGet } from '../lib/apiCache'
import { TEAM, type TeamMember } from '../utils/teamConfig'

class ErrorBoundary extends Component<{children: React.ReactNode},{err: string}> {
  constructor(p: any) { super(p); this.state = {err:''} }
  componentDidCatch(e: Error) { this.setState({err: e.message + '\n' + e.stack?.split('\n').slice(0,5).join('\n')}) }
  render() {
    if (this.state.err) return <div className="p-6 text-sm text-red-600 bg-red-50 rounded-xl whitespace-pre-wrap font-mono">{this.state.err}</div>
    return this.props.children
  }
}

// ── Group colour config ───────────────────────────────────────────────────────
const GROUP_CONFIG: Record<string, { hex: string; light: string; border: string; label: string }> = {
  'Schedule':              { hex: '#3B82F6', light: '#EFF6FF', border: '#BFDBFE', label: 'Schedule' },
  'Product':               { hex: '#A855F7', light: '#FAF5FF', border: '#E9D5FF', label: 'Product' },
  'Projects':              { hex: '#F97316', light: '#FFF7ED', border: '#FED7AA', label: 'Projects' },
  'Media':                 { hex: '#EC4899', light: '#FDF2F8', border: '#FBCFE8', label: 'Media' },
  'Events':                { hex: '#EAB308', light: '#FEFCE8', border: '#FEF08A', label: 'Events' },
  'Maintenance':           { hex: '#6B7280', light: '#F9FAFB', border: '#E5E7EB', label: 'Maintenance' },
  'Tenders/Presentations': { hex: '#14B8A6', light: '#F0FDFA', border: '#99F6E4', label: 'Tenders' },
  'Tasks':                 { hex: '#6366F1', light: '#EEF2FF', border: '#C7D2FE', label: 'Tasks' },
}
const DEFAULT_GROUP = { hex: '#9CA3AF', light: '#F9FAFB', border: '#E5E7EB', label: '' }
const getGroup = (name: string) => GROUP_CONFIG[name] || DEFAULT_GROUP

// Breadcrumb of a leaf's context: "Group › Parent task › …" — so flattened
// views (List / Board / Gantt / Focus) show which parent a task belongs to.
function leafContext(t: { groupName: string; parentPath: string[] }): string {
  const groupLabel = getGroup(t.groupName).label || t.groupName
  return [groupLabel, ...(t.parentPath || [])].filter(Boolean).join(' › ')
}

// ── Types ─────────────────────────────────────────────────────────────────────
// Marketing priorities, held in the sheet's own Priority column so they're visible
// in Smartsheet too. Replaces the old ★ focus flag. 'Individual' means "a priority
// for whoever this task is assigned to" — there's one Priority cell per row, so the
// assignee is what makes it personal.
type PriorityKind = 'Team' | 'Individual'
const PRIORITY_KINDS: PriorityKind[] = ['Team', 'Individual']

// Both lists are split into three bands, and you drag tasks between them. The band
// is dashboard-only — the sheet's Priority column just says Team or Individual — so
// it lives in the shared order config alongside the ranking.
type Band = 'high' | 'medium' | 'low'
const BANDS: Band[] = ['high', 'medium', 'low']
// High = green, Medium = yellow, Low = red. These label the bands in the team list;
// in the individual list the same colours are used to show which team priority a
// task sits under (blank when it sits under none).
const BAND_STYLE: Record<Band, { label: string; hex: string; chip: string; row: string }> = {
  high:   { label: 'High',   hex: '#22C55E', chip: 'bg-green-50 text-green-700 border-green-200',   row: '#DCFCE7' },
  medium: { label: 'Medium', hex: '#F59E0B', chip: 'bg-amber-50 text-amber-700 border-amber-200',   row: '#FEF3C7' },
  low:    { label: 'Low',    hex: '#EF4444', chip: 'bg-red-50 text-red-700 border-red-200',         row: '#FEE2E2' },
}
// Where a newly-marked priority lands before anyone drags it. An individual task
// under a team priority starts in the band matching that team priority instead.
const DEFAULT_BAND: Band = 'medium'

// Every key the individual list groups by — the team, plus '' for the Unassigned
// group. Used to fold them all at once.
const ALL_PERSON_KEYS = [...TEAM.map(m => m.email), '']

type Bands = Record<Band, number[]>
interface PriorityOrder { team: Bands; individual: Bands }
const emptyBands = (): Bands => ({ high: [], medium: [], low: [] })
const EMPTY_ORDER: PriorityOrder = { team: emptyBands(), individual: emptyBands() }

const PRIORITY_STYLE: Record<PriorityKind, { chip: string; dot: string; label: string; short: string }> = {
  Team:       { chip: 'bg-indigo-50 text-indigo-600 border-indigo-200', dot: '#6366F1', label: 'Team',       short: 'Team' },
  Individual: { chip: 'bg-amber-50 text-amber-600 border-amber-200',    dot: '#F59E0B', label: 'Individual', short: 'Ind.' },
}

// Only these two values count as priorities. Anything else already sitting in the
// Priority column is left alone and simply doesn't rank.
function parsePriority(raw: unknown): PriorityKind | null {
  const v = String(raw ?? '').trim().toLowerCase()
  if (v === 'team') return 'Team'
  if (v === 'individual') return 'Individual'
  return null
}

interface Task {
  id: number
  parentId?: number
  name: string
  details: string
  assignee: string
  status: string
  pct: number         // 0–100
  startDate: Date | null
  dueDate: Date | null
  comments: string
  priority: PriorityKind | null
  groupName: string
  parentPath: string[]   // ancestor task names below the group header, e.g. ['August Newsletter']
  depth: number
  children: Task[]
}

// ── Data processing ───────────────────────────────────────────────────────────
function processSheet(rawRows: any[], columns: any[]): Task[] {
  const colMap: Record<string, string> = {}
  columns.forEach((c: any) => { colMap[String(c.id)] = c.title })

  function cells(row: any): Record<string, any> {
    // Row fields are now direct properties (e.g. row['Task Name']) — no cells array needed
    return row
  }

  // Step 1: build taskMap with no groupName yet
  const taskMap: Record<string, Task> = {}
  rawRows.forEach(row => {
    const c = cells(row)
    const pctRaw = parseFloat(c['% Complete'] ?? '0')
    const pct = pctRaw <= 1 ? Math.round(pctRaw * 100) : Math.round(pctRaw)
    taskMap[String(row.id)] = {
      id: row.id,
      parentId: row.parentId,
      name: c['Task Name'] || c['Details'] || '(untitled)',
      details: c['Details'] || '',
      assignee: c['Assigned To'] || '',
      status: c['Status'] || '',
      pct,
      startDate: c['Start Date'] ? (d => isNaN(d.getTime()) ? null : d)(new Date(c['Start Date'])) : null,
      dueDate: c['Required Date'] ? (d => isNaN(d.getTime()) ? null : d)(new Date(c['Required Date'])) : null,
      comments: c['Comments'] || '',
      priority: parsePriority(c['Priority']),
      groupName: '',
      parentPath: [],
      depth: 0,
      children: [],
    }
  })

  // Step 2: build tree structure
  const roots: Task[] = []
  rawRows.forEach(row => {
    const task = taskMap[String(row.id)]
    if (!task) return
    const parentKey = String(row.parentId)
    if (row.parentId && taskMap[parentKey]) {
      taskMap[parentKey].children.push(task)
      task.depth = taskMap[parentKey].depth + 1
    } else {
      roots.push(task)
    }
  })

  // Step 3: DFS from each group header to stamp groupName on all descendants
  // This is reliable because it works top-down rather than looking up parents
  const groupNames = new Set(Object.keys(GROUP_CONFIG))
  function stampGroup(task: Task, groupName: string) {
    task.groupName = groupName
    task.children.forEach(child => stampGroup(child, groupName))
  }
  function walkForGroups(tasks: Task[]) {
    tasks.forEach(task => {
      if (groupNames.has(task.name)) {
        stampGroup(task, task.name)
      } else if (!task.groupName) {
        walkForGroups(task.children)
      }
    })
  }
  walkForGroups(roots)

  // Step 4: DFS to stamp each task's ancestor chain (task names below the group
  // header). A leaf ends up knowing the parent task(s) it sits under, so the
  // flattened views can show which parent it belongs to.
  function stampParents(tasks: Task[], ancestors: string[]) {
    tasks.forEach(task => {
      task.parentPath = ancestors
      const nextAncestors = groupNames.has(task.name) ? [] : [...ancestors, task.name]
      stampParents(task.children, nextAncestors)
    })
  }
  stampParents(roots, [])

  return roots
}

// ── Priority ranking persistence (shared, server-side) ───────────────────────
// The Team/Individual flag is a Smartsheet cell, but the ranking and the team
// High/Medium/Low bands aren't expressible there, so they live in a shared config
// row (via /api/marketing/priority-order). Shared, not per-browser: when Morgan
// re-ranks the team list, Cara sees the same order.

async function loadPriorityOrder(force = false): Promise<PriorityOrder> {
  try {
    const r = await cachedGet('/api/marketing/priority-order', force ? { force: true } : {})
    const ids = (a: unknown) => (Array.isArray(a) ? a : []).map(Number).filter(Number.isFinite)
    const bands = (v: any): Bands => ({ high: ids(v?.high), medium: ids(v?.medium), low: ids(v?.low) })
    return { team: bands(r.data?.team), individual: bands(r.data?.individual) }
  } catch { return EMPTY_ORDER }
}

// One retry rides out a transient blip; a hard failure is logged and the local
// order stays on screen until the next load.
function savePriorityOrder(order: PriorityOrder) {
  const put = () => axios.put('/api/marketing/priority-order', order)
  put().catch(() => put()).catch(e => console.error('save priority order failed', e))
}

function orderSignature(o: PriorityOrder): string {
  return (['team', 'individual'] as const).map(k => BANDS.map(b => o[k][b].join(',')).join(';')).join('|')
}

// Rank a set of ids against a stored order: known ids keep their stored position,
// anything new lands at the end (in the order it was handed to us, i.e. tree order).
function rankByOrder(ids: number[], stored: number[]): number[] {
  const pos = new Map(stored.map((id, i) => [id, i]))
  return [...ids].sort((a, b) => (pos.get(a) ?? Infinity) - (pos.get(b) ?? Infinity))
}

// Fold a re-ordered on-screen list back into a band's shared order. An individual
// band spans everyone, but each person only ever sees their own slice of it, so the
// dragged block is appended as a unit and the entries that weren't on screen keep
// their relative order. Only relative position within a person's own rows is ever
// read back out (see rankByOrder), so this is lossless for what's displayed — and
// it stays correct when the block grows, which is what a cross-band drop does.
function applySubsetOrder(full: number[], visibleNewOrder: number[]): number[] {
  const visible = new Set(visibleNewOrder)
  return [...full.filter(id => !visible.has(id)), ...visibleNewOrder]
}

// Move `id` to sit immediately before `beforeId` (or at the end when null).
function moveWithin(list: number[], id: number, beforeId: number | null): number[] {
  const without = list.filter(x => x !== id)
  if (beforeId === null || beforeId === id) return [...without, id]
  const at = without.indexOf(beforeId)
  if (at === -1) return [...without, id]
  return [...without.slice(0, at), id, ...without.slice(at)]
}

// Remove an id from every band of both lists, so re-marking or completing a task
// can't leave it ranked in two places at once.
function stripId(order: PriorityOrder, id: number): PriorityOrder {
  const strip = (b: Bands): Bands => ({
    high: b.high.filter(x => x !== id),
    medium: b.medium.filter(x => x !== id),
    low: b.low.filter(x => x !== id),
  })
  return { team: strip(order.team), individual: strip(order.individual) }
}

// Put `id` into one band of one list at the drop position, having cleared it from
// everywhere else first.
function placeInBand(order: PriorityOrder, list: 'team' | 'individual', band: Band, id: number, beforeId: number | null): PriorityOrder {
  const stripped = stripId(order, id)
  return { ...stripped, [list]: { ...stripped[list], [band]: moveWithin(stripped[list][band], id, beforeId) } }
}

function flatLeaves(tasks: Task[]): Task[] {
  const out: Task[] = []
  function walk(t: Task) {
    if (t.children.length === 0) out.push(t)
    else t.children.forEach(walk)
  }
  tasks.forEach(walk)
  return out
}

function findTaskById(tasks: Task[], id: number): Task | null {
  for (const t of tasks) {
    if (t.id === id) return t
    const found = findTaskById(t.children, id)
    if (found) return found
  }
  return null
}

// Shared read-modify-write for a single field, used to make edits optimistic:
// apply immediately, then patch back to the pre-edit value if the save fails.
function patchTaskField<K extends keyof Task>(ts: Task[], id: number, field: K, value: Task[K]): Task[] {
  return ts.map(t => t.id === id ? { ...t, [field]: value } : { ...t, children: patchTaskField(t.children, id, field, value) })
}

interface TaskLocation { node: Task; parentId?: number; index: number }

function findTaskLocation(ts: Task[], id: number, parentId?: number): TaskLocation | null {
  for (let i = 0; i < ts.length; i++) {
    if (ts[i].id === id) return { node: ts[i], parentId, index: i }
    const found = findTaskLocation(ts[i].children, id, ts[i].id)
    if (found) return found
  }
  return null
}

// Puts a deleted task back at its original position — used to undo an optimistic
// delete when the server rejects it.
function reinsertTask(ts: Task[], loc: TaskLocation): Task[] {
  if (loc.parentId === undefined) {
    const result = [...ts]
    result.splice(loc.index, 0, loc.node)
    return result
  }
  return ts.map(t => t.id === loc.parentId
    ? { ...t, children: [...t.children.slice(0, loc.index), loc.node, ...t.children.slice(loc.index)] }
    : { ...t, children: reinsertTask(t.children, loc) })
}

// ── Report rule ───────────────────────────────────────────────────────────────
// A task only counts on the report when it is:
//   1. an indented leaf row — nothing indented beneath it (not a title/parent row)
//   2. not marked 100% / Complete
//   3. has something in the Details column
//   4. has BOTH a Start Date and a Required (due) Date
// This mirrors the Smartsheet view — title rows and anything missing those
// fields are excluded from every count and every report view.
const taskIsComplete = (t: Task) => t.pct === 100 || t.status === 'Complete'

function isReportable(t: Task): boolean {
  return t.children.length === 0 &&
    t.pct < 100 && t.status !== 'Complete' &&
    t.details.trim().length > 0 &&
    t.startDate != null && t.dueDate != null
}

function reportableLeaves(tasks: Task[]): Task[] {
  return flatLeaves(tasks).filter(isReportable)
}

function countStats(tasks: Task[]) {
  const active = reportableLeaves(tasks)
  const now = new Date()
  const weekEnd = new Date(now); weekEnd.setDate(now.getDate() + 7)
  let inProgress = 0, todo = 0, overdue = 0, dueToday = 0, dueThisWeek = 0
  active.forEach(t => {
    if (t.status === 'In Progress' || t.pct > 0) inProgress++
    else todo++
    if (t.dueDate && t.dueDate < now) overdue++
    if (t.dueDate && t.dueDate.toDateString() === now.toDateString()) dueToday++
    if (t.dueDate && t.dueDate >= now && t.dueDate <= weekEnd) dueThisWeek++
  })
  return { total: active.length, inProgress, todo, overdue, dueToday, dueThisWeek }
}

// ── Stat categories (clickable tiles → filtered List view) ────────────────────
type StatKey = 'dueToday' | 'dueThisWeek' | 'overdue' | 'inProgress' | 'todo' | 'total'

const STAT_LABELS: Record<StatKey, string> = {
  dueToday: 'Due Today',
  dueThisWeek: 'Due This Week',
  overdue: 'Overdue',
  inProgress: 'In Progress',
  todo: 'To Do',
  total: 'All Active Tasks',
}

// Whether a (reportable) task belongs to a given stat tile. Mirrors countStats:
// due-this-week / overdue are date buckets; in-progress / to-do split by progress.
function matchesStat(t: Task, key: StatKey, now: Date, weekEnd: Date): boolean {
  switch (key) {
    case 'dueToday':    return !!t.dueDate && t.dueDate.toDateString() === now.toDateString()
    case 'dueThisWeek': return !!t.dueDate && t.dueDate >= now && t.dueDate <= weekEnd
    case 'overdue':     return !!t.dueDate && t.dueDate < now
    case 'inProgress':  return t.status === 'In Progress' || t.pct > 0
    case 'todo':        return !(t.status === 'In Progress' || t.pct > 0)
    case 'total':       return true
  }
}

// ── Inline % editor ───────────────────────────────────────────────────────────
// Shared click-to-edit % complete control used by the Gantt / Board / List views.
// (TreeRow keeps its own inline copy, wired to the same onUpdatePct handler.)
// compact = number only (no progress bar), for space-tight rows like the Gantt.
function PctEditor({ pct, hex, onChange, compact = false }: {
  pct: number
  hex: string
  onChange: (pct: number) => void
  compact?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState(String(pct))

  const commit = () => {
    const val = Math.min(100, Math.max(0, parseInt(input) || 0))
    setEditing(false)
    if (val !== pct) onChange(val)
  }
  const openEdit = (e: React.MouseEvent) => { e.stopPropagation(); setInput(String(pct)); setEditing(true) }

  if (editing) {
    return (
      <input
        autoFocus type="number" min={0} max={100}
        value={input}
        onChange={e => setInput(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        onClick={e => e.stopPropagation()}
        className="w-12 text-xs border border-blue-300 rounded px-1 py-0.5 focus:outline-none shrink-0"
      />
    )
  }
  if (compact) {
    return (
      <span onClick={openEdit} title="Click to edit % complete"
        className="text-xs text-gray-500 hover:text-blue-500 hover:underline cursor-pointer shrink-0 w-9 text-right">
        {pct}%
      </span>
    )
  }
  return (
    <div className="flex items-center gap-2 cursor-pointer group shrink-0" onClick={openEdit} title="Click to edit % complete">
      <div className="w-14 bg-gray-100 rounded-full h-1.5">
        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: hex }} />
      </div>
      <span className="text-xs text-gray-500 group-hover:text-blue-500 group-hover:underline w-8">{pct}%</span>
    </div>
  )
}

// ── Inline date editor ────────────────────────────────────────────────────────
// Shared click-to-edit date control used by the Gantt / Board / List views.
// (TreeRow keeps its own inline copy, wired to the same onUpdateDate handler.)
function DateEditor({ date, field, overdue = false, placeholder = 'set', onChange }: {
  date: Date | null
  field: 'startDate' | 'dueDate'
  overdue?: boolean
  placeholder?: string
  onChange: (field: 'startDate' | 'dueDate', value: string) => void
}) {
  const [editing, setEditing] = useState(false)
  // Format for <input type="date"> using LOCAL (NZ) calendar day, not UTC — toISOString
  // would shift a locally-parsed midnight date back a day.
  const toDateInput = (d: Date | null) => { if (!d || isNaN(d.getTime())) return ''; const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }

  if (editing) {
    return (
      <input type="date" autoFocus defaultValue={toDateInput(date)}
        onBlur={e => { setEditing(false); if (e.target.value) onChange(field, e.target.value) }}
        onKeyDown={e => { if (e.key === 'Escape') setEditing(false) }}
        onClick={e => e.stopPropagation()}
        className="text-xs border border-blue-300 rounded px-1 py-0.5 focus:outline-none w-28" />
    )
  }
  return (
    <span onClick={e => { e.stopPropagation(); setEditing(true) }} title="Click to edit date"
      className="text-xs cursor-pointer hover:underline whitespace-nowrap"
      style={{ color: overdue ? '#ef4444' : date ? '#6b7280' : undefined }}>
      {date ? date.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }) : <span className="text-gray-300 hover:text-blue-400">{placeholder}</span>}
    </span>
  )
}

// ── Inline assignee editor ────────────────────────────────────────────────────
// Multi-select dropdown of team members (tasks can have more than one). Toggling a
// member adds/removes them; "Clear (None)" empties the cell so the task drops off
// everyone's filtered views. Used by all four views, wired to onUpdateAssignees,
// which writes the Smartsheet MULTI_CONTACT cell.
function AssigneeEditor({ assignee, onChange, align = 'left' }: {
  assignee: string
  onChange: (members: TeamMember[]) => void
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const selected = TEAM.filter(m => assignee.toLowerCase().includes(m.email.toLowerCase()))
  const label = selected.length ? selected.map(m => m.name.split(' ')[0]).join(', ') : 'Unassigned'

  const toggle = (m: TeamMember) => {
    const isSel = selected.some(s => s.email === m.email)
    onChange(isSel ? selected.filter(s => s.email !== m.email) : [...selected, m])
  }

  return (
    <span className="relative inline-flex">
      <button onClick={e => { e.stopPropagation(); setOpen(o => !o) }} title="Edit assignee"
        className={`text-xs cursor-pointer hover:underline truncate max-w-[140px] ${selected.length ? 'text-gray-500' : 'text-gray-300 italic'}`}>
        {label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={e => { e.stopPropagation(); setOpen(false) }} />
          <div className={`absolute z-30 top-full mt-1 ${align === 'right' ? 'right-0' : 'left-0'} bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-44`}
            onClick={e => e.stopPropagation()}>
            {TEAM.map(m => {
              const isSel = selected.some(s => s.email === m.email)
              return (
                <button key={m.email} onClick={() => toggle(m)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 text-left">
                  <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px] leading-none ${isSel ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-300'}`}>
                    {isSel ? '✓' : ''}
                  </span>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: m.hexColor }} />
                  <span className="truncate text-gray-700">{m.name}</span>
                </button>
              )
            })}
            {selected.length > 0 && (
              <button onClick={() => onChange([])}
                className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 border-t border-gray-100 mt-1">
                Clear (None)
              </button>
            )}
          </div>
        </>
      )}
    </span>
  )
}

// ── Inline priority editor ────────────────────────────────────────────────────
// Sits in the tree's Priority column (where the ★ used to be) and in the task
// pop-up. Writes the sheet's Priority cell, which is what puts a task into the
// Marketing Priorities lists above.
// The dropdown sets the band as well as Team/Individual, so every band is reachable
// without dragging — which also makes the whole feature usable on a phone, where
// HTML5 drag events never fire.
function PriorityEditor({ priority, band, onChange, align = 'left' }: {
  priority: PriorityKind | null
  band: Band | null
  onChange: (p: PriorityKind | null, band?: Band) => void
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const style = priority ? PRIORITY_STYLE[priority] : null

  const pick = (p: PriorityKind | null, b?: Band) => {
    setOpen(false)
    if (p !== priority || (b && b !== band)) onChange(p, b)
  }

  return (
    <span className="relative inline-flex">
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        title={priority ? `${style!.label}${band ? ` · ${BAND_STYLE[band].label}` : ''} — tap to change` : 'Set as a priority'}
        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-1 rounded border whitespace-nowrap transition-colors ${
          style ? style.chip : 'border-dashed border-gray-300 text-gray-400 hover:text-blue-500 hover:border-blue-400'
        }`}
      >
        {priority && band && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: BAND_STYLE[band].hex }} />}
        {style ? style.short : 'Set'}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={e => { e.stopPropagation(); setOpen(false) }} />
          <div className={`absolute z-30 top-full mt-1 ${align === 'right' ? 'right-0' : 'left-0'} bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-44`}
            onClick={e => e.stopPropagation()}>
            {PRIORITY_KINDS.map(k => (
              <div key={k} className="border-b border-gray-100 last:border-0 pb-1 mb-1 last:pb-0 last:mb-0">
                <p className="flex items-center gap-1.5 px-3 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PRIORITY_STYLE[k].dot }} />
                  {PRIORITY_STYLE[k].label}
                </p>
                {BANDS.map(b => {
                  const current = priority === k && band === b
                  return (
                    <button key={b} onClick={() => pick(k, b)}
                      className="w-full flex items-center gap-2 pl-6 pr-3 py-1.5 text-xs hover:bg-gray-50 text-left">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: BAND_STYLE[b].hex }} />
                      <span className={current ? 'text-gray-900 font-semibold' : 'text-gray-700'}>{BAND_STYLE[b].label}</span>
                      {current && <span className="ml-auto text-gray-400">✓</span>}
                    </button>
                  )
                })}
              </div>
            ))}
            {priority && (
              <button onClick={() => pick(null)}
                className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 border-t border-gray-100">
                Clear priority
              </button>
            )}
          </div>
        </>
      )}
    </span>
  )
}

// ── Tree View ─────────────────────────────────────────────────────────────────
function TreeRow({ task, groupCfg, assigneeFilter, bandOfTask, onSetPriority, onUpdatePct, onUpdateComments, onDelete, onAddBelow, onUpdateDate, onUpdateAssignees, onOpenDetail, depth = 0, forceOpen }: {
  task: Task
  groupCfg: typeof DEFAULT_GROUP
  assigneeFilter: string
  bandOfTask: (id: number) => Band | null
  onSetPriority: (id: number, p: PriorityKind | null, band?: Band) => void
  onUpdatePct: (id: number, pct: number) => void
  onUpdateComments: (id: number, comments: string) => void
  onDelete: (id: number) => void
  onAddBelow: (siblingId: number, name: string, parentId: number | undefined, members: TeamMember[], startDate?: string, dueDate?: string) => Promise<boolean>
  onUpdateDate: (id: number, field: 'startDate' | 'dueDate', value: string) => void
  onUpdateAssignees: (id: number, members: TeamMember[]) => void
  onOpenDetail: (id: number) => void
  depth?: number
  forceOpen?: { open: boolean; version: number } | null
}) {
  const [open, setOpen] = useState(false)
  const [editingPct, setEditingPct] = useState(false)
  const [pctInput, setPctInput] = useState(String(task.pct))
  const [showComments, setShowComments] = useState(false)
  const [commentText, setCommentText] = useState(task.comments)
  const [savingComment, setSavingComment] = useState(false)
  const [addingBelow, setAddingBelow] = useState(false)
  const [newName, setNewName] = useState('')
  const [newMembers, setNewMembers] = useState<TeamMember[]>([])
  const [newStart, setNewStart] = useState('')
  const [newDue, setNewDue] = useState('')
  const [addingLoading, setAddingLoading] = useState(false)
  const [editingStart, setEditingStart] = useState(false)
  const [editingDue, setEditingDue] = useState(false)

  // Format for <input type="date"> using LOCAL (NZ) calendar day, not UTC — toISOString
  // would shift a locally-parsed midnight date back a day.
  const toDateInput = (d: Date | null) => { if (!d || isNaN(d.getTime())) return ''; const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }

  useEffect(() => { if (forceOpen != null) setOpen(forceOpen.open) }, [forceOpen])

  const hasChildren = task.children.length > 0
  const matchesFilter = !assigneeFilter || task.assignee.toLowerCase().includes(assigneeFilter.toLowerCase())
  if (!matchesFilter && !hasChildren) return null

  const isComplete = task.pct === 100 || task.status === 'Complete'
  const isOverdue = !isComplete && task.dueDate && task.dueDate < new Date()
  const bgColor = depth === 0 ? groupCfg.border : depth === 1 ? groupCfg.light : 'white'

  const commitPct = () => {
    const val = Math.min(100, Math.max(0, parseInt(pctInput) || 0))
    setPctInput(String(val))
    setEditingPct(false)
    if (val !== task.pct) onUpdatePct(task.id, val)
  }

  const commitComment = async () => {
    setSavingComment(true)
    await onUpdateComments(task.id, commentText)
    setSavingComment(false)
  }

  const cancelAdd = () => {
    setAddingBelow(false); setNewName(''); setNewMembers([]); setNewStart(''); setNewDue('')
  }

  const submitAdd = async () => {
    if (!newName.trim()) return
    setAddingLoading(true)
    const ok = await onAddBelow(task.id, newName.trim(), task.parentId, newMembers, newStart || undefined, newDue || undefined)
    setAddingLoading(false)
    // Only clear on success — a failed save keeps the row open with what the
    // user typed so a flaky Smartsheet write doesn't just eat their input.
    if (ok) { setNewName(''); setNewMembers([]); setNewStart(''); setNewDue(''); setAddingBelow(false) }
  }

  return (
    <>
      <tr className="border-b border-gray-50 transition-colors group/row" style={{ backgroundColor: bgColor }}>
        <td style={{ paddingLeft: `${12 + depth * 18}px`, paddingRight: '8px', paddingTop: '8px', paddingBottom: '8px', borderLeft: `4px solid ${groupCfg.hex}` }}>
          <div className="flex items-center gap-2">
            {hasChildren ? (
              <button onClick={() => setOpen(o => !o)} className="shrink-0" style={{ color: groupCfg.hex }}>
                <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </button>
            ) : (
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: groupCfg.hex }} />
            )}
            <span
              onClick={e => { e.stopPropagation(); onOpenDetail(task.id) }}
              title={task.name}
              className={`text-sm truncate max-w-[200px] cursor-pointer hover:underline hover:text-blue-600 ${depth === 0 ? 'font-bold' : depth === 1 ? 'font-semibold' : 'font-normal'} ${isComplete ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
              {task.name}
            </span>
            <div className="flex items-center gap-1 ml-1 shrink-0 opacity-0 pointer-events-none group-hover/row:opacity-100 group-hover/row:pointer-events-auto transition-opacity">
              <button onClick={() => setAddingBelow(true)} title="Add task below"
                className="text-gray-300 hover:text-blue-500 text-xs leading-none">＋</button>
              {!hasChildren && (
                <button onClick={() => { if (confirm(`Delete "${task.name}"?`)) onDelete(task.id) }} title="Delete individual task"
                  className="text-gray-300 hover:text-red-500 text-xs leading-none">✕</button>
              )}
            </div>
          </div>
        </td>
        <td className="px-3 py-2 text-xs text-gray-400 max-w-[140px] truncate">{task.details}</td>
        <td className="px-3 py-2 whitespace-nowrap"><AssigneeEditor assignee={task.assignee} onChange={m => onUpdateAssignees(task.id, m)} /></td>
        <td className="px-3 py-2 text-center">
          <PriorityEditor priority={task.priority} band={bandOfTask(task.id)} onChange={(p, b) => onSetPriority(task.id, p, b)} />
        </td>
        <td className="px-3 py-2 text-xs whitespace-nowrap">
          {editingStart ? (
            <input type="date" autoFocus defaultValue={toDateInput(task.startDate)}
              onBlur={e => { setEditingStart(false); if (e.target.value) onUpdateDate(task.id, 'startDate', e.target.value) }}
              onKeyDown={e => { if (e.key === 'Escape') setEditingStart(false) }}
              className="text-xs border border-blue-300 rounded px-1 py-0.5 focus:outline-none w-28" />
          ) : (
            <span onClick={() => setEditingStart(true)} className="cursor-pointer text-gray-500 hover:text-blue-500 hover:underline">
              {task.startDate ? task.startDate.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }) : <span className="text-gray-200 hover:text-blue-300">set</span>}
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-xs whitespace-nowrap">
          {editingDue ? (
            <input type="date" autoFocus defaultValue={toDateInput(task.dueDate)}
              onBlur={e => { setEditingDue(false); if (e.target.value) onUpdateDate(task.id, 'dueDate', e.target.value) }}
              onKeyDown={e => { if (e.key === 'Escape') setEditingDue(false) }}
              className="text-xs border border-blue-300 rounded px-1 py-0.5 focus:outline-none w-28" />
          ) : (
            <span onClick={() => setEditingDue(true)} className="cursor-pointer hover:underline"
              style={{ color: isOverdue ? '#ef4444' : task.dueDate ? '#6b7280' : undefined }}>
              {task.dueDate ? task.dueDate.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }) : <span className="text-gray-200 hover:text-blue-300">set</span>}
            </span>
          )}
        </td>
        <td className="px-3 py-2">
          {!hasChildren && (
            editingPct ? (
              <input
                autoFocus type="number" min={0} max={100}
                value={pctInput}
                onChange={e => setPctInput(e.target.value)}
                onBlur={commitPct}
                onKeyDown={e => { if (e.key === 'Enter') commitPct(); if (e.key === 'Escape') setEditingPct(false) }}
                className="w-16 text-xs border border-blue-300 rounded px-1 py-0.5 focus:outline-none"
              />
            ) : (
              <div className="flex items-center gap-2 cursor-pointer group" onClick={() => { setPctInput(String(task.pct)); setEditingPct(true) }}>
                <div className="w-14 bg-gray-100 rounded-full h-1.5">
                  <div className="h-1.5 rounded-full" style={{ width: `${task.pct}%`, backgroundColor: groupCfg.hex }} />
                </div>
                <span className="text-xs text-gray-500 group-hover:text-blue-500 group-hover:underline">{task.pct}%</span>
              </div>
            )
          )}
        </td>
        <td className="px-3 py-2">
          {!hasChildren && (
            <button
              onClick={() => setShowComments(s => !s)}
              className={`text-xs px-2 py-0.5 rounded transition-colors ${showComments ? 'bg-blue-50 text-blue-600' : task.comments ? 'text-blue-400 hover:text-blue-600' : 'text-gray-300 hover:text-gray-500'}`}
            >
              {task.comments ? '💬' : '+ note'}
            </button>
          )}
        </td>
      </tr>
      {showComments && !hasChildren && (
        <tr style={{ backgroundColor: bgColor }}>
          <td colSpan={8} className="px-6 pb-3 pt-1">
            <div className="flex gap-2 items-end">
              <textarea
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                placeholder="Add a note or comment..."
                rows={2}
                className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-300 resize-none"
              />
              <button
                onClick={commitComment}
                disabled={savingComment || commentText === task.comments}
                className="px-3 py-2 text-xs bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-40"
              >
                {savingComment ? '...' : 'Save'}
              </button>
            </div>
          </td>
        </tr>
      )}
      {addingBelow && (
        <tr style={{ backgroundColor: bgColor }}>
          <td colSpan={8} style={{ paddingLeft: `${12 + depth * 18 + 20}px`, paddingRight: '12px', paddingTop: '4px', paddingBottom: '4px' }}>
            <div className="flex gap-2 items-center flex-wrap">
              <input
                autoFocus
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={async e => {
                  if (e.key === 'Enter' && newName.trim()) await submitAdd()
                  if (e.key === 'Escape') cancelAdd()
                }}
                placeholder="New task name… (Enter to save, Esc to cancel)"
                className="flex-1 min-w-[160px] text-xs border border-blue-300 rounded px-3 py-1.5 focus:outline-none focus:border-blue-500"
              />
              <AssigneeEditor assignee={newMembers.map(m => m.email).join(',')} onChange={setNewMembers} />
              <input type="date" value={newStart} onChange={e => setNewStart(e.target.value)}
                title="Start date"
                className="text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-blue-300 w-32" />
              <input type="date" value={newDue} onChange={e => setNewDue(e.target.value)}
                title="Required date"
                className="text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-blue-300 w-32" />
              <button
                onClick={submitAdd}
                disabled={addingLoading || !newName.trim()}
                className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
              >{addingLoading ? '…' : 'Add'}</button>
              <button onClick={cancelAdd} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
            </div>
          </td>
        </tr>
      )}
      {open && task.children.map(child => (
        <TreeRow key={child.id} task={child} groupCfg={groupCfg} assigneeFilter={assigneeFilter}
          bandOfTask={bandOfTask} onSetPriority={onSetPriority} onUpdatePct={onUpdatePct} onUpdateComments={onUpdateComments}
          onDelete={onDelete} onAddBelow={onAddBelow} onUpdateDate={onUpdateDate} onUpdateAssignees={onUpdateAssignees}
          onOpenDetail={onOpenDetail} depth={depth + 1} forceOpen={forceOpen} />
      ))}
    </>
  )
}

// ── Gantt View ────────────────────────────────────────────────────────────────
function GanttView({ tasks, assigneeFilter, onUpdatePct, onUpdateDate, onOpenDetail }: {
  tasks: Task[]
  assigneeFilter: string
  onUpdatePct: (id: number, pct: number) => void
  onUpdateDate: (id: number, field: 'startDate' | 'dueDate', value: string) => void
  onOpenDetail: (id: number) => void
}) {
  const today = new Date()
  const mondayOf = (d: Date) => {
    const m = new Date(d); m.setHours(0, 0, 0, 0)
    m.setDate(m.getDate() - ((m.getDay() + 6) % 7))
    return m
  }

  // Every reportable task for the current filter (each has both a start and due date).
  const leaves = flatLeaves(tasks).filter(t =>
    isReportable(t) &&
    (!assigneeFilter || t.assignee.toLowerCase().includes(assigneeFilter.toLowerCase()))
  ).sort((a, b) => a.startDate!.getTime() - b.startDate!.getTime()).slice(0, 80)

  // Timeline spans the earliest start → latest due across the list, snapped to whole weeks.
  let minStart = leaves.length ? leaves[0].startDate! : today
  let maxDue = leaves.length ? leaves[0].dueDate! : today
  for (const t of leaves) {
    if (t.startDate! < minStart) minStart = t.startDate!
    if (t.dueDate! > maxDue) maxDue = t.dueDate!
  }
  const rangeStart = mondayOf(minStart)
  const rangeEnd = new Date(mondayOf(maxDue)); rangeEnd.setDate(rangeEnd.getDate() + 7) // start of week after the last due
  const totalMs = Math.max(rangeEnd.getTime() - rangeStart.getTime(), 7 * 86400000)

  const weeks: Date[] = []
  for (let d = new Date(rangeStart); d < rangeEnd; d.setDate(d.getDate() + 7)) weeks.push(new Date(d))

  const LABEL_W = 300
  const WEEK_W = 54
  const gridW = LABEL_W + weeks.length * WEEK_W

  const pctOf = (ms: number) => ((ms - rangeStart.getTime()) / totalMs) * 100
  function barStyle(t: Task) {
    const left = Math.max(0, pctOf(t.startDate!.getTime()))
    const width = Math.max(0.6, pctOf(t.dueDate!.getTime()) - pctOf(t.startDate!.getTime()))
    return { left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }
  }
  const todayPct = pctOf(today.getTime())

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-6 py-3 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-widest text-gray-500 uppercase">
          Gantt{leaves.length ? ` — from ${rangeStart.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })} · ${weeks.length} ${weeks.length === 1 ? 'week' : 'weeks'}` : ''}
        </h2>
        <span className="text-xs text-gray-400">{leaves.length} {leaves.length === 1 ? 'task' : 'tasks'}</span>
      </div>
      {leaves.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-gray-400 text-sm">No tasks to show</div>
      ) : (
        <div className="overflow-x-auto">
          <div style={{ minWidth: `${gridW}px` }}>
            {/* Week headers */}
            <div className="flex border-b border-gray-100 sticky top-0 bg-white z-10" style={{ marginLeft: `${LABEL_W}px` }}>
              {weeks.map((d, i) => {
                const isThisWeek = mondayOf(today).getTime() === d.getTime()
                return (
                  <div key={i} className={`flex-1 text-center py-1.5 text-[10px] border-r border-gray-50 ${i % 2 ? 'bg-gray-50/60' : ''} ${isThisWeek ? 'font-bold' : 'text-gray-400'}`}
                    style={{ color: isThisWeek ? '#2563EB' : undefined }}>
                    {d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                  </div>
                )
              })}
            </div>

            {/* Tasks */}
            {leaves.map(task => {
              const group = getGroup(task.groupName)
              return (
                <div key={task.id} onClick={() => onOpenDetail(task.id)}
                  className="flex items-stretch border-b border-gray-50 hover:bg-gray-50 h-9 cursor-pointer">
                  <div className="shrink-0 flex flex-col justify-center px-2 overflow-hidden"
                    style={{ width: `${LABEL_W}px`, borderLeft: `3px solid ${group.hex}` }}>
                    <span title={task.name || task.details} className="text-[11px] text-gray-700 truncate leading-tight">{task.name || task.details}</span>
                    <div className="flex items-center gap-1 text-gray-400">
                      <DateEditor date={task.startDate} field="startDate" onChange={(f, v) => onUpdateDate(task.id, f, v)} />
                      <span className="text-gray-300">→</span>
                      <DateEditor date={task.dueDate} field="dueDate" overdue={!!(task.dueDate && task.dueDate < today && task.pct < 100)} onChange={(f, v) => onUpdateDate(task.id, f, v)} />
                      <PctEditor pct={task.pct} hex={group.hex} onChange={p => onUpdatePct(task.id, p)} compact />
                    </div>
                  </div>
                  <div className="flex-1 relative">
                    {/* Alternate-week shading */}
                    {weeks.map((_, i) => i % 2 === 1 && (
                      <div key={i} className="absolute top-0 bottom-0 bg-gray-50/60"
                        style={{ left: `${(i / weeks.length) * 100}%`, width: `${(1 / weeks.length) * 100}%` }} />
                    ))}
                    {/* Today line */}
                    {todayPct >= 0 && todayPct <= 100 && (
                      <div className="absolute top-0 bottom-0 w-0.5 bg-blue-400 z-10" style={{ left: `${todayPct}%` }} />
                    )}
                    {/* Task bar */}
                    <div className="absolute top-1.5 bottom-1.5 rounded flex items-center px-1.5 overflow-hidden"
                      style={{ ...barStyle(task), backgroundColor: group.hex + 'CC' }}>
                      {!assigneeFilter && (
                        <span className="text-[10px] text-white truncate font-medium">{task.assignee?.split(' ')[0] || ''}</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Board View ────────────────────────────────────────────────────────────────
function BoardView({ tasks, assigneeFilter, onUpdatePct, onUpdateDate, onOpenDetail }: {
  tasks: Task[]
  assigneeFilter: string
  onUpdatePct: (id: number, pct: number) => void
  onUpdateDate: (id: number, field: 'startDate' | 'dueDate', value: string) => void
  onOpenDetail: (id: number) => void
}) {
  const leaves = flatLeaves(tasks).filter(t =>
    !assigneeFilter || t.assignee.toLowerCase().includes(assigneeFilter.toLowerCase())
  )
  const now = new Date()

  const groups = Object.keys(GROUP_CONFIG).filter(g =>
    leaves.some(t => t.groupName === g && isReportable(t))
  )

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-4" style={{ minWidth: `${groups.length * 260}px` }}>
        {groups.map(groupName => {
          const group = getGroup(groupName)
          const groupTasks = leaves
            .filter(t => t.groupName === groupName && isReportable(t))
            .sort((a, b) => {
              if (!a.dueDate) return 1
              if (!b.dueDate) return -1
              return a.dueDate.getTime() - b.dueDate.getTime()
            })
            .slice(0, 10)

          return (
            <div key={groupName} className="w-60 shrink-0">
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: group.hex }} />
                <span className="text-sm font-semibold text-gray-700">{groupName}</span>
                <span className="ml-auto text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{groupTasks.length}</span>
              </div>
              <div className="space-y-2">
                {groupTasks.map(task => {
                  const isOverdue = task.dueDate && task.dueDate < now
                  return (
                    <div key={task.id} onClick={() => onOpenDetail(task.id)}
                      className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                      style={{ borderLeft: `3px solid ${group.hex}` }}>
                      {leafContext(task) && <p className="text-[10px] text-gray-400 tracking-wide truncate mb-1">{leafContext(task)}</p>}
                      <p className="text-sm text-gray-800 font-medium leading-snug mb-2 line-clamp-2">{task.name || task.details}</p>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-xs text-gray-400 truncate">{task.assignee?.split(' ')[0] || '—'}</span>
                        <PctEditor pct={task.pct} hex={group.hex} onChange={p => onUpdatePct(task.id, p)} />
                      </div>
                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-50">
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] uppercase tracking-wide text-gray-300">Start</span>
                          <DateEditor date={task.startDate} field="startDate" onChange={(f, v) => onUpdateDate(task.id, f, v)} />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] uppercase tracking-wide text-gray-300">Due</span>
                          <DateEditor date={task.dueDate} field="dueDate" overdue={!!isOverdue} onChange={(f, v) => onUpdateDate(task.id, f, v)} />
                        </div>
                      </div>
                    </div>
                  )
                })}
                {groupTasks.length === 0 && (
                  <div className="text-xs text-gray-400 text-center py-4 bg-gray-50 rounded-lg">No active tasks</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── List View ─────────────────────────────────────────────────────────────────
function ListView({ tasks, assigneeFilter, statFilter, onUpdatePct, onUpdateDate, onOpenDetail }: {
  tasks: Task[]; assigneeFilter: string; statFilter: StatKey
  onUpdatePct: (id: number, pct: number) => void
  onUpdateDate: (id: number, field: 'startDate' | 'dueDate', value: string) => void
  onOpenDetail: (id: number) => void
}) {
  const now = new Date()
  const weekEnd = new Date(now); weekEnd.setDate(now.getDate() + 7)
  const leaves = flatLeaves(tasks)
    .filter(t =>
      isReportable(t) &&
      matchesStat(t, statFilter, now, weekEnd) &&
      (!assigneeFilter || t.assignee.toLowerCase().includes(assigneeFilter.toLowerCase()))
    )
    .sort((a, b) => (a.dueDate!.getTime()) - (b.dueDate!.getTime()))
    .slice(0, 200)

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-widest text-gray-500 uppercase">{STAT_LABELS[statFilter]}</h2>
        <span className="text-xs text-gray-400">{leaves.length} {leaves.length === 1 ? 'task' : 'tasks'}</span>
      </div>
      <div className="divide-y divide-gray-50">
        {leaves.map(task => {
          const group = getGroup(task.groupName)
          const isOverdue = task.dueDate && task.dueDate < now
          return (
            <div key={task.id} onClick={() => onOpenDetail(task.id)}
              className="flex items-center gap-4 px-6 py-3 hover:bg-gray-50 cursor-pointer">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: group.hex }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 truncate">{task.name || task.details}</p>
                <p className="text-xs text-gray-400 truncate">{[leafContext(task), task.assignee || '—'].filter(Boolean).join(' · ')}</p>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <PctEditor pct={task.pct} hex={group.hex} onChange={p => onUpdatePct(task.id, p)} />
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-gray-300">Start</span>
                  <DateEditor date={task.startDate} field="startDate" onChange={(f, v) => onUpdateDate(task.id, f, v)} />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-gray-300">Due</span>
                  <DateEditor date={task.dueDate} field="dueDate" overdue={!!isOverdue} onChange={(f, v) => onUpdateDate(task.id, f, v)} />
                </div>
              </div>
            </div>
          )
        })}
        {leaves.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">No upcoming tasks</div>
        )}
      </div>
    </div>
  )
}

// ── Team filter dropdown (colour-coded, like the old pills) ───────────────────
function TeamFilterDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const selected = TEAM.find(m => m.email === value)
  const Dot = ({ m }: { m: typeof TEAM[number] }) => (
    <span className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
      style={{ backgroundColor: m.hexColor }}>{m.initials}</span>
  )

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-sm border border-gray-200 rounded-lg pl-2 pr-2.5 py-1.5 bg-white hover:bg-gray-50 min-w-[160px]">
        {selected ? (
          <>
            <Dot m={selected} />
            <span className="font-medium truncate" style={{ color: selected.hexColor }}>{selected.name}</span>
          </>
        ) : (
          <>
            <span className="w-5 h-5 rounded-full bg-gray-200 shrink-0" />
            <span className="font-medium text-gray-600">All team</span>
          </>
        )}
        <svg className={`w-4 h-4 ml-auto text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-30 py-1">
          <button onClick={() => { onChange(''); setOpen(false) }}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 ${!value ? 'bg-gray-50' : ''}`}>
            <span className="w-5 h-5 rounded-full bg-gray-200 shrink-0" />
            <span className="font-medium text-gray-700">All team</span>
          </button>
          {TEAM.map(m => (
            <button key={m.initials} onClick={() => { onChange(m.email); setOpen(false) }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 ${value === m.email ? 'bg-gray-50' : ''}`}>
              <Dot m={m} />
              <span className="font-medium truncate" style={{ color: m.hexColor }}>{m.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Task detail modal ─────────────────────────────────────────────────────────
// One consistent pop-up editor, opened by clicking a task in the Gantt / Board /
// List views. Edits every field and persists via the same handlers the tree uses.
function TaskDetailModal({ task, band, onClose, onUpdateText, onUpdateStatus, onUpdatePct, onUpdateDate, onUpdateAssignees, onUpdateComments, onSetPriority, onComplete, onDelete }: {
  task: Task
  band: Band | null
  onClose: () => void
  onUpdateText: (id: number, field: 'name' | 'details', value: string) => void
  onUpdateStatus: (id: number, status: string) => void
  onUpdatePct: (id: number, pct: number) => void
  onUpdateDate: (id: number, field: 'startDate' | 'dueDate', value: string) => void
  onUpdateAssignees: (id: number, members: TeamMember[]) => void
  onUpdateComments: (id: number, comments: string) => void
  onSetPriority: (id: number, p: PriorityKind | null, band?: Band) => void
  onComplete: (id: number) => void
  onDelete: (id: number) => void
}) {
  const group = getGroup(task.groupName)
  const [name, setName] = useState(task.name)
  const [details, setDetails] = useState(task.details)
  const [comments, setComments] = useState(task.comments)
  const [pctInput, setPctInput] = useState(String(task.pct))
  // Format for <input type="date"> using LOCAL (NZ) calendar day, not UTC — toISOString
  // would shift a locally-parsed midnight date back a day.
  const toDateInput = (d: Date | null) => { if (!d || isNaN(d.getTime())) return ''; const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }

  const commitPct = () => {
    const val = Math.min(100, Math.max(0, parseInt(pctInput) || 0))
    setPctInput(String(val))
    if (val !== task.pct) onUpdatePct(task.id, val)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const inputCls = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400'
  const labelCls = 'block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        style={{ borderTop: `4px solid ${group.hex}` }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-gray-100">
          <div className="flex-1 min-w-0">
            {leafContext(task) && <p className="text-[11px] text-gray-400 tracking-wide truncate">{leafContext(task)}</p>}
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: group.hex }}>{task.groupName || 'Task'}</p>
          </div>
          <PriorityEditor priority={task.priority} band={band} onChange={(p, b) => onSetPriority(task.id, p, b)} align="right" />
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none">✕</button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className={labelCls}>Task</label>
            <input value={name} onChange={e => setName(e.target.value)} onBlur={() => { if (name !== task.name) onUpdateText(task.id, 'name', name) }}
              className={`${inputCls} font-medium`} />
          </div>
          <div>
            <label className={labelCls}>Details</label>
            <textarea value={details} onChange={e => setDetails(e.target.value)} onBlur={() => { if (details !== task.details) onUpdateText(task.id, 'details', details) }}
              rows={2} className={`${inputCls} resize-none`} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Assigned to</label>
              <div className="text-sm border border-gray-200 rounded-lg px-3 py-2 min-h-[38px] flex items-center">
                <AssigneeEditor assignee={task.assignee} onChange={m => onUpdateAssignees(task.id, m)} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select value={task.status || 'Not Started'} onChange={e => onUpdateStatus(task.id, e.target.value)} className={inputCls}>
                <option>Not Started</option>
                <option>In Progress</option>
                <option>Complete</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Start date</label>
              <input type="date" value={toDateInput(task.startDate)}
                onChange={e => { if (e.target.value) onUpdateDate(task.id, 'startDate', e.target.value) }} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Due date</label>
              <input type="date" value={toDateInput(task.dueDate)}
                onChange={e => { if (e.target.value) onUpdateDate(task.id, 'dueDate', e.target.value) }} className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Progress — {task.pct}%</label>
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-gray-100 rounded-full h-2">
                <div className="h-2 rounded-full" style={{ width: `${task.pct}%`, backgroundColor: group.hex }} />
              </div>
              <input type="number" min={0} max={100} value={pctInput}
                onChange={e => setPctInput(e.target.value)} onBlur={commitPct}
                onKeyDown={e => { if (e.key === 'Enter') commitPct() }}
                className="w-16 text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-400" />
            </div>
          </div>

          <div>
            <label className={labelCls}>Notes</label>
            <textarea value={comments} onChange={e => setComments(e.target.value)} onBlur={() => { if (comments !== task.comments) onUpdateComments(task.id, comments) }}
              rows={2} placeholder="Add a note or comment…" className={`${inputCls} resize-none`} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={() => { onComplete(task.id); onClose() }}
            className="px-4 py-2 text-sm font-medium rounded-lg" style={{ backgroundColor: group.hex + '22', color: group.hex }}>
            Mark Complete
          </button>
          <button onClick={() => { if (confirm(`Delete "${task.name}"?`)) { onDelete(task.id); onClose() } }}
            className="px-3 py-2 text-sm text-red-500 hover:bg-red-50 rounded-lg">Delete</button>
          <button onClick={onClose} className="ml-auto px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-700">Done</button>
        </div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
interface MarketingPlanInnerProps {
  defaultAssignee?: string
}

function MarketingPlanInner({ defaultAssignee }: MarketingPlanInnerProps) {
  const [rawData, setRawData] = useState<{ rows: any[]; columns: any[] } | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'tree' | 'gantt' | 'board' | 'list'>('tree')
  const [statFilter, setStatFilter] = useState<StatKey>('total')
  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [treeSearch, setTreeSearch] = useState('')
  const [detailTaskId, setDetailTaskId] = useState<number | null>(null)

  // On mount, apply the default assignee filter if provided and filter is still empty
  useEffect(() => {
    if (defaultAssignee && assigneeFilter === '') {
      setAssigneeFilter(defaultAssignee)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultAssignee])
  const [forceOpen, setForceOpen] = useState<{ open: boolean; version: number } | null>(null)
  // Typing in the tree search expands everything so matches deep in the tree show.
  useEffect(() => {
    if (treeSearch.trim()) setForceOpen(prev => ({ open: true, version: (prev?.version ?? 0) + 1 }))
  }, [treeSearch])
  const [showNewTask, setShowNewTask] = useState(false)
  const [newTaskName, setNewTaskName] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [loadMsg, setLoadMsg] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)

  // Surfaces a failed write instead of letting it fail silently — otherwise the row
  // still shows the edit locally even though Smartsheet never got it, and it reverts
  // next time anyone reloads (reads as "my change got lost/overwritten").
  const flagSaveError = useCallback((label: string, e?: any) => {
    // Smartsheet's own error body is a flat { errorCode, message, refId } object
    // (surfaced by the backend as `detail`) — show it instead of a generic
    // "may be busy" guess whenever it's actually available.
    const detail = e?.response?.data?.detail
    const smartsheetMsg = detail?.message || (typeof detail === 'string' ? detail : null)
    setSaveError(smartsheetMsg
      ? `Failed to save "${label}" — ${smartsheetMsg}`
      : `Failed to save "${label}" — Smartsheet may be busy. Try again in a moment.`)
  }, [])
  // Shared drag order + team bands for the priority lists.
  const [order, setOrder] = useState<PriorityOrder>(EMPTY_ORDER)
  // Ids that were starred under the old ★ feature and haven't been given a
  // Team/Individual value yet — drives the one-click migration banner.
  const [legacyStarred, setLegacyStarred] = useState<number[]>([])
  // When this client last re-ranked. The poll skips a round right after a local
  // change so it can't stomp a drag before its save has landed.
  const lastLocalOrderChange = useRef(0)

  // ── Priority model ──────────────────────────────────────────────────────────
  // One walk of the tree resolves everything the two lists need: which band each
  // priority sits in, and — for individual priorities — the band of the nearest team
  // priority above them in the tree, which is the colour they show (null = blank,
  // which is the normal case for the Tasks group since it's never ranked by the team).
  const model = useMemo(() => {
    const bandOf = new Map<number, Band>()
    for (const list of ['team', 'individual'] as const) {
      for (const b of BANDS) for (const id of order[list][b]) bandOf.set(id, b)
    }

    const team: Record<Band, Task[]> = { high: [], medium: [], low: [] }
    const individual: { task: Task; band: Band; teamBand: Band | null }[] = []
    const teamBandOfTask = new Map<number, Band | null>()

    function walk(ts: Task[], inherited: Band | null) {
      for (const t of ts) {
        let nextInherited = inherited
        if (t.priority === 'Team') {
          const band = bandOf.get(t.id) ?? DEFAULT_BAND
          nextInherited = band
          if (!taskIsComplete(t)) team[band].push(t)
        } else if (t.priority === 'Individual' && !taskIsComplete(t)) {
          individual.push({ task: t, band: bandOf.get(t.id) ?? inherited ?? DEFAULT_BAND, teamBand: inherited })
        }
        teamBandOfTask.set(t.id, inherited)
        walk(t.children, nextInherited)
      }
    }
    walk(tasks, null)

    // Rank each band by the stored order; anything not yet ranked falls to the end.
    const rankBand = (rows: Task[], stored: number[]) => {
      const byId = new Map(rows.map(t => [t.id, t]))
      return rankByOrder(rows.map(t => t.id), stored).map(id => byId.get(id)!).filter(Boolean)
    }
    const teamByBand = {} as Record<Band, Task[]>
    for (const b of BANDS) teamByBand[b] = rankBand(team[b], order.team[b])

    // Individual priorities: grouped by person, then by band. A task assigned to two
    // people appears in both their lists, in the same band. The trailing group holds
    // anything marked Individual but assigned to nobody on the team — otherwise those
    // tasks would be counted and never shown.
    const groupFor = (matches: (r: typeof individual[number]) => boolean) => {
      const mine = individual.filter(matches)
      const bands = {} as Record<Band, typeof individual>
      for (const b of BANDS) {
        const rows = mine.filter(r => r.band === b)
        const ordered = rankByOrder(rows.map(r => r.task.id), order.individual[b])
        bands[b] = ordered.map(id => rows.find(r => r.task.id === id)!).filter(Boolean)
      }
      return { bands, count: mine.length }
    }
    const individualByPerson = [
      ...TEAM.map(member => ({ member, ...groupFor(r => r.task.assignee.toLowerCase().includes(member.email)) })),
      {
        member: { email: '', name: 'Unassigned', initials: '?', color: 'bg-gray-400' } as unknown as TeamMember,
        ...groupFor(r => !TEAM.some(m => r.task.assignee.toLowerCase().includes(m.email))),
      },
    ]

    return {
      teamByBand,
      individualByPerson,
      teamBandOfTask,
      bandOf,
      teamCount: BANDS.reduce((n, b) => n + teamByBand[b].length, 0),
      individualCount: individual.length,
    }
  }, [tasks, order])

  // What band a task is ranked in, for the tree's Priority dropdown. Falls back the
  // same way the lists do, so the dropdown always shows the band you can see.
  const bandOfTask = useCallback((id: number): Band | null => {
    const t = findTaskById(tasks, id)
    if (!t?.priority) return null
    return model.bandOf.get(id)
      ?? (t.priority === 'Individual' ? model.teamBandOfTask.get(id) ?? DEFAULT_BAND : DEFAULT_BAND)
  }, [tasks, model])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadMsg('step1')
    await new Promise(r => setTimeout(r, 50))
    setLoadMsg('step2-calling-api')
    try {
      const r = await cachedGet('/api/smartsheet', { timeout: 25000 })
      setLoadMsg('step3-processing')
      setRawData(r.data)
      const processed = processSheet(r.data.rows || [], r.data.columns || [])
      setLoadMsg('step4-priorities')
      setOrder(await loadPriorityOrder())
      setTasks(processed)
      // Old ★ list, kept only so its tasks can be converted to Individual priorities.
      try {
        const f = await cachedGet('/api/marketing/focus-tasks')
        const ids = (f.data?.ids || []).map(Number).filter((n: number) => Number.isFinite(n))
        // Any row could be starred, not just leaves, so walk the whole tree.
        const unset = new Set<number>()
        ;(function walk(ts: Task[]) { for (const t of ts) { if (!t.priority) unset.add(t.id); walk(t.children) } })(processed)
        setLegacyStarred(ids.filter((id: number) => unset.has(id)))
      } catch { setLegacyStarred([]) }
    } catch (e: any) {
      setLoadMsg('ERROR: ' + (e?.message || 'unknown'))
      setLoadError(true)
    } finally {
      setLoading(false)
      setLoadMsg('')
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Light polling so a re-rank shows up for everyone without a manual refresh: if
  // Morgan re-orders the team list, Cara's view picks it up within ~20s. (The
  // Team/Individual flags themselves are sheet cells and arrive on load/Refresh,
  // same as every other column.)
  useEffect(() => {
    const id = setInterval(async () => {
      if (document.hidden) return                                  // don't poll a background tab
      if (Date.now() - lastLocalOrderChange.current < 8000) return // let a local drag's save settle first
      const next = await loadPriorityOrder(true)                   // force: live, past the read cache
      setOrder(prev => orderSignature(prev) === orderSignature(next) ? prev : next)
    }, 20000)
    return () => clearInterval(id)
  }, [])

  // Persist a new ranking and remember when, so the poll doesn't race it.
  const commitOrder = useCallback((next: PriorityOrder) => {
    lastLocalOrderChange.current = Date.now()
    setOrder(next)
    savePriorityOrder(next)
  }, [])

  // Writes the sheet's Priority cell, optimistically and reverting on failure like
  // every other edit here. Ranking is handled separately, because a drag decides the
  // position itself and mustn't be overwritten by a default placement.
  const writePriorityCell = useCallback(async (id: number, next: PriorityKind | null) => {
    const prevPriority = findTaskById(tasks, id)?.priority ?? null
    if (prevPriority === next) return
    setTasks(cur => patchTaskField(cur, id, 'priority', next))
    if (!rawData) return
    const col = rawData.columns.find((c: any) => c.title === 'Priority')
    if (!col) { flagSaveError('Priority'); return }
    try {
      await axios.put('/api/smartsheet/rows', [{ id, cells: [{ columnId: col.id, value: next ?? '' }] }])
    } catch (e) {
      console.error(e); flagSaveError('Priority', e)
      setTasks(cur => patchTaskField(cur, id, 'priority', prevPriority))
    }
  }, [tasks, rawData, flagSaveError])

  // Mark / unmark a task from the tree column or the task pop-up: sets the cell and
  // slots it into — or drops it out of — the shared ranking. Both lists are banded,
  // so a newly-marked task needs a band: team priorities start in Medium, individual
  // ones in the band of the team priority they sit under (Medium when there is none).
  const setPriority = useCallback((id: number, next: PriorityKind | null, band?: Band) => {
    if (next === 'Team') {
      commitOrder(placeInBand(order, 'team', band ?? DEFAULT_BAND, id, null))
    } else if (next === 'Individual') {
      commitOrder(placeInBand(order, 'individual', band ?? model.teamBandOfTask.get(id) ?? DEFAULT_BAND, id, null))
    } else {
      commitOrder(stripId(order, id))
    }
    writePriorityCell(id, next)
  }, [order, model, commitOrder, writePriorityCell])

  // One-time conversion of the old ★ list into Individual priorities, in one batch
  // write, then the old list is emptied so the banner doesn't come back.
  const [migrating, setMigrating] = useState(false)
  const migrateStars = useCallback(async () => {
    if (!rawData || !legacyStarred.length) return
    const col = rawData.columns.find((c: any) => c.title === 'Priority')
    if (!col) { flagSaveError('Priority'); return }
    setMigrating(true)
    try {
      await axios.put('/api/smartsheet/rows', legacyStarred.map(id => ({ id, cells: [{ columnId: col.id, value: 'Individual' }] })))
      setTasks(cur => legacyStarred.reduce((acc, id) => patchTaskField(acc, id, 'priority', 'Individual'), cur))
      commitOrder(legacyStarred.reduce((acc, id) => stripId(acc, id), order))
      axios.put('/api/marketing/focus-tasks', { ids: [] }).catch(e => console.error('clear old focus list failed', e))
      setLegacyStarred([])
    } catch (e) {
      console.error(e); flagSaveError('Convert starred tasks', e)
    } finally {
      setMigrating(false)
    }
  }, [rawData, legacyStarred, order, commitOrder, flagSaveError])

  const completeTask = useCallback(async (id: number) => {
    const prev = findTaskById(tasks, id)
    const prevPct = prev?.pct
    const prevPriority = prev?.priority ?? null

    // Completing clears the Priority cell too, so a done task drops out of the
    // priority lists rather than sitting there ticked off.
    function apply(ts: Task[]): Task[] {
      return ts.map(t => t.id === id ? { ...t, pct: 100, priority: null } : { ...t, children: apply(t.children) })
    }
    setTasks(cur => apply(cur))
    if (prevPriority) commitOrder(stripId(order, id))

    if (!rawData) return
    const pctCol = rawData.columns.find((c: any) => c.title === '% Complete')
    const priorityCol = rawData.columns.find((c: any) => c.title === 'Priority')
    const cells: any[] = []
    if (pctCol) cells.push({ columnId: pctCol.id, value: 1 })
    if (priorityCol) cells.push({ columnId: priorityCol.id, value: '' })
    if (!cells.length) return
    try {
      await axios.put('/api/smartsheet/rows', [{ id, cells }])
    } catch (e) {
      console.error(e); flagSaveError('Complete task', e)
      if (prevPct === undefined) return
      function revert(ts: Task[]): Task[] {
        return ts.map(t => t.id === id ? { ...t, pct: prevPct!, priority: prevPriority } : { ...t, children: revert(t.children) })
      }
      setTasks(cur => revert(cur))
    }
  }, [tasks, rawData, order, commitOrder, flagSaveError])

  const updateTaskPct = useCallback(async (id: number, pct: number) => {
    if (!rawData) return
    const prevPct = findTaskById(tasks, id)?.pct
    setTasks(prev => patchTaskField(prev, id, 'pct', pct))
    const pctCol = rawData.columns.find((c: any) => c.title === '% Complete')
    if (!pctCol) return
    try {
      await axios.put('/api/smartsheet/rows', [{ id, cells: [{ columnId: pctCol.id, value: pct / 100 }] }])
    } catch (e) {
      console.error(e); flagSaveError('% Complete', e)
      if (prevPct !== undefined) setTasks(prev => patchTaskField(prev, id, 'pct', prevPct))
    }
  }, [rawData, tasks, flagSaveError])

  const updateTaskComments = useCallback(async (id: number, comments: string) => {
    if (!rawData) return
    const prevComments = findTaskById(tasks, id)?.comments
    setTasks(prev => patchTaskField(prev, id, 'comments', comments))
    const col = rawData.columns.find((c: any) => c.title === 'Comments')
    if (!col) return
    try {
      await axios.put('/api/smartsheet/rows', [{ id, cells: [{ columnId: col.id, value: comments }] }])
    } catch (e) {
      console.error(e); flagSaveError('Comment', e)
      if (prevComments !== undefined) setTasks(prev => patchTaskField(prev, id, 'comments', prevComments))
    }
  }, [rawData, tasks, flagSaveError])

  const updateTaskDate = useCallback(async (id: number, field: 'startDate' | 'dueDate', value: string) => {
    if (!rawData) return
    const newDate = new Date(value + 'T00:00:00')
    const task = findTaskById(tasks, id)

    // Keep start <= due. Moving the start drags the due with it when they were on
    // the same day, or whenever the new start would land after the due. Moving the
    // due below the start pulls the start back. The sibling always snaps to the
    // same day as the edited date, so it uses the same `value` string.
    let moveOther: 'startDate' | 'dueDate' | null = null
    if (task) {
      if (field === 'startDate') {
        const sameDay = task.startDate && task.dueDate && task.startDate.toDateString() === task.dueDate.toDateString()
        if (sameDay || (task.dueDate && newDate > task.dueDate)) moveOther = 'dueDate'
      } else {
        if (task.startDate && newDate < task.startDate) moveOther = 'startDate'
      }
    }

    const prevStart = task?.startDate ?? null
    const prevDue = task?.dueDate ?? null

    function apply(ts: Task[]): Task[] {
      return ts.map(t => {
        if (t.id !== id) return { ...t, children: apply(t.children) }
        return { ...t, [field]: newDate, ...(moveOther ? { [moveOther]: newDate } : {}) }
      })
    }
    setTasks(prev => apply(prev))

    const colFor = (f: 'startDate' | 'dueDate') =>
      rawData.columns.find((c: any) => c.title === (f === 'startDate' ? 'Start Date' : 'Required Date'))
    const cells: any[] = []
    const changedCol = colFor(field)
    if (changedCol) cells.push({ columnId: changedCol.id, objectValue: { objectType: 'DATE', value } })
    if (moveOther) {
      const otherCol = colFor(moveOther)
      if (otherCol) cells.push({ columnId: otherCol.id, objectValue: { objectType: 'DATE', value } })
    }
    if (!cells.length) return
    try {
      await axios.put('/api/smartsheet/rows', [{ id, cells }])
    } catch (e) {
      console.error(e); flagSaveError(field === 'startDate' ? 'Start date' : 'Due date', e)
      function revert(ts: Task[]): Task[] {
        return ts.map(t => t.id === id ? { ...t, startDate: prevStart, dueDate: prevDue } : { ...t, children: revert(t.children) })
      }
      setTasks(prev => revert(prev))
    }
  }, [rawData, tasks, flagSaveError])

  const updateTaskAssignees = useCallback(async (id: number, members: TeamMember[]) => {
    // Optimistic local update first so the dropdown reflects toggles instantly and
    // rapid multi-selects build on fresh state (the write below is fire-and-forget).
    const prevAssignee = findTaskById(tasks, id)?.assignee
    const newAssignee = members.map(m => m.name).join(', ')
    setTasks(prev => patchTaskField(prev, id, 'assignee', newAssignee))
    if (!rawData) return
    const col = rawData.columns.find((c: any) => c.title === 'Assigned To')
    if (!col) return
    const cell = members.length
      ? { columnId: col.id, objectValue: { objectType: 'MULTI_CONTACT', values: members.map(m => ({ objectType: 'CONTACT', email: m.fullEmail, name: m.name })) } }
      : { columnId: col.id, value: null }
    try {
      await axios.put('/api/smartsheet/rows', [{ id, cells: [cell] }])
    } catch (e) {
      console.error(e); flagSaveError('Assignee', e)
      if (prevAssignee !== undefined) setTasks(prev => patchTaskField(prev, id, 'assignee', prevAssignee))
    }
  }, [rawData, tasks, flagSaveError])

  const updateTaskText = useCallback(async (id: number, field: 'name' | 'details', value: string) => {
    if (!rawData) return
    const prevValue = findTaskById(tasks, id)?.[field]
    setTasks(prev => patchTaskField(prev, id, field, value))
    const col = rawData.columns.find((c: any) => c.title === (field === 'name' ? 'Task Name' : 'Details'))
    if (!col) return
    try {
      await axios.put('/api/smartsheet/rows', [{ id, cells: [{ columnId: col.id, value }] }])
    } catch (e) {
      console.error(e); flagSaveError(field === 'name' ? 'Task name' : 'Details', e)
      if (prevValue !== undefined) setTasks(prev => patchTaskField(prev, id, field, prevValue))
    }
  }, [rawData, tasks, flagSaveError])

  const updateTaskStatus = useCallback(async (id: number, status: string) => {
    if (!rawData) return
    const prevStatus = findTaskById(tasks, id)?.status
    setTasks(prev => patchTaskField(prev, id, 'status', status))
    const col = rawData.columns.find((c: any) => c.title === 'Status')
    if (!col) return
    try {
      await axios.put('/api/smartsheet/rows', [{ id, cells: [{ columnId: col.id, value: status || null }] }])
    } catch (e) {
      console.error(e); flagSaveError('Status', e)
      if (prevStatus !== undefined) setTasks(prev => patchTaskField(prev, id, 'status', prevStatus))
    }
  }, [rawData, tasks, flagSaveError])

  const deleteTask = useCallback(async (id: number) => {
    const loc = findTaskLocation(tasks, id)
    function remove(ts: Task[]): Task[] {
      return ts.filter(t => t.id !== id).map(t => ({ ...t, children: remove(t.children) }))
    }
    setTasks(prev => remove(prev))
    try {
      await axios.delete(`/api/smartsheet/rows?ids=${id}`)
    } catch (e) {
      console.error(e); flagSaveError('Delete task', e)
      if (loc) setTasks(prev => reinsertTask(prev, loc))
    }
  }, [tasks, flagSaveError])

  const addTaskBelow = useCallback(async (
    siblingId: number, name: string, parentId?: number,
    members: TeamMember[] = [], startDate?: string, dueDate?: string
  ): Promise<boolean> => {
    if (!rawData) return false
    const taskNameCol = rawData.columns.find((c: any) => c.title === 'Task Name')
    if (!taskNameCol) return false
    const assignedCol = rawData.columns.find((c: any) => c.title === 'Assigned To')
    const startCol = rawData.columns.find((c: any) => c.title === 'Start Date')
    const dueCol = rawData.columns.find((c: any) => c.title === 'Required Date')

    const cells: any[] = [{ columnId: taskNameCol.id, value: name }]
    if (members.length && assignedCol) {
      cells.push({ columnId: assignedCol.id, objectValue: { objectType: 'MULTI_CONTACT', values: members.map(m => ({ objectType: 'CONTACT', email: m.fullEmail, name: m.name })) } })
    }
    if (startDate && startCol) cells.push({ columnId: startCol.id, objectValue: { objectType: 'DATE', value: startDate } })
    if (dueDate && dueCol) cells.push({ columnId: dueCol.id, objectValue: { objectType: 'DATE', value: dueDate } })

    try {
      // siblingId alone already places the new row directly below it (and inherits
      // its parent) — Smartsheet rejects the request outright if parentId is sent
      // alongside siblingId, since they're two conflicting location specifiers.
      // parentId is still tracked locally (below) for the in-memory tree structure.
      const body: any = { siblingId, cells }
      // Smartsheet's Add Rows endpoint requires an array of row objects, same as
      // every PUT (update) call in this file already sends — a bare object here
      // was silently rejected by Smartsheet with a 400, which is why adding a
      // task always failed (surfaced now via flagSaveError instead of swallowed).
      const r = await axios.post('/api/smartsheet/rows', [body])
      const newRow = r.data.result?.[0] || r.data.result
      if (!newRow) { flagSaveError('Add task'); return false }

      const newTask: Task = {
        id: newRow.id, parentId, name,
        details: '', assignee: members.map(m => m.name).join(', '), status: '', pct: 0,
        startDate: startDate ? new Date(startDate + 'T00:00:00') : null,
        dueDate: dueDate ? new Date(dueDate + 'T00:00:00') : null,
        comments: '', priority: null, groupName: '', parentPath: [], depth: 0, children: []
      }
      function insertAfter(ts: Task[]): Task[] {
        const idx = ts.findIndex(t => t.id === siblingId)
        if (idx !== -1) {
          const result = [...ts]
          result.splice(idx + 1, 0, newTask)
          return result
        }
        return ts.map(t => ({ ...t, children: insertAfter(t.children) }))
      }
      setTasks(prev => insertAfter(prev))
      return true
    } catch (e) {
      console.error(e); flagSaveError('Add task', e)
      return false
    }
  }, [rawData, flagSaveError])

  const addTask = async () => {
    if (!newTaskName.trim() || !rawData) return
    setSaving(true)
    try {
      const taskNameCol = rawData.columns.find((c: any) => c.title === 'Task Name')
      const assignedCol = rawData.columns.find((c: any) => c.title === 'Assigned To')
      const rocky = TEAM.find(m => m.name === 'Alex Chen')
      if (taskNameCol) {
        // Add Rows requires an array of row objects; a bare object was silently
        // rejected by Smartsheet (400), and the plain-string assignee value below
        // was also the wrong cell format (contact columns need MULTI_CONTACT).
        await axios.post('/api/smartsheet/rows', [{
          toBottom: true,
          cells: [
            { columnId: taskNameCol.id, value: newTaskName },
            ...(assignedCol && rocky ? [{ columnId: assignedCol.id, objectValue: { objectType: 'MULTI_CONTACT', values: [{ objectType: 'CONTACT', email: rocky.fullEmail, name: rocky.name }] } }] : [])
          ]
        }])
        setNewTaskName(''); setShowNewTask(false); load()
      }
    } catch (e) { console.error(e); flagSaveError('New task', e) }
    finally { setSaving(false) }
  }

  // Count from real leaves that match the person filter — mirrors ListView exactly.
  // (Pruning the tree instead would promote childless-after-filter parent rows to
  // leaves, over-counting rows the list can't show — e.g. a parent assigned to two
  // people whose sub-rows belong to only one of them.)
  const statTasks = assigneeFilter
    ? flatLeaves(tasks).filter(t => t.assignee.toLowerCase().includes(assigneeFilter.toLowerCase()))
    : tasks
  const stats = countStats(statTasks)


  // ── Priority drag & drop ────────────────────────────────────────────────────
  // Native HTML5 drag, no extra dependency. `drag` holds what's moving and where it
  // came from; dropping on a row inserts above it, dropping on a list's tail area
  // appends. Dragging a team priority between bands re-bands it; dragging across the
  // Team/Individual divide re-marks it (which writes the sheet cell).
  const [drag, setDrag] = useState<{ id: number; from: 'team' | 'individual' } | null>(null)
  const [dropHint, setDropHint] = useState<string | null>(null)

  // A drop does two things at most: move the task within the shared ranking, and —
  // if it crossed between the Team and Individual lists — re-mark it, which writes
  // the sheet's Priority cell. `visibleIds` is the band's on-screen rows, which for
  // an individual band is only one person's slice of it: the moved ids are written
  // back into the slots they already held so nobody else's ranking shifts.
  const dropOn = useCallback((list: 'team' | 'individual', band: Band, beforeId: number | null, visibleIds: number[], ownerEmail?: string) => {
    if (!drag) return
    const { id, from } = drag
    setDrag(null)
    setDropHint(null)

    // Whose individual list a task appears in is decided by its assignee, so a drop
    // into someone else's table would silently bounce back. Refuse it instead — the
    // way to hand a task over is to reassign it.
    if (ownerEmail !== undefined) {
      const t = findTaskById(tasks, id)
      const assigned = ownerEmail
        ? !!t && t.assignee.toLowerCase().includes(ownerEmail)
        : !!t && !TEAM.some(m => t.assignee.toLowerCase().includes(m.email))
      if (!assigned) {
        flagSaveError('Move priority — reassign the task first, it can only sit in its own assignee’s list')
        return
      }
    }

    const stripped = stripId(order, id)
    const nextVisible = moveWithin(visibleIds.includes(id) ? visibleIds : [...visibleIds, id], id, beforeId)
    commitOrder({
      ...stripped,
      [list]: { ...stripped[list], [band]: applySubsetOrder(stripped[list][band], nextVisible) },
    })

    if (from !== list) writePriorityCell(id, list === 'team' ? 'Team' : 'Individual')
  }, [drag, tasks, order, commitOrder, writePriorityCell, flagSaveError])

  // The rows a given band is currently showing, resolved from the model rather than
  // serialised into the DOM — the pointer drag only needs to know list/band/owner to
  // find them again.
  const visibleIdsFor = useCallback((list: 'team' | 'individual', band: Band, owner?: string): number[] => {
    if (list === 'team') return model.teamByBand[band].map(t => t.id)
    const group = model.individualByPerson.find(p => p.member.email === (owner ?? ''))
    return group ? group.bands[band].map(r => r.task.id) : []
  }, [model])

  // ── Dragging, via Pointer Events ────────────────────────────────────────────
  // Deliberately not HTML5 drag-and-drop: those events never fire on touch, so the
  // whole feature was dead on a phone. Pointer events cover mouse, touch and pen
  // through one path. Drops are resolved by hit-testing what's under the pointer
  // (elementFromPoint + data-drop-* attributes) because pointer events, unlike drag
  // events, don't target what you're hovering — they stay with the element you
  // pressed.
  const dragState = useRef<{ id: number; from: 'team' | 'individual'; moved: boolean; x: number; y: number } | null>(null)

  const resolveDropAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    const zone = el?.closest('[data-drop-band]') as HTMLElement | null
    if (!zone) return null
    const list = zone.dataset.dropList as 'team' | 'individual'
    const band = zone.dataset.dropBand as Band
    const owner = list === 'individual' ? (zone.dataset.dropOwner ?? '') : undefined
    const rowEl = el?.closest('[data-drop-id]') as HTMLElement | null
    // Past the vertical middle of a row means "after it", i.e. before the next one.
    let beforeId: number | null = null
    if (rowEl) {
      const rect = rowEl.getBoundingClientRect()
      const id = Number(rowEl.dataset.dropId)
      if (y < rect.top + rect.height / 2) beforeId = id
      else {
        const ids = visibleIdsFor(list, band, owner)
        const at = ids.indexOf(id)
        beforeId = at >= 0 && at + 1 < ids.length ? ids[at + 1] : null
      }
    }
    const key = `${list}-${owner ?? ''}-${band}-${beforeId ?? 'end'}`
    return { list, band, owner, beforeId, key }
  }

  useEffect(() => {
    if (!drag) return

    const onMove = (e: PointerEvent) => {
      const st = dragState.current
      if (!st) return
      if (!st.moved && Math.abs(e.clientY - st.y) < 4 && Math.abs(e.clientX - st.x) < 4) return
      st.moved = true
      e.preventDefault()
      const hit = resolveDropAt(e.clientX, e.clientY)
      setDropHint(hit?.key ?? null)
      // Nudge the page when dragging near an edge, so long lists stay reachable on a
      // phone where there's no room to see both ends at once.
      const margin = 64
      if (e.clientY < margin) window.scrollBy({ top: -12 })
      else if (e.clientY > window.innerHeight - margin) window.scrollBy({ top: 12 })
    }

    const onUp = (e: PointerEvent) => {
      const st = dragState.current
      dragState.current = null
      setDrag(null)
      setDropHint(null)
      if (!st?.moved) return                       // a tap, not a drag
      const hit = resolveDropAt(e.clientX, e.clientY)
      if (!hit) return                             // dropped outside any band: no-op
      dropOn(hit.list, hit.band, hit.beforeId, visibleIdsFor(hit.list, hit.band, hit.owner), hit.owner)
    }

    const onCancel = () => { dragState.current = null; setDrag(null); setDropHint(null) }

    // passive:false so preventDefault can stop the page scrolling under the finger.
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }, [drag, dropOn, visibleIdsFor])

  // Spread onto a row's grab handle. touch-action:none is what stops the browser
  // treating the gesture as a scroll before we see it.
  const handleProps = (id: number, from: 'team' | 'individual', extra = '') => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      dragState.current = { id, from, moved: false, x: e.clientX, y: e.clientY }
      setDrag({ id, from })
    },
    onClick: (e: React.MouseEvent) => e.stopPropagation(),   // grabbing isn't opening
    style: { touchAction: 'none' as const },
    title: 'Drag to re-rank',
    className: `cursor-grab active:cursor-grabbing select-none ${extra}`,
  })

  // Highlight key for the insertion point, matching what resolveDropAt computes.
  const hintKey = (list: 'team' | 'individual', owner: string, band: Band, beforeId: number | null) =>
    `${list}-${owner}-${band}-${beforeId ?? 'end'}`

  // Keyboard/tap equivalent of a drag — HTML5 drag events never fire on touch, so
  // these buttons are the only way to re-rank on a phone (and the quickest way for
  // anyone who'd rather not drag). Moving past the end of a band is a no-op; use the
  // Priority dropdown to change band.
  const nudge = useCallback((list: 'team' | 'individual', band: Band, id: number, dir: -1 | 1, visibleIds: number[]) => {
    const at = visibleIds.indexOf(id)
    const to = at + dir
    if (at === -1 || to < 0 || to >= visibleIds.length) return
    const next = [...visibleIds]
    ;[next[at], next[to]] = [next[to], next[at]]
    commitOrder({ ...order, [list]: { ...order[list], [band]: applySubsetOrder(order[list][band], next) } })
  }, [order, commitOrder])

  // Shared little ▲▼ pair used by both lists.
  const RankButtons = ({ list, band, id, visibleIds }: { list: 'team' | 'individual'; band: Band; id: number; visibleIds: number[] }) => {
    const at = visibleIds.indexOf(id)
    const cls = 'w-4 h-4 flex items-center justify-center text-[9px] leading-none rounded text-gray-400 hover:text-gray-900 hover:bg-gray-200 disabled:opacity-25 disabled:hover:bg-transparent'
    return (
      <span className="flex flex-col shrink-0" onClick={e => e.stopPropagation()}>
        <button className={cls} disabled={at <= 0} title="Move up"
          onClick={e => { e.stopPropagation(); nudge(list, band, id, -1, visibleIds) }}>▲</button>
        <button className={cls} disabled={at === -1 || at >= visibleIds.length - 1} title="Move down"
          onClick={e => { e.stopPropagation(); nudge(list, band, id, 1, visibleIds) }}>▼</button>
      </span>
    )
  }

  // Which people's individual lists to show: the page person filter narrows it to
  // one, otherwise everyone who has any.
  const [collapsedPeople, setCollapsedPeople] = useState<string[]>(ALL_PERSON_KEYS)
  const visiblePeople = model.individualByPerson.filter(p =>
    assigneeFilter ? p.member.email === assigneeFilter : p.count > 0
  )

  // Default open state follows the person filter: on All team the lists stay folded
  // so the section reads as a summary, and picking someone opens theirs straight up.
  // Changing the filter re-applies this, so a manual toggle only lasts as long as
  // you're looking at that filter.
  useEffect(() => {
    setCollapsedPeople(assigneeFilter ? [] : ALL_PERSON_KEYS)
  }, [assigneeFilter])

  // Filter tasks for tree/list views: first by the assignee filter, then by the
  // tree search box. A row matches the search on its name, description or assignee;
  // when a row matches, its whole subtree is kept, and any ancestor of a match is
  // kept so the branch stays reachable.
  const assigneeFiltered = assigneeFilter
    ? tasks.map(function filterTree(t: Task): Task {
        const children = t.children.map(filterTree).filter(c =>
          c.children.length > 0 || c.assignee.toLowerCase().includes(assigneeFilter.toLowerCase())
        )
        return { ...t, children }
      })
    : tasks
  const searchQuery = treeSearch.trim().toLowerCase()
  const matchesSearch = (t: Task) =>
    t.name.toLowerCase().includes(searchQuery) ||
    (t.details || '').toLowerCase().includes(searchQuery) ||
    t.assignee.toLowerCase().includes(searchQuery)
  const searchPrune = (t: Task): Task | null => {
    if (matchesSearch(t)) return t
    const children = t.children.map(searchPrune).filter(Boolean) as Task[]
    return children.length ? { ...t, children } : null
  }
  const filteredTasks = searchQuery
    ? (assigneeFiltered.map(searchPrune).filter(Boolean) as Task[])
    : assigneeFiltered

  const detailTask = detailTaskId != null ? findTaskById(tasks, detailTaskId) : null

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="font-semibold text-gray-900">Planner</p>
            <p className="text-xs text-gray-400">
              {assigneeFilter ? (TEAM.find(m => m.email === assigneeFilter)?.name ?? 'All team') : 'All team'} · {stats.total.toLocaleString()} tasks
            </p>
          </div>
          <div className="flex items-center gap-3">
            <TeamFilterDropdown value={assigneeFilter} onChange={setAssigneeFilter} />
            <button onClick={() => setShowNewTask(true)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700 transition-colors">
              + New Task
            </button>
          </div>
        </div>
      </div>

      {/* New task */}
      {showNewTask && (
        <div className="bg-white rounded-xl border border-blue-200 p-4 shadow-sm flex gap-3">
          <input autoFocus value={newTaskName} onChange={e => setNewTaskName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addTask(); if (e.key === 'Escape') setShowNewTask(false) }}
            placeholder="Task name..." className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400" />
          <button onClick={addTask} disabled={saving} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60">
            {saving ? 'Saving…' : 'Add'}
          </button>
          <button onClick={() => setShowNewTask(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
        </div>
      )}

      {/* Stats — click a tile to jump to a filtered List view */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {([
          { key: 'dueToday',    label: 'Due Today',     value: stats.dueToday,    color: '#F59E0B' },
          { key: 'dueThisWeek', label: 'Due This Week', value: stats.dueThisWeek, color: '#F97316' },
          { key: 'overdue',     label: 'Overdue',       value: stats.overdue,     color: '#EF4444' },
          { key: 'todo',        label: 'To Do',         value: stats.todo,        color: '#374151' },
          { key: 'inProgress',  label: 'In Progress',   value: stats.inProgress,  color: '#14B8A6' },
          { key: 'total',       label: 'Total Active',  value: stats.total,       color: '#22C55E' },
        ] as const).map(s => {
          const active = view === 'list' && statFilter === s.key
          return (
            <button key={s.label} onClick={() => { setStatFilter(s.key); setView('list') }}
              title={`Show ${STAT_LABELS[s.key]} in List view`}
              className={`bg-white rounded-xl border p-4 shadow-sm text-center transition-all hover:shadow-md hover:-translate-y-0.5 ${active ? 'ring-2 ring-offset-1' : 'border-gray-200'}`}
              style={active ? ({ borderColor: 'transparent', '--tw-ring-color': s.color } as React.CSSProperties) : undefined}>
              <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
              <p className="text-xs text-gray-400 mt-1 uppercase tracking-wide leading-tight">{s.label}</p>
            </button>
          )
        })}
      </div>

      {/* Group colour legend */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(GROUP_CONFIG).map(([name, cfg]) => (
          <div key={name} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cfg.hex }} />
            <span className="text-xs text-gray-500">{name}</span>
          </div>
        ))}
      </div>

      {/* ── Marketing Priorities ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100">
          <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase">Marketing Priorities</p>
          <span className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full">{model.teamCount} team</span>
          <span className="text-xs px-2 py-0.5 bg-amber-50 text-amber-600 rounded-full">{model.individualCount} individual</span>
          <span className="ml-auto text-xs text-gray-400 hidden lg:inline">Drag to rank or to move between High / Medium / Low</span>
        </div>

        {/* One-time conversion of the old ★ list */}
        {legacyStarred.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-amber-50 border-b border-amber-100">
            <p className="text-xs text-amber-800 flex-1 min-w-[240px]">
              {legacyStarred.length} starred {legacyStarred.length === 1 ? 'task' : 'tasks'} from the old Focus list
              {' '}— convert {legacyStarred.length === 1 ? 'it' : 'them'} to Individual priorities?
            </p>
            <button onClick={migrateStars} disabled={migrating}
              className="text-xs px-3 py-1.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-60">
              {migrating ? 'Converting…' : 'Convert to Individual'}
            </button>
            <button onClick={() => setLegacyStarred([])} className="text-xs text-amber-700 hover:text-amber-900 px-2">
              Dismiss
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">

          {/* ── Team priorities ──────────────────────────────────────────────── */}
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PRIORITY_STYLE.Team.dot }} />
              <p className="text-xs font-semibold tracking-widest text-gray-500 uppercase">Team Priorities</p>
            </div>

            {BANDS.map(band => {
              const rows = model.teamByBand[band]
              const style = BAND_STYLE[band]
              const visibleIds = rows.map(t => t.id)
              return (
                <div key={band} className="mb-3 last:mb-0">
                  {/* Band cutoff line */}
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border ${style.chip}`}>
                      {style.label}
                    </span>
                    <span className="text-[10px] text-gray-300 tabular-nums">{rows.length}</span>
                    <div className="flex-1 h-px" style={{ backgroundColor: style.hex, opacity: 0.3 }} />
                  </div>

                  {/* Band drop zone — also the tail target and the empty-band target */}
                  <div
                    data-drop-list="team"
                    data-drop-band={band}
                    className={`min-h-[36px] rounded-lg transition-colors ${dropHint === hintKey('team', '', band, null) ? 'bg-gray-50 ring-1 ring-inset ring-gray-200' : ''}`}
                  >
                    {rows.length === 0 && (
                      <p className="text-[11px] text-gray-400 px-2 py-2">Drag a task here, or set one to Team · {style.label} in the tree</p>
                    )}
                    {rows.map((t, i) => (
                      <div
                        key={t.id}
                        data-drop-id={t.id}
                        onClick={() => setDetailTaskId(t.id)}
                        className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-gray-50 border-t-2 ${
                          dropHint === hintKey('team', '', band, t.id) ? '' : 'border-transparent'
                        } ${drag?.id === t.id ? 'opacity-40' : ''}`}
                        style={dropHint === hintKey('team', '', band, t.id) ? { borderTopColor: style.hex } : undefined}
                      >
                        <RankButtons list="team" band={band} id={t.id} visibleIds={visibleIds} />
                        <span {...handleProps(t.id, 'team', 'flex items-center justify-center w-6 h-6 shrink-0 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 text-sm leading-none')}>⠿</span>
                        <span className="text-[10px] text-gray-400 w-3 shrink-0 tabular-nums">{i + 1}</span>
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: getGroup(t.groupName).hex }} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-800 truncate">{t.name}</p>
                          {leafContext(t) && <p className="text-[10px] text-gray-400 truncate">{leafContext(t)}</p>}
                        </div>
                        {t.dueDate && (
                          <span className="text-[10px] text-gray-400 shrink-0">
                            {t.dueDate.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                          </span>
                        )}
                        <span className="text-[10px] text-gray-400 shrink-0 w-7 text-right tabular-nums">{t.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── Individual priorities: collapsible table per person ──────────── */}
          <div className="p-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PRIORITY_STYLE.Individual.dot }} />
              <p className="text-xs font-semibold tracking-widest text-gray-500 uppercase">Individual Priorities</p>
              <span className="ml-auto text-[10px] text-gray-400">row colour = team priority above it</span>
            </div>

            {visiblePeople.length === 0 && (
              <p className="text-[11px] text-gray-300 px-2 py-2">
                No individual priorities yet — set a task to Individual in the tree
              </p>
            )}

            {visiblePeople.map(({ member, bands, count }) => {
              const collapsed = collapsedPeople.includes(member.email)
              return (
                <div key={member.email} className="mb-2 last:mb-0 border border-gray-100 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setCollapsedPeople(cur =>
                      cur.includes(member.email) ? cur.filter(e => e !== member.email) : [...cur, member.email])}
                    className="w-full flex items-center gap-2 px-2.5 py-2 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                  >
                    <svg className={`w-3 h-3 text-gray-400 transition-transform shrink-0 ${collapsed ? '' : 'rotate-90'}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className={`w-5 h-5 rounded-full ${member.color} flex items-center justify-center text-white text-[9px] font-bold shrink-0`}>
                      {member.initials}
                    </span>
                    <span className="text-xs font-semibold text-gray-700">{member.name.split(' ')[0]}</span>
                    <span className="text-[10px] text-gray-400 tabular-nums">{count}</span>
                    {/* Band tally, so a collapsed person still shows their shape */}
                    <span className="ml-auto flex items-center gap-1">
                      {BANDS.map(b => {
                        const n = bands[b].length
                        if (!n) return null
                        return (
                          <span key={b} className={`text-[10px] px-1.5 rounded-full font-semibold tabular-nums border ${BAND_STYLE[b].chip}`}>
                            {n}
                          </span>
                        )
                      })}
                    </span>
                  </button>

                  {!collapsed && (
                    <table className="w-full text-left table-fixed">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="w-14" />
                          <th className="px-1 py-1 text-[9px] font-semibold tracking-widest text-gray-400 uppercase">Task</th>
                          <th className="px-1 py-1 w-14 text-[9px] font-semibold tracking-widest text-gray-400 uppercase">Team</th>
                          <th className="px-1 py-1 w-14 text-[9px] font-semibold tracking-widest text-gray-400 uppercase">Due</th>
                          <th className="px-1 py-1 w-9 text-[9px] font-semibold tracking-widest text-gray-400 uppercase text-right">%</th>
                        </tr>
                      </thead>
                      {BANDS.map(band => {
                        const rows = bands[band]
                        const style = BAND_STYLE[band]
                        const visibleIds = rows.map(r => r.task.id)
                        return (
                          <tbody key={band}
                            data-drop-list="individual"
                            data-drop-band={band}
                            data-drop-owner={member.email}
                            className={dropHint === hintKey('individual', member.email, band, null) ? 'bg-gray-50' : ''}
                          >
                            {/* Band cutoff line */}
                            <tr>
                              <td colSpan={5} className="px-2 pt-1.5 pb-0.5">
                                <div className="flex items-center gap-2">
                                  <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 rounded border ${style.chip}`}>
                                    {style.label}
                                  </span>
                                  <div className="flex-1 h-px" style={{ backgroundColor: style.hex, opacity: 0.25 }} />
                                </div>
                              </td>
                            </tr>
                            {rows.length === 0 && (
                              <tr><td colSpan={5} className="px-2 py-1 text-[10px] text-gray-400">Drag a task here</td></tr>
                            )}
                            {rows.map(({ task: t, teamBand }) => {
                              const colour = teamBand ? BAND_STYLE[teamBand] : null
                              const isTarget = dropHint === hintKey('individual', member.email, band, t.id)
                              return (
                                <tr
                                  key={t.id}
                                  data-drop-id={t.id}
                                  onClick={() => setDetailTaskId(t.id)}
                                  className={`group cursor-pointer hover:brightness-95 border-t-2 ${
                                    isTarget ? '' : 'border-transparent'
                                  } ${drag?.id === t.id ? 'opacity-40' : ''}`}
                                  style={{
                                    backgroundColor: colour ? colour.row : undefined,
                                    ...(isTarget ? { borderTopColor: colour?.hex ?? '#9CA3AF' } : {}),
                                  }}
                                >
                                  <td className="px-1 py-1 align-middle">
                                    <span className="flex items-center gap-0.5">
                                      <RankButtons list="individual" band={band} id={t.id} visibleIds={visibleIds} />
                                      <span {...handleProps(t.id, 'individual', 'flex items-center justify-center w-6 h-6 shrink-0 rounded text-gray-500 hover:text-gray-900 hover:bg-gray-200 text-sm leading-none')}>⠿</span>
                                    </span>
                                  </td>
                                  <td className="px-1 py-1">
                                    <p className="text-xs text-gray-900 truncate">{t.name}</p>
                                    {leafContext(t) && <p className="text-[10px] text-gray-600 truncate">{leafContext(t)}</p>}
                                  </td>
                                  <td className="px-1 py-1">
                                    {colour
                                      ? <span className={`text-[9px] font-bold uppercase px-1 rounded border ${colour.chip}`}>{colour.label}</span>
                                      : <span className="text-[10px] text-gray-400">—</span>}
                                  </td>
                                  <td className="px-1 py-1 text-[10px] text-gray-700 whitespace-nowrap">
                                    {t.dueDate ? t.dueDate.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }) : '—'}
                                  </td>
                                  <td className="px-1 py-1 text-[10px] text-gray-700 tabular-nums text-right">{t.pct}%</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        )
                      })}
                    </table>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* View controls */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden bg-white">
          {(['tree', 'gantt', 'board', 'list'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-4 py-2 text-sm font-medium transition-colors capitalize border-r border-gray-200 last:border-0 ${view === v ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
              {v === 'tree' ? 'Tree' : v === 'gantt' ? 'Gantt' : v === 'board' ? 'Board' : 'List'}
            </button>
          ))}
        </div>
        {view === 'tree' && (
          <div className="flex items-center gap-2">
            <button onClick={() => setForceOpen(prev => ({ open: true, version: (prev?.version ?? 0) + 1 }))} className="px-3 py-1.5 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">Expand All</button>
            <button onClick={() => setForceOpen(prev => ({ open: false, version: (prev?.version ?? 0) + 1 }))} className="px-3 py-1.5 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">Collapse All</button>
          </div>
        )}
        <div className="relative">
          <input
            value={treeSearch}
            onChange={e => setTreeSearch(e.target.value)}
            placeholder="Search tasks…"
            className="text-sm border border-gray-200 rounded-lg pl-3 pr-7 py-1.5 bg-white focus:outline-none focus:border-blue-300 w-52" />
          {treeSearch && (
            <button onClick={() => setTreeSearch('')} title="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 leading-none text-lg">×</button>
          )}
        </div>
        <span className="text-xs text-gray-400 ml-auto">{stats.total.toLocaleString()} tasks total</span>
      </div>

      {saveError && (
        <div className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2.5">
          <span>{saveError}</span>
          <button onClick={() => setSaveError(null)} className="text-red-400 hover:text-red-600 font-medium">Dismiss</button>
        </div>
      )}

      {/* Views */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="text-gray-400">Loading tasks from Smartsheet…</div>
          <div className="text-xs text-gray-400 font-mono">{loadMsg}</div>
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="text-red-400">Failed to load Smartsheet data</div>
          <button onClick={load} className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-700">Retry</button>
        </div>
      ) : (
        <>
          {view === 'tree' && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      {['Task', 'Description', 'Assigned To', 'Priority', 'Start', 'Due', 'Progress', 'Notes'].map(h => (
                        <th key={h} className="px-3 py-3 text-xs font-semibold tracking-widest text-gray-700 uppercase whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTasks.map(t => (
                      <TreeRow
                        key={t.id}
                        task={t}
                        groupCfg={GROUP_CONFIG[t.name] || DEFAULT_GROUP}
                        assigneeFilter={assigneeFilter}
                        bandOfTask={bandOfTask}
                        onSetPriority={setPriority}
                        onUpdatePct={updateTaskPct}
                        onUpdateComments={updateTaskComments}
                        onDelete={deleteTask}
                        onAddBelow={addTaskBelow}
                        onUpdateDate={updateTaskDate}
                        onUpdateAssignees={updateTaskAssignees}
                        onOpenDetail={setDetailTaskId}
                        depth={0}
                        forceOpen={forceOpen}
                      />
                    ))}
                    {filteredTasks.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-3 py-12 text-center text-sm text-gray-400">
                          {searchQuery ? `No tasks match “${treeSearch.trim()}”` : 'No tasks'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {view === 'gantt' && <GanttView tasks={filteredTasks} assigneeFilter={assigneeFilter} onUpdatePct={updateTaskPct} onUpdateDate={updateTaskDate} onOpenDetail={setDetailTaskId} />}
          {view === 'board' && <BoardView tasks={filteredTasks} assigneeFilter={assigneeFilter} onUpdatePct={updateTaskPct} onUpdateDate={updateTaskDate} onOpenDetail={setDetailTaskId} />}
          {view === 'list' && <ListView tasks={filteredTasks} assigneeFilter={assigneeFilter} statFilter={statFilter} onUpdatePct={updateTaskPct} onUpdateDate={updateTaskDate} onOpenDetail={setDetailTaskId} />}
        </>
      )}

      {detailTask && (
        <TaskDetailModal
          key={detailTask.id}
          task={detailTask}
          band={bandOfTask(detailTask.id)}
          onClose={() => setDetailTaskId(null)}
          onUpdateText={updateTaskText}
          onUpdateStatus={updateTaskStatus}
          onUpdatePct={updateTaskPct}
          onUpdateDate={updateTaskDate}
          onUpdateAssignees={updateTaskAssignees}
          onUpdateComments={updateTaskComments}
          onSetPriority={setPriority}
          onComplete={completeTask}
          onDelete={deleteTask}
        />
      )}
    </div>
  )
}

interface MarketingPlanProps {
  defaultAssignee?: string
}

export default function MarketingPlan({ defaultAssignee }: MarketingPlanProps) {
  return <ErrorBoundary><MarketingPlanInner defaultAssignee={defaultAssignee} /></ErrorBoundary>
}
