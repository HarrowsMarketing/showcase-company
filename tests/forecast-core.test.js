// Unit tests for the cohort-convolution forecast math (lib/forecast-core.js).
// Run with: npm test  (node --test, no test framework dependency)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { amt, parseHs, msToIdx, aggregateDeals, wonByCloseMonth, conversionCurve, averageMonthlyLead, trendInflowParams, trendInflowAt, blendCurrentMonth, buildForecast, applyActualWonToCurrentMonth, isAuMirrorDeal, auDealAtNzValue, AU_MARGIN } from '../lib/forecast-core.js'

const NZ = 12 // winter offset, matches the endpoint's Apr–Sep value

// Epoch ms (as HubSpot string) for a UTC year/month/day shifted so it lands in the
// given NZ month — mirrors how the endpoint's date handling sees deal timestamps.
const nzMs = (y, m, d = 15) => String(Date.UTC(y, m, d) - NZ * 3600000)
const idx = (y, m) => y * 12 + m

const deal = (createdate, opts = {}) => ({
  properties: {
    createdate,
    closedate: opts.closedate ?? null,
    dealstage: opts.stage ?? 'open',
    amount: opts.amount ?? '1000',
    hs_converted_amount: opts.converted ?? '',
    amount_in_home_currency: opts.home ?? '',
  },
})
const WON = new Set(['won'])

// ── amt / parseHs ─────────────────────────────────────────────────────────────

test('amt prefers converted amount, then home currency, then raw amount', () => {
  assert.equal(amt({ hs_converted_amount: '150', amount_in_home_currency: '120', amount: '100' }), 150)
  assert.equal(amt({ hs_converted_amount: '0', amount_in_home_currency: '120', amount: '100' }), 120)
  assert.equal(amt({ hs_converted_amount: '', amount_in_home_currency: '', amount: '100' }), 100)
  assert.equal(amt({ amount: 'garbage' }), 0)
})

test('parseHs handles epoch-ms strings, ISO strings, and empties', () => {
  assert.equal(parseHs('1720000000000'), 1720000000000)
  assert.equal(parseHs('2026-07-01T00:00:00Z'), Date.parse('2026-07-01T00:00:00Z'))
  assert.equal(parseHs(''), null)
  assert.equal(parseHs(null), null)
})

// ── aggregateDeals: cohort bucketing ─────────────────────────────────────────

test('aggregateDeals buckets lead value by NZ creation month', () => {
  const { leadValue, dealCount } = aggregateDeals([
    deal(nzMs(2026, 3), { amount: '500' }),
    deal(nzMs(2026, 3), { amount: '300' }),
    deal(nzMs(2026, 4), { amount: '200' }),
  ], { nzOffset: NZ, wonStageIds: WON })
  assert.equal(leadValue[idx(2026, 3)], 800)
  assert.equal(leadValue[idx(2026, 4)], 200)
  assert.equal(dealCount, 3)
})

test('aggregateDeals records won deals by lag and close month', () => {
  const { wonCohortLag, actualWon } = aggregateDeals([
    deal(nzMs(2026, 1), { stage: 'won', closedate: nzMs(2026, 4), amount: '900' }), // lag 3
    deal(nzMs(2026, 1), { stage: 'won', closedate: nzMs(2026, 1, 20), amount: '100' }), // lag 0
    deal(nzMs(2026, 1), { stage: 'open', amount: '400' }), // open: leads only
  ], { nzOffset: NZ, wonStageIds: WON })
  assert.equal(wonCohortLag[idx(2026, 1)][3], 900)
  assert.equal(wonCohortLag[idx(2026, 1)][0], 100)
  assert.equal(actualWon[idx(2026, 4)], 900)
  assert.equal(actualWon[idx(2026, 1)], 100)
})

test('aggregateDeals: won deal with no close date counts as lead value only', () => {
  const { leadValue, wonCohortLag, actualWon } = aggregateDeals([
    deal(nzMs(2026, 2), { stage: 'won', closedate: null, amount: '700' }),
  ], { nzOffset: NZ, wonStageIds: WON })
  assert.equal(leadValue[idx(2026, 2)], 700)
  assert.equal(wonCohortLag[idx(2026, 2)], undefined)
  assert.deepEqual(actualWon, {})
})

