// /api/hubspot/kpis, /api/hubspot/kpis/recent, /api/hubspot/kpis/monthly,
// /api/hubspot/sales-support — KPIDashboard.tsx.
import { rngFor, pick, randInt, weightedBool } from '../prng'
import { NOW, ymd, addDays, addMonths, FY_MONTHS, CURRENT_FY_MONTH_IDX, SALES_TEAM } from './company'
import { contactNameFor } from './dealGen'

type ActivityKey = 'ce_visit' | 'project_visit' | 'ce_call' | 'project_call' | 'bd_visit' | 'bd_call'
const ACTIVITY_KEYS: ActivityKey[] = ['bd_visit', 'ce_visit', 'project_visit', 'bd_call', 'ce_call', 'project_call']
const ACTIVITY_POINTS: Record<ActivityKey, number> = { ce_visit: 5, project_visit: 4, ce_call: 3, project_call: 2, bd_visit: 5, bd_call: 3 }

function buildPeople(streamName: string) {
  const rng = rngFor(streamName)
  return SALES_TEAM.map((sp, i) => {
    const counts: Record<ActivityKey, number> = {} as any
    const targets: Record<ActivityKey, number> = {} as any
    let points = 0
    ACTIVITY_KEYS.forEach(key => {
      const t = randInt(rng, 4, 14)
      const c = Math.max(0, Math.round(t * randInt(rng, 60, 130) / 100))
      counts[key] = c; targets[key] = t
      points += c * ACTIVITY_POINTS[key]
    })
    const noTarget = i === SALES_TEAM.length - 1 && weightedBool(rng, 0.3)
    const pointsTargetFullMonth = Object.entries(targets).reduce((s, [k, v]) => s + v * ACTIVITY_POINTS[k as ActivityKey], 0)
    return {
      id: sp.id, name: sp.name, initials: sp.initials,
      pointsTarget: Math.round(pointsTargetFullMonth * 0.62),
      pointsTargetFullMonth, targets,
      ...counts, points,
      hidden: false, noTarget,
    }
  })
}

export function kpisFor(from: string, to: string) {
  return {
    month: NOW.toLocaleDateString('en-NZ', { month: 'long', year: 'numeric' }),
    from, to, targetFactor: 0.62,
    people: buildPeople('kpis-people'),
  }
}

// ── /api/hubspot/kpis/recent?ownerId&type&from&to ───────────────────────────
export function kpisRecent(ownerId: string, type: string) {
  const rng = rngFor(`kpis-recent-${ownerId}-${type}`)
  const items = Array.from({ length: randInt(rng, 3, 10) }, (_, i) => ({
    date: addDays(NOW, -randInt(rng, 0, 28)).toISOString(),
    title: pick(rng, [`${type.replace('_', ' ')} — site visit`, `${type.replace('_', ' ')} — follow-up call`, null]),
    contact: weightedBool(rng, 0.8) ? contactNameFor(rng) : null,
    organisation: pick(rng, ORG_POOL),
  }))
  return { items }
}
const ORG_POOL: (string | null)[] = ['Meridian Workspaces', 'Beacon Health Group', 'Solstice Architects', 'Cobalt Financial', null]

// ── /api/hubspot/kpis/monthly?prevFy= ───────────────────────────────────────
export function kpisMonthly(prevFy: boolean) {
  const rng = rngFor(`kpis-monthly-${prevFy}`)
  const label = prevFy ? '1 Apr 2025 - 31 Mar 2026' : '1 Apr 2026 - 31 Mar 2027'
  let cum = 0, cumTarget = 0, prevCum = 0
  const fyMonths = FY_MONTHS.map((m, i) => {
    const isCurrentOrPast = prevFy || i <= CURRENT_FY_MONTH_IDX
    const kpiPointsTarget = randInt(rng, 380, 520)
    const kpiPoints = isCurrentOrPast ? Math.round(kpiPointsTarget * (randInt(rng, 70, 130) / 100)) : null
    if (isCurrentOrPast) cum += kpiPoints || 0
    cumTarget += kpiPointsTarget
    const prevKpiPoints = randInt(rng, 300, 500)
    prevCum += prevKpiPoints
    return {
      label: m.label, kpiPoints, kpiPointsTarget,
      cumulativeKpiPoints: isCurrentOrPast ? cum : null, cumulativeKpiTarget: cumTarget,
      isCurrentOrPast, prevKpiPoints, prevCumulativeKpiPoints: prevCum,
    }
  })
  return { fyLabel: label, fyMonths }
}

// ── /api/hubspot/sales-support?from&to ──────────────────────────────────────
export function salesSupportFor(from: string, to: string) {
  const rng = rngFor(`sales-support-${from}-${to}`)
  let quotesT = 0, valueT = 0
  const people = SALES_TEAM.map(sp => {
    const quotes = randInt(rng, 2, 16)
    const avgValue = randInt(rng, 8000, 45000)
    const totalValue = quotes * avgValue
    quotesT += quotes; valueT += totalValue
    return { id: sp.id, name: sp.name, initials: sp.initials, quotes, totalValue, avgValue }
  })
  return { from, to, people, totals: { quotes: quotesT, totalValue: valueT, avgValue: quotesT ? Math.round(valueT / quotesT) : 0 } }
}
