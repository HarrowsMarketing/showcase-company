// /api/content/plan* — ContentPlan.tsx ("Content Plan FY26/27" tab).
import { rngFor, pick, randInt } from '../prng'
import { NOW, addDays, FY_START } from './company'

function mondayOf(d: Date) {
  const m = new Date(d); m.setHours(0, 0, 0, 0)
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7))
  return m
}
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

let nextRowId = 1
let nextEntryId = 1
const rowId = () => String(nextRowId++)
const entryId = () => String(nextEntryId++)

const ROW_LABELS = ['Campaigns', 'Trade Shows & Events', 'Social Content', 'Email / EDM', 'Blog & PR', 'Product Launches']
const ENTRY_TITLES = [
  'Spring Trade Campaign', 'EOFY Trade Promotion', 'New Product Range Showcase', 'Sustainability Report Launch',
  'New Cordless Range Launch', 'Customer Spotlight Series', 'Trade Show — BuildNZ', 'Webinar: Trade Industry Trends',
  'Case Study: BuildRight Merchants', 'Winter Catalogue Drop', 'Referral Partner Push', 'Showroom Open Day',
]

function buildRows() {
  const rng = rngFor('content-plan-rows')
  return ROW_LABELS.map((label, sort_order) => {
    const nEntries = randInt(rng, 1, 3)
    const content_plan_entries = Array.from({ length: nEntries }, () => {
      const startWeekOffset = randInt(rng, 0, 47)
      const spanWeeks = randInt(rng, 1, 4)
      const start = mondayOf(addDays(FY_START, startWeekOffset * 7))
      const end = mondayOf(addDays(start, spanWeeks * 7 - 7))
      const hasDue = rng() < 0.5
      return {
        id: entryId(), row_id: '', title: pick(rng, ENTRY_TITLES),
        start_date: ymd(start), end_date: ymd(end),
        notes: null, due_date: hasDue ? ymd(addDays(start, randInt(rng, 3, spanWeeks * 7 - 1))) : null,
      }
    })
    const id = rowId()
    content_plan_entries.forEach(e => { e.row_id = id })
    return { id, label, sort_order, content_plan_entries }
  })
}

export const contentPlanStore = {
  theme: 'Tools That Get The Job Done',
  quarterGoals: [
    'Q1: Launch new cordless tool range',
    'Q2: Grow trade show presence across AU',
    'Q3: Refresh brand photography & case studies',
    'Q4: EOFY promotion push + FY27/28 planning',
  ],
  rows: buildRows(),
}

export function cpAddRow(label: string) {
  const row = { id: rowId(), label, sort_order: contentPlanStore.rows.length, content_plan_entries: [] as any[] }
  contentPlanStore.rows.push(row)
  return row
}
export function cpRenameRow(id: string, label: string) {
  const row = contentPlanStore.rows.find(r => r.id === id)
  if (row) row.label = label
  return row
}
export function cpDeleteRow(id: string) {
  contentPlanStore.rows = contentPlanStore.rows.filter(r => r.id !== id)
}
export function cpAddEntry(row_id: string, v: any) {
  const entry = { id: entryId(), row_id, title: v.title || 'Untitled', start_date: v.start_date, end_date: v.end_date, notes: v.notes ?? null, due_date: v.due_date ?? null }
  const row = contentPlanStore.rows.find(r => r.id === row_id)
  if (row) row.content_plan_entries.push(entry)
  return entry
}
export function cpUpdateEntry(id: string, v: any) {
  for (const row of contentPlanStore.rows) {
    const entry = row.content_plan_entries.find((e: any) => e.id === id)
    if (entry) { Object.assign(entry, v); return entry }
  }
  return null
}
export function cpDeleteEntry(id: string) {
  contentPlanStore.rows.forEach(row => { row.content_plan_entries = row.content_plan_entries.filter((e: any) => e.id !== id) })
}
