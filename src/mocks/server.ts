// Installs the fake backend: every /api/* call (axios AND raw fetch — a handful
// of admin/huddle/sample-register components use fetch directly) is answered
// from the fixtures under ./fixtures/**, keyed by exact method+path. Nothing
// ever leaves the browser. See CLAUDE.md-equivalent notes in each fixture file
// for what each endpoint's real shape was derived from.
import axios from 'axios'
import AxiosMockAdapter from 'axios-mock-adapter'

import { rngFor, randInt } from './prng'
import { NOW } from './fixtures/company'
import { SALES_DATA, pipelineFor, HUBSPOT_LEADS, HUBSPOT_SECTORS, HUBSPOT_CONTACTS, HUBSPOT_REPEAT_CUSTOMERS, formsFor, HUBSPOT_EMAILS, contactActivities } from './fixtures/sales'
import { meetingSnapshot, MEETING_SQL_CONTACTS, MEETING_MQL_CONTACTS, MEETING_MQL_TREND, MEETING_PIPELINE_DEALS, MEETING_MARKETING_WON, MARKETING_PIPELINE_BY_SOURCE } from './fixtures/meeting'
import { SALES_TRACKING, INVOICED_FY, MANUAL_METRICS, KPI_TILES } from './fixtures/salesTracking'
import { SALES_BREAKDOWN } from './fixtures/salesBreakdown'
import { SALES_CLEANUP, DEALS_TO_WIN, bigRocksStore, INSTALL_SCHEDULE } from './fixtures/salesOps'
import { SALES_FORECAST } from './fixtures/forecast'
import { kpisFor, kpisRecent, kpisMonthly, salesSupportFor } from './fixtures/kpis'
import { SEO_SUMMARY, SEO_QUERIES, SEO_PAGES, analyticsFor, analyticsDeepFor } from './fixtures/seo'
import { SOCIAL_INSTAGRAM, SOCIAL_LINKEDIN, SOCIAL_PINTEREST } from './fixtures/social'
import { CE_ENGAGEMENT, regionsFor, historyFor, CE_ACTIVITY, companyProfile, companiesSearch, dealsSearch, CE_ACCOUNT_ROWS } from './fixtures/customerEngagement'
import { SMARTSHEET_COLUMNS, smartsheetStore, ssAddRow, ssUpdateRow, ssDeleteRows } from './fixtures/smartsheet'
import { contentPlanStore, cpAddRow, cpRenameRow, cpDeleteRow, cpAddEntry, cpUpdateEntry, cpDeleteEntry } from './fixtures/contentPlan'
import { MQL_CONTACTS, MQL_SQL_QUEUE, contactBrief, LIFECYCLE_STAGES } from './fixtures/mql'
import { huddleWeeks, huddleForWeek, huddlePatchNotes, huddleComplete, ideasStore, addIdea, deleteIdea } from './fixtures/huddle'
import { ADMIN_USERS, ADMIN_AUDIT_LOG, ADMIN_TARGETS, FORWARD_ORDER_TARGET, ADMIN_ACCESS_DEPTS, HUBSPOT_OWNERS, CE_OWNERS, CE_SALESPEOPLE, managementEmailStore } from './fixtures/admin'
import { MARKETING_TARGETS, focusTasksStore, priorityOrderStore, samplesStore, ANALYSIS_RESULTS, analysisRun } from './fixtures/misc'

type Ctx = { match: RegExpMatchArray; params: URLSearchParams; body: any }
type Route = { method: string; pattern: RegExp; handler: (ctx: Ctx) => any }

const ok = () => ({ ok: true })
const country = (ctx: Ctx): 'NZ' | 'AU' => (ctx.params.get('country') === 'AU' ? 'AU' : 'NZ')

// Simple accountName+activity keyed log store for /api/customer/activity/log.
const activityLog = new Map<string, { date: string; note?: string }[]>()
function logKey(accountName: string, activity: string) { return `${accountName}::${activity}` }
;(() => {
  const rng = rngFor('activity-log-seed')
  CE_ACCOUNT_ROWS.filter(a => !a.isGeneric).slice(0, 6).forEach(a => {
    ;['head_office_trip', 'director_contact'].forEach(activity => {
      if (rng() < 0.5) activityLog.set(logKey(a.name, activity), [{ date: NOW.toISOString().slice(0, 10), note: 'Logged during onboarding.' }])
    })
  })
})()