test('aggregateDeals clamps negative lag (closed before created) to 0', () => {
  const { wonCohortLag } = aggregateDeals([
    deal(nzMs(2026, 5), { stage: 'won', closedate: nzMs(2026, 3), amount: '250' }),
  ], { nzOffset: NZ, wonStageIds: WON })
  assert.equal(wonCohortLag[idx(2026, 5)][0], 250)
})

test('aggregateDeals skips deals with no create date', () => {
  const { leadValue, dealCount } = aggregateDeals([deal(null)], { nzOffset: NZ, wonStageIds: WON })
  assert.deepEqual(leadValue, {})
  assert.equal(dealCount, 1) // still counted as analysed
})

// Regression: actualWon (the source of the green history bars and fyActualToDate)
// must match the original inline implementation exactly — the audit fixes were to
// projections only, never history.
test('aggregateDeals actualWon matches the original inline implementation', () => {
  const originalAggregate = deals => { // verbatim copy of the pre-audit endpoint loop
    const parseHsL = s => { const str = String(s || ''); if (!str) return null; return /^\d+$/.test(str) ? Number(str) : Date.parse(str) }
    const msToIdxL = ms => { const d = new Date(ms + NZ * 3600000); return d.getUTCFullYear() * 12 + d.getUTCMonth() }
    const amtL = p => { const c = parseFloat(p.hs_converted_amount); if (c > 0) return c; const h = parseFloat(p.amount_in_home_currency); if (h > 0) return h; return parseFloat(p.amount) || 0 }
    const leadValue = {}, wonCohortLag = {}, actualWon = {}
    for (const d of deals) {
      const p = d.properties
      const cMs = parseHsL(p.createdate); if (!cMs) continue
      const cIdx = msToIdxL(cMs), v = amtL(p)
      leadValue[cIdx] = (leadValue[cIdx] || 0) + v
      if (WON.has(p.dealstage) && p.closedate) {
        const wIdx = msToIdxL(parseHsL(p.closedate)), lag = Math.max(0, wIdx - cIdx)
        ;(wonCohortLag[cIdx] = wonCohortLag[cIdx] || {})[lag] = (wonCohortLag[cIdx][lag] || 0) + v
        actualWon[wIdx] = (actualWon[wIdx] || 0) + v
      }
    }
    return { leadValue, wonCohortLag, actualWon }
  }
  // deterministic pseudo-random deal set (no Math.random — keep the test reproducible)
  let seed = 42
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const deals = Array.from({ length: 200 }, () => {
    const cm = Math.floor(rnd() * 36)
    const won = rnd() < 0.3
    const closeMonth = cm + Math.floor(rnd() * 12)
    return deal(nzMs(2023, 6 + cm, 1 + Math.floor(rnd() * 27)), {
      stage: won ? 'won' : 'open',
      closedate: won ? nzMs(2023, 6 + closeMonth, 1 + Math.floor(rnd() * 27)) : null,
      amount: String(Math.round(rnd() * 50000)),
    })
  })
  const ours = aggregateDeals(deals, { nzOffset: NZ, wonStageIds: WON })
  const orig = originalAggregate(deals)
  assert.deepEqual(ours.actualWon, orig.actualWon)
  assert.deepEqual(ours.leadValue, orig.leadValue)
  assert.deepEqual(ours.wonCohortLag, orig.wonCohortLag)
})

// ── wonByCloseMonth: closedate-based history bars ────────────────────────────

test('wonByCloseMonth buckets won value by NZ close month regardless of create date', () => {
  const won = wonByCloseMonth([
    deal(nzMs(2022, 0), { stage: 'won', closedate: nzMs(2026, 3), converted: '800' }), // created pre-window: still counts
    deal(nzMs(2026, 2), { stage: 'won', closedate: nzMs(2026, 3), amount: '200' }),
    deal(nzMs(2026, 2), { stage: 'open', closedate: nzMs(2026, 3), amount: '500' }),   // not won: ignored
    deal(nzMs(2026, 2), { stage: 'won', closedate: null, amount: '300' }),             // no close date: ignored
  ], { nzOffset: NZ, wonStageIds: WON })
  assert.equal(won[idx(2026, 3)], 1000)
  assert.equal(Object.keys(won).length, 1)
})

