import { useEffect, useState } from 'react'
import axios from 'axios'
import { cachedGet } from '../lib/apiCache'

// Edit Targets drawer for the Marketing KPIs tab — monthly targets for the two
// funnel numbers on "Our One Number" (New MQLs and New SQLs). Same right-hand
// drawer shape as the sales TargetsPanel, but it reads/writes only
// /api/marketing/targets, so it works for anyone with marketing access rather
// than admins only.

const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']

type Metric = 'mql' | 'sql'
const METRICS: { key: Metric; label: string }[] = [
  { key: 'mql', label: 'New MQLs' },
  { key: 'sql', label: 'New SQLs' },
]

interface MarketingTargets { mql: number[]; sql: number[] }

const zeros = () => Array(12).fill(0) as number[]
const twelve = (a: unknown): number[] => Array.from({ length: 12 }, (_, i) => Number((a as number[])?.[i]) || 0)

export default function MarketingTargetsPanel({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const [draft, setDraft] = useState<MarketingTargets | null>(null)
  const [saved, setSaved] = useState<MarketingTargets | null>(null)
  const [currentMonth, setCurrentMonth] = useState<number | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // force: true — the panel must show what's actually stored, not a cached read.
    cachedGet('/api/marketing/targets', { force: true })
      .then(r => {
        const t: MarketingTargets = { mql: twelve(r.data?.mql), sql: twelve(r.data?.sql) }
        setDraft(t)
        setSaved(t)
        setCurrentMonth(r.data?.current?.monthIndex ?? null)
      })
      .catch(e => setLoadError(e?.response?.data?.error ?? e.message))
  }, [])

  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved)

  function setMonth(metric: Metric, i: number, val: string) {
    if (!draft) return
    const v = Math.max(0, parseInt(val.replace(/,/g, '')) || 0)
    setDraft({ ...draft, [metric]: draft[metric].map((m, idx) => idx === i ? v : m) })
  }

  // Most months carry the same target, so let Apr set the whole year in one click.
  function copyAprToAll(metric: Metric) {
    if (!draft) return
    setDraft({ ...draft, [metric]: Array(12).fill(draft[metric][0]) })
  }

  function clearAll(metric: Metric) {
    if (!draft) return
    setDraft({ ...draft, [metric]: zeros() })
  }

  async function save() {
    if (!draft) return
    setSaving(true)
    setSaveError(null)
    try {
      const r = await axios.put('/api/marketing/targets', draft)
      const t: MarketingTargets = { mql: twelve(r.data?.mql), sql: twelve(r.data?.sql) }
      setDraft(t)
      setSaved(t)
      onSaved?.()
      onClose()
    } catch (e: any) {
      setSaveError(e?.response?.data?.error ?? e.message)
    } finally {
      setSaving(false)
    }
  }

  const total = (metric: Metric) => (draft?.[metric] ?? []).reduce((s, v) => s + v, 0)

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white w-full max-w-2xl h-full flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Edit Targets — Marketing KPIs</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loadError ? (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{loadError}</p>
          ) : !draft ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-gray-500">
                Monthly targets for <strong>New MQLs</strong> and <strong>New SQLs</strong> (Apr – Mar financial
                year). They set the progress bars on the two cards under <em>Our One Number</em>. Leave a month at
                0 to hide its target.
              </p>

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide w-12">Month</th>
                    {METRICS.map(m => (
                      <th key={m.key} className="text-right py-2 pl-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {m.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {MONTHS.map((label, i) => (
                    <tr key={label} className={currentMonth === i ? 'bg-amber-50/60' : 'hover:bg-gray-50'}>
                      <td className="py-1.5 text-gray-700 font-medium whitespace-nowrap">
                        {label}
                        {currentMonth === i && <span className="ml-1 text-[10px] text-amber-600 font-semibold">now</span>}
                      </td>
                      {METRICS.map(m => (
                        <td key={m.key} className="py-1.5 pl-2">
                          <input
                            type="number" min={0} step={1}
                            value={draft[m.key][i]}
                            onChange={e => setMonth(m.key, i, e.target.value)}
                            className="w-full text-right border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Per-column shortcuts + annual totals */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {METRICS.map(m => (
                  <div key={m.key} className="bg-gray-50 rounded-lg px-3 py-2.5">
                    <p className="text-xs font-semibold text-gray-700">{m.label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Year total: <strong className="text-gray-600">{total(m.key).toLocaleString('en-NZ')}</strong>
                    </p>
                    <div className="flex gap-3 mt-2">
                      <button
                        onClick={() => copyAprToAll(m.key)}
                        className="text-[11px] font-medium text-blue-600 hover:text-blue-800 transition-colors"
                      >
                        Copy Apr to all months
                      </button>
                      <button
                        onClick={() => clearAll(m.key)}
                        className="text-[11px] font-medium text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-[11px] text-gray-400">
                New SQLs is measured the same way as the <em>Pushed to SQL</em> card — contacts that reached SQL or
                beyond this month, not the current SQL-stage count.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-4 border-t border-gray-200 flex items-center gap-3">
          {saveError && <p className="text-red-500 text-xs flex-1 truncate">{saveError}</p>}
          <div className="flex gap-3 ml-auto">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