const ROUTES: Route[] = [
  // ── HubSpot / marketing ──────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/api\/hubspot\/pipeline$/, handler: ctx => pipelineFor(country(ctx)) },
  { method: 'GET', pattern: /^\/api\/hubspot\/leads$/, handler: () => HUBSPOT_LEADS },
  { method: 'GET', pattern: /^\/api\/hubspot\/sectors$/, handler: () => HUBSPOT_SECTORS },
  { method: 'GET', pattern: /^\/api\/hubspot\/contacts$/, handler: () => HUBSPOT_CONTACTS },
  { method: 'GET', pattern: /^\/api\/hubspot\/repeatcustomers$/, handler: () => HUBSPOT_REPEAT_CUSTOMERS },
  { method: 'GET', pattern: /^\/api\/hubspot\/forms$/, handler: ctx => formsFor(country(ctx)) },
  { method: 'GET', pattern: /^\/api\/hubspot\/emails$/, handler: () => HUBSPOT_EMAILS },
  { method: 'GET', pattern: /^\/api\/hubspot\/contact\/([^/]+)\/activities$/, handler: ctx => contactActivities(ctx.match[1]) },
  { method: 'GET', pattern: /^\/api\/hubspot\/kpis$/, handler: ctx => kpisFor(ctx.params.get('from') || '', ctx.params.get('to') || '') },
  { method: 'GET', pattern: /^\/api\/hubspot\/kpis\/recent$/, handler: ctx => kpisRecent(ctx.params.get('ownerId') || '', ctx.params.get('type') || '') },
  { method: 'GET', pattern: /^\/api\/hubspot\/kpis\/monthly$/, handler: ctx => kpisMonthly(ctx.params.get('prevFy') === '1') },
  { method: 'GET', pattern: /^\/api\/hubspot\/sales-support$/, handler: ctx => salesSupportFor(ctx.params.get('from') || '', ctx.params.get('to') || '') },
  { method: 'GET', pattern: /^\/api\/hubspot\/companies\/search$/, handler: ctx => companiesSearch(ctx.params.get('q') || '') },
  { method: 'GET', pattern: /^\/api\/hubspot\/deals\/search$/, handler: ctx => dealsSearch(ctx.params.get('q') || '') },

  // ── Smartsheet ────────────────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/api\/smartsheet$/, handler: () => ({ columns: SMARTSHEET_COLUMNS, rows: smartsheetStore.rows }) },
  { method: 'POST', pattern: /^\/api\/smartsheet\/meeting$/, handler: () => ok() },
  { method: 'PUT', pattern: /^\/api\/smartsheet\/rows$/, handler: ctx => {
    const items = Array.isArray(ctx.body) ? ctx.body : [ctx.body]
    return items.map((it: any) => ssUpdateRow(Number(it.id), it.cells || []))
  } },
  { method: 'POST', pattern: /^\/api\/smartsheet\/rows$/, handler: ctx => {
    const items = Array.isArray(ctx.body) ? ctx.body : [ctx.body]
    return items.map((it: any) => ssAddRow(it))
  } },
  { method: 'DELETE', pattern: /^\/api\/smartsheet\/rows$/, handler: ctx => {
    const ids = (ctx.params.get('ids') || '').split(',').filter(Boolean).map(Number)
    ssDeleteRows(ids)
    return ok()
  } },

  // ── Analytics / SEO ───────────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/api\/analytics\/deep$/, handler: ctx => analyticsDeepFor(country(ctx)) },
  { method: 'GET', pattern: /^\/api\/analytics$/, handler: ctx => analyticsFor(country(ctx)) },
  { method: 'GET', pattern: /^\/api\/seo\/queries$/, handler: () => SEO_QUERIES },
  { method: 'GET', pattern: /^\/api\/seo\/pages$/, handler: () => SEO_PAGES },
  { method: 'GET', pattern: /^\/api\/seo$/, handler: () => SEO_SUMMARY },

  // ── Meeting / Monday Huddle snapshot widgets ────────────────────────────
  { method: 'GET', pattern: /^\/api\/meeting\/snapshot$/, handler: ctx => meetingSnapshot(country(ctx)) },
  { method: 'GET', pattern: /^\/api\/meeting\/sql-contacts$/, handler: () => MEETING_SQL_CONTACTS },
  { method: 'GET', pattern: /^\/api\/meeting\/mql-contacts$/, handler: () => MEETING_MQL_CONTACTS },
  { method: 'GET', pattern: /^\/api\/meeting\/mql-trend$/, handler: () => MEETING_MQL_TREND },
  { method: 'GET', pattern: /^\/api\/meeting\/pipeline-deals$/, handler: () => MEETING_PIPELINE_DEALS },
  { method: 'GET', pattern: /^\/api\/meeting\/marketing-won$/, handler: () => MEETING_MARKETING_WON },

  // ── Social ────────────────────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/api\/social\/instagram$/, handler: () => SOCIAL_INSTAGRAM },
  { method: 'GET', pattern: /^\/api\/social\/linkedin$/, handler: () => SOCIAL_LINKEDIN },
  { method: 'GET', pattern: /^\/api\/social\/pinterest$/, handler: () => SOCIAL_PINTEREST },

  // ── Sales (the big ones) ──────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/api\/sales$/, handler: () => SALES_DATA },
  { method: 'GET', pattern: /^\/api\/sales\/tracking$/, handler: () => SALES_TRACKING },
  { method: 'GET', pattern: /^\/api\/sales\/invoiced-fy$/, handler: () => INVOICED_FY },
  { method: 'GET', pattern: /^\/api\/sales\/breakdown$/, handler: () => SALES_BREAKDOWN },
  { method: 'GET', pattern: /^\/api\/sales\/forecast$/, handler: () => SALES_FORECAST },
  { method: 'GET', pattern: /^\/api\/sales\/install-schedule$/, handler: () => INSTALL_SCHEDULE },
  { method: 'GET', pattern: /^\/api\/sales\/cleanup$/, handler: () => SALES_CLEANUP },
  { method: 'GET', pattern: /^\/api\/sales\/deals-to-win$/, handler: () => DEALS_TO_WIN },
  { method: 'GET', pattern: /^\/api\/sales\/big-rocks$/, handler: () => bigRocksStore },
  { method: 'PUT', pattern: /^\/api\/sales\/big-rocks$/, handler: ctx => { if (ctx.body?.rocks) bigRocksStore.rocks = ctx.body.rocks; return bigRocksStore } },
  { method: 'POST', pattern: /^\/api\/sales\/big-rocks\/complete$/, handler: ctx => {
    bigRocksStore.completed.push({ name: ctx.body?.name, text: ctx.body?.text, completedAt: NOW.toISOString() })
    if (ctx.body?.name && bigRocksStore.rocks[ctx.body.name]) bigRocksStore.rocks[ctx.body.name] = bigRocksStore.rocks[ctx.body.name].filter(t => t !== ctx.body.text)
    return bigRocksStore
  } },
  { method: 'POST', pattern: /^\/api\/sales\/big-rocks\/restore$/, handler: ctx => {
    bigRocksStore.completed = bigRocksStore.completed.filter(c => !(c.name === ctx.body?.name && c.text === ctx.body?.text))
    if (ctx.body?.name) { bigRocksStore.rocks[ctx.body.name] = bigRocksStore.rocks[ctx.body.name] || []; bigRocksStore.rocks[ctx.body.name].push(ctx.body?.text) }
    return bigRocksStore
  } },

  // ── Management ────────────────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/api\/management\/manual-metrics$/, handler: () => MANUAL_METRICS },
  { method: 'GET', pattern: /^\/api\/management\/kpi-tiles$/, handler: () => KPI_TILES },

  // ── MQL ───────────────────────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/api\/mql$/, handler: () => MQL_CONTACTS },
  { method: 'GET', pattern: /^\/api\/mql\/sql-queue$/, handler: () => MQL_SQL_QUEUE },
  { method: 'GET', pattern: /^\/api\/mql\/contact-brief$/, handler: ctx => contactBrief(ctx.params.get('contactId') || '') },
  { method: 'POST', pattern: /^\/api\/mql\/promote-to-sql$/, handler: () => ok() },
  { method: 'POST', pattern: /^\/api\/mql\/set-lifecycle$/, handler: () => ok() },
  { method: 'GET', pattern: /^\/api\/contacts\/lifecycle-stages$/, handler: () => LIFECYCLE_STAGES },

  // ── Customer Engagement ("Client Development") ──────────────────────────
  { method: 'GET', pattern: /^\/api\/customer\/engagement$/, handler: () => CE_ENGAGEMENT },
  { method: 'GET', pattern: /^\/api\/customer\/regions$/, handler: ctx => regionsFor(ctx.params.get('card') || '') },
  { method: 'GET', pattern: /^\/api\/customer\/history$/, handler: ctx => historyFor(ctx.params.get('card') || '') },
  { method: 'GET', pattern: /^\/api\/customer\/activity\/log$/, handler: ctx => ({ entries: activityLog.get(logKey(ctx.params.get('accountName') || '', ctx.params.get('activity') || '')) || [] }) },
  { method: 'POST', pattern: /^\/api\/customer\/activity\/log$/, handler: ctx => {
    const key = logKey(ctx.body?.accountName || '', ctx.body?.activity || '')
    const entries = activityLog.get(key) || []
    entries.push({ date: ctx.body?.date || NOW.toISOString().slice(0, 10), note: ctx.body?.note })
    activityLog.set(key, entries)
    return { entries }
  } },
  { method: 'DELETE', pattern: /^\/api\/customer\/activity\/log$/, handler: ctx => {
    const key = logKey(ctx.body?.accountName || '', ctx.body?.activity || '')
    const entries = (activityLog.get(key) || []).slice(0, -1)
    activityLog.set(key, entries)
    return { entries }
  } },
  { method: 'GET', pattern: /^\/api\/customer\/activity$/, handler: () => CE_ACTIVITY },
  { method: 'GET', pattern: /^\/api\/customer\/company\/([^/]+)$/, handler: ctx => companyProfile(ctx.match[1]) },
  { method: 'POST', pattern: /^\/api\/customer\/company\/([^/]+)\/designer$/, handler: () => ok() },
  { method: 'GET', pattern: /^\/api\/customer\/location-review$/, handler: () => ({ summary: {}, cards: [] }) },
  { method: 'POST', pattern: /^\/api\/customer\/(link|generic|target|deal-allocation|owner|confirm-locations|account)$/, handler: () => ok() },
  { method: 'DELETE', pattern: /^\/api\/customer\/account$/, handler: () => ok() },
  { method: 'POST', pattern: /^\/api\/customer\/owner\/remap$/, handler: () => ok() },
  { method: 'POST', pattern: /^\/api\/targets\/upload$/, handler: () => ok() },

  // ── Content Plan ──────────────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/api\/content\/plan$/, handler: () => contentPlanStore },
  { method: 'PUT', pattern: /^\/api\/content\/plan\/settings$/, handler: ctx => {
    if (ctx.body?.theme != null) contentPlanStore.theme = ctx.body.theme
    if (ctx.body?.quarterGoals) contentPlanStore.quarterGoals = ctx.body.quarterGoals
    return ok()
  } },
  { method: 'POST', pattern: /^\/api\/content\/plan\/rows$/, handler: ctx => cpAddRow(ctx.body?.label || 'New row') },
  { method: 'PATCH', pattern: /^\/api\/content\/plan\/rows\/([^/]+)$/, handler: ctx => cpRenameRow(ctx.match[1], ctx.body?.label || '') },
  { method: 'DELETE', pattern: /^\/api\/content\/plan\/rows\/([^/]+)$/, handler: ctx => { cpDeleteRow(ctx.match[1]); return ok() } },
  { method: 'POST', pattern: /^\/api\/content\/plan\/entries$/, handler: ctx => cpAddEntry(ctx.body?.row_id, ctx.body || {}) },
  { method: 'PATCH', pattern: /^\/api\/content\/plan\/entries\/([^/]+)$/, handler: ctx => cpUpdateEntry(ctx.match[1], ctx.body || {}) },
  { method: 'DELETE', pattern: /^\/api\/content\/plan\/entries\/([^/]+)$/, handler: ctx => { cpDeleteEntry(ctx.match[1]); return ok() } },

  // ── Marketing planner extras ──────────────────────────────────────────────
  { method: 'GET', pattern: /^\/api\/marketing\/pipeline-by-source$/, handler: () => MARKETING_PIPELINE_BY_SOURCE },
  { method: 'GET', pattern: /^\/api\/marketing\/targets$/, handler: () => MARKETING_TARGETS },
  { method: 'PUT', pattern: /^\/api\/marketing\/targets$/, handler: ctx => { Object.assign(MARKETING_TARGETS, ctx.body || {}); return MARKETING_TARGETS } },
  { method: 'GET', pattern: /^\/api\/marketing\/focus-tasks$/, handler: () => focusTasksStore },
  { method: 'PUT', pattern: /^\/api\/marketing\/focus-tasks$/, handler: ctx => { focusTasksStore.ids = ctx.body?.ids || []; return focusTasksStore } },
  { method: 'GET', pattern: /^\/api\/marketing\/priority-order$/, handler: () => priorityOrderStore },
  { method: 'PUT', pattern: /^\/api\/marketing\/priority-order$/, handler: ctx => { Object.assign(priorityOrderStore, ctx.body || {}); return priorityOrderStore } },

  // ── Monday Huddle ─────────────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/api\/huddle\/weeks$/, handler: () => huddleWeeks() },
  { method: 'GET', pattern: /^\/api\/huddle\/ideas$/, handler: () => ideasStore.posts },
  { method: 'POST', pattern: /^\/api\/huddle\/ideas$/, handler: ctx => addIdea(ctx.body?.body || '', ctx.body?.link_url ?? null, ctx.body?.author_name || 'Demo User') },
  { method: 'DELETE', pattern: /^\/api\/huddle\/ideas\/([^/]+)$/, handler: ctx => { deleteIdea(ctx.match[1]); return ok() } },
  { method: 'POST', pattern: /^\/api\/huddle\/social-upload$/, handler: () => ({ url: 'https://picsum.photos/seed/huddle/800/450' }) },
  { method: 'GET', pattern: /^\/api\/huddle$/, handler: ctx => huddleForWeek(ctx.params.get('week') || '') },
  { method: 'PATCH', pattern: /^\/api\/huddle\/([^/]+)$/, handler: ctx => huddlePatchNotes(ctx.match[1], ctx.body?.notes || {}) },
  { method: 'POST', pattern: /^\/api\/huddle\/([^/]+)\/complete$/, handler: ctx => huddleComplete(ctx.match[1]) },
  { method: 'POST', pattern: /^\/api\/huddle\/([^/]+)\/test-email$/, handler: () => ({ ok: true, result: { sent: false, skipped: 'Demo mode — no email is actually sent.' } }) },

  // ── Sample Register ───────────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/api\/production\/samples$/, handler: () => samplesStore.samples },
  { method: 'POST', pattern: /^\/api\/production\/samples$/, handler: ctx => {
    const s = { id: `sample-${Date.now()}`, display_id: `S-${String(samplesStore.samples.length + 1).padStart(4, '0')}`, history: [], ...ctx.body }
    samplesStore.samples.unshift(s)
    return s
  } },
  { method: 'PATCH', pattern: /^\/api\/production\/samples\/([^/]+)$/, handler: ctx => {
    const s = samplesStore.samples.find(x => x.id === ctx.match[1])
    if (s) Object.assign(s, ctx.body || {})
    return s || {}
  } },
  { method: 'DELETE', pattern: /^\/api\/production\/samples\/([^/]+)$/, handler: ctx => { samplesStore.samples = samplesStore.samples.filter(x => x.id !== ctx.match[1]); return ok() } },
  { method: 'POST', pattern: /^\/api\/production\/sample-upload$/, handler: () => ({ url: 'https://picsum.photos/seed/sample/600/450' }) },

  // ── Analysis (Lead Qualifier) ─────────────────────────────────────────────
  { method: 'GET', pattern: /^\/api\/analysis\/results$/, handler: () => ANALYSIS_RESULTS },
  { method: 'GET', pattern: /^\/api\/analysis\/run$/, handler: () => analysisRun() },

  // ── Admin ─────────────────────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/api\/admin\/users$/, handler: () => ({ users: ADMIN_USERS }) },
  { method: 'GET', pattern: /^\/api\/admin\/audit-log$/, handler: () => ({ entries: ADMIN_AUDIT_LOG }) },
  { method: 'POST', pattern: /^\/api\/admin\/invite$/, handler: () => ok() },
  { method: 'PATCH', pattern: /^\/api\/admin\/users\/([^/]+)$/, handler: () => ok() },
  { method: 'DELETE', pattern: /^\/api\/admin\/users\/([^/]+)$/, handler: () => ok() },
  { method: 'GET', pattern: /^\/api\/admin\/targets$/, handler: () => ADMIN_TARGETS },
  { method: 'PUT', pattern: /^\/api\/admin\/targets$/, handler: ctx => { Object.assign(ADMIN_TARGETS, ctx.body || {}); return ADMIN_TARGETS } },
  { method: 'GET', pattern: /^\/api\/admin\/forward-order-target$/, handler: () => FORWARD_ORDER_TARGET },
  { method: 'PUT', pattern: /^\/api\/admin\/forward-order-target$/, handler: ctx => { if (ctx.body?.target != null) FORWARD_ORDER_TARGET.target = ctx.body.target; return FORWARD_ORDER_TARGET } },
  { method: 'GET', pattern: /^\/api\/admin-access-depts$/, handler: () => ADMIN_ACCESS_DEPTS },
  { method: 'PUT', pattern: /^\/api\/admin-access-depts$/, handler: ctx => {
    const { deptId, allow } = ctx.body || {}
    if (deptId) ADMIN_ACCESS_DEPTS.depts = allow ? [...new Set([...ADMIN_ACCESS_DEPTS.depts, deptId])] : ADMIN_ACCESS_DEPTS.depts.filter(d => d !== deptId)
    return ADMIN_ACCESS_DEPTS
  } },
  { method: 'GET', pattern: /^\/api\/admin\/hubspot-owners$/, handler: () => HUBSPOT_OWNERS },
  { method: 'GET', pattern: /^\/api\/admin\/ce-owners$/, handler: () => CE_OWNERS },
  { method: 'PUT', pattern: /^\/api\/admin\/ce-owners$/, handler: () => CE_OWNERS },
  { method: 'GET', pattern: /^\/api\/admin\/ce-salespeople$/, handler: () => CE_SALESPEOPLE },
  { method: 'PUT', pattern: /^\/api\/admin\/ce-salespeople$/, handler: () => CE_SALESPEOPLE },
  { method: 'GET', pattern: /^\/api\/admin\/management-email$/, handler: () => managementEmailStore },
  { method: 'PUT', pattern: /^\/api\/admin\/management-email$/, handler: ctx => {
    const { dashboard, ...cfg } = ctx.body || {}
    if (dashboard && (managementEmailStore as any)[dashboard]) Object.assign((managementEmailStore as any)[dashboard], cfg)
    return managementEmailStore
  } },
  { method: 'POST', pattern: /^\/api\/admin\/management-email\/test$/, handler: () => ({ ok: true, result: { sent: true, recipients: ['demo@yourcompany.io'] } }) },
  { method: 'POST', pattern: /^\/api\/admin\/send-test-email$/, handler: () => ({ ok: true, result: { sent: true, recipients: ['demo@yourcompany.io'] } }) },
]

