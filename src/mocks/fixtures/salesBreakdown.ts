// /api/sales/breakdown?from&to — SalesBreakdown.tsx's pipeline drop-off funnel.
import { rngFor, pick, randInt, randFloat } from '../prng'
import { NOW, ymd, addDays, FY_LABEL, SALES_TEAM_NAMES } from './company'
import { OPEN_STAGES, WON_STAGE, dealName, dealAmount } from './dealGen'
import { SALES_DATA } from './sales'

const CORRIDOR_NAMES = ['NZ North Island', 'NZ South Island', 'AU East Coast', 'AU West/Other']

function dealSnap(rng: ReturnType<typeof rngFor>, stage: { name: string; probability: number } | { name: string; probability: number }, daysOut: number) {
  return {
    id: `snap-${Math.round(rng() * 1e9)}`,
    name: dealName(rng),
    owner: pick(rng, SALES_TEAM_NAMES),
    value: dealAmount(rng, 8000, 210000),
    closeDate: ymd(addDays(NOW, daysOut)),
    probability: stage.probability,
    stage: stage.name,
  }
}

export const SALES_BREAKDOWN = (() => {
  const rng = rngFor('sales-breakdown')
  const totalOpenCount = SALES_DATA.NZ.openCount + SALES_DATA.AU.openCount
  const totalOpenValue = SALES_DATA.NZ.openPipeline + SALES_DATA.AU.openPipeline

  let remainingCount = totalOpenCount
  const stages = OPEN_STAGES.map((s, i) => {
    const isLast = i === OPEN_STAGES.length - 1
    const count = isLast ? remainingCount : Math.max(2, Math.round(totalOpenCount * (0.3 - i * 0.04) * randFloat(rng, 0.85, 1.15, 2)))
    remainingCount -= count
    const value = Math.round(totalOpenValue * (count / totalOpenCount))
    const closedSample = randInt(rng, 18, 90)
    const actualWinCountPct = Math.round((s.probability * 100) * randFloat(rng, 0.85, 1.1, 2))
    return {
      id: s.name.toLowerCase().replace(/\s+/g, '-'), label: s.name, probability: s.probability,
      count: Math.max(0, count), value: Math.max(0, value), avgAgeDays: randInt(rng, 5, 60),
      actualWinValuePct: Math.min(99, Math.round(actualWinCountPct * randFloat(rng, 0.9, 1.1, 2))),
      actualWinCountPct: Math.min(99, actualWinCountPct),
      closedSample,
    }
  })

  const wonCount = SALES_DATA.NZ.wonCount + SALES_DATA.AU.wonCount
  const wonValue = SALES_DATA.NZ.closedWonValue + SALES_DATA.AU.closedWonValue
  const lostCount = SALES_DATA.NZ.lostCount + SALES_DATA.AU.lostCount
  const lostValue = Math.round(wonValue * randFloat(rng, 0.5, 0.8, 2))
  const winRate = Math.round((wonCount / (wonCount + lostCount)) * 1000) / 10

  const corridors = CORRIDOR_NAMES.map(name => {
    const openCount = randInt(rng, 8, 24)
    const wc = randInt(rng, 6, 22)
    const lc = randInt(rng, 3, 14)
    return {
      name,
      open: { count: openCount, value: openCount * randInt(rng, 12000, 42000) },
      won: { count: wc, value: wc * randInt(rng, 12000, 42000) },
      lost: { count: lc, value: lc * randInt(rng, 8000, 30000) },
      winRate: Math.round((wc / (wc + lc)) * 1000) / 10,
    }
  })

  const salespeople = SALES_TEAM_NAMES.map(name => {
    const openCount = randInt(rng, 6, 22)
    const wc = randInt(rng, 8, 30)
    const lc = randInt(rng, 4, 18)
    return {
      name,
      open: { count: openCount, value: openCount * randInt(rng, 12000, 45000) },
      won: { count: wc, value: wc * randInt(rng, 12000, 45000) },
      lost: { count: lc, value: lc * randInt(rng, 8000, 32000) },
      winRate: Math.round((wc / (wc + lc)) * 1000) / 10,
    }
  })

  const pipeSplit = {
    next1to4: Array.from({ length: 6 }, () => dealSnap(rng, pick(rng, OPEN_STAGES), randInt(rng, 1, 28))),
    next5to8: Array.from({ length: 6 }, () => dealSnap(rng, pick(rng, OPEN_STAGES), randInt(rng, 29, 56))),
    next9to12: Array.from({ length: 5 }, () => dealSnap(rng, pick(rng, OPEN_STAGES), randInt(rng, 57, 84))),
    top20pct: Array.from({ length: 8 }, () => dealSnap(rng, pick(rng, OPEN_STAGES), randInt(rng, 1, 84))).sort((a, b) => b.value - a.value),
  }

  const funnelOverall = stages.map(s => ({ id: s.id, label: s.label, count: s.count }))
  funnelOverall.push({ id: 'closed-won', label: WON_STAGE, count: wonCount })
  const bySalesperson: Record<string, { id: string; label: string; count: number }[]> = {}
  const excludedBySalesperson: Record<string, number> = {}
  SALES_TEAM_NAMES.forEach(name => {
    const share = randFloat(rng, 0.6, 1.5, 3)
    bySalesperson[name] = stages.map(s => ({ id: s.id, label: s.label, count: Math.max(0, Math.round(s.count * share / SALES_TEAM_NAMES.length)) }))
    excludedBySalesperson[name] = randInt(rng, 0, 4)
  })

  return {
    fyLabel: FY_LABEL,
    stages,
    stageWinRateMeta: { windowMonths: 12, closedCount: wonCount + lostCount, excludedCount: randInt(rng, 2, 9) },
    totalOpen: { count: totalOpenCount, value: totalOpenValue, avgAgeDays: randInt(rng, 18, 40) },
    winLoss: { won: { count: wonCount, value: wonValue }, lost: { count: lostCount, value: lostValue }, winRate },
    corridors,
    hasCorridorData: true,
    salespeople,
    pipeSplit,
    funnel: { overall: funnelOverall, bySalesperson, excludedCount: randInt(rng, 4, 14), excludedBySalesperson },
  }
})()
