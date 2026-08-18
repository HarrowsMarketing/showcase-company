// /api/sales/cleanup, /api/sales/deals-to-win, /api/sales/big-rocks,
// /api/sales/install-schedule.
import { rngFor, pick, randInt, randFloat, weightedBool } from '../prng'
import { NOW, ymd, addDays, addMonths, shortMonthLabel, SALES_TEAM_NAMES } from './company'
import { OPEN_STAGES, dealName, dealAmount } from './dealGen'

// ── /api/sales/cleanup ───────────────────────────────────────────────────────
const AGE_BUCKETS = [
  { key: 'lt1m', label: '< 1 month', min: 0, max: 1 },
  { key: '1to3m', label: '1–3 months', min: 1, max: 3 },
  { key: '3to6m', label: '3–6 months', min: 3, max: 6 },
  { key: '6to12m', label: '6–12 months', min: 6, max: 12 },
  { key: 'gt12m', label: '12+ months', min: 12, max: 30 },
]
const PROB_BUCKETS = [
  { key: 'low', label: '0–20%', min: 0, max: 0.2 },
  { key: 'mid', label: '21–50%', min: 0.21, max: 0.5 },
  { key: 'high', label: '51–100%', min: 0.51, max: 1 },
]
const SIZE_BUCKETS = [
  { key: 'small', label: '< $20k', min: 0, max: 20000 },
  { key: 'mid', label: '$20k–$80k', min: 20000, max: 80000 },
  { key: 'large', label: '$80k+', min: 80000, max: 250000 },
]

export const SALES_CLEANUP = (() => {
  const rng = rngFor('sales-cleanup')
  const dealCount = randInt(rng, 90, 130)
  const deals = Array.from({ length: dealCount }, (_, i) => {
    const pipeline: 'NZ' | 'AU' = weightedBool(rng, 0.72) ? 'NZ' : 'AU'
    const ageMonthsF = randFloat(rng, 0, 26, 1)
    const ageBucket = AGE_BUCKETS.find(b => ageMonthsF >= b.min && ageMonthsF < b.max) || AGE_BUCKETS[AGE_BUCKETS.length - 1]
    const stageIdx = randInt(rng, 0, OPEN_STAGES.length - 1)
    const stage = OPEN_STAGES[stageIdx]
    const value = dealAmount(rng, 4000, 220000)
    const sizeBucket = SIZE_BUCKETS.find(b => value >= b.min && value < b.max) || SIZE_BUCKETS[SIZE_BUCKETS.length - 1]
    const probBucket = PROB_BUCKETS.find(b => stage.probability >= b.min && stage.probability <= b.max) || PROB_BUCKETS[0]
    const createdAt = addMonths(NOW, -Math.round(ageMonthsF)).getTime()
    const stale = ageMonthsF >= 3
    const daysSinceTouch = stale ? randInt(rng, 31, 220) : randInt(rng, 0, 30)
    const lastContactedAt = weightedBool(rng, 0.85) ? addDays(NOW, -daysSinceTouch).getTime() : null
    const installMonthsPast = weightedBool(rng, 0.15) ? randInt(rng, 1, 6) : null
    return {
      id: `cleanup-${i}`, name: dealName(rng), value, pipeline,
      stageId: stage.name.toLowerCase().replace(/\s+/g, '-'), stage: stage.name, prob: stage.probability, stageOrder: stageIdx,
      createdAt, ageMonths: Math.round(ageMonthsF), owner: pick(rng, SALES_TEAM_NAMES),
      lastContactedAt, daysSinceTouch: lastContactedAt ? daysSinceTouch : null,
      installMonthsPast, ageKey: ageBucket.key, probKey: probBucket.key, sizeKey: sizeBucket.key, stale,
    }
  })

  const groupBy = (buckets: { key: string; label: string }[], keyField: 'ageKey' | 'probKey' | 'sizeKey', extra?: (b: any) => object) =>
    buckets.map(b => {
      const inBucket = deals.filter(d => (d as any)[keyField] === b.key)
      const stale = inBucket.filter(d => d.stale)
      return {
        key: b.key, label: b.label, count: inBucket.length,
        value: inBucket.reduce((s, d) => s + d.value, 0),
        staleCount: stale.length, staleValue: stale.reduce((s, d) => s + d.value, 0),
        ...(extra ? extra(b) : {}),
      }
    })
  const stageGroups = OPEN_STAGES.map((s, i) => {
    const inStage = deals.filter(d => d.stageOrder === i)
    const stale = inStage.filter(d => d.stale)
    return {
      key: s.name.toLowerCase().replace(/\s+/g, '-'), label: s.name, count: inStage.length,
      value: inStage.reduce((sum, d) => sum + d.value, 0),
      staleCount: stale.length, staleValue: stale.reduce((sum, d) => sum + d.value, 0),
      prob: s.probability, order: i, pipeline: 'NZ',
    }
  })

  const stale = deals.filter(d => d.stale)
  const lowStale = stale.filter(d => d.prob <= 0.2)
  const lateStale = stale.filter(d => d.ageMonths >= 6)
  const pastInstall = deals.filter(d => d.installMonthsPast != null)
  const openValue = deals.reduce((s, d) => s + d.value, 0)

  return {
    staleMonths: 12, portalId: 'demo-portal', installProp: 'Expected Install Date',
    totals: {
      openCount: deals.length, openValue,
      staleCount: stale.length, staleValue: stale.reduce((s, d) => s + d.value, 0),
      lowStaleCount: lowStale.length, lowStaleValue: lowStale.reduce((s, d) => s + d.value, 0),
      lateStaleCount: lateStale.length, lateStaleValue: lateStale.reduce((s, d) => s + d.value, 0),
      pastInstallCount: pastInstall.length, pastInstallValue: pastInstall.reduce((s, d) => s + d.value, 0),
    },
    groups: {
      age: groupBy(AGE_BUCKETS, 'ageKey'),
      prob: groupBy(PROB_BUCKETS, 'probKey'),
      size: groupBy(SIZE_BUCKETS, 'sizeKey'),
      stage: stageGroups,
    },
    deals,
  }
})()