function parseBody(raw: any) {
  if (raw == null) return {}
  if (typeof raw === 'string') { try { return JSON.parse(raw) } catch { return {} } }
  return raw
}

/** Shared routing logic used by both the axios adapter and the fetch shim below. */
function dispatch(method: string, rawUrl: string, axiosParams: Record<string, any> | undefined, rawBody: any): [number, any] {
  const [path, qs] = rawUrl.split('?')
  const params = new URLSearchParams(qs || '')
  if (axiosParams) Object.entries(axiosParams).forEach(([k, v]) => { if (v != null) params.set(k, String(v)) })
  const body = parseBody(rawBody)
  for (const route of ROUTES) {
    if (route.method !== method) continue
    const m = path.match(route.pattern)
    if (m) {
      try {
        return [200, route.handler({ match: m, params, body }) ?? {}]
      } catch (e) {
        console.error('[mock-api]', method, path, e)
        return [200, {}]
      }
    }
  }
  // Never 404 — anything unrecognised gets a harmless empty object.
  return [200, {}]
}

export function installMockApi() {
  const mock = new AxiosMockAdapter(axios, { delayResponse: randInt(rngFor('mock-delay'), 150, 400) })
  mock.onGet(/^\/api\//).reply(config => dispatch('GET', config.url || '', config.params, undefined))
  mock.onPost(/^\/api\//).reply(config => dispatch('POST', config.url || '', config.params, config.data))
  mock.onPut(/^\/api\//).reply(config => dispatch('PUT', config.url || '', config.params, config.data))
  mock.onPatch(/^\/api\//).reply(config => dispatch('PATCH', config.url || '', config.params, config.data))
  mock.onDelete(/^\/api\//).reply(config => dispatch('DELETE', config.url || '', config.params, config.data))

  // A handful of admin/huddle/sample-register components call `fetch()` directly
  // (with a bearer token that nothing here validates) instead of going through
  // axios — patch window.fetch too so those keep working unmodified.
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    if (!url.startsWith('/api/')) return realFetch(input, init)
    const method = (init?.method || 'GET').toUpperCase()
    const [status, data] = dispatch(method, url, undefined, init?.body)
    await new Promise(resolve => setTimeout(resolve, 150 + Math.floor(Math.random() * 200)))
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  }
}
