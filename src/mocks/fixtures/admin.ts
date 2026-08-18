// /api/admin/*, /api/admin-access-depts — AdminPage.tsx, TargetsPanel.tsx,
// ManagementEmailPanel.tsx. Admin CRUD is the lowest-priority surface for this
// demo (per the mock-data brief) — GET shapes are filled in; mutations are
// handled generically in server.ts (accept + echo/no-op).
import { rngFor, randInt } from '../prng'
import { SALES_TEAM, MARKETING_TEAM, ANNUAL_TARGET_NZ, ANNUAL_TARGET_AU, NZ_FY_CURVE, AU_FY_CURVE } from './company'
import { INVOICED_FY, MANUAL_METRICS } from './salesTracking'

// ── /api/admin/users ─────────────────────────────────────────────────────────
export const ADMIN_USERS = (() => {
  const rng = rngFor('admin-users')
  const people = [
    { name: 'Sam Kim', email: 'sam@yourcompany.io', role: 'super_admin' as const },
    { name: 'Alex Chen', email: 'alex@yourcompany.io', role: 'admin' as const },
    ...MARKETING_TEAM.slice(2).map(m => ({ name: m.name, email: m.fullEmail, role: null })),
    ...SALES_TEAM.slice(0, 4).map(p => ({ name: p.name, email: p.email, role: null })),
  ].filter((p, i, arr) => arr.findIndex(q => q.email === p.email) === i)
  return people.map((p, i) => ({
    id: `user-${i}`, email: p.email, firstName: p.name.split(' ')[0], lastName: p.name.split(' ').slice(1).join(' '),
    imageUrl: null, createdAt: Date.now() - randInt(rng, 10, 400) * 86400000,
    role: p.role, allowedDepts: ['marketing', 'sales', 'team'], blockedDepts: [] as string[], earlyAccessDepts: [] as string[],
  }))
})()

export const ADMIN_AUDIT_LOG = (() => {
  const rng = rngFor('admin-audit-log')
  const actions = ['invite_sent', 'role_changed', 'dept_blocked', 'user_removed', 'dept_early_access_granted']
  return Array.from({ length: 12 }, (_, i) => ({
    id: `audit-${i}`, action: actions[i % actions.length], actor: 'sam@yourcompany.io',
    target: ADMIN_USERS[randInt(rng, 0, ADMIN_USERS.length - 1)].email,
    created_at: new Date(Date.now() - i * 86400000 * 3).toISOString(), details: {},
  }))
})()

export const ADMIN_TARGETS = {
  fyTargets: NZ_FY_CURVE.months.map(m => ({ label: m.label, target: m.target })),
  fyTargetsAu: AU_FY_CURVE.months.map(m => ({ label: m.label, target: m.target })),
  fyInvoicedTargets: INVOICED_FY.byMonth.map(m => ({ label: m.label, target: m.target })),
  kpiTeam: SALES_TEAM,
  kpiPoints: { ce_visit: 5, project_visit: 4, ce_call: 3, project_call: 2, bd_visit: 5, bd_call: 3 },
  emailRecipients: ['sam@yourcompany.io', 'alex@yourcompany.io'],
  emailEnabled: true, emailSendTime: '07:30',
}

export const FORWARD_ORDER_TARGET = { target: 12_000_000 }
export const ADMIN_ACCESS_DEPTS = { depts: [] as string[] }
export const HUBSPOT_OWNERS = { owners: SALES_TEAM.map(p => ({ id: p.id, name: p.name })) }
export const CE_OWNERS = { owners: SALES_TEAM.map(p => p.name) }
export const CE_SALESPEOPLE = { salespeople: SALES_TEAM.map(p => p.name) }

export const managementEmailStore = {
  leadership: { enabled: true, recipients: ['sam@yourcompany.io'], sendTime: '07:00' },
  top5: { enabled: true, recipients: ['sam@yourcompany.io', 'alex@yourcompany.io'], sendTime: '07:15' },
  kpis: { enabled: false, recipients: [], sendTime: '18:00' },
}
