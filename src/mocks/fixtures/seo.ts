// /api/seo, /api/seo/queries, /api/seo/pages, /api/analytics, /api/analytics/deep
// — SEODashboard.tsx.
import { rngFor, pick, randInt, randFloat } from '../prng'
import { NOW, ymd, addDays, addMonths, shortMonthLabel } from './company'

const QUERY_POOL = [
  'power tools nz', 'cordless drill nz', 'impact driver kit', 'angle grinder',
  'trade tool supplier', 'wholesale power tools', 'tool distributor nz', 'hand tools nz',
  'tool importer nz', 'cordless tool range', 'trade tool accounts', 'circular saw nz',
  'tool wholesaler', 'bulk tools supplier', 'cordless nail gun', 'tool storage solutions',
  'construction tools supplier', 'commercial power tools', 'multi-tool combo kit', 'belt sander nz',
  'trade tool catalogue', 'tool showroom nz', 'durable trade tools', 'hardware store supplier',
  'industrial tool supplier',
]
const PAGE_POOL = [
  '/', '/products/power-tools', '/products/hand-tools', '/products/storage', '/about', '/contact',
  '/case-studies', '/case-studies/buildright-merchants', '/products/accessories', '/products/combo-kits',
  '/blog/cordless-drill-guide', '/blog/trade-trends-2026', '/showroom', '/sustainability',
  '/products/cordless-range', '/careers', '/services/distribution', '/services/trade-accounts', '/products/warranty', '/faq',
]

// ── /api/seo ─────────────────────────────────────────────────────────────────
export const SEO_SUMMARY = (() => {
  const rng = rngFor('seo-summary')
  const clicks = randInt(rng, 2800, 5200)
  const impressions = randInt(rng, 65000, 120000)
  const monthly = Array.from({ length: 6 }, (_, i) => {
    const d = addMonths(new Date(NOW.getFullYear(), NOW.getMonth(), 1), -(5 - i))
    const c = randInt(rng, 2200, 5500)
    const imp = randInt(rng, 55000, 125000)
    return { label: shortMonthLabel(d), clicks: c, impressions: imp, ctr: Math.round((c / imp) * 1000) / 10, position: randFloat(rng, 8, 22, 1) }
  })
  const positionTrend = Array.from({ length: 12 }, (_, i) => {
    const d = addMonths(new Date(NOW.getFullYear(), NOW.getMonth(), 1), -(11 - i))
    return { label: shortMonthLabel(d), position: randFloat(rng, 8, 24, 1) }
  })
  const ga4Monthly = Array.from({ length: 12 }, (_, i) => {
    const d = addMonths(new Date(NOW.getFullYear(), NOW.getMonth(), 1), -(11 - i))
    return { label: shortMonthLabel(d), users: randInt(rng, 1800, 4200), keyEvents: randInt(rng, 60, 220) }
  })
  const sessions = randInt(rng, 9000, 16000)
  return {
    summary: { clicks, impressions, ctr: Math.round((clicks / impressions) * 1000) / 10, position: randFloat(rng, 9, 18, 1) },
    monthly, positionTrend,
    siteOverview: { sessions, engagedSessions: Math.round(sessions * 0.62), activeUsers: Math.round(sessions * 0.78), newUsers: Math.round(sessions * 0.45), totalUsers: Math.round(sessions * 0.82), keyEventsTotal: randInt(rng, 400, 900) },
    organic: { sessions: Math.round(sessions * 0.55), users: Math.round(sessions * 0.4), keyEvents: randInt(rng, 180, 420) },
    ga4Monthly,
  }
})()

// ── /api/seo/queries ─────────────────────────────────────────────────────────
export const SEO_QUERIES = (() => {
  const rng = rngFor('seo-queries')
  const queries = QUERY_POOL.map((query, i) => {
    const impressions = randInt(rng, 400, 12000)
    const clicks = Math.round(impressions * randFloat(rng, 0.01, 0.12, 3))
    return { rank: i + 1, query, impressions, clicks, position: randFloat(rng, 1, 45, 1), ctr: Math.round((clicks / impressions) * 1000) / 10 }
  }).sort((a, b) => b.clicks - a.clicks).map((q, i) => ({ ...q, rank: i + 1 }))
  return { queries }
})()

// ── /api/seo/pages ────────────────────────────────────────────────────────────
export const SEO_PAGES = (() => {
  const rng = rngFor('seo-pages')
  const pages = PAGE_POOL.map((page, i) => {
    const impressions = randInt(rng, 300, 9000)
    const clicks = Math.round(impressions * randFloat(rng, 0.01, 0.1, 3))
    return { rank: i + 1, page, fullUrl: `https://yourcompany.example.com${page}`, impressions, clicks, position: randFloat(rng, 1, 40, 1), ctr: Math.round((clicks / impressions) * 1000) / 10 }
  }).sort((a, b) => b.clicks - a.clicks).map((p, i) => ({ ...p, rank: i + 1 }))
  return { pages }
})()

