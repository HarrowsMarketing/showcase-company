import { useState, useEffect } from 'react'
import { useAuth } from '../lib/fakeAuth'
import type { MgmtDashId } from './ManagementEmailPanel'

// When opened from a management dashboard, the "Daily Email" tab edits that
// dashboard's email (via /api/admin/management-email) instead of the sales
// dashboard email, and the header names the dashboard. All target editing is
// identical to the sales dashboard.
const MGMT_LABELS: Record<MgmtDashId, string> = {
  leadership: 'Leadership Dashboard',
  top5: 'Top 5 – Scoreboard',
  kpis: 'Management KPIs',
}

const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']
const ACT_KEYS = ['ce_visit', 'project_visit', 'ce_call', 'project_call', 'bd_visit', 'bd_call'] as const
type ActKey = typeof ACT_KEYS[number]
const ACT_LABELS: Record<ActKey, string> = {
  ce_visit: 'CE Visit', project_visit: 'Project Visit', ce_call: 'CE Call',
  project_call: 'Project Call', bd_visit: 'BD Visit', bd_call: 'BD Call',
}

interface FyMonth { newDealsTarget: number; salesTarget: number; kpiTarget?: number }
interface TeamMember {
  id: string; name: string; initials: string; monthlyTarget: number
  targets: Record<string, number>
  hidden?: boolean
  noTarget?: boolean
  salesSupport?: boolean
}
interface Targets {
  fyTargets: FyMonth[]
  fyTargetsAu: FyMonth[]
  fyInvoicedTargets: number[]
  kpiTeam: TeamMember[]
  kpiPoints: Record<string, number>
  emailRecipients?: string[]
  emailEnabled?: boolean
  emailSendTime?: string
}

type EditTab = 'monthly' | 'australia' | 'invoiced' | 'kpi' | 'email' | 'customer' | 'forward'

const ALL_TABS: EditTab[] = ['monthly', 'australia', 'invoiced', 'kpi', 'email', 'customer']
const TAB_LABELS: Record<EditTab, string> = {
  monthly: 'NZ Monthly', australia: 'AU Monthly', invoiced: 'Invoiced', kpi: 'KPI Team',
  email: 'Daily Email', customer: 'Client Development', forward: 'Forward Order Value',
}

