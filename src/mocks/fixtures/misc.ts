// Grab-bag of smaller endpoints: /api/marketing/targets, focus-tasks,
// priority-order; /api/production/samples; /api/analysis/results, /api/analysis/run.
import { rngFor, pick, randInt, randFloat } from '../prng'
import { NOW, ymd, addDays, SALES_TEAM_NAMES } from './company'
import { smartsheetStore } from './smartsheet'

// ── /api/marketing/targets ───────────────────────────────────────────────────
export const MARKETING_TARGETS = (() => {
  const rng = rngFor('marketing-targets')
  const mql = Array.from({ length: 12 }, () => randInt(rng, 60, 130))
  const sql = Array.from({ length: 12 }, () => randInt(rng, 12, 32))
  return { mql, sql }
})()

// ── /api/marketing/focus-tasks ───────────────────────────────────────────────
export const focusTasksStore = { ids: smartsheetStore.rows.filter(r => r.parentId).slice(0, 2).map(r => r.id) }

// ── /api/marketing/priority-order ────────────────────────────────────────────
const emptyBands = () => ({ high: [] as number[], medium: [] as number[], low: [] as number[] })
export const priorityOrderStore = { team: emptyBands(), individual: emptyBands() }

// ── /api/production/samples ──────────────────────────────────────────────────
const SAMPLE_NAMES = ['Aria Task Chair', 'Zenith Height-Adjustable Desk', 'Coastline Sofa Module', 'Meridian Boardroom Table', 'Lumen Acoustic Pod', 'Drift Breakout Stool', 'Halo Reception Desk', 'Contour Ergonomic Chair']
const CLIENTS = ['Meridian Workspaces', 'Beacon Health Group', 'Solstice Architects', 'Northfield University', 'Ironbark Mining Corp']
let sampleCounter = 1
function buildSample(rng: ReturnType<typeof rngFor>, i: number) {
  const country: 'NZ' | 'AU' = rng() < 0.7 ? 'NZ' : 'AU'
  const status: 'in' | 'out' = rng() < 0.6 ? 'in' : 'out'
  const created = addDays(NOW, -randInt(rng, 20, 400))
  const dateOut = status === 'out' ? ymd(addDays(NOW, -randInt(rng, 1, 60))) : null
  return {
    id: `sample-${i}`, display_id: `S-${String(sampleCounter++).padStart(4, '0')}`,
    name: pick(rng, SAMPLE_NAMES), photo_url: null, country,
    location: country === 'AU' ? pick(rng, ['Melbourne', 'Sydney']) : pick(rng, ['Timaru', 'Auckland']),
    condition: pick(rng, ['Excellent', 'Good', 'Fair', 'Poor']), status,
    job_card: `JC-${randInt(rng, 1000, 9999)}`, salesperson: pick(rng, SALES_TEAM_NAMES),
    client_name: pick(rng, CLIENTS), delivery_location: pick(rng, CLIENTS),
    review_months: 6, value: randInt(rng, 400, 6500),
    specs: [{ label: 'Fabric', value: pick(rng, ['Charcoal Weave', 'Ocean Blend', 'Sand Tweed']) }],
    date_out: dateOut, date_in: status === 'in' && dateOut ? ymd(addDays(NOW, -randInt(rng, 1, 20))) : null,
    estimated_return: status === 'out' ? ymd(addDays(NOW, randInt(rng, -10, 30))) : null,
    last_movement_date: ymd(addDays(NOW, -randInt(rng, 0, 90))), created_at: created.toISOString(),
    history: [{ date: ymd(created), action: 'Created', note: 'Added to register' }],
  }
}
export const samplesStore = { samples: (() => { const rng = rngFor('samples'); return Array.from({ length: 22 }, (_, i) => buildSample(rng, i)) })() }

// ── /api/analysis/results, /api/analysis/run ────────────────────────────────
export const ANALYSIS_RESULTS = (() => {
  const rng = rngFor('analysis-results')
  const sources = ['Organic Search', 'Paid Search', 'Direct', 'Referral', 'Email', 'Social']
  const trafficSources = {
    customers: sources.map(source => ({ source, count: randInt(rng, 10, 200), pct: randFloat(rng, 5, 40, 1).toFixed(1) })),
    leads: sources.map(source => ({ source, count: randInt(rng, 10, 300), pct: randFloat(rng, 5, 40, 1).toFixed(1) })),
  }
  const titles = ['Facilities Manager', 'Head of Workplace', 'Procurement Lead', 'Office Manager', 'Interior Designer']
  return {
    generatedAt: NOW.toISOString(), customerCount: randInt(rng, 400, 900), leadCount: randInt(rng, 800, 1800),
    averages: { customers: { pageViews: randFloat(rng, 4, 12, 1), formSubmissions: randFloat(rng, 1, 3, 1) }, leads: { pageViews: randFloat(rng, 1, 5, 1), formSubmissions: randFloat(rng, 0.2, 1, 1) } },
    trafficSources,
    titlePatterns: { customers: titles.map(keyword => ({ keyword, pct: randInt(rng, 5, 35) })), leads: titles.map(keyword => ({ keyword, pct: randInt(rng, 5, 35) })) },
    avgDaysToConvert: randInt(rng, 20, 90),
    conversionDrivers: ['Page Views', 'Form Submissions', 'Pricing Page Visit', 'Case Study View'].map(label => ({ key: label.toLowerCase().replace(/\s+/g, '_'), label, custAvg: randFloat(rng, 3, 10, 1), leadAvg: randFloat(rng, 1, 5, 1), lift: randFloat(rng, 1.1, 3.2, 2) })),
    scoringRules: [
      { category: 'Engagement', items: [{ label: 'Visited pricing page', pts: 15 }, { label: 'Downloaded catalogue', pts: 10 }] },
      { category: 'Firmographic', items: [{ label: 'Enterprise company size', pts: 20 }, { label: 'Existing customer contact', pts: 18 }] },
    ],
  }
})()
export function analysisRun() { return { ok: true, message: 'Analysis refreshed.' } }
