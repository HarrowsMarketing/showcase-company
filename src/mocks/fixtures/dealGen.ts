// Shared vocabulary for generating fake "deal"-shaped records across the sales,
// breakdown, cleanup, forecast, and customer-engagement fixtures — keeps deal
// names/stages/owners looking like the same underlying business everywhere
// without needing one literal shared deal database (only the headline revenue
// totals need to reconcile across endpoints; per-deal identity doesn't).
import { pick, randInt, type Rng } from '../prng'
import { CE_ACCOUNTS, SALES_TEAM_NAMES } from './company'

export const PROJECT_TYPES = [
  'Power Tool Range Order', 'Hand Tool Bulk Order', 'Cordless Tool Bundle', 'Trade Account Setup',
  'Seasonal Restock Order', 'Exclusive Distribution Deal', 'Catalogue Expansion', 'Private Label Tool Range',
  'Warranty Program Rollout', 'Retail Display Package', 'Warehouse Stock Order', 'Trade Show Order',
  'New Store Opening Order', 'Accessory Line Expansion', 'Branch Rollout Order', 'Annual Supply Agreement',
]

// Open-pipeline stages, roughly in order, each with a typical HubSpot-style
// probability. Closed Won/Lost are handled separately by callers.
export const OPEN_STAGES: { name: string; probability: number }[] = [
  { name: 'New Lead', probability: 0.05 },
  { name: 'Needs Analysis', probability: 0.15 },
  { name: 'Quote Sent', probability: 0.35 },
  { name: 'Negotiation', probability: 0.55 },
  { name: 'Verbal Commitment', probability: 0.75 },
  { name: 'Contract Sent', probability: 0.9 },
]
export const WON_STAGE = 'Closed Won'
export const LOST_STAGE = 'Closed Lost'

const GENERIC_COMPANY_NAMES = [
  'Kestrel Trading Ltd', 'Bramwell & Co', 'Northgate Trading', 'Fenwick Holdings',
  'Silverline Ventures', 'Marlow Group', 'Thackeray Partners', 'Coastal Ridge Ltd',
]

export function dealAccountName(rng: Rng) {
  return rng() < 0.75 ? pick(rng, CE_ACCOUNTS).name : pick(rng, GENERIC_COMPANY_NAMES)
}
export function dealName(rng: Rng, accountName?: string) {
  const acc = accountName || dealAccountName(rng)
  return `${acc} — ${pick(rng, PROJECT_TYPES)}`
}
export function dealOwner(rng: Rng, pool: string[] = SALES_TEAM_NAMES) {
  return pick(rng, pool)
}
export function contactNameFor(rng: Rng) {
  const first = ['Sarah', 'Michael', 'Emma', 'James', 'Olivia', 'Daniel', 'Grace', 'Ryan', 'Chloe', 'Mark', 'Hannah', 'Ben']
  const last = ['Thompson', 'Reid', 'Walsh', 'Carter', 'Bishop', 'Fenn', 'Doyle', 'Marsh', 'Kelleher', 'Voss']
  return `${pick(rng, first)} ${pick(rng, last)}`
}
export function dealAmount(rng: Rng, min = 8000, max = 220000) {
  return Math.round(randInt(rng, min, max) / 100) * 100
}