// ── /api/sales/deals-to-win ──────────────────────────────────────────────────
export const DEALS_TO_WIN = (() => {
  const rng = rngFor('deals-to-win')
  const build = (n: number, withOverdue: boolean) => Array.from({ length: n }, (_, i) => {
    const country: 'NZ' | 'AU' = weightedBool(rng, 0.7) ? 'NZ' : 'AU'
    const amount = dealAmount(rng, 6000, 200000)
    const closeDate = ymd(addDays(NOW, randInt(rng, withOverdue ? -10 : 0, 30)))
    const base = {
      id: `dtw-${withOverdue ? 'o' : 'n'}-${i}`, name: dealName(rng), owner: pick(rng, SALES_TEAM_NAMES),
      amount, nativeAmount: country === 'AU' ? Math.round(amount * 1.08) : amount,
      currency: country === 'AU' ? 'AUD' : 'NZD', country, closeDate,
    }
    return withOverdue ? { ...base, overdue: closeDate < ymd(NOW) } : { ...base, createDate: ymd(addDays(NOW, -randInt(rng, 0, 20))) }
  })
  return {
    generatedAt: NOW.toISOString(), horizon: addDays(NOW, 30).toISOString(),
    deals: build(14, true), newDeals: build(10, false), salespeople: SALES_TEAM_NAMES,
  }
})()

// ── /api/sales/big-rocks ─────────────────────────────────────────────────────
const ROCK_POOL = [
  'Close Mitre Trade Hardware bulk order', 'Follow up BuildRight Merchants quote', 'Site visit — Northgate Hardware Group',
  'Send revised proposal to Southern Cross Tool Co', 'Chase signature on Anchor Construction contract',
  'Book demo for Union Square Hardware', 'Finalise Pinnacle Construction pricing', 'Reconnect with Delta Logistics',
  'Prep RFQ response for Cedar Ridge Builders', 'Review AU pipeline with Ironbark Mining',
]
export const bigRocksStore = (() => {
  const rng = rngFor('big-rocks')
  const rocks: Record<string, string[]> = {}
  SALES_TEAM_NAMES.forEach(name => { rocks[name] = Array.from({ length: randInt(rng, 2, 4) }, () => pick(rng, ROCK_POOL)) })
  const completed = Array.from({ length: 4 }, (_, i) => ({
    name: pick(rng, SALES_TEAM_NAMES), text: pick(rng, ROCK_POOL), completedAt: addDays(NOW, -randInt(rng, 1, 20)).toISOString(),
  }))
  return { rocks, completed, team: SALES_TEAM_NAMES }
})()

// ── /api/sales/install-schedule ─────────────────────────────────────────────
export const INSTALL_SCHEDULE = (() => {
  const rng = rngFor('install-schedule')
  const rows = []
  let pastDueTotal = 0, wonTotal = 0, openTotal = 0
  for (let i = -6; i <= 12; i++) {
    const d = addMonths(new Date(NOW.getFullYear(), NOW.getMonth(), 1), i)
    const label = shortMonthLabel(d)
    const won = i <= 0 ? randInt(rng, 4, 14) : 0
    const open = i >= -1 ? randInt(rng, 2, 10) : 0
    const pastDue = i < 0 && i >= -3 ? randInt(rng, 0, 3) : 0
    pastDueTotal += pastDue; wonTotal += won; openTotal += open
    rows.push({ label, won, open, pastDue })
  }
  return { installProp: 'Expected Install Date', currentMonthLabel: shortMonthLabel(NOW), rows, totals: { pastDue: pastDueTotal, won: wonTotal, open: openTotal } }
})()
