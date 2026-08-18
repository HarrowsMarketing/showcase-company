import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../lib/fakeAuth'
import { LogoMark } from '../components/Logo'

const ALL_DEPTS = [
  { id: 'sales', label: 'Sales' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'production', label: 'Production' },
  { id: 'projects', label: 'Project Management' },
  { id: 'finance', label: 'Finance' },
  { id: 'management', label: 'Management' },
]

// Depts with no dashboard built yet — the only ones "early access" is meaningful for
const UNRELEASED_DEPTS = ['finance']

// Released depts — the only ones shown in the main "Dashboard access" list.
// Unreleased depts are granted via the "Early access" section instead.
const RELEASED_DEPTS = ALL_DEPTS.filter(d => !UNRELEASED_DEPTS.includes(d.id))

interface ClerkUser {
  id: string
  email: string | null
  firstName: string | null
  lastName: string | null
  imageUrl: string | null
  allowedDepts: string[]
  role: string | null
  blockedDepts: string[]
  earlyAccessDepts: string[]
  createdAt: number
}

interface AuditEntry {
  id: number
  actor_email: string | null
  action: string
  target_email: string | null
  details: Record<string, any>
  created_at: string
}

interface AdminPageProps {
  onBack: () => void
  userName: string | null
  userAvatar: string | null
  onSignOut: () => void
  isSuperAdmin: boolean
}

function Avatar({ src, name, size = 8 }: { src: string | null; name: string | null; size?: number }) {
  if (src) return <img src={src} alt={name ?? ''} className={`w-${size} h-${size} rounded-full object-cover`} />
  return (
    <div className={`w-${size} h-${size} rounded-full bg-gray-200 flex items-center justify-center text-xs font-semibold text-gray-600 shrink-0`}>
      {(name?.[0] ?? '?').toUpperCase()}
    </div>
  )
}

function DeptBadge({ deptId }: { deptId: string }) {
  const dept = ALL_DEPTS.find(d => d.id === deptId)
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 font-medium">
      {dept?.label ?? deptId}
    </span>
  )
}

