// Placeholder brand mark for the demo clone — a plain "Y" monogram, standing in
// for the real app's Harrows logo images (which weren't carried over).
export function LogoMark({ className = 'h-7 w-7', tone = 'yellow' }: { className?: string; tone?: 'yellow' | 'charcoal' | 'white' }) {
  const bg = tone === 'yellow' ? '#EBA117' : tone === 'charcoal' ? '#262626' : '#ffffff'
  const fg = tone === 'white' ? '#262626' : '#ffffff'
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <rect width="100" height="100" rx="18" fill={bg} />
      <path d="M28 24 L50 50 L72 24" stroke={fg} strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <line x1="50" y1="50" x2="50" y2="78" stroke={fg} strokeWidth="11" strokeLinecap="round" />
    </svg>
  )
}

export function Wordmark({ className = 'h-7', tone = 'charcoal' }: { className?: string; tone?: 'charcoal' | 'white' }) {
  const textColor = tone === 'white' ? '#ffffff' : '#1f2937'
  return (
    <div className={`flex items-center gap-2 ${className}`} style={{ height: '1.75rem' }}>
      <LogoMark className="h-full aspect-square" tone={tone === 'white' ? 'white' : 'yellow'} />
      <span className="font-bold tracking-tight text-lg leading-none" style={{ color: textColor }}>YourCompany</span>
    </div>
  )
}
