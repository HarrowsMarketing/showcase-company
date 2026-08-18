import { useEffect, useState } from 'react'

// Shared date-range control: two native date inputs, optional preset buttons, and a
// Submit button. Edits (typing or a preset) stage in a local draft and DON'T update the
// page until Submit is clicked — so a half-typed year or an oversized range never fires a
// fetch (which would hammer / break the HubSpot API). Submit is disabled until the draft
// is a valid, in-bounds range that differs from what's already applied.
interface RangePreset { label: string; from: string; to: string }

export default function DateRangePicker({
  from, to, setFrom, setTo, min, max, presets = [],
}: {
  from: string; to: string
  setFrom: (v: string) => void; setTo: (v: string) => void
  min?: string; max?: string; presets?: RangePreset[]
}) {
  const [draftFrom, setDraftFrom] = useState(from)
  const [draftTo, setDraftTo] = useState(to)
  // Re-sync the draft if the applied range changes elsewhere (keeps inputs truthful).
  useEffect(() => { setDraftFrom(from) }, [from])
  useEffect(() => { setDraftTo(to) }, [to])

  const inBounds = (v: string) => (!min || v >= min) && (!max || v <= max)
  const valid = !!draftFrom && !!draftTo && draftFrom <= draftTo && inBounds(draftFrom) && inBounds(draftTo)
  const dirty = draftFrom !== from || draftTo !== to

  function submit() {
    if (!valid || !dirty) return
    if (draftFrom !== from) setFrom(draftFrom)
    if (draftTo !== to) setTo(draftTo)
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-3 py-1.5 shadow-sm">
        <input type="date" value={draftFrom} min={min} max={max} onChange={e => setDraftFrom(e.target.value)} className="text-sm text-gray-700 bg-transparent outline-none" aria-label="From date" />
        <span className="text-gray-400 text-sm">→</span>
        <input type="date" value={draftTo} min={min} max={max} onChange={e => setDraftTo(e.target.value)} className="text-sm text-gray-700 bg-transparent outline-none" aria-label="To date" />
      </div>
      {presets.map(p => {
        const active = p.from === draftFrom && p.to === draftTo
        return (
          <button
            key={p.label}
            onClick={() => { setDraftFrom(p.from); setDraftTo(p.to) }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${active ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {p.label}
          </button>
        )
      })}
      <button
        onClick={submit}
        disabled={!valid || !dirty}
        title={!valid ? 'Pick a valid start and end date' : !dirty ? 'Range already applied' : 'Apply this date range'}
        className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${valid && dirty ? 'bg-gray-900 text-white hover:bg-gray-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
      >
        Submit
      </button>
    </div>
  )
}

export type { RangePreset }
