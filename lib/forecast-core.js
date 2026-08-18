// Pure math for the cohort-convolution sales forecast (/api/sales/forecast in api/index.js).
// Extracted so the cohort bucketing, conversion-by-lag curve, and convolution are
// unit-testable (tests/forecast-core.test.js) — no HubSpot or Express dependencies here.

// Deal value: converted amount preferred, then home currency, then raw amount.
export const amt = p => { const c = parseFloat(p.hs_converted_amount); if (c > 0) return c; const h = parseFloat(p.amount_in_home_currency); if (h > 0) return h; return parseFloat(p.amount) || 0 }

// HubSpot date properties arrive as epoch-ms strings or ISO strings.
export const parseHs = s => { const str = String(s || ''); if (!str) return null; return /^\d+$/.test(str) ? Number(str) : Date.parse(str) }

// Month index (months since year 0) of a UTC timestamp, shifted to NZ local time.
export const msToIdx = (ms, nzOffset) => { const d = new Date(ms + nzOffset * 3600000); return d.getUTCFullYear() * 12 + d.getUTCMonth() }

// Bucket deals into monthly creation cohorts:
//   leadValue[c]       — total deal value landing in month c
//   wonCohortLag[c][k] — of month c's leads, value won exactly k months later
//   actualWon[w]       — total value won (closed) in month w
// Won deals with no close date can't be placed in a win month, so they count as
// lead value only. Deals closed before creation (data-entry quirks) clamp to lag 0.
export function aggregateDeals(deals, { nzOffset, wonStageIds }) {
  const leadValue = {}, wonCohortLag = {}, actualWon = {}
  for (const d of deals) {
    const p = d.properties
    const cMs = parseHs(p.createdate); if (!cMs) continue
    const cIdx = msToIdx(cMs, nzOffset), v = amt(p)
    leadValue[cIdx] = (leadValue[cIdx] || 0) + v
    if (wonStageIds.has(p.dealstage) && p.closedate) {
      const wIdx = msToIdx(parseHs(p.closedate), nzOffset), lag = Math.max(0, wIdx - cIdx)
      ;(wonCohortLag[cIdx] = wonCohortLag[cIdx] || {})[lag] = (wonCohortLag[cIdx][lag] || 0) + v
      actualWon[wIdx] = (actualWon[wIdx] || 0) + v
    }
  }
  return { leadValue, wonCohortLag, actualWon, dealCount: deals.length }
}

// ── AU pipeline folding ───────────────────────────────────────────────────────
// AU buys 100% of its goods off NZ: an AU lead is future NZ demand, but the NZ pipeline
// only sees it when the AU deal is WON (a mirror NZ deal, named "AU …"/"AUS …", is
// created at that moment and recorded as the NZ sale). To forecast the demand early
// without double counting:
//   • mirror deals are excluded from the NZ cohorts — they are win events, not leads;
//   • AU-pipeline deals join the cohorts directly: their createdate is the lead landing,
//     their closedate the moment NZ books the mirror revenue.
// Won revenue stays NZ-only everywhere it is displayed (history bars, FY actuals).
export const isAuMirrorDeal = name => /^\s*au[s]?\b/i.test(String(name || ''))

// AU sells at the NZ transfer price + 15% margin, so the NZ-recognised value behind an
// AU deal is its NZD-converted amount ÷ 1.15. (Raw AUD figures read ~6.5% above the
// eventual NZD sale even though AUD is the stronger currency: ÷1.15 margin outweighs
// the ~×1.08 FX.)
export const AU_MARGIN = 1.15
export const auDealAtNzValue = d => ({
  ...d,
  properties: { ...d.properties, hs_converted_amount: String(amt(d.properties) / AU_MARGIN), amount_in_home_currency: '', amount: '' },
})

// Bucket won-deal value by NZ close month — the closedate basis the sales tracking
// dashboard uses, so the history bars match it exactly. (The cohort-windowed
// actualWon misses wins from deals created before the window: e.g. Jul 25 was
// $132,819 short when audited on 5 Jul 2026.)
export function wonByCloseMonth(deals, { nzOffset, wonStageIds }) {
  const won = {}
  for (const d of deals) {
    const p = d.properties
    if (!wonStageIds.has(p.dealstage) || !p.closedate) continue
    const ms = parseHs(p.closedate); if (!ms) continue
    const w = msToIdx(ms, nzOffset)
    won[w] = (won[w] || 0) + amt(p)
  }
  return won
}

// Value-weighted conversion-by-lag curve, right-censoring handled: a cohort only
// counts toward p[k] once its lag-k month has FULLY elapsed (nowIdx - c > k).
// The current month is still in progress — a cohort observed at lag k in it would
// contribute its full lead value to the denominator but only the first few days'
// wins to the numerator, biasing every p[k] low (worst at the start of the month).
export function conversionCurve({ leadValue, wonCohortLag, startIdx, nowIdx, K }) {
  const p = []
  for (let k = 0; k <= K; k++) {
    let num = 0, den = 0
    for (let c = startIdx; c <= nowIdx; c++) { if (nowIdx - c <= k) continue; den += leadValue[c] || 0; num += wonCohortLag[c]?.[k] || 0 }
    p[k] = den > 0 ? num / den : 0
  }
  return p
}