export default function AdminPage({ onBack, userName, userAvatar, onSignOut, isSuperAdmin }: AdminPageProps) {
  const { getToken } = useAuth()
  const [users, setUsers] = useState<ClerkUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteDepts, setInviteDepts] = useState<string[]>([])
  const [inviteRole, setInviteRole] = useState<'none' | 'admin' | 'super_admin'>('none')
  const [inviteBlockedDepts, setInviteBlockedDepts] = useState<string[]>([])
  const [inviteEarlyAccessDepts, setInviteEarlyAccessDepts] = useState<string[]>([])
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState(false)

  const [editingUser, setEditingUser] = useState<ClerkUser | null>(null)
  const [editDepts, setEditDepts] = useState<string[]>([])
  const [editRole, setEditRole] = useState<'none' | 'admin' | 'super_admin'>('none')
  const [editBlockedDepts, setEditBlockedDepts] = useState<string[]>([])
  const [editEarlyAccessDepts, setEditEarlyAccessDepts] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState('')

  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [showAuditLog, setShowAuditLog] = useState(false)
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState('')

  const canManage = (u: ClerkUser) => isSuperAdmin || (u.role !== 'admin' && u.role !== 'super_admin')

  const authFetch = useCallback(async (url: string, opts?: RequestInit) => {
    const token = await getToken()
    return fetch(url, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(opts?.headers ?? {}),
      },
    })
  }, [getToken])

  const loadUsers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await authFetch('/api/admin/users')
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load users')
      const data = await res.json()
      setUsers(data.users)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  useEffect(() => { loadUsers() }, [loadUsers])

  const loadAuditLog = useCallback(async () => {
    setAuditLoading(true)
    setAuditError('')
    try {
      const res = await authFetch('/api/admin/audit-log')
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load activity log')
      const data = await res.json()
      setAuditEntries(data.entries)
    } catch (e: any) {
      setAuditError(e.message)
    } finally {
      setAuditLoading(false)
    }
  }, [authFetch])

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return setInviteError('Email is required')
    setInviting(true)
    setInviteError('')
    try {
      const res = await authFetch('/api/admin/invite', {
        method: 'POST',
        body: JSON.stringify({
          email: inviteEmail.trim(),
          allowedDepts: inviteDepts,
          role: inviteRole === 'none' ? undefined : inviteRole,
          blockedDepts: inviteBlockedDepts,
          earlyAccessDepts: inviteEarlyAccessDepts,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Invite failed')
      setInviteSuccess(true)
      setTimeout(() => {
        setShowInvite(false)
        setInviteEmail('')
        setInviteDepts([])
        setInviteRole('none')
        setInviteBlockedDepts([])
        setInviteEarlyAccessDepts([])
        setInviteSuccess(false)
      }, 1500)
    } catch (e: any) {
      setInviteError(e.message)
    } finally {
      setInviting(false)
    }
  }

  const openEdit = (user: ClerkUser) => {
    if (!canManage(user)) return
    setEditingUser(user)
    setEditDepts(user.allowedDepts ?? [])
    setEditRole(user.role === 'super_admin' ? 'super_admin' : user.role === 'admin' ? 'admin' : 'none')
    setEditBlockedDepts(user.blockedDepts ?? [])
    setEditEarlyAccessDepts(user.earlyAccessDepts ?? [])
    setEditError('')
  }

  const handleSaveEdit = async () => {
    if (!editingUser) return
    setSaving(true)
    setEditError('')
    try {
      const res = await authFetch(`/api/admin/users/${editingUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          allowedDepts: editDepts,
          role: editRole === 'none' ? null : editRole,
          blockedDepts: editBlockedDepts,
          earlyAccessDepts: editEarlyAccessDepts,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
      setEditingUser(null)
      await loadUsers()
    } catch (e: any) {
      setEditError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (userId: string) => {
    setDeletingId(userId)
    try {
      const res = await authFetch(`/api/admin/users/${userId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Delete failed')
      await loadUsers()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setDeletingId(null)
    }
  }

  const toggleDept = (id: string, current: string[], setter: (v: string[]) => void) => {
    setter(current.includes(id) ? current.filter(d => d !== id) : [...current, id])
  }

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Home
            </button>
            <span className="text-gray-200">|</span>
            <LogoMark tone="charcoal" className="h-7 w-7" />
            <span className="text-lg text-gray-700 font-semibold">User Management</span>
          </div>
          <div className="flex items-center gap-2">
            <Avatar src={userAvatar} name={userName} size={8} />
            <span className="text-sm text-gray-600 hidden sm:block">{userName}</span>
            <button
              onClick={onSignOut}
              className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-900">People with access</h2>
            <p className="text-sm text-gray-400 mt-0.5">Invite team members and control which dashboards they can see.</p>
          </div>
          <div className="flex items-center gap-2">
            {isSuperAdmin && (
              <button
                onClick={() => { setShowAuditLog(true); loadAuditLog() }}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Activity log
              </button>
            )}
            <button
              onClick={() => { setShowInvite(true); setInviteError(''); setInviteSuccess(false) }}
              className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700 transition-colors font-medium"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Invite
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
        )}

        {loading ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-sm text-gray-400">
            Loading...
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
            {users.length === 0 && (
              <div className="p-12 text-center text-sm text-gray-400">No users yet.</div>
            )}
            {users.map(user => (
              <div key={user.id} className="flex items-center gap-4 px-6 py-4">
                <Avatar src={user.imageUrl} name={user.firstName ?? user.email} size={10} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900">
                      {user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : (user.firstName ?? user.email ?? '—')}
                    </span>
                    {user.role === 'super_admin' && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-amber-50 text-amber-700 font-medium">Super Admin</span>
                    )}
                    {user.role === 'admin' && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-purple-50 text-purple-700 font-medium">Admin</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">{user.email}</p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {user.role === 'admin' || user.role === 'super_admin' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-purple-50 text-purple-600">All dashboards</span>
                    ) : user.allowedDepts.length === 0 ? (
                      <span className="text-xs text-gray-300">No dashboards assigned</span>
                    ) : (
                      user.allowedDepts.map(d => <DeptBadge key={d} deptId={d} />)
                    )}
                    {(user.blockedDepts ?? []).map(d => (
                      <span key={`blocked-${d}`} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-red-50 text-red-600 font-medium">
                        🚫 {ALL_DEPTS.find(dep => dep.id === d)?.label ?? d}
                      </span>
                    ))}
                    {(user.earlyAccessDepts ?? []).map(d => (
                      <span key={`early-${d}`} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-amber-50 text-amber-600 font-medium">
                        ⚡ {ALL_DEPTS.find(dep => dep.id === d)?.label ?? d}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => openEdit(user)}
                    disabled={!canManage(user)}
                    title={!canManage(user) ? 'Only a super admin can manage other admins' : undefined}
                    className="text-xs text-gray-400 hover:text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`Remove access for ${user.email}? This will delete their account.`)) {
                        handleDelete(user.id)
                      }
                    }}
                    disabled={deletingId === user.id || !canManage(user)}
                    title={!canManage(user) ? 'Only a super admin can remove other admins' : undefined}
                    className="text-xs text-red-400 hover:text-red-600 px-3 py-1.5 rounded-lg border border-red-100 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
                  >
                    {deletingId === user.id ? '…' : 'Remove'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Invite modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Invite someone</h3>

            {inviteSuccess ? (
              <div className="py-6 text-center">
                <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-700">Invitation sent!</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Email address</label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500 mb-2 block">Dashboard access</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {RELEASED_DEPTS.map(d => (
                      <label key={d.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={inviteDepts.includes(d.id)}
                          onChange={() => toggleDept(d.id, inviteDepts, setInviteDepts)}
                          className="rounded text-blue-600"
                        />
                        <span className="text-sm text-gray-700">{d.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Access level</label>
                  <select
                    value={inviteRole}
                    onChange={e => setInviteRole(e.target.value as typeof inviteRole)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  >
                    <option value="none">Standard — only assigned dashboards</option>
                    <option value="admin">Admin — can invite & manage users</option>
                    {isSuperAdmin && <option value="super_admin">Super Admin — can also block dashboards from anyone</option>}
                  </select>
                </div>

                {isSuperAdmin && (
                  <details className="group rounded-lg border border-red-100">
                    <summary className="flex items-center justify-between cursor-pointer px-3 py-2 text-xs text-gray-500 select-none">
                      <span>Block from viewing (overrides everything, even Admin/Super Admin)</span>
                      <svg className="w-4 h-4 text-gray-300 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </summary>
                    <div className="grid grid-cols-2 gap-1.5 px-2 pb-2">
                      {ALL_DEPTS.map(d => (
                        <label key={d.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-100 hover:bg-red-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={inviteBlockedDepts.includes(d.id)}
                            onChange={() => toggleDept(d.id, inviteBlockedDepts, setInviteBlockedDepts)}
                            className="rounded text-red-600"
                          />
                          <span className="text-sm text-gray-700">{d.label}</span>
                        </label>
                      ))}
                    </div>
                  </details>
                )}

                {isSuperAdmin && (
                  <details className="group rounded-lg border border-amber-100">
                    <summary className="flex items-center justify-between cursor-pointer px-3 py-2 text-xs text-gray-500 select-none">
                      <span>Early access to unreleased dashboards</span>
                      <svg className="w-4 h-4 text-gray-300 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </summary>
                    <div className="grid grid-cols-2 gap-1.5 px-2 pb-2">
                      {ALL_DEPTS.filter(d => UNRELEASED_DEPTS.includes(d.id)).map(d => (
                        <label key={d.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-100 hover:bg-amber-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={inviteEarlyAccessDepts.includes(d.id)}
                            onChange={() => toggleDept(d.id, inviteEarlyAccessDepts, setInviteEarlyAccessDepts)}
                            className="rounded text-amber-600"
                          />
                          <span className="text-sm text-gray-700">{d.label}</span>
                        </label>
                      ))}
                    </div>
                  </details>
                )}

                {inviteError && <p className="text-xs text-red-500">{inviteError}</p>}

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => { setShowInvite(false); setInviteEmail(''); setInviteDepts([]); setInviteRole('none'); setInviteBlockedDepts([]); setInviteEarlyAccessDepts([]) }}
                    className="flex-1 px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleInvite}
                    disabled={inviting}
                    className="flex-1 px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
                  >
                    {inviting ? 'Sending…' : 'Send invite'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit user modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <Avatar src={editingUser.imageUrl} name={editingUser.firstName ?? editingUser.email} size={10} />
              <div>
                <h3 className="text-base font-semibold text-gray-900">
                  {editingUser.firstName ?? editingUser.email}
                </h3>
                <p className="text-xs text-gray-400">{editingUser.email}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 mb-2 block">Dashboard access</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {RELEASED_DEPTS.map(d => (
                    <label key={d.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editDepts.includes(d.id)}
                        onChange={() => toggleDept(d.id, editDepts, setEditDepts)}
                        className="rounded text-blue-600"
                      />
                      <span className="text-sm text-gray-700">{d.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">Access level</label>
                <select
                  value={editRole}
                  onChange={e => setEditRole(e.target.value as typeof editRole)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                >
                  <option value="none">Standard — only assigned dashboards</option>
                  <option value="admin">Admin — can invite & manage users</option>
                  {isSuperAdmin && <option value="super_admin">Super Admin — can also block dashboards from anyone</option>}
                </select>
              </div>

              {isSuperAdmin && (
                <details className="group rounded-lg border border-red-100">
                  <summary className="flex items-center justify-between cursor-pointer px-3 py-2 text-xs text-gray-500 select-none">
                    <span>Block from viewing (overrides everything, even Admin/Super Admin)</span>
                    <svg className="w-4 h-4 text-gray-300 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </summary>
                  <div className="grid grid-cols-2 gap-1.5 px-2 pb-2">
                    {ALL_DEPTS.map(d => (
                      <label key={d.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-100 hover:bg-red-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editBlockedDepts.includes(d.id)}
                          onChange={() => toggleDept(d.id, editBlockedDepts, setEditBlockedDepts)}
                          className="rounded text-red-600"
                        />
                        <span className="text-sm text-gray-700">{d.label}</span>
                      </label>
                    ))}
                  </div>
                </details>
              )}

              {isSuperAdmin && (
                <details className="group rounded-lg border border-amber-100">
                  <summary className="flex items-center justify-between cursor-pointer px-3 py-2 text-xs text-gray-500 select-none">
                    <span>Early access to unreleased dashboards</span>
                    <svg className="w-4 h-4 text-gray-300 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </summary>
                  <div className="grid grid-cols-2 gap-1.5 px-2 pb-2">
                    {ALL_DEPTS.filter(d => UNRELEASED_DEPTS.includes(d.id)).map(d => (
                      <label key={d.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-100 hover:bg-amber-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editEarlyAccessDepts.includes(d.id)}
                          onChange={() => toggleDept(d.id, editEarlyAccessDepts, setEditEarlyAccessDepts)}
                          className="rounded text-amber-600"
                        />
                        <span className="text-sm text-gray-700">{d.label}</span>
                      </label>
                    ))}
                  </div>
                </details>
              )}

              {editError && <p className="text-xs text-red-500">{editError}</p>}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setEditingUser(null)}
                  className="flex-1 px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={saving}
                  className="flex-1 px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Activity log modal */}
      {showAuditLog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl max-h-[80vh] shadow-xl flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">Activity log</h3>
              <button
                onClick={() => setShowAuditLog(false)}
                className="text-xs text-gray-400 hover:text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                Close
              </button>
            </div>

            {auditError && (
              <div className="mb-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{auditError}</div>
            )}

            <div className="overflow-y-auto -mx-2 px-2">
              {auditLoading ? (
                <div className="p-12 text-center text-sm text-gray-400">Loading...</div>
              ) : auditEntries.length === 0 ? (
                <div className="p-12 text-center text-sm text-gray-400">No activity recorded yet.</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {auditEntries.map(entry => (
                    <div key={entry.id} className="py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-gray-700">
                          <span className="font-medium">{entry.actor_email ?? 'Unknown'}</span>
                          {' '}{entry.action.replace(/_/g, ' ')}
                          {entry.target_email && <> — <span className="font-medium">{entry.target_email}</span></>}
                        </p>
                        <span className="text-xs text-gray-400 shrink-0">{new Date(entry.created_at).toLocaleString('en-NZ')}</span>
                      </div>
                      {entry.details && Object.keys(entry.details).length > 0 && (
                        <p className="text-xs text-gray-400 mt-0.5 font-mono truncate">{JSON.stringify(entry.details)}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
