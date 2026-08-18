// /api/sales (the big NZ+AU MarketData object) plus the smaller HubSpot-ish
// marketing-facing endpoints consumed by MarketingDashboard.tsx.
import { rngFor, pick, pickN, randInt, randFloat, weightedBool } from '../prng'
import {
  NOW, ymd, addDays, addMonths, shortMonthLabel, FY_LABEL,
  NZ_FY_CURVE, AU_FY_CURVE, SALES_TEAM_NAMES,
} from './company'
import { OPEN_STAGES, WON_STAGE, dealName, dealOwner, dealAmount } from './dealGen'

// ── Trailing-12-month curve (Sep 25 → Aug 26), realigned to the FY curve for
// the months that fall inside FY26/27 so /api/sales's own monthlyTrend agrees
// with its own fyWonValue. ────────────────────────────────────────────────────
function buildTrailing12(streamName: string, fyCurve: typeof NZ_FY_CURVE, avgMonthly: number) {
  const rng = rngFor(streamName)
  const fyByLabel = new Map(fyCurve.months.map(m => [m.label, m]))
  const months = []
  for (let i = 11; i >= 0; i--) {
    const d = addMonths(new Date(NOW.getFullYear(), NOW.getMonth(), 1), -i)
    const label = shortMonthLabel(d)
    const start = new Date(d.getFullYear(), d.getMonth(), 1)
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    const fyMatch = fyByLabel.get(label)
    const wonValue = fyMatch ? (fyMatch.actual ?? 0) : Math.round(avgMonthly * randFloat(rng, 0.75, 1.25, 3))
    const wonCount = fyMatch ? fyMatch.wonCount : Math.max(1, Math.round(wonValue / avgMonthly * randInt(rng, 3, 6)))
    const created = Math.max(wonCount, Math.round(wonCount * randFloat(rng, 1.3, 2.2, 2)))
    months.push({ label, start: ymd(start), end: ymd(end), wonValue, wonCount, created })
  }
  return months
}

function buildPipelines(streamName: string, openTotal: number, openCountTotal: number) {
  const rng = rngFor(streamName)
  const split = randFloat(rng, 0.6, 0.75, 2)
  const pipelines = [
    { id: 'default', name: 'New Business', share: split },
    { id: 'existing', name: 'Existing Accounts', share: 1 - split },
  ]
  return pipelines.map(p => {
    const openValue = Math.round(openTotal * p.share)
    const openCount = Math.round(openCountTotal * p.share)
    let remaining = openCount
    const stages = OPEN_STAGES.map((s, i) => {
      const isLast = i === OPEN_STAGES.length - 1
      const count = isLast ? remaining : Math.max(0, Math.round(openCount * (0.28 - i * 0.035) * randFloat(rng, 0.8, 1.2, 2)))
      remaining -= count
      const value = Math.round(openValue * (count / Math.max(1, openCount)))
      return { name: s.name, count: Math.max(0, count), value: Math.max(0, value) }
    })
    return { id: p.id, name: p.name, openValue, openCount, stages }
  })
}

function buildOwners(streamName: string, owners: string[], openTotal: number, openCountTotal: number, wonTotal: number, wonCountTotal: number) {
  const rng = rngFor(streamName)
  const weights = owners.map(() => randFloat(rng, 0.6, 1.6, 3))
  const wSum = weights.reduce((a, b) => a + b, 0)
  return owners.map((name, i) => ({
    name,
    openCount: Math.max(0, Math.round(openCountTotal * weights[i] / wSum)),
    openValue: Math.max(0, Math.round(openTotal * weights[i] / wSum)),
    wonCount: Math.max(0, Math.round(wonCountTotal * weights[i] / wSum)),
    wonValue: Math.max(0, Math.round(wonTotal * weights[i] / wSum)),
  })).sort((a, b) => b.openValue - a.openValue)
}