// Average monthly lead inflow over the completed months of the window — the
// current (partly-elapsed) month is excluded.
export function averageMonthlyLead({ leadValue, startIdx, nowIdx, monthsBack }) {
  let total = 0
  for (let c = startIdx; c < nowIdx; c++) total += leadValue[c] || 0
  return total / monthsBack
}

// Lead-inflow parameters. avg = trailing-12 monthly average — this is what actually
// drives the projection. growth = trailing-12 total ÷ the 12 months before that; it is
// still computed and still reported to the UI as a diagnostic (`inflowTrendPct`), but it
// no longer feeds the forecast. See trendInflowAt for why.
export function trendInflowParams({ leadValue, nowIdx }) {
  let t12 = 0, prior12 = 0
  for (let j = 1; j <= 12; j++) t12 += leadValue[nowIdx - j] || 0
  for (let j = 13; j <= 24; j++) prior12 += leadValue[nowIdx - j] || 0
  return { avg: t12 / 12, growth: prior12 > 0 ? t12 / prior12 : 1 }
}

// Assumed inflow h months ahead = the trailing-12 average, flat.
//
// It used to extrapolate the YoY growth factor: avg × growth^((6.5+h)/12) (audit decision
// B, 5 Jul 2026 — chosen on judgement, so that a stall in leads would show up quickly).
// A walk-forward backtest on 31 Jul 2026 (scripts/forecast-inflow-backtest.mjs) reversed
// that decision: over 28 vantage points the extrapolation was the WORST of six options
// (mean absolute error 41.6%, and a systematic +22.6% over-forecast bias) while going flat
// was the best (15.8%, +0.8%). Error fell monotonically as extrapolation was reduced.
//
// The failure mode: growth^((6.5+h)/12) compounds a one-off STEP in lead value into a
// permanent exponential trend. Forecasting FY25/26 from 1 Apr 2025 it predicted $27.93M
// against an actual $16.68M (+67%), because FY24/25's jump in entered deal value (+60% on
// 12% FEWER deals — largely values attached to deals before qualification) was read as
// demand growth and projected forward. Capping growth doesn't help: the cap only binds in
// extremes, so ±15%/±25% variants scored worse than damping and changed nothing at all at
// the vantage that mattered.
//
// Flat is not unresponsive: avg is a trailing-12 average, so a sustained change in demand
// still feeds through over ~a year. What's gone is the compounding. And nothing here
// affects leads that have ALREADY landed — those enter the convolution at full weight via
// buildForecast, which is the model's fast, well-validated channel.
//
// Worth re-running the backtest once the pipeline data is clean (the stale-deal problem in
// §H distorted entered lead values): the trend term may earn its place back.
export const trendInflowAt = ({ avg }) => avg

// Current-month assumed inflow = leads actually landed so far this month + the
// remaining-days share of the month's trend assumption. Actuals flow straight into
// the forecast, so a weak (or strong) month in progress shows up within days
// instead of waiting to enter a trailing average.
export const blendCurrentMonth = ({ actualToDate, assumed, elapsedDays, daysInMonth }) =>
  actualToDate + assumed * Math.max(0, daysInMonth - elapsedDays) / daysInMonth

// Convolution: projected won for month F = Σk lv(F−k) · p[k]. Contributions from
// months before nowIdx are "existing leads"; the rest are assumed future inflow.
// Rounding: the total and the existing slice are rounded, and the future slice is
// derived from them — so fromExistingLeads + fromFutureLeads === projectedWon
// exactly (rounding each slice independently drifts by ±$1 per row).
export function buildForecast({ p, K, nowIdx, lv, months = 12 }) {
  const rows = []
  for (let f = 0; f < months; f++) {
    const F = nowIdx + f
    let won = 0, fromExisting = 0
    for (let k = 0; k <= K; k++) { const src = F - k; const contrib = lv(src) * p[k]; won += contrib; if (src < nowIdx) fromExisting += contrib }
    const projectedWon = Math.round(won), fromExistingLeads = Math.round(fromExisting)
    rows.push({ idx: F, projectedWon, fromExistingLeads, fromFutureLeads: projectedWon - fromExistingLeads, isCurrentMonth: f === 0 })
  }
  return rows
}

// Fold the current month's ALREADY-WON revenue into its forecast row. buildForecast
// gives a whole-month expectation from the conversion curve, but part of that month has
// happened: those wins are fact, and they routinely land well above (or below) what the
// curve predicted. So keep only the remaining-days share of the projection and replace
// the elapsed share with the actual:
//   projectedWon = actualWon + wholeMonthProjection × remainingDays / daysInMonth
// The existing/future segments are scaled by the same share, so the row still satisfies
// actualWon + fromExistingLeads + fromFutureLeads === projectedWon exactly (Math.round
// is monotonic, so the remainder can never go negative). Same shape as the landed-lead
// blend in blendCurrentMonth, one level further down the funnel.
export function applyActualWonToCurrentMonth(row, { actualWon, elapsedDays, daysInMonth }) {
  const share = daysInMonth > 0 ? Math.max(0, daysInMonth - elapsedDays) / daysInMonth : 0
  const actual = Math.round(actualWon || 0)
  const projectedWon = Math.round((actualWon || 0) + row.projectedWon * share)
  const remainder = projectedWon - actual
  const fromExistingLeads = Math.min(Math.round(row.fromExistingLeads * share), remainder)
  return { ...row, actualWon: actual, projectedWon, fromExistingLeads, fromFutureLeads: remainder - fromExistingLeads }
}
