// Central "company facts" — every other fixture file imports its revenue
// numbers, dates, and rosters from here so the demo never contradicts itself
// across tabs (e.g. /api/sales and /api/customer/engagement both landing on
// ~$30M annual won revenue).
import { rngFor, randFloat, randInt } from '../prng'
import { TEAM as MARKETING_TEAM } from '../../utils/teamConfig'

export { MARKETING_TEAM }

// ── "Today" ──────────────────────────────────────────────────────────────────
// Fixed (not live Date.now()) so every relative date — "closing soon", "stalled
// 40 days", monthly trend endpoints — stays internally consistent for the whole
// demo run instead of drifting the day after this was built.
export const NOW = new Date(2026, 7, 19, 10, 0, 0) // 19 Aug 2026 (month is 0-based: 7 = Aug)

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const isoAt = (d: Date) => new Date(d).toISOString()
export const addDays = (d: Date, n: number) => { const c = new Date(d); c.setDate(c.getDate() + n); return c }
export const addMonths = (d: Date, n: number) => { const c = new Date(d); c.setMonth(c.getMonth() + n); return c }
export const daysInMonth = (year: number, month0: number) => new Date(year, month0 + 1, 0).getDate()
export const shortMonthLabel = (d: Date) => d.toLocaleDateString('en-NZ', { month: 'short', year: '2-digit' })

// ── Financial year (NZ: Apr–Mar) ────────────────────────────────────────────
export const FY_START_YEAR = 2026
export const FY_LABEL = 'FY26/27'
export const FY_LABEL_LONG = 'Apr 2026–Mar 2027'
export const FY_START = new Date(FY_START_YEAR, 3, 1) // 1 Apr 2026
export const FY_END = new Date(FY_START_YEAR + 1, 2, 31) // 31 Mar 2027

// Index of NOW within the 12 FY months (0 = Apr). Aug is index 4.
export const CURRENT_FY_MONTH_IDX = (NOW.getFullYear() - FY_START_YEAR) * 12 + (NOW.getMonth() - 3)
export const CURRENT_MONTH_ELAPSED_FRAC = NOW.getDate() / daysInMonth(NOW.getFullYear(), NOW.getMonth())

export interface FyMonthMeta { label: string; year: number; month0: number; start: Date; end: Date }
export const FY_MONTHS: FyMonthMeta[] = Array.from({ length: 12 }, (_, i) => {
  const d = addMonths(FY_START, i)
  const start = new Date(d.getFullYear(), d.getMonth(), 1)
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return { label: shortMonthLabel(d), year: d.getFullYear(), month0: d.getMonth(), start, end }
})

// Seasonal weighting across the FY (sums to 1) — a mild holiday dip in Dec/Jan,
// a year-end push in March. Used to shape both target and actual curves so
// they look like a real furniture-contracts business rather than flat lines.
const SEASONALITY = [0.075, 0.08, 0.085, 0.075, 0.08, 0.085, 0.09, 0.095, 0.07, 0.06, 0.085, 0.12]

// ── The one true annual revenue number ──────────────────────────────────────
// Combined NZ+AU won-revenue target for FY26/27 — the number a presenter says
// out loud ("we're tracking to about $30M this year"). Split ~72/28 NZ/AU.
export const ANNUAL_TARGET_TOTAL = 30_000_000
export const ANNUAL_TARGET_NZ = 21_600_000
export const ANNUAL_TARGET_AU = ANNUAL_TARGET_TOTAL - ANNUAL_TARGET_NZ // 8,400,000

export interface FyCurveMonth { label: string; start: string; end: string; target: number; actual: number | null; wonCount: number }
export interface FyCurve { months: FyCurveMonth[]; ytdActual: number; ytdTarget: number; avgDealSize: number }

