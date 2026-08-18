// /api/customer/engagement + all its drill-downs — CustomerEngagement.tsx
// ("Client Development" tab). The other big revenue anchor: nzWon/auWon are
// pulled straight from company.ts so they agree exactly with /api/sales.
import { rngFor, pick, randInt, randFloat, weightedBool } from '../prng'
import {
  NOW, ymd, addDays, FY_LABEL_LONG, CURRENT_FY_MONTH_IDX, CURRENT_MONTH_ELAPSED_FRAC,
  NZ_FY_CURVE, AU_FY_CURVE, ANNUAL_TARGET_NZ, ANNUAL_TARGET_AU, CE_ACCOUNTS, SALES_TEAM_NAMES,
} from './company'
import { OPEN_STAGES, WON_STAGE, dealName, dealAmount, contactNameFor } from './dealGen'
import { SALES_DATA } from './sales'

const TIER_WEIGHT: Record<string, number> = { Platinum: 5, Gold: 3, Silver: 1.6, Bronze: 1 }

export interface AccountRow { [k: string]: any }

function buildAccounts(): AccountRow[] {
  const rng = rngFor('ce-accounts-full')
  const nzAccts = CE_ACCOUNTS.filter(a => a.country === 'NZ')
  const auAccts = CE_ACCOUNTS.filter(a => a.country === 'AU')

  function distribute(accts: typeof CE_ACCOUNTS, totalWon: number, annualTarget: number) {
    const weights = accts.map(a => TIER_WEIGHT[a.tier] * randFloat(rng, 0.7, 1.3, 3))
    const wSum = weights.reduce((a, b) => a + b, 0)
    const elapsedFrac = (CURRENT_FY_MONTH_IDX + CURRENT_MONTH_ELAPSED_FRAC) / 12
    return accts.map((a, i) => {
      const ytdWon = Math.round(totalWon * weights[i] / wSum)
      const ytdTarget = Math.round(annualTarget * weights[i] / wSum * elapsedFrac)
      const pctOfTarget = ytdTarget > 0 ? Math.round((ytdWon / ytdTarget) * 1000) / 10 : null
      const openCount = randInt(rng, 0, 6)
      const wonCount = randInt(rng, 1, 9)
      const lostCount = randInt(rng, 0, 5)
      const won12mCount = wonCount + randInt(rng, 0, 4)
      const lost12mCount = lostCount + randInt(rng, 0, 3)
      const designerCount = randInt(rng, 2, 14)
      const engagedDesignerCount = randInt(rng, 0, designerCount)
      const deals = Array.from({ length: randInt(rng, 1, 4) }, (_, di) => {
        const status: 'won' | 'open' | 'lost' = pick(rng, ['won', 'won', 'open', 'lost'])
        return { id: `${a.id}-deal-${di}`, name: dealName(rng, a.name), value: dealAmount(rng, 4000, 160000), stage: status === 'won' ? WON_STAGE : status === 'lost' ? 'Closed Lost' : pick(rng, OPEN_STAGES).name, status, manual: false }
      })
      return {
        id: a.id, name: a.name, manager: a.manager,
        ytdWon, ytdTarget, pctOfTarget, onTrack: pctOfTarget == null ? null : pctOfTarget >= 90,
        openPipeline: openCount * randInt(rng, 12000, 60000), openCount, wonCount, lostCount,
        convRate: Math.round((wonCount / Math.max(1, wonCount + lostCount)) * 1000) / 10,
        winRate12m: Math.round((won12mCount / Math.max(1, won12mCount + lost12mCount)) * 1000) / 10,
        won12mCount, lost12mCount, tier: a.tier, isGeneric: false,
        designerCount, engagedDesignerCount, deals,
      }
    })
  }

  const accounts = [
    ...distribute(nzAccts, NZ_FY_CURVE.ytdActual, ANNUAL_TARGET_NZ),
    ...distribute(auAccts, AU_FY_CURVE.ytdActual, ANNUAL_TARGET_AU),
  ]
  // One generic/unmatched bucket — opt-out companies with no target.
  accounts.push({
    id: 'generic-other', name: 'Other / Unmatched Accounts', manager: pick(rng, SALES_TEAM_NAMES),
    ytdWon: randInt(rng, 20000, 90000), ytdTarget: null, pctOfTarget: null, onTrack: null,
    openPipeline: randInt(rng, 10000, 60000), openCount: randInt(rng, 2, 10), wonCount: randInt(rng, 1, 6), lostCount: randInt(rng, 0, 4),
    convRate: randFloat(rng, 30, 60, 1), winRate12m: randFloat(rng, 30, 60, 1), won12mCount: randInt(rng, 3, 10), lost12mCount: randInt(rng, 1, 6),
    tier: null, isGeneric: true, designerCount: null, engagedDesignerCount: null, deals: [],
  })
  return accounts.sort((a, b) => b.ytdWon - a.ytdWon)
}

