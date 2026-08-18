// /api/social/instagram, /api/social/linkedin, /api/social/pinterest.
import { rngFor, pick, randInt, randFloat } from '../prng'
import { NOW, addDays } from './company'

const CAPTIONS = [
  'New arrivals for the workshop 🛠️', 'Behind the scenes at our Auckland warehouse',
  'Cordless range now in 4 voltage options', 'Trade partner spotlight: BuildRight Merchants stock drop',
  'Built to last — every tool backed by our 5-year warranty', 'Toolbox goals 🧰', 'Torque 101 with our product team',
  'Say hello to our new accessory range', 'Warehouse day with the team', 'Proud to support local trade partners',
]
const LINKEDIN_TEXTS = [
  'We\'re thrilled to announce our new exclusive distribution agreement with BuildRight Merchants — bringing our full power tool range to trade customers nationwide.',
  'Reliability isn\'t a checkbox for us — every tool we import is warranty-tested before it reaches the shelf.',
  'Hiring: we\'re growing our trade sales team. If you love the tools industry, we want to hear from you.',
]
const PIN_TITLES = [
  'Cordless Drill Buying Guide', 'Workshop Storage Ideas', 'Trade Toolkit Essentials',
  'Power Tool Maintenance Tips', 'DIY Starter Tool Set 2026', 'Garage Organisation Inspiration',
]

// ── /api/social/instagram ───────────────────────────────────────────────────
export const SOCIAL_INSTAGRAM = (() => {
  const rng = rngFor('social-instagram')
  const recentPosts = Array.from({ length: 6 }, (_, i) => ({
    caption: pick(rng, CAPTIONS), mediaType: pick(rng, ['IMAGE', 'IMAGE', 'CAROUSEL_ALBUM', 'VIDEO']),
    timestamp: addDays(NOW, -randInt(rng, 0, 40)).toISOString(),
    likeCount: randInt(rng, 25, 320), commentsCount: randInt(rng, 0, 24),
    permalink: `https://instagram.com/p/demo${i}`,
  }))
  const dailyTrend = Array.from({ length: 30 }, (_, i) => ({ date: addDays(NOW, -(29 - i)).toISOString().slice(0, 10), engagement: randInt(rng, 20, 260) }))
  return {
    configured: true, username: 'yourcompany.tools', followersCount: randInt(rng, 4200, 6800),
    mediaCount: randInt(rng, 320, 640), avgLikes: randInt(rng, 60, 220), avgComments: randInt(rng, 2, 14),
    reach7d: randInt(rng, 2000, 9000), impressions7d: randInt(rng, 3500, 14000),
    recentPosts, dailyTrend,
  }
})()

// ── /api/social/linkedin ─────────────────────────────────────────────────────
export const SOCIAL_LINKEDIN = (() => {
  const rng = rngFor('social-linkedin')
  const recentPosts = LINKEDIN_TEXTS.map(text => ({
    text, publishedAt: addDays(NOW, -randInt(rng, 1, 30)).getTime(),
    likeCount: randInt(rng, 15, 180), commentCount: randInt(rng, 0, 20), shareCount: randInt(rng, 0, 15),
  }))
  const dailyTrend = Array.from({ length: 30 }, (_, i) => ({
    date: addDays(NOW, -(29 - i)).toISOString().slice(0, 10), engagement: randInt(rng, 5, 90), clicks: randInt(rng, 2, 60),
  }))
  return { configured: true, followersCount: randInt(rng, 2100, 3600), recentPosts, dailyTrend }
})()

// ── /api/social/pinterest ─────────────────────────────────────────────────────
export const SOCIAL_PINTEREST = (() => {
  const rng = rngFor('social-pinterest')
  const recentPins = PIN_TITLES.map((title, i) => ({
    title, thumbnail: null, link: `https://pinterest.com/pin/demo${i}`, createdAt: addDays(NOW, -randInt(rng, 0, 60)).toISOString(),
  }))
  const dailyTrend = Array.from({ length: 30 }, (_, i) => ({
    date: addDays(NOW, -(29 - i)).toISOString().slice(0, 10),
    impressions: randInt(rng, 300, 2400), engagement: randInt(rng, 10, 140), clicks: randInt(rng, 2, 60),
  }))
  return { configured: true, username: 'yourcompanytools', followersCount: randInt(rng, 900, 2200), recentPins, dailyTrend }
})()
