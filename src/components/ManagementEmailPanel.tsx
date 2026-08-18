import { useState, useEffect } from 'react'
import { useAuth } from '../lib/fakeAuth'

// Admin-only editor for a single management dashboard's daily-email settings
// (recipient list, on/off toggle, send time), saved to Supabase via
// /api/admin/management-email. Scoped to just the dashboard it was opened from.

export type MgmtDashId = 'leadership' | 'top5' | 'kpis'

const LABELS: Record<MgmtDashId, string> = {
  leadership: 'Leadership Dashboard',
  top5: 'Top 5 – Scoreboard',
  kpis: 'Management KPIs',
}

interface EmailCfg { enabled: boolean; recipients: string[]; sendTime: string }

export default function ManagementEmailPanel({ onClose, dashboard }: {
  onClose: () => void
  dashboard: MgmtDashId
}) {
  const { getToken } = useAuth()
  const [cfg, setCfg] = useState<EmailCfg | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const token = await getToken()
        const res = await fetch('/api/admin/management-email', { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load')
        const all = await res.json()
        setCfg(all[dashboard] ?? { enabled: false, recipients: [], sendTime: '18:00' })
      } catch (e: any) {
        setLoadError(e.message)
      } finally {
        setLoading(false)
      }
    })()
  }, [getToken, dashboard])

  function patch(changes: Partial<EmailCfg>) {
    setCfg(c => c && ({ ...c, ...changes }))
  }
  function setEmailAt(idx: number, val: string) {
    setCfg(c => { if (!c) return c; const next = [...c.recipients]; next[idx] = val; return { ...c, recipients: next } })
  }
  function addEmail() { setCfg(c => c && ({ ...c, recipients: [...c.recipients, ''] })) }
  function removeEmail(idx: number) { setCfg(c => c && ({ ...c, recipients: c.recipients.filter((_, i) => i !== idx) })) }

  async function save() {
    if (!cfg) return
    setSaving(true)
    setSaveError(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/admin/management-email', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ [dashboard]: cfg }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to save')
      onClose()
    } catch (e: any) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function sendTest() {
    setTesting(true)
    setTestMsg(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/admin/management-email/test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: dashboard }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Failed to send')
      const r = data.result
      setTestMsg(r?.sent ? `Sent to ${(r.recipients ?? []).join(', ') || 'recipients'}.` : `Not sent (${r?.skipped || r?.error || 'unknown reason'}).`)
    } catch (e: any) {
      setTestMsg(`Error: ${e.message}`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white w-full max-w-2xl h-full flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Edit — {LABELS[dashboard]}</h2>
            <p className="text-xs text-gray-400">Daily email settings</p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex justify-center py-12 text-sm text-gray-400">Loading…</div>
          ) : loadError ? (
            <div className="text-red-500 text-sm">{loadError}</div>
          ) : cfg && (
            <div className="space-y-5">
              <p className="text-xs text-gray-500">
                Emails embedded screenshots of each <strong>{LABELS[dashboard]}</strong> tile to the recipients below,
                once a day (weekdays) at the time you set (New Zealand time).
              </p>

              {/* Enable toggle */}
              <label className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2.5 cursor-pointer">
                <input type="checkbox" checked={cfg.enabled} onChange={e => patch({ enabled: e.target.checked })} className="rounded text-blue-600 w-4 h-4" />
                <span className="text-sm text-gray-700">Send this dashboard's daily email</span>
              </label>

              {/* Send time */}
              <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2.5 gap-2">
                <span className="text-sm text-gray-700">Send time (NZ)</span>
                <input type="time" value={cfg.sendTime || '18:00'} onChange={e => patch({ sendTime: e.target.value })} className="border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400" />
              </div>
              <p className="-mt-3 text-[11px] text-gray-400">Sent at or shortly after this time (checked every 30 minutes).</p>

              {/* Recipients */}
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-1">Recipients</h3>
                <p className="text-xs text-gray-400 mb-3">Who receives this email. Invalid addresses are dropped on save.</p>
                <div className="space-y-2">
                  {cfg.recipients.length === 0 && <p className="text-[11px] text-gray-400">No recipients yet — add one below.</p>}
                  {cfg.recipients.map((email, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input type="email" value={email} placeholder="name@yourcompany.io" onChange={e => setEmailAt(idx, e.target.value)} className="flex-1 min-w-0 border border-gray-200 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
                      <button onClick={() => removeEmail(idx)} title="Remove recipient" className="shrink-0 p-1.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
                <button onClick={addEmail} className="mt-3 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors">
                  + Add recipient
                </button>
              </div>

              {/* Send test now */}
              <div className="pt-4 border-t border-gray-100">
                <div className="flex items-center gap-3">
                  <button onClick={sendTest} disabled={testing} className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-50 transition-colors">
                    {testing ? 'Sending…' : 'Send test email now'}
                  </button>
                  {testMsg && <span className="text-xs text-gray-500">{testMsg}</span>}
                </div>
                <p className="text-[11px] text-gray-400 mt-2">
                  Sends immediately to this dashboard's <strong>saved</strong> recipients (ignores the on/off toggle and
                  send time). Save Changes first if you've just edited the list. Capturing the dashboard can take a few seconds.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && !loadError && (
          <div className="shrink-0 px-5 py-4 border-t border-gray-200 flex items-center gap-3">
            {saveError && <p className="text-red-500 text-xs flex-1 truncate">{saveError}</p>}
            <div className="flex gap-3 ml-auto">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
