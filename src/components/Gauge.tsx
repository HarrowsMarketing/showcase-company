// ── Shared formatters ──────────────────────────────────────────────────────────

export const fmtDollar = (v: number) => `$${Math.round(v).toLocaleString('en-NZ')}`
export const fmtNum    = (v: number) => Math.round(v).toLocaleString('en-NZ')
export const fmtPct    = (v: number) => `${Math.round(v)}%`

// ── Arc geometry ────────────────────────────────────────────────────────────────

function describeArc(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number) {
  const rad = (d: number) => d * Math.PI / 180
  const x1 = cx + r * Math.cos(rad(startDeg))
  const y1 = cy + r * Math.sin(rad(startDeg))
  const x2 = cx + r * Math.cos(rad(startDeg + sweepDeg))
  const y2 = cy + r * Math.sin(rad(startDeg + sweepDeg))
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

const G_START = 143
const G_SWEEP = 254

export function gaugeColor(pct: number) {
  if (pct >= 1)    return '#22c55e'
  if (pct >= 0.75) return '#f59e0b'
  return '#ef4444'
}

// ── Gauge (scales to fill its tile) ──────────────────────────────────────────────

export function Gauge({ label, sublabel, actual, target, format, compact = false, fullMonthTarget }: {
  label: string; sublabel?: string; actual: number; target: number; format: (v: number) => string; compact?: boolean
  fullMonthTarget?: number
}) {
  const pct      = target > 0 ? actual / target : 0
  const exceeded = pct > 1
  const filled   = Math.min(pct, 1)
  const overflow = exceeded ? Math.min(pct - 1, 1) * G_SWEEP : 0
  const color    = gaugeColor(pct)
  const cx = 100, cy = 96, r = 74
  const valStr = format(actual)
  const valSize = valStr.length > 11 ? 18 : 22

  // The middle grey number is the accumulative to-date target the gauge fills
  // against. When a full-month target is supplied, show it alongside as
  // "<to-date> / <full month>" (e.g. "$1,565,217 / $2,000,000"), shrinking the
  // font so the longer combined string still fits inside the arc.
  // The accumulative (to-date) target is drawn in the gauge colour to tie it to the
  // big actual figure and arc; the " / " and the full-month total stay grey.
  const showMonthly = typeof fullMonthTarget === 'number' && fullMonthTarget > 0
  const toDateStr = format(target)
  const monthStr = showMonthly ? ` / ${format(fullMonthTarget!)}` : ''
  // Adaptive font: the combined "<to-date> / <full month>" string is kept small and
  // shrinks further as it gets longer, so it stays well clear of the arc. Plain
  // single-value targets keep the original size.
  const targetLen = (toDateStr + monthStr).length
  const targetSize = showMonthly ? Math.max(8, Math.min(11, 100 / (targetLen * 0.42))) : 17

  return (
    <div className={`bg-white rounded-2xl border border-gray-200 shadow-sm ${compact ? 'p-3' : 'p-4'} flex flex-col h-full min-h-0`}>
      <div className="text-center shrink-0">
        <p className={`${compact ? 'text-sm xl:text-base' : 'text-xl xl:text-3xl'} font-bold tracking-widest text-gray-600 uppercase leading-tight`}>{label}</p>
        {sublabel && <p className={`${compact ? 'text-[10px]' : 'text-xs xl:text-sm'} text-gray-400`}>{sublabel}</p>}
      </div>
      <div className="flex-1 w-full min-h-0 flex items-center justify-center">
        <svg viewBox="0 0 200 176" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
          <path d={describeArc(cx, cy, r, G_START, G_SWEEP)} fill="none" stroke="#e5e7eb" strokeWidth={16} strokeLinecap="round" />
          {filled > 0.008 && (
            <path d={describeArc(cx, cy, r, G_START, exceeded ? G_SWEEP : filled * G_SWEEP)} fill="none" stroke={color} strokeWidth={16} strokeLinecap="round" />
          )}
          {overflow > 1 && (
            <path d={describeArc(cx, cy, r, G_START, overflow)} fill="none" stroke="#16a34a" strokeWidth={16} strokeLinecap="round" />
          )}
          <text x={cx} y={cy - 6} textAnchor="middle" dominantBaseline="middle" fill={color} fontSize={valSize} fontWeight="800">{valStr}</text>
          <text x={cx} y={cy + 24} textAnchor="middle" dominantBaseline="middle" fontSize={targetSize}>
            <tspan fill={showMonthly ? color : '#9ca3af'}>{toDateStr}</tspan>
            {showMonthly && <tspan fill="#9ca3af">{monthStr}</tspan>}
          </text>
          {target > 0 && (
            <text x={cx} y={cy + 52} textAnchor="middle" dominantBaseline="middle" fill={color} fontSize={15} fontWeight="700">
              {Math.round(pct * 100)}%
            </text>
          )}
        </svg>
      </div>
    </div>
  )
}

// ── Big value text that fills the tile width, capped at a fixed height ───────────
// Rendered as SVG text so it scales to span the full width of its container while
// never exceeding `heightCm` tall (≈ the size of a gauge's central number).
export function ScaledValue({ text, color, heightCm = 2 }: { text: string; color: string; heightCm?: number }) {
  // viewBox width tracks the string length so the text roughly fills the box;
  // meet-scaling then sizes it to the full width (or the height cap, whichever
  // is smaller).
  const vbW = Math.max(60, text.length * 20)
  return (
    <svg width="100%" viewBox={`0 0 ${vbW} 40`} preserveAspectRatio="xMidYMid meet" style={{ height: `${heightCm}cm`, maxHeight: '100%' }}>
      <text x={vbW / 2} y={21} textAnchor="middle" dominantBaseline="central" fill={color} fontSize={34} fontWeight="800">{text}</text>
    </svg>
  )
}

// ── Value tile (no target/arc — e.g. a raw balance like Cash on Hand) ────────────

export function ValueTile({ label, sublabel, value, format, compact = false }: {
  label: string; sublabel?: string; value: number; format: (v: number) => string; compact?: boolean
}) {
  const color = value < 0 ? '#ef4444' : '#3B82F6'
  return (
    <div className={`bg-white rounded-2xl border border-gray-200 shadow-sm ${compact ? 'p-3' : 'p-4'} flex flex-col h-full min-h-0`}>
      <div className="text-center shrink-0">
        <p className={`${compact ? 'text-sm xl:text-base' : 'text-xl xl:text-3xl'} font-bold tracking-widest text-gray-600 uppercase leading-tight`}>{label}</p>
        {sublabel && <p className={`${compact ? 'text-[10px]' : 'text-xs xl:text-sm'} text-gray-400`}>{sublabel}</p>}
      </div>
      <div className="flex-1 w-full min-h-0 flex items-center justify-center">
        <ScaledValue text={format(value)} color={color} />
      </div>
    </div>
  )
}