/** Builds a seeded, seasonally-shaped monthly target/actual curve for one market. */
function buildFyCurve(streamName: string, annualTarget: number, avgDealSize: number): FyCurve {
  const rng = rngFor(streamName)
  let ytdActual = 0
  let ytdTarget = 0
  const months: FyCurveMonth[] = FY_MONTHS.map((m, i) => {
    const target = Math.round(annualTarget * SEASONALITY[i])
    let actual: number | null = null
    if (i < CURRENT_FY_MONTH_IDX) {
      actual = Math.round(target * randFloat(rng, 0.82, 1.18, 3))
    } else if (i === CURRENT_FY_MONTH_IDX) {
      actual = Math.round(target * CURRENT_MONTH_ELAPSED_FRAC * randFloat(rng, 0.85, 1.2, 3))
    }
    if (i <= CURRENT_FY_MONTH_IDX) { ytdActual += actual || 0; ytdTarget += target }
    const wonCount = Math.max(0, Math.round((actual || 0) / avgDealSize))
    return { label: m.label, start: ymd(m.start), end: ymd(m.end), target, actual, wonCount }
  })
  return { months, ytdActual, ytdTarget, avgDealSize }
}

export const NZ_FY_CURVE = buildFyCurve('nz-fy-curve', ANNUAL_TARGET_NZ, 38_500)
export const AU_FY_CURVE = buildFyCurve('au-fy-curve', ANNUAL_TARGET_AU, 46_000)

export const YTD_WON_TOTAL = NZ_FY_CURVE.ytdActual + AU_FY_CURVE.ytdActual
export const YTD_TARGET_TOTAL = NZ_FY_CURVE.ytdTarget + AU_FY_CURVE.ytdTarget

// ── Sales team roster ────────────────────────────────────────────────────────
export interface SalesPerson { id: string; name: string; initials: string; email: string }
export const SALES_TEAM: SalesPerson[] = [
  { id: 'sp-1', name: 'Jordan Blake', initials: 'JB', email: 'jordan@yourcompany.io' },
  { id: 'sp-2', name: 'Priya Nair', initials: 'PN', email: 'priya@yourcompany.io' },
  { id: 'sp-3', name: "Liam O'Connor", initials: 'LO', email: 'liam@yourcompany.io' },
  { id: 'sp-4', name: 'Nina Torres', initials: 'NT', email: 'nina@yourcompany.io' },
  { id: 'sp-5', name: 'Ethan Wright', initials: 'EW', email: 'ethan@yourcompany.io' },
  { id: 'sp-6', name: 'Zoe Campbell', initials: 'ZC', email: 'zoe@yourcompany.io' },
]
export const SALES_TEAM_NAMES = SALES_TEAM.map(p => p.name)

// ── Customer / account roster (Customer Engagement Hub) ────────────────────
export interface CeAccount { id: string; name: string; country: 'NZ' | 'AU'; manager: string; tier: 'Bronze' | 'Silver' | 'Gold' | 'Platinum' }
const NZ_ACCOUNT_NAMES = [
  'Meridian Workspaces', 'Beacon Health Group', 'Solstice Architects', 'Northfield University',
  'Vantage Legal Partners', 'Cobalt Financial', 'Harborview Hotels', 'Pinnacle Construction',
  'Bright Path Schools Trust', 'Delta Logistics', 'Evergreen District Council', 'Union Square Studios',
  'Redwood Capital', 'Anchor Insurance', 'Cedar Ridge Developments', 'Fathom Design Collective',
]
const AU_ACCOUNT_NAMES = [
  'Ironbark Mining Corp', 'Outback Property Group', 'Sapphire Coast Resorts', 'Great Southern Bank',
  'Whitlam Health Alliance', 'Bondi Creative Agency',
]
function buildAccounts(): CeAccount[] {
  const rng = rngFor('ce-accounts')
  const tiers: CeAccount['tier'][] = ['Platinum', 'Gold', 'Gold', 'Silver', 'Silver', 'Silver', 'Bronze', 'Bronze']
  let mgrIdx = 0
  const build = (names: string[], country: 'NZ' | 'AU', prefix: string) => names.map((name, i) => {
    const manager = SALES_TEAM_NAMES[mgrIdx % SALES_TEAM_NAMES.length]; mgrIdx++
    const tier = tiers[randInt(rng, 0, tiers.length - 1)]
    return { id: `${prefix}-${i + 1}`, name, country, manager, tier }
  })
  return [...build(NZ_ACCOUNT_NAMES, 'NZ', 'co-nz'), ...build(AU_ACCOUNT_NAMES, 'AU', 'co-au')]
}
export const CE_ACCOUNTS: CeAccount[] = buildAccounts()

// Currency formatter used consistently wherever a fixture needs to render text
// (most tabs format client-side, but a few endpoints return preformatted strings).
export const fmtMoney = (n: number) => new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD', maximumFractionDigits: 0 }).format(n)
