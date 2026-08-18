// /api/sales/forecast — generates ~200 fake HubSpot-shaped deal records and runs
// them through the REAL forecast-core.js math (aggregateDeals/conversionCurve/
// buildForecast/applyActualWonToCurrentMonth), so the forecast curve shown in
// ForecastDashboard.tsx is genuinely derived, not hand-typed — the most
// "look, it's real math" surface for an AI-audience demo.
import { rngFor, randInt, randFloat, weightedBool } from '../prng'
import { NOW, addMonths, addDays, shortMonthLabel, ANNUAL_TARGET_NZ } from './company'
import { dealAmount } from './dealGen'
import {
  aggregateDeals, conversionCurve, averageMonthlyLead, trendInflowParams,
  trendInflowAt, buildForecast, applyActualWonToCurrentMonth, msToIdx,
} from '../../../lib/forecast-core.js'

const NZ_OFFSET = 12 // NZST, ignoring DST — fine for fake data
const WON_STAGE_ID = 'closedwon'
const LOST_STAGE_ID = 'closedlost'
const OPEN_STAGE_ID = 'open'
const wonStageIds = new Set([WON_STAGE_ID])

const nowIdx = msToIdx(NOW.getTime(), NZ_OFFSET)
const MONTHS_BACK = 30
const startIdx = nowIdx - MONTHS_BACK
const K = 11 // max lag (months) tracked by the conversion curve

// Roughly the same monthly run-rate as the company's NZ FY target, so the
// forecast's projected annual total lands in a believable range without being
// forced to exactly equal the /api/sales anchor (this is genuinely a different
// model — lead-to-win conversion — not a restatement of booked revenue).
const AVG_MONTHLY_LEAD_VALUE = (ANNUAL_TARGET_NZ / 12) * 1.6 // pipeline > revenue
const AVG_DEAL = 42_000

function generateDeals() {
  const rng = rngFor('forecast-deals')
  const deals: { properties: Record<string, string> }[] = []
  for (let c = startIdx; c <= nowIdx; c++) {
    const monthsAgo = nowIdx - c
    // Mild growth trend heading into "now" so the curve isn't flat.
    const growth = 1 + (MONTHS_BACK - monthsAgo) / MONTHS_BACK * 0.35
    const cohortLeadValue = AVG_MONTHLY_LEAD_VALUE * growth * randFloat(rng, 0.75, 1.25, 3)
    const dealCount = Math.max(3, Math.round(cohortLeadValue / AVG_DEAL))
    // Cohort's calendar month, for picking a plausible day-of-month createdate.
    const cohortDate = addMonths(new Date(NOW.getFullYear(), NOW.getMonth(), 1), -monthsAgo)
    const daysInCohortMonth = new Date(cohortDate.getFullYear(), cohortDate.getMonth() + 1, 0).getDate()

    for (let i = 0; i < dealCount; i++) {
      const amount = dealAmount(rng, 6000, 180000)
      const createDay = Math.min(daysInCohortMonth, randInt(rng, 1, daysInCohortMonth))
      const createdate = new Date(cohortDate.getFullYear(), cohortDate.getMonth(), createDay, randInt(rng, 8, 17)).getTime()

      // A cohort can only be OBSERVED winning at lags that have fully elapsed
      // (matches conversionCurve's own right-censoring) — a deal created last
      // month can't show a 6-month-lag win yet.
      const maxObservableLag = Math.min(K, monthsAgo)
      // ~28% ultimate win probability, spread across lags 0..K with a peak
      // around lag 2-4 (typical sales-cycle shape).
      const willWin = weightedBool(rng, 0.28) && maxObservableLag >= 0
      let dealstage = OPEN_STAGE_ID
      let closedate: number | null = null
      if (willWin) {
        // Triangular-ish lag distribution peaking at lag 3.
        const lag = Math.min(maxObservableLag, Math.max(0, Math.round(randFloat(rng, 0, 1, 3) * randFloat(rng, 0, 1, 3) * 8 + 1)))
        if (lag <= maxObservableLag) {
          dealstage = WON_STAGE_ID
          const closeMonth = addMonths(cohortDate, lag)
          const closeDay = Math.min(new Date(closeMonth.getFullYear(), closeMonth.getMonth() + 1, 0).getDate(), randInt(rng, 1, 28))
          closedate = new Date(closeMonth.getFullYear(), closeMonth.getMonth(), closeDay).getTime()
        }
      } else if (weightedBool(rng, 0.4)) {
        dealstage = LOST_STAGE_ID
      }
      deals.push({ properties: { createdate: String(createdate), closedate: closedate ? String(closedate) : '', dealstage, amount: String(amount), hs_converted_amount: '', amount_in_home_currency: '' } })
    }
  }
  return deals
}