test('wonByCloseMonth agrees with cohort actualWon when all deals are in-window', () => {
  const deals = [
    deal(nzMs(2026, 0), { stage: 'won', closedate: nzMs(2026, 2), amount: '450' }),
    deal(nzMs(2026, 1), { stage: 'won', closedate: nzMs(2026, 2), amount: '150' }),
    deal(nzMs(2026, 1), { stage: 'won', closedate: nzMs(2026, 4), amount: '75' }),
  ]
  const { actualWon } = aggregateDeals(deals, { nzOffset: NZ, wonStageIds: WON })
  const won = wonByCloseMonth(deals, { nzOffset: NZ, wonStageIds: WON })
  assert.deepEqual(won, actualWon)
})

// ── conversionCurve: censoring ───────────────────────────────────────────────

test('conversionCurve computes value-weighted win rate per lag', () => {
  const nowIdx = 100, startIdx = 90
  // cohort 95: $1000 leads, $100 won at lag 0, $200 at lag 2 — fully observable at both lags
  const leadValue = { 95: 1000 }
  const wonCohortLag = { 95: { 0: 100, 2: 200 } }
  const p = conversionCurve({ leadValue, wonCohortLag, startIdx, nowIdx, K: 3 })
  assert.equal(p[0], 0.1)
  assert.equal(p[1], 0)
  assert.equal(p[2], 0.2)
})

test('conversionCurve excludes cohorts whose lag-k month is the current (incomplete) month', () => {
  const nowIdx = 100, startIdx = 90
  // cohort 99's lag-1 month IS the current month → must not count toward p[1],
  // even though it already shows an (early, partial) lag-1 win.
  const leadValue = { 99: 1000, 95: 1000 }
  const wonCohortLag = { 99: { 1: 50 }, 95: { 1: 300 } }
  const p = conversionCurve({ leadValue, wonCohortLag, startIdx, nowIdx, K: 2 })
  assert.equal(p[1], 0.3) // cohort 95 only — not (300+50)/2000
  // …but cohort 99 IS old enough for lag 0 (its lag-0 month, 99, has fully elapsed)
  const p0Curve = conversionCurve({ leadValue: { 99: 1000 }, wonCohortLag: { 99: { 0: 100 } }, startIdx, nowIdx, K: 1 })
  assert.equal(p0Curve[0], 0.1)
})

test('conversionCurve returns 0 when no cohort is old enough for a lag', () => {
  const p = conversionCurve({ leadValue: { 99: 1000 }, wonCohortLag: {}, startIdx: 98, nowIdx: 100, K: 5 })
  assert.equal(p[4], 0)
})

// ── averageMonthlyLead ───────────────────────────────────────────────────────

test('averageMonthlyLead spans completed months only (current month excluded)', () => {
  const leadValue = { 97: 300, 98: 600, 99: 900, 100: 99999 } // 100 = current month
  assert.equal(averageMonthlyLead({ leadValue, startIdx: 97, nowIdx: 100, monthsBack: 3 }), 600)
})

// ── AU folding: mirror-deal detection + NZ-value adjustment ──────────────────

test('isAuMirrorDeal matches the AU/AUS deal-name prefix convention only', () => {
  assert.ok(isAuMirrorDeal('AU - Sydney fitout'))
  assert.ok(isAuMirrorDeal('AUS Melbourne office'))
  assert.ok(isAuMirrorDeal('  au chairs order'))
  assert.ok(!isAuMirrorDeal('Australia Post'))       // 'Australia…' is a customer, not the prefix
  assert.ok(!isAuMirrorDeal('Auckland University'))
  assert.ok(!isAuMirrorDeal('AU123 special'))         // prefix must be the whole word
  assert.ok(!isAuMirrorDeal(''))
  assert.ok(!isAuMirrorDeal(null))
})

test('auDealAtNzValue strips the 15% margin off the NZD-converted amount', () => {
  const d = deal(nzMs(2026, 1), { converted: '115000', amount: '106500' }) // NZD converted, AUD raw
  const adjusted = auDealAtNzValue(d)
  assert.equal(amt(adjusted.properties), 115000 / AU_MARGIN) // = 100,000 NZD
  // falls back to the raw amount when no converted value exists (treated as-is, then ÷ margin)
  const raw = auDealAtNzValue(deal(nzMs(2026, 1), { amount: '106500' }))
  assert.equal(amt(raw.properties), 106500 / AU_MARGIN)
  // original deal untouched (no mutation)
  assert.equal(d.properties.hs_converted_amount, '115000')
})