function buildRecentlyWon(streamName: string, owners: string[], n = 10) {
  const rng = rngFor(streamName)
  return Array.from({ length: n }, (_, i) => {
    const closeDate = addDays(NOW, -randInt(rng, 0, 45))
    return {
      id: `won-${streamName}-${i}`,
      name: dealName(rng),
      amount: dealAmount(rng, 6000, 180000),
      stage: WON_STAGE,
      owner: dealOwner(rng, owners),
      closeDate: ymd(closeDate),
      probability: 1,
    }
  }).sort((a, b) => (a.closeDate < b.closeDate ? 1 : -1))
}
function buildClosingSoon(streamName: string, owners: string[], n = 10) {
  const rng = rngFor(streamName)
  return Array.from({ length: n }, (_, i) => {
    const daysUntilClose = randInt(rng, 1, 28)
    const stage = pick(rng, OPEN_STAGES)
    return {
      id: `soon-${streamName}-${i}`,
      name: dealName(rng),
      amount: dealAmount(rng, 8000, 200000),
      stage: stage.name,
      owner: dealOwner(rng, owners),
      closeDate: ymd(addDays(NOW, daysUntilClose)),
      probability: stage.probability,
      daysUntilClose,
    }
  }).sort((a, b) => a.daysUntilClose - b.daysUntilClose)
}
function buildStalled(streamName: string, owners: string[], n = 10) {
  const rng = rngFor(streamName)
  return Array.from({ length: n }, (_, i) => {
    const daysSinceActivity = randInt(rng, 31, 120)
    const stage = pick(rng, OPEN_STAGES.slice(0, 4))
    return {
      id: `stall-${streamName}-${i}`,
      name: dealName(rng),
      amount: dealAmount(rng, 5000, 150000),
      stage: stage.name,
      owner: dealOwner(rng, owners),
      closeDate: ymd(addDays(NOW, randInt(rng, 5, 60))),
      probability: stage.probability,
      daysSinceActivity,
    }
  }).sort((a, b) => b.daysSinceActivity - a.daysSinceActivity)
}

export interface MarketData { [k: string]: any }

function buildMarketData(country: 'NZ' | 'AU'): MarketData {
  const streamName = `sales-${country}`
  const rng = rngFor(streamName)
  const fyCurve = country === 'NZ' ? NZ_FY_CURVE : AU_FY_CURVE
  const owners = country === 'NZ' ? SALES_TEAM_NAMES : SALES_TEAM_NAMES.slice(0, 3)
  const avgDealSize = fyCurve.avgDealSize
  const monthlyTrend = buildTrailing12(`${streamName}-trend`, fyCurve, fyCurve.months.reduce((s, m) => s + m.target, 0) / 12)
  const closedWonValue = monthlyTrend.reduce((s, m) => s + m.wonValue, 0)
  const wonCount = monthlyTrend.reduce((s, m) => s + m.wonCount, 0)
  const lostCount = Math.round(wonCount * randFloat(rng, 1.4, 2.2, 2))
  const winRate = Math.round((wonCount / (wonCount + lostCount)) * 1000) / 10

  const fyWonValue = fyCurve.ytdActual
  const fyWonCount = fyCurve.months.filter(m => m.actual != null).reduce((s, m) => s + m.wonCount, 0)
  const fyLostCount = Math.round(fyWonCount * randFloat(rng, 1.2, 1.8, 2))
  const fyWinRate = Math.round((fyWonCount / (fyWonCount + fyLostCount)) * 1000) / 10

  const openCount = country === 'NZ' ? randInt(rng, 55, 85) : randInt(rng, 20, 38)
  const openPipeline = Math.round(openCount * avgDealSize * randFloat(rng, 1.6, 2.4, 2))
  const newThisMonth = randInt(rng, 8, 22)
  const closingThisMonth = randInt(rng, 6, 16)
  const closedThisMonth = fyCurve.months[fyCurve.months.length - 1]?.wonCount ?? randInt(rng, 4, 12)

  return {
    openPipeline, openCount, closedWonValue, wonCount, lostCount,
    ytdWon: fyWonValue,
    newThisMonth, closingThisMonth, winRate, avgDealSize,
    fyWonCount, fyWonValue, fyLostCount, fyWinRate, fyLabel: FY_LABEL,
    pipelines: buildPipelines(`${streamName}-pipelines`, openPipeline, openCount)
      .sort((a, b) => b.openValue - a.openValue),
    owners: buildOwners(`${streamName}-owners`, owners, openPipeline, openCount, closedWonValue, wonCount),
    monthlyTrend,
    recentlyWon: buildRecentlyWon(`${streamName}-won`, owners),
    closingSoon: buildClosingSoon(`${streamName}-soon`, owners),
    stalled: buildStalled(`${streamName}-stalled`, owners),
    closedThisMonth,
  }
}

