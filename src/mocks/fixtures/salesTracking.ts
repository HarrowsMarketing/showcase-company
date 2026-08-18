// /api/sales/tracking (the richest single endpoint), /api/sales/invoiced-fy,
// /api/management/manual-metrics, /api/management/kpi-tiles.
import { rngFor, randInt, randFloat } from '../prng'
import {
  NOW, ymd, FY_LABEL, FY_MONTHS, CURRENT_FY_MONTH_IDX, CURRENT_MONTH_ELAPSED_FRAC,
  NZ_FY_CURVE, AU_FY_CURVE, ANNUAL_TARGET_NZ, ANNUAL_TARGET_AU, SALES_TEAM,
} from './company'
import { SALES_DATA } from './sales'

const CURRENT_MONTH_LABEL = FY_MONTHS[CURRENT_FY_MONTH_IDX].label

// Generic FyMonth[] builder (used for both fyMonths/auFyMonths, 12 entries, and
// fyWeeks/auFyWeeks, ~52 entries) — same shape either way per SalesTracking.tsx's
// single `FyMonth` interface.
function buildFyPeriods(streamName: string, curve: typeof NZ_FY_CURVE, annualTarget: number, periodsPerYear: 12 | 52) {
  const rng = rngFor(streamName)
  const n = periodsPerYear
  const perPeriodTarget = annualTarget / n
  const currentPeriodIdx = periodsPerYear === 12 ? CURRENT_FY_MONTH_IDX : Math.floor(CURRENT_FY_MONTH_IDX * (52 / 12) + CURRENT_MONTH_ELAPSED_FRAC * (52 / 12))
  const avgDealSize = curve.avgDealSize

  let cumNewDeals = 0, cumWon = 0, cumNewDealsTarget = 0, cumWonTarget = 0
  let prevCumNewDeals = 0, prevCumWon = 0
  const out = [] as any[]
  for (let i = 0; i < n; i++) {
    const isCurrentOrPast = i <= currentPeriodIdx
    const periodFrac = i === currentPeriodIdx ? CURRENT_MONTH_ELAPSED_FRAC : 1
    const target = Math.round(perPeriodTarget)
    const wonDealsTarget = Math.max(1, Math.round(target / avgDealSize))
    const newDealsTarget = Math.max(1, Math.round(wonDealsTarget * randFloat(rng, 1.5, 2.1, 2)))
    let wonDeals = 0, newDeals = 0
    if (isCurrentOrPast) {
      wonDeals = Math.max(0, Math.round(wonDealsTarget * periodFrac * randFloat(rng, 0.75, 1.25, 3)))
      newDeals = Math.max(0, Math.round(newDealsTarget * periodFrac * randFloat(rng, 0.75, 1.3, 3)))
    }
    cumNewDeals += newDeals; cumWon += wonDeals
    cumNewDealsTarget += newDealsTarget; cumWonTarget += wonDealsTarget

    const prevWonDeals = Math.max(0, Math.round(wonDealsTarget * randFloat(rng, 0.7, 1.1, 3)))
    const prevNewDeals = Math.max(0, Math.round(newDealsTarget * randFloat(rng, 0.7, 1.15, 3)))
    prevCumNewDeals += prevNewDeals; prevCumWon += prevWonDeals

    out.push({
      label: periodsPerYear === 12 ? curve.months[i].label : `W${i + 1}`,
      newDeals, wonDeals, newDealsTarget, wonDealsTarget,
      cumulativeNewDeals: cumNewDeals, cumulativeWon: cumWon,
      cumulativeNewDealsTarget: Math.round(cumNewDealsTarget), cumulativeWonTarget: Math.round(cumWonTarget),
      isCurrentOrPast,
      prevNewDeals, prevWonDeals,
      prevCumulativeNewDeals: prevCumNewDeals, prevCumulativeWon: prevCumWon,
    })
  }
  return out
}

function metric(actual: number, target: number, extra: Record<string, number> = {}) {
  return { actual, target, ...extra }
}