test('AU deals fold into cohorts at NZ value; mirror exclusion leaves wins to the AU stream', () => {
  const AU_WON = new Set(['au-won'])
  const nzDeals = [
    deal(nzMs(2026, 0), { amount: '1000' }),                                   // NZ direct lead
    deal(nzMs(2026, 3), { stage: 'won', closedate: nzMs(2026, 3, 20), amount: '900' }), // would be a mirror deal in prod (name-filtered upstream)
  ]
  const auDeals = [
    { properties: { createdate: nzMs(2026, 0), closedate: nzMs(2026, 3), dealstage: 'au-won', amount: '', hs_converted_amount: '1035', amount_in_home_currency: '' } },
  ].map(auDealAtNzValue)
  const { leadValue, wonCohortLag } = aggregateDeals([nzDeals[0], ...auDeals], { nzOffset: NZ, wonStageIds: new Set(['won', ...AU_WON]) })
  assert.equal(leadValue[idx(2026, 0)], 1000 + 1035 / AU_MARGIN)  // both streams land as demand
  assert.equal(wonCohortLag[idx(2026, 0)][3], 1035 / AU_MARGIN)   // AU win at its real 3-month lag
})

// ── trendInflowParams / trendInflowAt / blendCurrentMonth ────────────────────

test('trendInflowParams derives trailing-12 average and YoY growth factor', () => {
  const nowIdx = 100, leadValue = {}
  for (let j = 1; j <= 12; j++) leadValue[nowIdx - j] = 1200   // trailing 12: 14,400
  for (let j = 13; j <= 24; j++) leadValue[nowIdx - j] = 1000  // prior 12:   12,000
  leadValue[nowIdx] = 99999 // current month must not enter either window
  const { avg, growth } = trendInflowParams({ leadValue, nowIdx })
  assert.equal(avg, 1200)
  assert.equal(growth, 1.2)
})

test('trendInflowParams: growth defaults to 1 with no prior-year data', () => {
  const leadValue = { 99: 500 }
  const { growth } = trendInflowParams({ leadValue, nowIdx: 100 })
  assert.equal(growth, 1)
})

// trendInflowAt is deliberately FLAT — it returns the trailing-12 average and ignores the
// growth factor. The YoY extrapolation it used to apply was reversed on 31 Jul 2026 after a
// walk-forward backtest (see lib/forecast-core.js and scripts/forecast-inflow-backtest.mjs).
test('trendInflowAt is flat: the trailing-12 average, at every horizon', () => {
  const params = { avg: 1000, growth: 1.2 }
  for (const h of [0, 1, 5.5, 11, 24]) assert.equal(trendInflowAt(params, h), 1000)
  // a declining growth factor must NOT drag the assumption down any more
  const down = { avg: 1000, growth: 0.8 }
  assert.equal(trendInflowAt(down, 11), trendInflowAt(down, 0))
  assert.equal(trendInflowAt(down, 11), 1000)
})

test('trendInflowAt: growth is ignored entirely, so a step change cannot compound', () => {
  // the regression this guards: growth^((6.5+h)/12) turned a one-off step in entered lead
  // value into an exponential, over-forecasting FY25/26 by +67%
  const flat = trendInflowAt({ avg: 4_670_000, growth: 1.0 }, 8)
  const booming = trendInflowAt({ avg: 4_670_000, growth: 2.0 }, 8)
  const slumping = trendInflowAt({ avg: 4_670_000, growth: 0.5 }, 8)
  assert.equal(flat, booming)
  assert.equal(flat, slumping)
})

test('blendCurrentMonth: actuals + remaining share of the assumption', () => {
  assert.equal(blendCurrentMonth({ actualToDate: 500, assumed: 3100, elapsedDays: 5, daysInMonth: 31 }), 500 + 3100 * 26 / 31)
  // month fully elapsed → actuals only
  assert.equal(blendCurrentMonth({ actualToDate: 500, assumed: 3100, elapsedDays: 31, daysInMonth: 31 }), 500)
  // guard against elapsed > daysInMonth
  assert.equal(blendCurrentMonth({ actualToDate: 500, assumed: 3100, elapsedDays: 40, daysInMonth: 31 }), 500)
})

// ── buildForecast: convolution + rounding invariant ──────────────────────────