export const SALES_DATA = {
  NZ: buildMarketData('NZ'),
  AU: buildMarketData('AU'),
  _debug: { mock: true },
}

// ── /api/hubspot/pipeline?country= ──────────────────────────────────────────
export function pipelineFor(country: 'NZ' | 'AU') {
  const m = country === 'AU' ? SALES_DATA.AU : SALES_DATA.NZ
  const stages = m.pipelines[0].stages.map((s: any) => ({ name: s.name, count: s.count, value: s.value }))
  return {
    openPipeline: m.openPipeline, openCount: m.openCount,
    closedWon: m.closedWonValue, wonCount: m.wonCount,
    avgDeal: m.avgDealSize, stages,
  }
}

// ── /api/hubspot/leads ───────────────────────────────────────────────────────
const TAG_POOL = [
  { label: 'Visited pricing page', pts: 15 }, { label: 'Downloaded catalogue', pts: 10 },
  { label: 'Enterprise company size', pts: 20 }, { label: 'Repeat visitor', pts: 8 },
  { label: 'Attended webinar', pts: 12 }, { label: 'Filled RFQ form', pts: 25 },
  { label: 'Existing customer contact', pts: 18 }, { label: 'From referral', pts: 14 },
]
const STATUS_POOL = ['OPEN_DEAL', 'IN_PROGRESS', 'LEAD']
const TITLE_POOL = ['Purchasing Manager', 'Trade Sales Manager', 'Procurement Lead', 'Store Manager', 'Director of Operations', 'Warehouse Manager', 'Project Manager', 'CFO', 'HR Director']
export const HUBSPOT_LEADS = (() => {
  const rng = rngFor('hubspot-leads')
  const leads = Array.from({ length: 25 }, (_, i) => {
    const country = weightedBool(rng, 0.72) ? 'NZ' : 'AU'
    const tags = pickN(rng, TAG_POOL, randInt(rng, 1, 5))
    const score = Math.min(100, Math.max(2, Math.round(tags.reduce((s, t) => s + t.pts, 0) * randFloat(rng, 0.8, 1.15, 2))))
    return {
      id: `lead-${i}`,
      name: dealName(rng).split(' — ')[0] + ' Contact',
      title: pick(rng, TITLE_POOL),
      company: dealName(rng).split(' — ')[0],
      owner: dealOwner(rng),
      status: pick(rng, STATUS_POOL),
      score, tags, country,
      daysAgo: randInt(rng, 0, 60),
    }
  }).sort((a, b) => b.score - a.score)
  return { total: leads.length, leads }
})()

// ── /api/hubspot/sectors ─────────────────────────────────────────────────────
export const HUBSPOT_SECTORS = (() => {
  const rng = rngFor('hubspot-sectors')
  const monthsYtd = ['Jan 26', 'Feb 26', 'Mar 26', 'Apr 26', 'May 26', 'Jun 26', 'Jul 26', 'Aug 26']
  let marketingTotal = 0, salesTotal = 0
  const monthly = monthsYtd.map(label => {
    const Marketing = randInt(rng, 60, 140)
    const Sales = randInt(rng, 20, 70)
    marketingTotal += Marketing; salesTotal += Sales
    return { label, Marketing, Sales }
  })
  return {
    total: marketingTotal + salesTotal, marketingTotal, salesTotal,
    monthly,
    sourcePie: [{ name: 'Marketing', count: marketingTotal }, { name: 'Sales', count: salesTotal }],
    sourcePieLabel: 'Contacts by original source (YTD)',
  }
})()