export default function TargetsPanel({ onClose, onSaved, initialTab, emailDashboard, tabs = ALL_TABS }: { onClose: () => void; onSaved?: () => void; initialTab?: EditTab; emailDashboard?: MgmtDashId; tabs?: EditTab[] }) {
  const { getToken } = useAuth()
  const [tab, setTab] = useState<EditTab>(initialTab && tabs.includes(initialTab) ? initialTab : tabs[0])
  // Forward Order Value monthly target — lives in the ops Google Sheet, edited via
  // its own endpoint (separate from the sales-targets config below).
  const [fovDraft, setFovDraft] = useState<number | null>(null)
  const [fovSaved, setFovSaved] = useState<number | null>(null)
  const [fovSaving, setFovSaving] = useState(false)
  const [fovError, setFovError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Targets | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [owners, setOwners] = useState<{ id: string; name: string; email: string }[]>([])
  const [addId, setAddId] = useState('')
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<string | null>(null)
  // Customer Engagement tab — curated roster of salespeople for the CE dashboard,
  // independent of the KPI Team. Tick people, then Save.
  const [ceList, setCeList] = useState<string[] | null>(null)   // saved roster
  const [ceDraft, setCeDraft] = useState<Set<string> | null>(null) // checkbox selection
  const [ceSaving, setCeSaving] = useState(false)
  const [ceError, setCeError] = useState<string | null>(null)
  // Bulk owner-reassign tool
  const [remapOwners, setRemapOwners] = useState<{ manager: string; count: number }[] | null>(null)
  const [remapDraft, setRemapDraft] = useState<Record<string, string>>({})
  const [remapSaving, setRemapSaving] = useState(false)

  async function loadCeList() {
    try {
      const token = await getToken()
      const res = await fetch('/api/admin/ce-salespeople', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load')
      const list: string[] = (await res.json()).salespeople || []
      setCeList(list)
      setCeDraft(new Set(list))
    } catch (e: any) {
      setCeError(e.message)
    }
  }

  async function loadRemapOwners() {
    try {
      const token = await getToken()
      const res = await fetch('/api/admin/ce-owners', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load')
      setRemapOwners((await res.json()).owners || [])
    } catch (e: any) {
      setCeError(e.message)
    }
  }

  async function loadFov() {
    try {
      const token = await getToken()
      const res = await fetch('/api/admin/forward-order-target', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load')
      const t: number = (await res.json()).target ?? 0
      setFovDraft(t)
      setFovSaved(t)
    } catch (e: any) {
      setFovError(e.message)
    }
  }

  const fovDirty = fovDraft !== null && fovDraft !== fovSaved

  async function saveFov() {
    if (fovDraft === null) return
    setFovSaving(true); setFovError(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/admin/forward-order-target', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: fovDraft }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to save')
      const t: number = (await res.json()).target ?? fovDraft
      setFovDraft(t)
      setFovSaved(t)
      onSaved?.()
    } catch (e: any) {
      setFovError(e.message)
    } finally {
      setFovSaving(false)
    }
  }

  useEffect(() => {
    if (tab === 'customer' && ceList === null) loadCeList()
    if (tab === 'customer' && remapOwners === null) loadRemapOwners()
    if (tab === 'forward' && fovDraft === null) loadFov()
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  const remapDirty = !!remapOwners && remapOwners.some(o => remapDraft[o.manager] && remapDraft[o.manager] !== o.manager)
  async function applyRemap() {
    const mapping: Record<string, string> = {}
    for (const o of remapOwners ?? []) {
      const to = remapDraft[o.manager]
      if (to && to !== o.manager) mapping[o.manager] = to
    }
    if (Object.keys(mapping).length === 0) return
    setRemapSaving(true); setCeError(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/customer/owner/remap', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapping }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to reassign')
      setRemapDraft({})
      await loadRemapOwners()
      onSaved?.()
    } catch (e: any) {
      setCeError(e.message)
    } finally {
      setRemapSaving(false)
    }
  }

  function toggleCe(name: string) {
    setCeDraft(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }

  const ceDirty = !!ceList && !!ceDraft && (ceList.length !== ceDraft.size || ceList.some(n => !ceDraft!.has(n)))

  async function saveCeList() {
    if (!ceDraft) return
    setCeSaving(true); setCeError(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/admin/ce-salespeople', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ salespeople: [...ceDraft] }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to save')
      const saved: string[] = (await res.json()).salespeople || [...ceDraft]
      setCeList(saved)
      setCeDraft(new Set(saved))
      onSaved?.()
    } catch (e: any) {
      setCeError(e.message)
    } finally {
      setCeSaving(false)
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken()
        const res = await fetch('/api/admin/hubspot-owners', { headers: { Authorization: `Bearer ${token}` } })
        if (res.ok) setOwners((await res.json()).owners || [])
      } catch { /* non-fatal */ }
    })()
  }, [getToken])

  useEffect(() => {
    (async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const token = await getToken()
        const res = await fetch('/api/admin/targets', { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load')
        const d: Targets = await res.json()
        // In management mode the Daily Email tab reflects that dashboard's own
        // email config, not the sales one.
        if (emailDashboard) {
          const mres = await fetch('/api/admin/management-email', { headers: { Authorization: `Bearer ${token}` } })
          if (mres.ok) {
            const m = (await mres.json())[emailDashboard] ?? { enabled: false, recipients: [], sendTime: '18:00' }
            d.emailEnabled = m.enabled
            d.emailRecipients = m.recipients
            d.emailSendTime = m.sendTime
          }
        }
        setDraft(JSON.parse(JSON.stringify(d)))
      } catch (e: any) {
        setLoadError(e.message)
      } finally {
        setLoading(false)
      }
    })()
  }, [getToken, emailDashboard])

  async function save() {
    if (!draft) return
    setSaving(true)
    setSaveError(null)
    try {
      const token = await getToken()
      // In management mode, DON'T send email fields to /api/admin/targets (that
      // would clobber the sales email) — save this dashboard's email separately.
      const { emailRecipients, emailEnabled, emailSendTime, ...targetsOnly } = draft
      const targetsBody = emailDashboard ? targetsOnly : draft
      const res = await fetch('/api/admin/targets', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(targetsBody),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to save')
      if (emailDashboard) {
        const mres = await fetch('/api/admin/management-email', {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ [emailDashboard]: { enabled: !!emailEnabled, recipients: emailRecipients ?? [], sendTime: emailSendTime ?? '18:00' } }),
        })
        if (!mres.ok) throw new Error((await mres.json()).error ?? 'Failed to save email settings')
      }
      onSaved?.()
      onClose()
    } catch (e: any) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function setMonth(i: number, field: keyof FyMonth, val: string) {
    if (!draft) return
    const v = parseInt(val.replace(/,/g, '')) || 0
    setDraft({ ...draft, fyTargets: draft.fyTargets.map((m, idx) => idx === i ? { ...m, [field]: v } : m) })
  }

  function setMonthAu(i: number, field: 'newDealsTarget' | 'salesTarget', val: string) {
    if (!draft) return
    const v = parseInt(val.replace(/,/g, '')) || 0
    setDraft({ ...draft, fyTargetsAu: draft.fyTargetsAu.map((m, idx) => idx === i ? { ...m, [field]: v } : m) })
  }

  function setInvoicedMonth(i: number, val: string) {
    if (!draft) return
    const v = parseInt(val.replace(/,/g, '')) || 0
    setDraft({ ...draft, fyInvoicedTargets: (draft.fyInvoicedTargets ?? []).map((m, idx) => idx === i ? v : m) })
  }

  function moveTeamMember(i: number, dir: -1 | 1) {
    if (!draft) return
    const j = i + dir
    if (j < 0 || j >= draft.kpiTeam.length) return
    const next = [...draft.kpiTeam]
    ;[next[i], next[j]] = [next[j], next[i]]
    setDraft({ ...draft, kpiTeam: next })
  }

  function toggleHidden(idx: number) {
    if (!draft) return
    setDraft({ ...draft, kpiTeam: draft.kpiTeam.map((p, i) => i === idx ? { ...p, hidden: !p.hidden } : p) })
  }

  function toggleNoTarget(idx: number) {
    if (!draft) return
    setDraft({ ...draft, kpiTeam: draft.kpiTeam.map((p, i) => i === idx ? { ...p, noTarget: !p.noTarget } : p) })
  }

  function toggleSalesSupport(idx: number) {
    if (!draft) return
    setDraft({ ...draft, kpiTeam: draft.kpiTeam.map((p, i) => i === idx ? { ...p, salesSupport: !p.salesSupport } : p) })
  }

  function removeTeamMember(idx: number) {
    if (!draft) return
    if (!window.confirm(`Remove ${draft.kpiTeam[idx]?.name || 'this person'} from the team? Remember to Save Changes.`)) return
    setDraft({ ...draft, kpiTeam: draft.kpiTeam.filter((_, i) => i !== idx) })
  }

  function addTeamMember(ownerId: string) {
    if (!draft || !ownerId) return
    if (draft.kpiTeam.some(p => p.id === ownerId)) return
    const owner = owners.find(o => o.id === ownerId)
    if (!owner) return
    const initials = owner.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
    setDraft({
      ...draft,
      kpiTeam: [...draft.kpiTeam, {
        id: owner.id, name: owner.name, initials, monthlyTarget: 0,
        targets: { ce_visit: 0, project_visit: 0, ce_call: 0, project_call: 0, bd_visit: 0, bd_call: 0 },
        hidden: false,
      }],
    })
    setAddId('')
  }

  function setPersonField(idx: number, field: string, val: string) {
    if (!draft) return
    const next = draft.kpiTeam.map((p, i) => i === idx ? { ...p, [field]: field === 'id' || field === 'name' || field === 'initials' ? val : (parseInt(val) || 0) } : p)
    setDraft({ ...draft, kpiTeam: next })
  }

  function setPersonPts(idOrIdx: string, val: string) {
    if (!draft) return
    setDraft({ ...draft, kpiTeam: draft.kpiTeam.map((p, i) => (p.id === idOrIdx || String(i) === idOrIdx) ? { ...p, monthlyTarget: parseInt(val) || 0 } : p) })
  }

  function setPersonAct(idOrIdx: string, key: string, val: string) {
    if (!draft) return
    setDraft({ ...draft, kpiTeam: draft.kpiTeam.map((p, i) => (p.id === idOrIdx || String(i) === idOrIdx) ? { ...p, targets: { ...p.targets, [key]: parseInt(val) || 0 } } : p) })
  }

  function setPoint(key: string, val: string) {
    if (!draft) return
    setDraft({ ...draft, kpiPoints: { ...draft.kpiPoints, [key]: parseFloat(val) || 0 } })
  }

  function setEmailAt(idx: number, val: string) {
    if (!draft) return
    const next = [...(draft.emailRecipients ?? [])]
    next[idx] = val
    setDraft({ ...draft, emailRecipients: next })
  }
  function addEmail() {
    if (!draft) return
    setDraft({ ...draft, emailRecipients: [...(draft.emailRecipients ?? []), ''] })
  }
  function removeEmail(idx: number) {
    if (!draft) return
    setDraft({ ...draft, emailRecipients: (draft.emailRecipients ?? []).filter((_, i) => i !== idx) })
  }

  async function sendTest() {
    setTesting(true)
    setTestMsg(null)
    try {
      const token = await getToken()
      const res = emailDashboard
        ? await fetch('/api/admin/management-email/test', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: emailDashboard }),
          })
        : await fetch('/api/admin/send-test-email', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Failed to send')
      // Management test returns per-dashboard detail under `result`.
      const r = emailDashboard ? data.result : data
      setTestMsg(
        r?.sent
          ? `Sent to ${(r.recipients ?? []).join(', ') || 'recipients'}.`
          : `Not sent (${r?.skipped ?? r?.error ?? 'unknown reason'}).`
      )
    } catch (e: any) {
      setTestMsg(`Error: ${e.message}`)
    } finally {
      setTesting(false)
    }
  }

  const num = (v: number) => v.toLocaleString('en-NZ')

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white w-full max-w-2xl h-full flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">{emailDashboard ? `Edit — ${MGMT_LABELS[emailDashboard]}` : 'Edit Targets'}</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 shrink-0 overflow-x-auto">
          {tabs.map(k => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                tab === k ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {TAB_LABELS[k]}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'forward' ? (
            <div className="space-y-4">
              <p className="text-xs text-gray-500">
                The monthly <strong>Forward Order Value</strong> target shown on the Leadership dashboard gauge.
                Saved to the ops Google Sheet (<em>Scoreboard Targets → Monthly Target</em>).
              </p>
              {fovError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{fovError}</p>}
              {fovDraft === null ? (
                <p className="text-sm text-gray-400">Loading…</p>
              ) : (
                <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-3 gap-3 max-w-sm">
                  <span className="text-sm text-gray-700">Monthly target ($)</span>
                  <input
                    type="number" min={0} step={50000}
                    value={fovDraft}
                    onChange={e => setFovDraft(e.target.value === '' ? 0 : (parseInt(e.target.value.replace(/,/g, '')) || 0))}
                    className="w-44 text-right border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                  />
                </div>
              )}
              <p className="text-[11px] text-gray-400">
                The gauge's actual value comes from the daily figure in the sheet — only the target is set here.
              </p>
            </div>
          ) : tab === 'customer' ? (
            <div className="space-y-4">
              <p className="text-xs text-gray-500">
                Tick the salespeople to include on the Client Development dashboard — they appear in the
                owner filter and as selectable owners on cards. Separate from the KPI Team, so someone can
                be active here but not on KPIs. Click <strong>Save Changes</strong> when done.
              </p>
              {ceError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{ceError}</p>}
              {ceDraft === null ? (
                <p className="text-sm text-gray-400">Loading…</p>
              ) : (() => {
                const names = [...new Set([...owners.map(o => o.name), ...(ceList ?? [])])].sort((a, b) => a.localeCompare(b))
                const ownerEmail: Record<string, string> = {}
                for (const o of owners) if (o.email) ownerEmail[o.name] = o.email
                return (
                  <>
                    {names.length === 0 ? (
                      <p className="text-sm text-gray-400">Loading HubSpot owners…</p>
                    ) : (
                      <div className="border border-gray-100 rounded-lg divide-y divide-gray-100 max-h-[32vh] overflow-y-auto">
                        {names.map(name => (
                          <label key={name} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50">
                            <input
                              type="checkbox"
                              checked={ceDraft.has(name)}
                              onChange={() => toggleCe(name)}
                              className="rounded text-blue-600 w-4 h-4"
                            />
                            <span className="text-sm text-gray-800">{name}</span>
                            {ownerEmail[name] && <span className="text-xs text-gray-400">{ownerEmail[name]}</span>}
                          </label>
                        ))}
                      </div>
                    )}
                    <p className="text-[11px] text-gray-400">{ceDraft.size} selected</p>
                  </>
                )
              })()}

              {/* ── Bulk reassign account owners ── */}
              <div className="pt-4 border-t border-gray-100">
                <p className="text-sm font-semibold text-gray-800 mb-1">Reassign account owners</p>
                <p className="text-xs text-gray-400 mb-3">
                  Remap old owner names on accounts to a HubSpot owner. Change the ones you want, then Apply —
                  it updates all their accounts at once.
                </p>
                {remapOwners === null ? (
                  <p className="text-xs text-gray-400">Loading…</p>
                ) : remapOwners.length === 0 ? (
                  <p className="text-xs text-gray-400">No owners assigned to accounts yet.</p>
                ) : (
                  <div className="space-y-2">
                    {remapOwners.map(o => (
                      <div key={o.manager} className="flex items-center gap-2">
                        <span className="text-sm text-gray-700 w-36 truncate shrink-0" title={o.manager}>{o.manager}</span>
                        <span className="text-xs text-gray-300 shrink-0">→</span>
                        <select
                          value={remapDraft[o.manager] ?? o.manager}
                          onChange={e => setRemapDraft(d => ({ ...d, [o.manager]: e.target.value }))}
                          className="flex-1 min-w-0 border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                        >
                          <option value={o.manager}>{o.manager} (keep)</option>
                          {owners.filter(ow => ow.name !== o.manager).map(ow => (
                            <option key={ow.id} value={ow.name}>{ow.name}</option>
                          ))}
                        </select>
                        <span className="text-[11px] text-gray-400 w-14 shrink-0 text-right">{o.count} acct{o.count !== 1 ? 's' : ''}</span>
                      </div>
                    ))}
                    <button
                      onClick={applyRemap}
                      disabled={remapSaving || !remapDirty}
                      className="mt-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40 transition-colors"
                    >
                      {remapSaving ? 'Applying…' : 'Apply owner changes'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : loading ? (
            <div className="flex justify-center py-12 text-sm text-gray-400">Loading…</div>
          ) : loadError ? (
            <div className="text-red-500 text-sm">{loadError}</div>
          ) : draft && (
            <>
              {/* ── Monthly Targets ── */}
              {tab === 'monthly' && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-500">FY monthly targets (Apr – Mar). Cumulative values are computed automatically.</p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide w-12">Month</th>
                        <th className="text-right py-2 pr-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">New Deals ($)</th>
                        <th className="text-right py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Sales ($)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {draft.fyTargets.map((m, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="py-1.5 text-gray-700 font-medium">{MONTHS[i]}</td>
                          <td className="py-1.5 pr-2">
                            <input
                              type="number" min={0} step={100000}
                              value={m.newDealsTarget}
                              onChange={e => setMonth(i, 'newDealsTarget', e.target.value)}
                              className="w-full text-right border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400"
                            />
                          </td>
                          <td className="py-1.5">
                            <input
                              type="number" min={0} step={100000}
                              value={m.salesTarget}
                              onChange={e => setMonth(i, 'salesTarget', e.target.value)}
                              className="w-full text-right border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-xs text-gray-400 pt-1">
                    Annual totals — New Deals: <strong>{num(draft.fyTargets.reduce((s, m) => s + m.newDealsTarget, 0))}</strong> &nbsp;·&nbsp;
                    Sales: <strong>{num(draft.fyTargets.reduce((s, m) => s + m.salesTarget, 0))}</strong>
                  </p>
                </div>
              )}

              {/* ── AU Monthly Targets (AUD) ── */}
              {tab === 'australia' && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-500">AU (AUS - Sales Pipeline) monthly targets in <strong>AUD</strong> (Apr – Mar). Cumulative values are computed automatically.</p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide w-12">Month</th>
                        <th className="text-right py-2 pr-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">New Deals (A$)</th>
                        <th className="text-right py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Sales (A$)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {draft.fyTargetsAu.map((m, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="py-1.5 text-gray-700 font-medium">{MONTHS[i]}</td>
                          <td className="py-1.5 pr-2">
                            <input
                              type="number" min={0} step={100000}
                              value={m.newDealsTarget}
                              onChange={e => setMonthAu(i, 'newDealsTarget', e.target.value)}
                              className="w-full text-right border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400"
                            />
                          </td>
                          <td className="py-1.5">
                            <input
                              type="number" min={0} step={100000}
                              value={m.salesTarget}
                              onChange={e => setMonthAu(i, 'salesTarget', e.target.value)}
                              className="w-full text-right border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-xs text-gray-400 pt-1">
                    Annual totals — New Deals: <strong>A${num(draft.fyTargetsAu.reduce((s, m) => s + m.newDealsTarget, 0))}</strong> &nbsp;·&nbsp;
                    Sales: <strong>A${num(draft.fyTargetsAu.reduce((s, m) => s + m.salesTarget, 0))}</strong>
                  </p>
                </div>
              )}

              {/* ── Invoiced Sales Monthly Targets ── */}
              {tab === 'invoiced' && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-500">
                    Monthly <strong>invoiced sales</strong> targets (Apr – Mar). These set the target line on the
                    Invoiced Sales chart and the YTD dial on the sales dashboard.
                  </p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide w-12">Month</th>
                        <th className="text-right py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Invoiced ($)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(draft.fyInvoicedTargets ?? []).map((v, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="py-1.5 text-gray-700 font-medium">{MONTHS[i]}</td>
                          <td className="py-1.5">
                            <input
                              type="number" min={0} step={100000}
                              value={v}
                              onChange={e => setInvoicedMonth(i, e.target.value)}
                              className="w-full text-right border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-xs text-gray-400 pt-1">
                    Annual total: <strong>${num((draft.fyInvoicedTargets ?? []).reduce((s, v) => s + v, 0))}</strong>
                  </p>
                </div>
              )}

              {/* ── KPI Team ── */}
              {tab === 'kpi' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800 mb-1">Display Order & Points Target</h3>
                    <p className="text-xs text-gray-400 mb-3">
                      Use the arrows to reorder, and the eye toggle to show/hide a person on the KPI dashboard
                      (every shown person appears). Use ✕ to remove someone. Set the HubSpot Owner ID for new members.
                    </p>
                    <div className="space-y-2">
                      {draft.kpiTeam.map((p, idx) => {
                        const shown = !p.hidden
                        return (
                          <div key={idx} className={`rounded-lg border px-3 py-2 ${shown ? 'border-blue-100 bg-blue-50/40' : 'border-gray-100 bg-gray-50'}`}>
                            <div className="flex items-center gap-2">
                              {/* Position badge */}
                              <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${shown ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
                                {idx + 1}
                              </span>
                              {/* Up/down */}
                              <div className="flex flex-col shrink-0">
                                <button onClick={() => moveTeamMember(idx, -1)} disabled={idx === 0}
                                  className="text-gray-300 hover:text-gray-600 disabled:opacity-20 leading-none p-0.5">
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 15l7-7 7 7" /></svg>
                                </button>
                                <button onClick={() => moveTeamMember(idx, 1)} disabled={idx === draft.kpiTeam.length - 1}
                                  className="text-gray-300 hover:text-gray-600 disabled:opacity-20 leading-none p-0.5">
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" /></svg>
                                </button>
                              </div>
                              {/* Avatar */}
                              <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0">
                                {p.initials || '?'}
                              </div>
                              {/* Name */}
                              <input
                                type="text" value={p.name}
                                onChange={e => setPersonField(idx, 'name', e.target.value)}
                                className="flex-1 min-w-0 border border-transparent rounded px-1 py-0.5 text-sm text-gray-700 hover:border-gray-200 focus:border-blue-300 focus:outline-none bg-transparent"
                              />
                              {/* Show/hide toggle */}
                              <button
                                onClick={() => toggleHidden(idx)}
                                title={shown ? 'Shown — click to hide' : 'Hidden — click to show'}
                                className={`shrink-0 p-1 rounded transition-colors ${shown ? 'text-blue-500 hover:bg-blue-50' : 'text-gray-300 hover:bg-gray-100'}`}
                              >
                                {shown ? (
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                ) : (
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.542 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                                )}
                              </button>
                              {/* No-target toggle — show points total only, no target */}
                              <label className="flex items-center gap-1 shrink-0 cursor-pointer" title="No target — show points total only">
                                <input
                                  type="checkbox"
                                  checked={!!p.noTarget}
                                  onChange={() => toggleNoTarget(idx)}
                                  className="rounded text-blue-600"
                                />
                                <span className="text-[10px] text-gray-400">no tgt</span>
                              </label>
                              {/* Sales-support toggle — their quotes show in the Sales Support view */}
                              <label className="flex items-center gap-1 shrink-0 cursor-pointer" title="Sales support — include this person's quotes in the Sales Support section">
                                <input
                                  type="checkbox"
                                  checked={!!p.salesSupport}
                                  onChange={() => toggleSalesSupport(idx)}
                                  className="rounded text-blue-600"
                                />
                                <span className="text-[10px] text-gray-400">support</span>
                              </label>
                              {/* Points */}
                              <span className="text-xs text-gray-400 shrink-0">pts</span>
                              <input
                                type="number" min={0} value={p.monthlyTarget}
                                onChange={e => setPersonPts(p.id || String(idx), e.target.value)}
                                disabled={!!p.noTarget}
                                className="w-16 text-right border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400 disabled:bg-gray-100 disabled:text-gray-300"
                              />
                              {/* Remove */}
                              <button
                                onClick={() => removeTeamMember(idx)}
                                title="Remove from team"
                                className="shrink-0 p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                              </button>
                            </div>
                            {/* HubSpot ID row (shown when ID is empty) */}
                            {!p.id && (
                              <div className="flex items-center gap-2 mt-1.5 pl-14">
                                <span className="text-[10px] text-amber-600 font-medium">HubSpot Owner ID needed:</span>
                                <input
                                  type="text" placeholder="e.g. 362511066"
                                  value={p.id}
                                  onChange={e => setPersonField(idx, 'id', e.target.value)}
                                  className="flex-1 border border-amber-200 rounded px-2 py-0.5 text-xs focus:outline-none focus:border-amber-400 bg-amber-50"
                                />
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    <p className="text-xs text-gray-400 mt-2">
                      Team total: <strong>{num(draft.kpiTeam.reduce((s, p) => s + p.monthlyTarget, 0))} pts/month</strong>
                    </p>

                    {/* Add a salesperson from HubSpot sales accounts not already on the team */}
                    {(() => {
                      const available = owners.filter(o => !draft.kpiTeam.some(p => p.id === o.id))
                      return (
                        <div className="mt-4 pt-3 border-t border-gray-100">
                          <p className="text-xs font-semibold text-gray-600 mb-1.5">Add a salesperson</p>
                          {owners.length === 0 ? (
                            <p className="text-[11px] text-gray-400">Loading HubSpot accounts…</p>
                          ) : available.length === 0 ? (
                            <p className="text-[11px] text-gray-400">All HubSpot sales accounts are already on the team.</p>
                          ) : (
                            <div className="flex gap-2">
                              <select
                                value={addId}
                                onChange={e => setAddId(e.target.value)}
                                className="flex-1 min-w-0 border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                              >
                                <option value="">Select a HubSpot account…</option>
                                {available.map(o => (
                                  <option key={o.id} value={o.id}>{o.name}{o.email ? ` (${o.email})` : ''}</option>
                                ))}
                              </select>
                              <button
                                onClick={() => addTeamMember(addId)}
                                disabled={!addId}
                                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors shrink-0"
                              >
                                Add
                              </button>
                            </div>
                          )}
                          <p className="text-[10px] text-gray-400 mt-1.5">New people are added shown, with 0 targets — set their points/activity targets above, then Save Changes.</p>
                        </div>
                      )
                    })()}
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-gray-800 mb-1">Monthly Activity Count Targets</h3>
                    <p className="text-xs text-gray-400 mb-3">How many of each activity per person per month.</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th className="text-left py-2 pr-2 text-gray-500 font-semibold">Person</th>
                            {ACT_KEYS.map(k => (
                              <th key={k} className="text-right py-2 px-1 text-gray-500 font-semibold whitespace-nowrap">{ACT_LABELS[k]}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {draft.kpiTeam.map((p, i) => (
                            <tr key={i} className="hover:bg-gray-50">
                              <td className="py-1.5 pr-2 text-gray-700 font-medium whitespace-nowrap">{p.initials || p.name.slice(0, 2)}</td>
                              {ACT_KEYS.map(k => (
                                <td key={k} className="py-1 px-1">
                                  <input
                                    type="number" min={0}
                                    value={p.targets[k] ?? 0}
                                    onChange={e => setPersonAct(p.id || String(i), k, e.target.value)}
                                    className="w-14 text-right border border-gray-200 rounded px-1 py-0.5 text-xs focus:outline-none focus:border-blue-400"
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-gray-800 mb-1">KPI Point Values</h3>
                    <p className="text-xs text-gray-400 mb-3">Points awarded per logged activity.</p>
                    <div className="grid grid-cols-2 gap-2">
                      {ACT_KEYS.map(k => (
                        <div key={k} className="flex items-center justify-between bg-gray-50 rounded px-3 py-2 gap-2">
                          <span className="text-sm text-gray-700">{ACT_LABELS[k]}</span>
                          <input
                            type="number" min={0}
                            value={draft.kpiPoints[k] ?? 0}
                            onChange={e => setPoint(k, e.target.value)}
                            className="w-16 text-right border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Daily Email ── */}
              {tab === 'email' && (
                <div className="space-y-5">
                  <p className="text-xs text-gray-500">
                    Emails an embedded screenshot of the {emailDashboard ? MGMT_LABELS[emailDashboard] : 'sales dashboard'} to
                    the recipients below, once a day at the time you set (New Zealand time).
                  </p>

                  {/* Enable toggle */}
                  <label className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!draft.emailEnabled}
                      onChange={e => setDraft({ ...draft, emailEnabled: e.target.checked })}
                      className="rounded text-blue-600 w-4 h-4"
                    />
                    <span className="text-sm text-gray-700">Send the daily sales dashboard email</span>
                  </label>

                  {/* Send time */}
                  <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2.5 gap-2">
                    <span className="text-sm text-gray-700">Send time (NZ)</span>
                    <input
                      type="time"
                      value={draft.emailSendTime || '18:00'}
                      onChange={e => setDraft({ ...draft, emailSendTime: e.target.value })}
                      className="border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400"
                    />
                  </div>
                  <p className="-mt-3 text-[11px] text-gray-400">Sent at or shortly after this time (checked every 30 minutes).</p>

                  {/* Recipients */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800 mb-1">Recipients</h3>
                    <p className="text-xs text-gray-400 mb-3">Who receives the email. Invalid addresses are dropped on save.</p>
                    <div className="space-y-2">
                      {(draft.emailRecipients ?? []).length === 0 && (
                        <p className="text-[11px] text-gray-400">No recipients yet — add one below.</p>
                      )}
                      {(draft.emailRecipients ?? []).map((email, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="email"
                            value={email}
                            placeholder="name@yourcompany.io"
                            onChange={e => setEmailAt(idx, e.target.value)}
                            className="flex-1 min-w-0 border border-gray-200 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                          />
                          <button
                            onClick={() => removeEmail(idx)}
                            title="Remove recipient"
                            className="shrink-0 p-1.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={addEmail}
                      className="mt-3 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                    >
                      + Add recipient
                    </button>
                  </div>

                  {/* Send test now */}
                  <div className="pt-4 border-t border-gray-100">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={sendTest}
                        disabled={testing}
                        className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
                      >
                        {testing ? 'Sending…' : 'Send test email now'}
                      </button>
                      {testMsg && <span className="text-xs text-gray-500">{testMsg}</span>}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-2">
                      Sends immediately to the <strong>saved</strong> recipients (ignores the on/off toggle and send time).
                      Save Changes first if you've just edited the list. Capturing the dashboard can take a few seconds.
                    </p>
                  </div>
                </div>
              )}

            </>
          )}
        </div>

        {/* Footer */}
        {(tab === 'customer' || tab === 'forward' || (!loading && !loadError)) && (
          <div className="shrink-0 px-5 py-4 border-t border-gray-200 flex items-center gap-3">
            {saveError && <p className="text-red-500 text-xs flex-1 truncate">{saveError}</p>}
            <div className="flex gap-3 ml-auto">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                {tab === 'customer' ? 'Close' : 'Cancel'}
              </button>
              {tab === 'forward' ? (
                <button
                  onClick={saveFov}
                  disabled={fovSaving || !fovDirty}
                  className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {fovSaving ? 'Saving…' : 'Save Changes'}
                </button>
              ) : tab === 'customer' ? (
                <button
                  onClick={saveCeList}
                  disabled={ceSaving || !ceDirty}
                  className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {ceSaving ? 'Saving…' : 'Save Changes'}
                </button>
              ) : (
                <button
                  onClick={save}
                  disabled={saving}
                  className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
