// /api/smartsheet (+ mutation routes) — MarketingPlan.tsx, MarketingActivity.tsx,
// FloatingMeetingNotes.tsx. Kept as simple mutable in-memory state (module-level
// arrays) so edits made during a demo session visibly "stick" until reload.
import { rngFor, pick, randInt } from '../prng'
import { NOW, ymd, addDays, MARKETING_TEAM } from './company'

export const SMARTSHEET_COLUMNS = [
  { id: 1, title: 'Task Name' }, { id: 2, title: 'Details' }, { id: 3, title: 'Assigned To' },
  { id: 4, title: 'Status' }, { id: 5, title: '% Complete' }, { id: 6, title: 'Start Date' },
  { id: 7, title: 'Required Date' }, { id: 8, title: 'Priority' }, { id: 9, title: 'Frequency' },
  { id: 10, title: 'Comments' },
]
const COL_BY_TITLE = new Map(SMARTSHEET_COLUMNS.map(c => [c.title, c.id]))

const CATEGORIES = [
  'Content Plan FY26/27', 'Paid & Organic Social', 'Website & SEO', 'Email Marketing',
  'Trade Shows & Events', 'Brand & Collateral', 'Reporting & Analytics', 'Product Launches',
]
const TASK_POOL = [
  'Draft campaign brief', 'Design social tiles', 'Write newsletter copy', 'Update product photography',
  'Book showroom event', 'Review Q performance report', 'Refresh landing page', 'Coordinate trade show stand',
  'Schedule email send', 'Approve final artwork', 'Brief external agency', 'Update case study',
  'Audit SEO metadata', 'Plan influencer collab', 'Film product video', 'Prep sales collateral',
]
const STATUS_POOL = ['Not Started', 'In Progress', 'Complete', 'Blocked']
const PRIORITY_POOL = ['High', 'Medium', 'Low']
const FREQUENCY_POOL = ['One-off', 'Weekly', 'Monthly', 'Quarterly']

let nextId = 100000
function newId() { return nextId++ }

function buildInitialRows() {
  const rng = rngFor('smartsheet-rows')
  const rows: Record<string, any>[] = []
  CATEGORIES.forEach(cat => {
    const parentId = newId()
    rows.push({ id: parentId, 'Task Name': cat, 'Status': pick(rng, STATUS_POOL) })
    const nChildren = randInt(rng, 3, 6)
    for (let i = 0; i < nChildren; i++) {
      const start = addDays(NOW, randInt(rng, -30, 10))
      const required = addDays(start, randInt(rng, 5, 45))
      const pct = randInt(rng, 0, 100)
      rows.push({
        id: newId(), parentId,
        'Task Name': pick(rng, TASK_POOL),
        'Details': '', 'Assigned To': pick(rng, MARKETING_TEAM).name,
        'Status': pct >= 100 ? 'Complete' : pick(rng, STATUS_POOL),
        '% Complete': pct, 'Start Date': ymd(start), 'Required Date': ymd(required),
        'Priority': pick(rng, PRIORITY_POOL), 'Frequency': pick(rng, FREQUENCY_POOL), 'Comments': '',
      })
    }
  })
  return rows
}

export const smartsheetStore = { rows: buildInitialRows() }

export function ssAddRow(body: any) {
  // MarketingPlan posts a Smartsheet-shaped { toBottom, parentId?, cells: [{columnId, value}] } row.
  const row: Record<string, any> = { id: newId() }
  if (body.parentId) row.parentId = body.parentId
  const cells = body.cells || []
  cells.forEach((c: { columnId: number; value: any }) => {
    const col = SMARTSHEET_COLUMNS.find(cc => cc.id === c.columnId)
    if (col) row[col.title] = c.value
  })
  smartsheetStore.rows.push(row)
  return row
}
export function ssUpdateRow(id: number, cells: { columnId: number; value: any }[]) {
  const row = smartsheetStore.rows.find(r => r.id === id)
  if (!row) return null
  cells.forEach(c => {
    const col = SMARTSHEET_COLUMNS.find(cc => cc.id === c.columnId)
    if (col) row[col.title] = c.value
  })
  return row
}
export function ssDeleteRows(ids: number[]) {
  smartsheetStore.rows = smartsheetStore.rows.filter(r => !ids.includes(r.id))
}
export { COL_BY_TITLE }
