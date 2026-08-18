// /api/mql, /api/mql/sql-queue, /api/mql/contact-brief, /api/contacts/lifecycle-stages
// — MQLDashboard.tsx, MqlManager.tsx.
import { rngFor, pick, randInt, weightedBool } from '../prng'
import { NOW, addDays } from './company'
import { contactNameFor } from './dealGen'

const COMPANY_POOL = ['Meridian Workspaces', 'Beacon Health Group', 'Solstice Architects', 'Northfield University', 'Vantage Legal Partners', 'Cobalt Financial', 'Pinnacle Construction', 'Delta Logistics', 'Union Square Studios', 'Redwood Capital']
const JOB_TITLES = ['Facilities Manager', 'Head of Workplace', 'Procurement Lead', 'Office Manager', 'Interior Designer', 'Operations Director']
const PAGE_URLS = ['/products/desking', '/products/seating', '/case-studies', '/pricing', '/contact', '/showroom', '/products/boardroom', '/blog/workplace-trends-2026']
const LEAD_SOURCES = ['Organic Search → Product Page', 'Paid Search → Landing Page', 'Referral → Case Study', 'Direct → Pricing', 'Email → Newsletter Click']

function randomContact(rng: ReturnType<typeof rngFor>, i: number) {
  const name = contactNameFor(rng)
  const hasVisit = weightedBool(rng, 0.9)
  return {
    id: `mql-${i}`, name, email: `${name.toLowerCase().replace(' ', '.')}@example.com`,
    company: pick(rng, COMPANY_POOL), jobTitle: pick(rng, JOB_TITLES), phone: `+64 21 ${randInt(rng, 100, 999)} ${randInt(rng, 100, 999)}`,
    score: randInt(rng, 5, 98), totalPageViews: randInt(rng, 1, 40), formCount: randInt(rng, 0, 4),
    lastVisit: hasVisit ? addDays(NOW, -randInt(rng, 0, 60)).getTime() : null,
    createdAt: weightedBool(rng, 0.95) ? addDays(NOW, -randInt(rng, 1, 200)).toISOString() : null,
    leadSource: pick(rng, LEAD_SOURCES),
    recentPages: Array.from({ length: randInt(rng, 0, 4) }, () => ({ url: pick(rng, PAGE_URLS), ts: addDays(NOW, -randInt(rng, 0, 20)).toISOString(), count: randInt(rng, 1, 6) })),
  }
}

export const MQL_CONTACTS = (() => {
  const rng = rngFor('mql-contacts')
  const contacts = Array.from({ length: 40 }, (_, i) => randomContact(rng, i)).sort((a, b) => b.score - a.score)
  return { contacts, total: contacts.length }
})()

export const MQL_SQL_QUEUE = (() => {
  const rng = rngFor('mql-sql-queue')
  const contacts = Array.from({ length: 10 }, (_, i) => {
    const c = randomContact(rng, 1000 + i)
    return { id: c.id, name: c.name, email: c.email, company: c.company, jobTitle: c.jobTitle, phone: c.phone, totalPageViews: c.totalPageViews, formCount: c.formCount, becameSqlAt: addDays(NOW, -randInt(rng, 0, 14)).getTime() }
  })
  return { contacts }
})()

export function contactBrief(contactId: string) {
  const rng = rngFor(`contact-brief-${contactId}`)
  const allPageViews = Array.from({ length: randInt(rng, 2, 10) }, () => ({ url: pick(rng, PAGE_URLS), title: pick(rng, ['Product Page', 'Case Study', 'Pricing', 'Contact', 'Showroom']), ts: addDays(NOW, -randInt(rng, 0, 30)).toISOString() }))
  const formSubmissions = weightedBool(rng, 0.6) ? [{ name: pick(rng, ['Request a Quote', 'Book a Showroom Visit', 'Download Catalogue']) }] : []
  const products = Array.from({ length: randInt(rng, 1, 3) }, () => ({ name: pick(rng, ['Height-Adjustable Desk', 'Ergonomic Chair', 'Boardroom Table', 'Acoustic Pod']), count: randInt(rng, 1, 5) }))
  return { allPageViews, formSubmissions, products }
}

// ── /api/contacts/lifecycle-stages ──────────────────────────────────────────
export const LIFECYCLE_STAGES = {
  stages: [
    { value: 'subscriber', label: 'Subscriber' }, { value: 'lead', label: 'Lead' },
    { value: 'marketingqualifiedlead', label: 'Marketing Qualified Lead' }, { value: 'salesqualifiedlead', label: 'Sales Qualified Lead' },
    { value: 'opportunity', label: 'Opportunity' }, { value: 'customer', label: 'Customer' }, { value: 'other', label: 'Other' },
  ],
}