// ── /api/hubspot/contacts ────────────────────────────────────────────────────
export const HUBSPOT_CONTACTS = (() => {
  const rng = rngFor('hubspot-contacts')
  const months = []
  let total = 0
  for (let i = 5; i >= 0; i--) {
    const d = addMonths(new Date(NOW.getFullYear(), NOW.getMonth(), 1), -i)
    const start = new Date(d.getFullYear(), d.getMonth(), 1)
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    const count = randInt(rng, 140, 340)
    total += count
    months.push({ label: shortMonthLabel(d), start: ymd(start), end: ymd(end), count })
  }
  return { total: total + randInt(rng, 4000, 6000), monthly: months }
})()

// ── /api/hubspot/repeatcustomers ─────────────────────────────────────────────
export const HUBSPOT_REPEAT_CUSTOMERS = (() => {
  const rng = rngFor('hubspot-repeat')
  const total = randInt(rng, 900, 1100)
  const returning = Math.round(total * randFloat(rng, 0.34, 0.42, 3))
  const unlinked = Math.round(total * randFloat(rng, 0.03, 0.06, 3))
  const newC = total - returning - unlinked
  return {
    total, returning, new: newC, unlinked,
    returningPct: Math.round((returning / total) * 1000) / 10,
    newPct: Math.round((newC / total) * 1000) / 10,
  }
})()

// ── /api/hubspot/forms?country= [LIGHT — matched to MarketingDashboard.tsx] ─
export function formsFor(_country: 'NZ' | 'AU') {
  const rng = rngFor(`hubspot-forms-${_country}`)
  const months = []
  let total = 0
  for (let i = 5; i >= 0; i--) {
    const d = addMonths(new Date(NOW.getFullYear(), NOW.getMonth(), 1), -i)
    const count = randInt(rng, 18, 60)
    total += count
    months.push({ label: shortMonthLabel(d), count })
  }
  return { total, avgPerMonth: Math.round(total / 6), monthly: months }
}

// ── /api/hubspot/emails [LIGHT] ──────────────────────────────────────────────
export const HUBSPOT_EMAILS = (() => {
  const rng = rngFor('hubspot-emails')
  const names = ['August Product Newsletter', 'New Showroom Launch', 'End of FY Clearance', 'Winter Trade Guide', 'Customer Spotlight: BuildRight', 'Sustainability Report 2026', 'EOFY Trade Offer', 'New Range: Cordless Tools', 'Webinar Invite: Trade Industry Trends', 'Case Study: Northgate Hardware']
  let sentTotal = 0, deliveredTotal = 0, unsubTotal = 0, openSum = 0, clickSum = 0
  const campaigns = names.map((name, i) => {
    const sent = randInt(rng, 3500, 9200)
    const delivered = Math.round(sent * randFloat(rng, 0.96, 0.995, 3))
    const openRate = randFloat(rng, 14, 34, 1)
    const clickRate = randFloat(rng, 1.2, 5.4, 1)
    const bounce = sent - delivered
    const unsubscribed = randInt(rng, 2, 22)
    sentTotal += sent; deliveredTotal += delivered; unsubTotal += unsubscribed
    openSum += openRate; clickSum += clickRate
    return { id: `email-${i}`, name, subject: name, sent, delivered, openRate, clickRate, bounce, unsubscribed }
  })
  return {
    avgOpenRate: Math.round((openSum / campaigns.length) * 10) / 10,
    avgClickRate: Math.round((clickSum / campaigns.length) * 10) / 10,
    totals: { sent: sentTotal, delivered: deliveredTotal, unsubscribed: unsubTotal },
    campaigns,
  }
})()

// ── /api/hubspot/contact/:id/activities [LIGHT] ─────────────────────────────
export function contactActivities(_contactId: string) {
  const rng = rngFor(`contact-activities-${_contactId}`)
  const kinds = ['EMAIL', 'CALL', 'MEETING', 'NOTE', 'FORM_SUBMISSION']
  const activities = Array.from({ length: randInt(rng, 2, 8) }, (_, i) => ({
    id: `act-${_contactId}-${i}`,
    type: pick(rng, kinds),
    timestamp: ymd(addDays(NOW, -randInt(rng, 0, 120))),
    summary: pick(rng, ['Left voicemail re: quote', 'Sent updated pricing', 'Discovery call', 'Site visit booked', 'Opened pricing email', 'Submitted RFQ form', 'Follow-up meeting scheduled']),
  }))
  return { activities }
}
