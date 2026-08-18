// /api/meeting/* (OurOneNumber widget + MeetingTab drill-downs) and
// /api/marketing/pipeline-by-source (MarketingRevenue.tsx).
import { rngFor, pick, randInt, randFloat } from '../prng'
import { NOW, ymd, addDays, addMonths, shortMonthLabel } from './company'
import { contactNameFor, dealName, dealAmount } from './dealGen'

const COMPANY_POOL = ['Mitre Trade Hardware', 'Southern Cross Tool Co', 'BuildRight Merchants', 'Northgate Hardware Group', 'Anchor Construction Ltd', 'Delta Logistics', 'Pinnacle Construction', 'Ironbark Mining Corp']
const LIFECYCLE_POOL = ['subscriber', 'lead', 'marketingqualifiedlead', 'salesqualifiedlead', 'opportunity']
const JOB_TITLES = ['Purchasing Manager', 'Trade Sales Manager', 'Procurement Lead', 'Store Manager', 'Operations Director']

// ── /api/meeting/snapshot?country= ──────────────────────────────────────────
export function meetingSnapshot(_country: 'NZ' | 'AU') {
  const rng = rngFor(`meeting-snapshot-${_country}`)
  const yesterdaySessions = randInt(rng, 180, 520)
  const dayBeforeSessions = Math.round(yesterdaySessions * randFloat(rng, 0.85, 1.15, 3))
  return {
    website: {
      yesterdaySessions, dayBeforeSessions,
      sessionChange: Math.round(((yesterdaySessions - dayBeforeSessions) / dayBeforeSessions) * 1000) / 10,
      yesterdayUsers: Math.round(yesterdaySessions * randFloat(rng, 0.8, 0.92, 2)),
      yesterdayNewUsers: Math.round(yesterdaySessions * randFloat(rng, 0.35, 0.55, 2)),
    },
    leads: { newThisWeek: randInt(rng, 12, 45), newYesterday: randInt(rng, 0, 8) },
    pipeline: { openValue: randInt(rng, 400000, 900000), openCount: randInt(rng, 20, 60), newDealsThisWeek: randInt(rng, 3, 12) },
    email: { name: 'August Product Newsletter', subject: 'New arrivals for the workshop', sent: randInt(rng, 4000, 9000), openRate: randFloat(rng, 16, 30, 1), clickRate: randFloat(rng, 1.5, 4.5, 1) },
    mql: { total: randInt(rng, 800, 1400), newThisMonth: randInt(rng, 40, 110), sqlThisMonth: randInt(rng, 8, 28), sqlDebug: { mock: true } },
  }
}

function contactList(streamName: string, n: number) {
  const rng = rngFor(streamName)
  return Array.from({ length: n }, (_, i) => ({
    id: `contact-${streamName}-${i}`,
    name: contactNameFor(rng),
    email: `contact${i}@${pick(rng, COMPANY_POOL)}`.toLowerCase().replace(/\s+/g, '') + '.example.com',
    company: pick(rng, COMPANY_POOL),
    jobTitle: pick(rng, JOB_TITLES),
    lifecyclestage: pick(rng, LIFECYCLE_POOL),
    lifecycleStage: pick(rng, LIFECYCLE_POOL),
    source: pick(rng, ['Organic Search', 'Paid Search', 'Direct', 'Referral', 'Email']),
    date: ymd(addDays(NOW, -randInt(rng, 0, 45))),
  }))
}
export const MEETING_SQL_CONTACTS = (() => { const contacts = contactList('meeting-sql', 14); return { total: contacts.length, contacts } })()
export const MEETING_MQL_CONTACTS = (() => { const contacts = contactList('meeting-mql', 22); return { total: contacts.length, contacts } })()

// ── /api/meeting/mql-trend — array, not object ──────────────────────────────
export const MEETING_MQL_TREND = (() => {
  const rng = rngFor('meeting-mql-trend')
  const out = []
  for (let i = 11; i >= 0; i--) {
    const d = addMonths(new Date(NOW.getFullYear(), NOW.getMonth(), 1), -i)
    out.push({ month: shortMonthLabel(d), count: randInt(rng, 55, 140) })
  }
  return out
})()

// ── /api/meeting/pipeline-deals ──────────────────────────────────────────────
function dealRows(streamName: string, n: number) {
  const rng = rngFor(streamName)
  return Array.from({ length: n }, (_, i) => ({
    id: `pd-${streamName}-${i}`,
    dealname: dealName(rng),
    amount: dealAmount(rng, 6000, 190000),
    contactName: contactNameFor(rng),
    company: pick(rng, COMPANY_POOL),
    date: ymd(addDays(NOW, -randInt(rng, 0, 30))),
  }))
}
export const MEETING_PIPELINE_DEALS = {
  newPipelineDeals: dealRows('mpd-new', 12),
  wonDeals: dealRows('mpd-won', 10),
}

// ── /api/meeting/marketing-won ───────────────────────────────────────────────
export const MEETING_MARKETING_WON = (() => {
  const rng = rngFor('meeting-marketing-won')
  const wonDeals = Array.from({ length: 8 }, (_, i) => ({ id: `mw-${i}`, dealname: dealName(rng), amount: dealAmount(rng, 5000, 140000), contactName: null, company: null, date: ymd(addDays(NOW, -randInt(rng, 0, 30))) }))
  const npDeals = Array.from({ length: 9 }, (_, i) => ({ id: `mnp-${i}`, dealname: dealName(rng), amount: dealAmount(rng, 5000, 160000), contactName: null, company: null, date: ymd(addDays(NOW, -randInt(rng, 0, 30))) }))
  const thisMonth = wonDeals.reduce((s, d) => s + d.amount, 0)
  return {
    won: { thisMonth, lastMonth: Math.round(thisMonth * randFloat(rng, 0.75, 1.25, 3)), deals: wonDeals },
    newPipeline: { thisMonth: npDeals.reduce((s, d) => s + d.amount, 0), lastMonth: Math.round(npDeals.reduce((s, d) => s + d.amount, 0) * randFloat(rng, 0.75, 1.25, 3)), deals: npDeals },
  }
})()

// ── /api/marketing/pipeline-by-source — 36 months, MarketingRevenue.tsx ────
function sourceSplitMonths(streamName: string) {
  const rng = rngFor(streamName)
  const out = []
  for (let i = 35; i >= 0; i--) {
    const d = addMonths(new Date(NOW.getFullYear(), NOW.getMonth(), 1), -i)
    const base = randInt(rng, 60000, 260000)
    const marketing = Math.round(base * randFloat(rng, 0.35, 0.5, 3))
    const bd = Math.round(base * randFloat(rng, 0.15, 0.25, 3))
    const sales = Math.round(base * randFloat(rng, 0.2, 0.32, 3))
    const unassigned = Math.max(0, base - marketing - bd - sales)
    out.push({ month: shortMonthLabel(d), marketing, bd, sales, unassigned })
  }
  return out
}
export const MARKETING_PIPELINE_BY_SOURCE = {
  newPipeline: sourceSplitMonths('pbs-new'),
  won: sourceSplitMonths('pbs-won'),
}