// ── /api/analytics?country= ──────────────────────────────────────────────────
export function analyticsFor(_country: 'NZ' | 'AU') {
  const rng = rngFor(`analytics-${_country}`)
  const sessions = randInt(rng, 6000, 15000)
  const monthly = Array.from({ length: 6 }, (_, i) => {
    const d = addMonths(new Date(NOW.getFullYear(), NOW.getMonth(), 1), -(5 - i))
    return { label: shortMonthLabel(d), sessions: randInt(rng, 5500, 16000) }
  })
  return {
    summary: {
      sessions, users: Math.round(sessions * 0.78), bounceRate: randFloat(rng, 32, 55, 1),
      avgSessionDuration: randInt(rng, 60, 220), engagementRate: randFloat(rng, 45, 68, 1),
      pagesPerSession: randFloat(rng, 1.4, 3.2, 2), newUsers: Math.round(sessions * 0.45), returningUsers: Math.round(sessions * 0.33),
    },
    monthly,
    sources: ['Organic Search', 'Direct', 'Paid Search', 'Referral', 'Social', 'Email', 'Organic Social', 'Display']
      .map(source => ({ source, sessions: randInt(rng, 300, 4200) })).sort((a, b) => b.sessions - a.sessions),
  }
}

// ── /api/analytics/deep?country= ─────────────────────────────────────────────
export function analyticsDeepFor(_country: 'NZ' | 'AU') {
  const rng = rngFor(`analytics-deep-${_country}`)
  const topPages = PAGE_POOL.slice(0, 10).map(page => {
    const sessions = randInt(rng, 200, 3000)
    return { page: page === '/' ? 'Home' : page.replace('/', '').replace(/-/g, ' '), sessions, views: Math.round(sessions * randFloat(rng, 1.1, 2.2, 2)), avgDuration: randInt(rng, 30, 240) }
  }).sort((a, b) => b.sessions - a.sessions)
  const deviceSplit = [randFloat(rng, 0.45, 0.6, 3), randFloat(rng, 0.3, 0.45, 3)]
  const devices = [
    { device: 'desktop', sessions: 0, pct: Math.round(deviceSplit[0] * 1000) / 10 },
    { device: 'mobile', sessions: 0, pct: Math.round(deviceSplit[1] * 1000) / 10 },
    { device: 'tablet', sessions: 0, pct: Math.round((1 - deviceSplit[0] - deviceSplit[1]) * 1000) / 10 },
  ]
  const total = randInt(rng, 6000, 15000)
  devices.forEach(d => { d.sessions = Math.round(total * d.pct / 100) })
  const cities = _country === 'AU'
    ? ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Gold Coast', 'Canberra', 'Newcastle']
    : ['Auckland', 'Wellington', 'Christchurch', 'Hamilton', 'Tauranga', 'Dunedin', 'Palmerston North', 'Napier']
  const geographic = cities.map(city => ({ city, sessions: randInt(rng, 200, 3200) })).sort((a, b) => b.sessions - a.sessions)
  const acquisition = [
    { source: 'google', medium: 'organic' }, { source: '(direct)', medium: '(none)' },
    { source: 'google', medium: 'cpc' }, { source: 'facebook', medium: 'social' },
    { source: 'instagram', medium: 'social' }, { source: 'linkedin', medium: 'social' },
    { source: 'bing', medium: 'organic' }, { source: 'newsletter', medium: 'email' },
    { source: 'referral-partner.co.nz', medium: 'referral' }, { source: 'google', medium: 'display' },
  ].map(a => ({ ...a, sessions: randInt(rng, 100, 2400) })).sort((a, b) => b.sessions - a.sessions)
  const dailyTrend = Array.from({ length: 30 }, (_, i) => {
    const d = addDays(NOW, -(29 - i))
    return { date: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`, sessions: randInt(rng, 120, 620) }
  })
  const conversions = [
    'Form Submission', 'Phone Click', 'Catalogue Download', 'Showroom Booking', 'Quote Request',
    'Newsletter Signup', 'Live Chat Started', 'Case Study View', 'Sample Request', 'Contact Page View',
  ].map(event => ({ event, count: randInt(rng, 10, 320) })).sort((a, b) => b.count - a.count)
  return { topPages, devices, geographic, acquisition, dailyTrend, conversions }
}