test('buildForecast convolves past cohorts and assumed inflow (hand-computed)', () => {
  const nowIdx = 10, p = [0.1, 0.2], projLead = 500
  const leadValue = { 9: 1000 }
  const lv = i => i < nowIdx ? (leadValue[i] || 0) : projLead
  const rows = buildForecast({ p, K: 1, nowIdx, lv, months: 2 })
  // f=0: existing = leadValue[9]×p[1] = 200; future = projLead×p[0] = 50
  assert.deepEqual(rows[0], { idx: 10, projectedWon: 250, fromExistingLeads: 200, fromFutureLeads: 50, isCurrentMonth: true })
  // f=1: both sources are current/future months → all "future": 500×0.1 + 500×0.2 = 150
  assert.deepEqual(rows[1], { idx: 11, projectedWon: 150, fromExistingLeads: 0, fromFutureLeads: 150, isCurrentMonth: false })
})

test('buildForecast invariant: fromExistingLeads + fromFutureLeads === projectedWon exactly', () => {
  // fractional values that force ±$1 drift under independent rounding
  let seed = 7
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const nowIdx = 50, K = 18
  const p = Array.from({ length: K + 1 }, () => rnd() * 0.08 + 0.001)
  const leadValue = {}
  for (let i = nowIdx - K; i < nowIdx; i++) leadValue[i] = rnd() * 5000000 + 333333.337
  const projLead = 4512410.5567
  const lv = i => i < nowIdx ? (leadValue[i] || 0) : projLead
  const rows = buildForecast({ p, K, nowIdx, lv, months: 12 })
  for (const r of rows) {
    assert.equal(r.fromExistingLeads + r.fromFutureLeads, r.projectedWon, `${r.idx}: segments must sum to the tile`)
    assert.equal(r.projectedWon, Math.round(rows.indexOf(r) === 0 ? r.projectedWon : r.projectedWon)) // integers
    assert.ok(Number.isInteger(r.fromExistingLeads) && Number.isInteger(r.fromFutureLeads))
  }
  assert.ok(rows[0].isCurrentMonth && rows.slice(1).every(r => !r.isCurrentMonth))
})

// ── applyActualWonToCurrentMonth: banked wins fold into the current month ─────

test('applyActualWonToCurrentMonth: actual + remaining-days share of the projection', () => {
  const row = { idx: 10, projectedWon: 1000, fromExistingLeads: 800, fromFutureLeads: 200, isCurrentMonth: true }
  // 10 of 30 days elapsed → keep 2/3 of the projection, replace the elapsed third with actuals
  const r = applyActualWonToCurrentMonth(row, { actualWon: 2000, elapsedDays: 10, daysInMonth: 30 })
  assert.equal(r.actualWon, 2000)
  assert.equal(r.projectedWon, 2000 + Math.round(1000 * 2 / 3))
  assert.equal(r.fromExistingLeads, Math.round(800 * 2 / 3))
  assert.equal(r.actualWon + r.fromExistingLeads + r.fromFutureLeads, r.projectedWon)
  assert.equal(r.idx, 10)
  assert.equal(r.isCurrentMonth, true)
})

test('applyActualWonToCurrentMonth: a big month beats the curve instead of being hidden by it', () => {
  // The bug this fixes: $2.1M already won but the curve only predicted $1.2M for the month.
  const row = { idx: 10, projectedWon: 1200000, fromExistingLeads: 900000, fromFutureLeads: 300000, isCurrentMonth: true }
  const r = applyActualWonToCurrentMonth(row, { actualWon: 2100000, elapsedDays: 25, daysInMonth: 31 })
  assert.ok(r.projectedWon > 2100000, 'projection must be at least the revenue already banked')
  assert.equal(r.projectedWon, 2100000 + Math.round(1200000 * 6 / 31))
})

test('applyActualWonToCurrentMonth: month fully elapsed → actuals only', () => {
  const row = { idx: 10, projectedWon: 1000, fromExistingLeads: 800, fromFutureLeads: 200, isCurrentMonth: true }
  for (const elapsedDays of [31, 40]) { // also guards elapsed > daysInMonth
    const r = applyActualWonToCurrentMonth(row, { actualWon: 2000, elapsedDays, daysInMonth: 31 })
    assert.deepEqual(r, { idx: 10, projectedWon: 2000, actualWon: 2000, fromExistingLeads: 0, fromFutureLeads: 0, isCurrentMonth: true })
  }
})