export const CE_ACCOUNT_ROWS = buildAccounts()

export const CE_ENGAGEMENT = (() => {
  const rng = rngFor('ce-engagement-summary')
  const target = ANNUAL_TARGET_NZ + ANNUAL_TARGET_AU
  const nzWon = NZ_FY_CURVE.ytdActual, auWon = AU_FY_CURVE.ytdActual
  const nzOpen = SALES_DATA.NZ.openPipeline, auOpen = SALES_DATA.AU.openPipeline
  const nzLost = Math.round(nzWon * randFloat(rng, 0.5, 0.8, 2))
  const auLost = Math.round(auWon * randFloat(rng, 0.5, 0.8, 2))
  const elapsedFrac = (CURRENT_FY_MONTH_IDX + CURRENT_MONTH_ELAPSED_FRAC) / 12
  const projected = Math.round((nzWon + auWon) / elapsedFrac)
  return {
    accounts: CE_ACCOUNT_ROWS,
    fyLabel: FY_LABEL_LONG, hasTargets: true,
    hubspotOwners: SALES_TEAM_NAMES, ceSalespeople: SALES_TEAM_NAMES,
    revenueSummary: {
      target, cardTarget: Math.round(target / CE_ACCOUNT_ROWS.length),
      nzWon, nzOpen, nzLost, auOpen, auWon, auLost,
      nzConv: Math.round((nzWon / (nzWon + nzLost)) * 1000) / 10,
      auConv: Math.round((auWon / (auWon + auLost)) * 1000) / 10,
      openWonInPipeline: nzOpen + auOpen,
      projected, shortfall: target - projected,
      projectedInFY: projected, shortfallInFY: target - projected,
      auPipelineFound: true,
    },
  }
})()

// ── /api/customer/regions?card= ──────────────────────────────────────────────
function completionCell(rng: ReturnType<typeof rngFor>) {
  const daysSince = weightedBool(rng, 0.85) ? randInt(rng, 1, 400) : null
  return { status: (daysSince != null && daysSince <= 60 ? 'green' : 'red') as 'green' | 'red', lastDate: daysSince != null ? ymd(addDays(NOW, -daysSince)) : null, daysSince }
}
export function regionsFor(card: string) {
  const rng = rngFor(`regions-${card}`)
  const account = CE_ACCOUNT_ROWS.find(a => a.name === card)
  const cityPool = ['Auckland', 'Wellington', 'Christchurch', 'Hamilton', 'Sydney', 'Melbourne', 'Brisbane']
  const nLocations = randInt(rng, 1, 3)
  const locations = Array.from({ length: nLocations }, (_, i) => {
    const nContacts = randInt(rng, 1, 6)
    const contacts = Array.from({ length: nContacts }, (_, ci) => {
      const daysSince = weightedBool(rng, 0.9) ? randInt(rng, 0, 400) : null
      const score: 'A' | 'B' | 'C' = daysSince == null ? 'C' : daysSince <= 60 ? 'A' : daysSince <= 180 ? 'B' : 'C'
      return { id: `${card}-contact-${i}-${ci}`, name: contactNameFor(rng), email: `${contactNameFor(rng).toLowerCase().replace(' ', '.')}@example.com`, jobTitle: pick(rng, ['Facilities Manager', 'Head of Workplace', 'Procurement Lead', 'Interior Designer', 'Office Manager']), lastContacted: daysSince != null ? ymd(addDays(NOW, -daysSince)) : null, score, isDesigner: weightedBool(rng, 0.6) }
    })
    return {
      companyId: `${account?.id || 'unknown'}-loc-${i}`, name: `${card} — ${cityPool[i % cityPool.length]}`, city: cityPool[i % cityPool.length], confirmed: weightedBool(rng, 0.75),
      contacts,
      completion: { bd_presentation: completionCell(rng), f2f: completionCell(rng), monthly_admin: completionCell(rng) },
    }
  })
  return { card, cardNorm: card.toLowerCase().replace(/\s+/g, '-'), locations, undefined: { contacts: [] } }
}

