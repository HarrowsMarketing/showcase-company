// /api/huddle* — MondayHuddle.tsx ("Monday Huddle" tab).
import { rngFor, pick, randInt, randFloat } from '../prng'
import { NOW, addDays, MARKETING_TEAM } from './company'
import { SALES_TRACKING } from './salesTracking'

function mondayOf(d: Date) { const m = new Date(d); m.setHours(0, 0, 0, 0); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m }
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const CURRENT_WEEK = ymd(mondayOf(NOW))
const PAST_WEEKS = Array.from({ length: 6 }, (_, i) => ymd(mondayOf(addDays(NOW, -(i + 1) * 7))))
const NEXT_WEEK = ymd(mondayOf(addDays(NOW, 7)))

function buildSnapshot(week: string) {
  const rng = rngFor(`huddle-snapshot-${week}`)
  const sessions = randInt(rng, 1400, 3200)
  const period = () => ({ sessions: randInt(rng, 1200, 3200), users: randInt(rng, 900, 2400), engagementRate: randFloat(rng, 45, 68, 1), newUsers: randInt(rng, 400, 1200) })
  return {
    marketingSnapshot: { ...period(), rangeLabel: 'Last 7 days', lastMonth: period() },
    salesNumbers: {
      newMqlThisMonth: randInt(rng, 40, 110), newMqlLastMonth: randInt(rng, 35, 100),
      sqlThisMonth: randInt(rng, 8, 28), sqlLastMonth: randInt(rng, 6, 26),
      newPipelineThisMonth: randInt(rng, 8, 22), newPipelineLastMonth: randInt(rng, 6, 20),
      wonRevenueThisMonth: SALES_TRACKING.monthlySales.actual, wonRevenueLastMonth: SALES_TRACKING.monthlySales.prevMonth,
    },
    computedAt: NOW.toISOString(),
  }
}

const meetingsByWeek = new Map<string, any>()
function meetingFor(week: string, status: 'open' | 'completed') {
  const rng = rngFor(`huddle-meeting-${week}`)
  const meeting = {
    id: `huddle-${week}`, week_start: week, status,
    notes: {
      review: { Marketing: { good: 'Strong organic traffic growth this week.', bad: '', interesting: 'Referral traffic from a trade industry blog spiked.' } },
      sales: 'Pipeline tracking to target this month.',
      marketing: 'Spring campaign creative in final review.',
      social: 'New reel performing well — 3x average reach.', socialImages: [],
      blogs: 'Cordless drill buying guide drafted, publishing Friday.',
      edms: 'August newsletter scheduled for Thursday.',
      newsletter: '',
      campaigns: 'EOFY campaign planning underway.',
      tasks: Object.fromEntries(MARKETING_TEAM.map(m => [m.name, pick(rng, ['On track', 'Blocked on approval', 'Not started yet', ''])])),
      blockers: Object.fromEntries(MARKETING_TEAM.map(m => [m.name, pick(rng, ['', '', 'Waiting on client sign-off', 'Needs content resource'])])),
    },
    snapshot: buildSnapshot(week),
    completed_by: status === 'completed' ? pick(rng, MARKETING_TEAM).name : null,
    completed_at: status === 'completed' ? addDays(NOW, -randInt(rng, 1, 6)).toISOString() : null,
  }
  return meeting
}
;[...PAST_WEEKS].forEach(w => meetingsByWeek.set(w, meetingFor(w, 'completed')))
meetingsByWeek.set(CURRENT_WEEK, meetingFor(CURRENT_WEEK, 'open'))

export function huddleWeeks() {
  return [...meetingsByWeek.keys()].sort().reverse().map(week_start => {
    const m = meetingsByWeek.get(week_start)
    return { week_start, status: m.status, completed_at: m.completed_at }
  })
}
export function huddleForWeek(week: string) {
  if (!meetingsByWeek.has(week)) meetingsByWeek.set(week, meetingFor(week, week === CURRENT_WEEK || week === NEXT_WEEK ? 'open' : 'completed'))
  return meetingsByWeek.get(week)
}
export function huddlePatchNotes(id: string, notes: any) {
  for (const m of meetingsByWeek.values()) if (m.id === id) { m.notes = { ...m.notes, ...notes }; return m }
  return null
}
export function huddleComplete(id: string) {
  for (const m of meetingsByWeek.values()) if (m.id === id) { m.status = 'completed'; m.completed_at = NOW.toISOString(); m.completed_by = MARKETING_TEAM[0].name; return m }
  return null
}

// ── /api/huddle/ideas ─────────────────────────────────────────────────────────
const ideaSeed = (() => {
  const rng = rngFor('huddle-ideas')
  const bodies = [
    'What if we did a behind-the-scenes reel of the warehouse pick-and-pack process?',
    'Idea: partner with a trade blog for a sponsored feature on our cordless tool range.',
    'Could we run a LinkedIn poll about hybrid workspace preferences?',
    'Worth trying a short customer testimonial video series?',
  ]
  return bodies.map((body, i) => ({
    id: `idea-${i}`, clerk_user_id: `user-${i % MARKETING_TEAM.length}`,
    author_name: MARKETING_TEAM[i % MARKETING_TEAM.length].name, author_avatar: null,
    body, link_url: i === 1 ? 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' : null,
    created_at: addDays(NOW, -randInt(rng, 0, 10)).toISOString(),
  }))
})()
export const ideasStore = { posts: [...ideaSeed] }
export function addIdea(body: string, link_url: string | null, authorName: string) {
  const post = { id: `idea-${Date.now()}`, clerk_user_id: 'demo-user', author_name: authorName, author_avatar: null, body, link_url, created_at: NOW.toISOString() }
  ideasStore.posts.unshift(post)
  return post
}
export function deleteIdea(id: string) {
  ideasStore.posts = ideasStore.posts.filter(p => p.id !== id)
}