function buildCountry(country: 'NZ' | 'AU') {
  const streamName = `tracking-${country}`
  const rng = rngFor(streamName)
  const curve = country === 'NZ' ? NZ_FY_CURVE : AU_FY_CURVE
  const annualTarget = country === 'NZ' ? ANNUAL_TARGET_NZ : ANNUAL_TARGET_AU
  const fyMonths = buildFyPeriods(`${streamName}-months`, curve, annualTarget, 12)
  const fyWeeks = buildFyPeriods(`${streamName}-weeks`, curve, annualTarget, 52)
  const curMonth = fyMonths[CURRENT_FY_MONTH_IDX]
  const monthTarget = curve.months[CURRENT_FY_MONTH_IDX].target
  const prevMonth = curve.months[CURRENT_FY_MONTH_IDX - 1]?.actual ?? Math.round(monthTarget * 0.9)

  const monthlyNewDeals = metric(curMonth.newDeals, Math.round(curMonth.newDealsTarget * CURRENT_MONTH_ELAPSED_FRAC), { fullMonthTarget: curMonth.newDealsTarget, prevMonth: curMonth.prevNewDeals })
  const monthlySales = metric(curve.months[CURRENT_FY_MONTH_IDX].actual ?? 0, Math.round(monthTarget * CURRENT_MONTH_ELAPSED_FRAC), { fullMonthTarget: monthTarget, prevMonth })
  const monthlyKpiPoints = metric(randInt(rng, 320, 480), 500, { fullMonthTarget: 500 })
  const dailyTargetSales = Math.round(monthTarget / 22)
  const dailyNewDeals = metric(randInt(rng, 0, 4), Math.max(1, Math.round(curMonth.newDealsTarget / 22)))
  const dailySales = metric(randInt(rng, 0, Math.round(dailyTargetSales * 1.6)), dailyTargetSales)
  const dailyKpiPoints = metric(randInt(rng, 10, 30), 22)
  const yesterdayNewDeals = metric(randInt(rng, 0, 4), Math.max(1, Math.round(curMonth.newDealsTarget / 22)))
  const yesterdaySales = metric(randInt(rng, 0, Math.round(dailyTargetSales * 1.6)), dailyTargetSales)

  const salesTable = SALES_TEAM.slice(0, country === 'NZ' ? 6 : 3).map(p => ({ name: p.name, total: 0 }))
  let remaining = curve.ytdActual
  const weights = salesTable.map(() => randFloat(rng, 0.6, 1.6, 3))
  const wSum = weights.reduce((a, b) => a + b, 0)
  salesTable.forEach((row, i) => { row.total = Math.round(remaining * weights[i] / wSum) })

  const newDealsAccumulated = {
    actual: fyMonths.reduce((s, m) => s + m.newDeals, 0),
    annualised: Math.round(fyMonths.reduce((s, m) => s + m.newDeals, 0) / (CURRENT_FY_MONTH_IDX + CURRENT_MONTH_ELAPSED_FRAC) * 12),
    target: fyMonths.reduce((s, m) => s + m.newDealsTarget, 0),
  }
  const yearlySales = { actual: curve.ytdActual, prevMonth, target: annualTarget }

  return {
    fyMonths, fyWeeks, monthlyNewDeals, monthlySales, monthlyKpiPoints,
    dailyNewDeals, dailySales, dailyKpiPoints, yesterdayNewDeals, yesterdaySales,
    monthlySalesTable: salesTable, newDealsAccumulated, yearlySales,
  }
}

const NZ_TRACK = buildCountry('NZ')
const AU_TRACK = buildCountry('AU')

export const SALES_TRACKING = {
  fyLabel: FY_LABEL,
  currentMonth: CURRENT_MONTH_LABEL,
  fyMonths: NZ_TRACK.fyMonths,
  fyWeeks: NZ_TRACK.fyWeeks,
  monthlyNewDeals: NZ_TRACK.monthlyNewDeals,
  monthlySales: NZ_TRACK.monthlySales,
  monthlyKpiPoints: NZ_TRACK.monthlyKpiPoints,
  dailyNewDeals: NZ_TRACK.dailyNewDeals,
  dailySales: NZ_TRACK.dailySales,
  dailyKpiPoints: NZ_TRACK.dailyKpiPoints,
  yesterdayNewDeals: NZ_TRACK.yesterdayNewDeals,
  yesterdaySales: NZ_TRACK.yesterdaySales,
  range: { from: ymd(FY_MONTHS[CURRENT_FY_MONTH_IDX].start), to: ymd(NOW), isFullMonth: false },
  monthlySalesTable: NZ_TRACK.monthlySalesTable,
  newDealsAccumulated: NZ_TRACK.newDealsAccumulated,
  yearlySales: NZ_TRACK.yearlySales,
  pipelineNz: { actual: SALES_DATA.NZ.openPipeline, target: Math.round(ANNUAL_TARGET_NZ * 0.35) },
  pipelineAu: { actual: SALES_DATA.AU.openPipeline, target: Math.round(ANNUAL_TARGET_AU * 0.35) },
  pipelineOverall: { actual: SALES_DATA.NZ.openPipeline + SALES_DATA.AU.openPipeline, target: Math.round((ANNUAL_TARGET_NZ + ANNUAL_TARGET_AU) * 0.35) },
  auFyMonths: AU_TRACK.fyMonths,
  auFyWeeks: AU_TRACK.fyWeeks,
  auMonthlyNewDeals: AU_TRACK.monthlyNewDeals,
  auMonthlySales: AU_TRACK.monthlySales,
  auDailyNewDeals: AU_TRACK.dailyNewDeals,
  auDailySales: AU_TRACK.dailySales,
  auSalesTable: AU_TRACK.monthlySalesTable,
  auNewDealsAccumulated: AU_TRACK.newDealsAccumulated,
  auYearlySales: AU_TRACK.yearlySales,
  _debug: { mock: true },
}