test('applyActualWonToCurrentMonth: no wins yet → projection scales down to the days left', () => {
  const row = { idx: 10, projectedWon: 1000, fromExistingLeads: 800, fromFutureLeads: 200, isCurrentMonth: true }
  const r = applyActualWonToCurrentMonth(row, { actualWon: 0, elapsedDays: 15, daysInMonth: 30 })
  assert.equal(r.actualWon, 0)
  assert.equal(r.projectedWon, 500)
  assert.equal(r.actualWon + r.fromExistingLeads + r.fromFutureLeads, r.projectedWon)
})

test('applyActualWonToCurrentMonth invariant: segments sum exactly, never negative', () => {
  let seed = 4242
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  for (let i = 0; i < 500; i++) {
    const existing = rnd() * 3000000 + 0.5551, future = rnd() * 1000000 + 0.4449
    const row = { idx: 10, projectedWon: Math.round(existing + future), fromExistingLeads: Math.round(existing), fromFutureLeads: 0, isCurrentMonth: true }
    row.fromFutureLeads = row.projectedWon - row.fromExistingLeads
    const daysInMonth = 28 + Math.floor(rnd() * 4)
    const r = applyActualWonToCurrentMonth(row, {
      actualWon: rnd() * 5000000 + 0.4999,
      elapsedDays: 1 + Math.floor(rnd() * daysInMonth),
      daysInMonth,
    })
    assert.equal(r.actualWon + r.fromExistingLeads + r.fromFutureLeads, r.projectedWon, `iteration ${i}`)
    assert.ok(r.fromExistingLeads >= 0 && r.fromFutureLeads >= 0, `iteration ${i}: no negative segments`)
    assert.ok(r.projectedWon >= r.actualWon, `iteration ${i}: projection never below banked wins`)
    assert.ok([r.projectedWon, r.actualWon, r.fromExistingLeads, r.fromFutureLeads].every(Number.isInteger))
  }
})

// End-to-end through the pipeline: aggregate → curve → convolution, mirroring the
// endpoint's wiring, verifying the invariant holds on cohort-derived data too.
test('pipeline: aggregate → curve → forecast reconciles', () => {
  let seed = 99
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const deals = Array.from({ length: 300 }, () => {
    const cm = Math.floor(rnd() * 36)
    const won = rnd() < 0.27
    return deal(nzMs(2023, 6 + cm, 1 + Math.floor(rnd() * 27)), {
      stage: won ? 'won' : 'open',
      closedate: won ? nzMs(2023, 6 + cm + Math.floor(rnd() * 10), 5) : null,
      amount: String((rnd() * 80000).toFixed(2)),
    })
  })
  const nowIdx = idx(2026, 6), startIdx = nowIdx - 36, K = 18
  const { leadValue, wonCohortLag } = aggregateDeals(deals, { nzOffset: NZ, wonStageIds: WON })
  const p = conversionCurve({ leadValue, wonCohortLag, startIdx, nowIdx, K })
  // mirror the endpoint's inflow wiring: YoY trend + current-month actuals blend
  const inflow = trendInflowParams({ leadValue, nowIdx })
  const currentMonthLead = blendCurrentMonth({ actualToDate: leadValue[nowIdx] || 0, assumed: trendInflowAt(inflow, 0), elapsedDays: 5, daysInMonth: 31 })
  const lv = i => i < nowIdx ? (leadValue[i] || 0) : i === nowIdx ? currentMonthLead : trendInflowAt(inflow, i - nowIdx)
  const rows = buildForecast({ p, K, nowIdx, lv, months: 12 })
  assert.equal(rows.length, 12)
  for (const r of rows) assert.equal(r.fromExistingLeads + r.fromFutureLeads, r.projectedWon)
  assert.ok(rows.every(r => r.projectedWon >= 0))
  assert.ok(inflow.avg > 0 && inflow.growth > 0)
})

// averageMonthlyLead is retained for reference/fallback — keep its contract pinned
test('averageMonthlyLead still matches its original contract', () => {
  const leadValue = { 97: 300, 98: 600, 99: 900 }
  assert.equal(averageMonthlyLead({ leadValue, startIdx: 97, nowIdx: 100, monthsBack: 3 }), 600)
})