const DEALS = generateDeals()
const agg = aggregateDeals(DEALS, { nzOffset: NZ_OFFSET, wonStageIds })
const p = conversionCurve({ leadValue: agg.leadValue, wonCohortLag: agg.wonCohortLag, startIdx, nowIdx, K })
const overallConversionPct = Math.round(p.reduce((s, v) => s + v, 0) * 1000) / 10
const { avg: projectedMonthlyLead, growth } = trendInflowParams({ leadValue: agg.leadValue, nowIdx })
const inflowTrendPct = Math.round((growth - 1) * 1000) / 10
const assumedInflow = trendInflowAt({ avg: projectedMonthlyLead })

const rows = buildForecast({ p, K, nowIdx, lv: (idx: number) => (idx <= nowIdx ? (agg.leadValue[idx] || 0) : assumedInflow), months: 12 })
const daysInCurrentMonth = new Date(NOW.getFullYear(), NOW.getMonth() + 1, 0).getDate()
rows[0] = applyActualWonToCurrentMonth(rows[0], { actualWon: agg.actualWon[nowIdx] || 0, elapsedDays: NOW.getDate(), daysInMonth: daysInCurrentMonth })

const totalProjected12mo = rows.reduce((s, r) => s + r.projectedWon, 0)

const forecastRows = rows.map((r, i) => {
  const d = addMonths(new Date(NOW.getFullYear(), NOW.getMonth(), 1), i)
  return {
    label: shortMonthLabel(d), projectedWon: r.projectedWon, fromExistingLeads: r.fromExistingLeads,
    fromFutureLeads: r.fromFutureLeads, isCurrentMonth: r.isCurrentMonth,
    ...(r.isCurrentMonth ? { actualWon: (r as any).actualWon } : {}),
  }
})

const history = Array.from({ length: 12 }, (_, i) => {
  const idx = nowIdx - (11 - i)
  const d = addMonths(new Date(NOW.getFullYear(), NOW.getMonth(), 1), -(11 - i))
  return { label: shortMonthLabel(d), leadValue: Math.round(agg.leadValue[idx] || 0), won: Math.round(agg.actualWon[idx] || 0) }
})

// FY26/27 remaining forecast: current month's not-yet-elapsed share + the rest
// of the FY months captured in the 12-month forward window.
const fyRemainingMonths = forecastRows.slice(0, 8) // Aug (partial) .. Mar
const fromExistingLeads = fyRemainingMonths.reduce((s, r) => s + r.fromExistingLeads, 0)
const fromAssumedInflow = fyRemainingMonths.reduce((s, r) => s + r.fromFutureLeads, 0)
const actualToDateFy = history.slice(-5).reduce((s, h) => s + h.won, 0) // Apr..Aug actuals from this same model
const forecastRemaining = fromExistingLeads + fromAssumedInflow - (forecastRows[0].actualWon || 0)

export const SALES_FORECAST = {
  curve: p.map((pct, lag) => ({ lag, pct: Math.round(pct * 1000) / 10 })),
  overallConversionPct,
  projectedMonthlyLead: Math.round(projectedMonthlyLead),
  inflowTrendPct,
  totalProjected12mo: Math.round(totalProjected12mo),
  fyForecast: {
    label: 'Apr 2026–Mar 2027',
    actualToDate: Math.round(actualToDateFy),
    forecastRemaining: Math.round(forecastRemaining),
    fromExistingLeads: Math.round(fromExistingLeads),
    fromAssumedInflow: Math.round(fromAssumedInflow),
    total: Math.round(actualToDateFy + forecastRemaining),
  },
  dealsAnalysed: agg.dealCount,
  history,
  forecast: forecastRows,
}