// ── /api/sales/invoiced-fy ───────────────────────────────────────────────────
export const INVOICED_FY = (() => {
  const rng = rngFor('invoiced-fy')
  let ytdActual = 0, ytdTarget = 0
  const byMonth = FY_MONTHS.map((m, i) => {
    const target = Math.round(ANNUAL_TARGET_NZ / 12 * (0.8 + (i % 4) * 0.1))
    const isPast = i < CURRENT_FY_MONTH_IDX
    const isCurrent = i === CURRENT_FY_MONTH_IDX
    const isFuture = i > CURRENT_FY_MONTH_IDX
    let actual = 0
    if (isPast) actual = Math.round(target * randFloat(rng, 0.85, 1.15, 3))
    else if (isCurrent) actual = Math.round(target * CURRENT_MONTH_ELAPSED_FRAC * randFloat(rng, 0.85, 1.15, 3))
    if (isPast || isCurrent) { ytdActual += actual; ytdTarget += isCurrent ? Math.round(target * CURRENT_MONTH_ELAPSED_FRAC) : target }
    const completed = isPast ? actual : isCurrent ? actual : 0
    const scheduled = isFuture ? target : Math.max(0, target - completed)
    return {
      label: m.label, actual, target, completed, scheduled,
      source: isPast ? 'completed' : isCurrent ? 'current' : 'scheduled',
      isPast, isCurrent, isFuture,
    }
  })
  return { fyLabel: FY_LABEL, currentLabel: CURRENT_MONTH_LABEL, byMonth, ytd: { actual: ytdActual, target: ytdTarget } }
})()

// ── /api/management/manual-metrics ───────────────────────────────────────────
export const MANUAL_METRICS = (() => {
  const rng = rngFor('manual-metrics')
  const monthTarget = Math.round(ANNUAL_TARGET_NZ / 12)
  const completed = Math.round(monthTarget * CURRENT_MONTH_ELAPSED_FRAC * randFloat(rng, 0.9, 1.1, 3))
  const toBeInvoiced = Math.max(0, monthTarget - completed)
  return {
    difot: randFloat(rng, 90, 98, 1),
    invoicedSales: { actual: completed, target: Math.round(monthTarget * CURRENT_MONTH_ELAPSED_FRAC) },
    forwardOrderValue: randInt(rng, 11_000_000, 16_500_000),
    cashOnHand: randInt(rng, 3_200_000, 6_100_000),
    scheduledInvoicedSales: { actual: completed, target: monthTarget },
    monthlyInvoicedSales: { actual: completed, target: monthTarget, completed, toBeInvoiced },
  }
})()

// ── /api/management/kpi-tiles [LIGHT] ───────────────────────────────────────
export const KPI_TILES = (() => {
  const rng = rngFor('kpi-tiles')
  const tiles = [
    { id: 't-safety-incidents', label: 'Safety Incidents (MTD)', kind: 'yesno', actual: 0, target: 0, group: 'Safety' },
    { id: 't-near-miss', label: 'Near-Miss Reports', kind: 'count', actual: randInt(rng, 0, 3), target: 0, group: 'Safety' },
    { id: 't-difot', label: 'DIFOT', kind: 'percent', actual: MANUAL_METRICS.difot, target: 95, group: 'Operations', sublabel: 'On-time-in-full' },
    { id: 't-forward-order', label: 'Forward Order Value', kind: 'dollar', actual: MANUAL_METRICS.forwardOrderValue, target: 12_000_000, group: 'Operations' },
    { id: 't-cash', label: 'Cash on Hand', kind: 'dollar', actual: MANUAL_METRICS.cashOnHand, target: 4_000_000, group: 'Finance' },
    { id: 't-invoiced', label: 'Invoiced Sales (MTD)', kind: 'dollar', actual: MANUAL_METRICS.monthlyInvoicedSales.actual, target: MANUAL_METRICS.monthlyInvoicedSales.target, group: 'Finance' },
    { id: 't-new-starters', label: 'New Starters', kind: 'count', actual: randInt(rng, 0, 4), target: 0, group: 'People' },
    { id: 't-open-roles', label: 'Open Roles', kind: 'count', actual: randInt(rng, 1, 5), target: 0, group: 'People' },
  ]
  return { tiles }
})()