// ── /api/customer/history?card= ─────────────────────────────────────────────
export function historyFor(card: string) {
  const rng = rngFor(`history-${card}`)
  const account = CE_ACCOUNT_ROWS.find(a => a.name === card)
  const base = account?.ytdWon || randInt(rng, 30000, 200000)
  const years = [2023, 2024, 2025].map(fyStartYear => ({
    fyStartYear, won: Math.round(base * randFloat(rng, 0.7, 1.5, 3)), dealCount: randInt(rng, 2, 14),
    fyLabel: `FY${String(fyStartYear).slice(2)}/${String(fyStartYear + 1).slice(2)}`,
  }))
  return { years }
}

// ── /api/customer/activity ───────────────────────────────────────────────────
const ACTIVITY_META = [
  { key: 'head_office_trip', label: 'Head Office Trip', staleDays: 180, derived: false },
  { key: 'director_contact', label: 'Director Contact', staleDays: 90, derived: false },
  { key: 'bd_presentation', label: 'BD Presentation', staleDays: 365, derived: true, sourceLabel: 'HubSpot: BD Visit' },
  { key: 'f2f', label: 'Face to Face', staleDays: 120, derived: true, sourceLabel: 'HubSpot: Meetings' },
  { key: 'monthly_admin', label: 'Monthly Admin Check-in', staleDays: 45, derived: true, sourceLabel: 'HubSpot: Calls / Emails' },
]
export const CE_ACTIVITY = (() => {
  const rng = rngFor('ce-activity')
  const cell = (staleDays: number) => {
    const daysSince = weightedBool(rng, 0.8) ? randInt(rng, 1, staleDays * 2) : null
    return { lastDate: daysSince != null ? ymd(addDays(NOW, -daysSince)) : null, daysSince, status: (daysSince != null && daysSince <= staleDays ? 'green' : 'red') as 'green' | 'red', count: daysSince != null ? randInt(rng, 1, 6) : 0, derived: false }
  }
  const accounts = CE_ACCOUNT_ROWS.filter(a => !a.isGeneric).map(a => {
    const activity: Record<string, any> = {}
    ACTIVITY_META.forEach(m => { activity[m.key] = { ...cell(m.staleDays), derived: !!m.derived } })
    return { name: a.name, manager: a.manager, activity, locations: [] }
  })
  return { accounts, activities: ACTIVITY_META }
})()

// ── /api/customer/company/:id ────────────────────────────────────────────────
export function companyProfile(id: string) {
  const rng = rngFor(`company-profile-${id}`)
  const account = CE_ACCOUNT_ROWS.find(a => a.id === id) || CE_ACCOUNT_ROWS[0]
  const nContacts = randInt(rng, 3, 12)
  const scoreCounts = { A: 0, B: 0, C: 0 }
  const contacts = Array.from({ length: nContacts }, (_, i) => {
    const score: 'A' | 'B' | 'C' = pick(rng, ['A', 'A', 'B', 'B', 'C'])
    scoreCounts[score]++
    const isDesigner = weightedBool(rng, 0.65)
    return { id: `${id}-c-${i}`, name: contactNameFor(rng), email: `contact${i}@example.com`, jobTitle: pick(rng, ['Interior Designer', 'Facilities Manager', 'Procurement Lead', 'Office Manager']), isDesigner, lastContact: ymd(addDays(NOW, -randInt(rng, 0, 300))), score }
  })
  return {
    company: { id, name: account.name, domain: `${account.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.example.com`, industry: pick(rng, ['Architecture', 'Healthcare', 'Education', 'Financial Services', 'Construction', 'Hospitality']), city: pick(rng, ['Auckland', 'Wellington', 'Christchurch', 'Sydney', 'Melbourne']), phone: `+64 9 ${randInt(rng, 200, 999)} ${randInt(rng, 1000, 9999)}`, numberOfEmployees: String(randInt(rng, 20, 900)), description: `${account.name} is a long-standing client account in the customer engagement programme.` },
    contacts, designerCount: contacts.filter(c => c.isDesigner).length, designerScoreCounts: scoreCounts,
  }
}

// ── /api/hubspot/companies/search, /api/hubspot/deals/search ───────────────
export function companiesSearch(q: string) {
  if (!q || q.length < 2) return { results: [] }
  const results = CE_ACCOUNT_ROWS.filter(a => a.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8).map(a => ({ id: a.id, name: a.name }))
  return { results }
}
export function dealsSearch(q: string) {
  const rng = rngFor(`deals-search-${q}`)
  if (!q || q.length < 2) return { results: [] }
  const results = Array.from({ length: randInt(rng, 2, 6) }, (_, i) => ({ id: `deal-search-${q}-${i}`, name: dealName(rng, q), value: dealAmount(rng, 6000, 180000), closeDate: ymd(addDays(NOW, randInt(rng, -20, 40))) }))
  return { results }
}
