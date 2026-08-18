import React, { useState, useRef } from 'react'
import { Wordmark } from './components/Logo'

interface Sprinkle { id: number; x: number; y: number; dx: number; dy: number; rot: number; dur: number }

function HSprinkleIcon() {
  return (
    <svg viewBox="0 0 100 100" width="18" height="18">
      <path d="M50 0 L61 39 L100 50 L61 61 L50 100 L39 61 L0 50 L39 39 Z" fill="#EBA117" />
    </svg>
  )
}

interface HomePageProps {
  onEnter: (dept: string) => void
  allowedDepts?: string[]
  earlyAccessDepts?: string[]
  isAdmin?: boolean
  isSuperAdmin?: boolean
  adminAccessDepts?: string[]
  onToggleAdminAccess?: (deptId: string, allow: boolean) => void
  userName?: string | null
  userAvatar?: string | null
  onSignOut?: () => void
  onAdmin?: () => void
  accountButton?: React.ReactNode
}

interface Department {
  id: string
  label: string
  description: string
  live: boolean
  color: string
  icon: React.ReactNode
  // When set, the tile jumps straight to this URL instead of entering an internal
  // dept view — for tools that live on their own separate site/app.
  externalUrl?: string
}

const DEPARTMENTS: Department[] = [
  {
    id: 'sales',
    label: 'Sales',
    description: 'Pipeline, opportunities & revenue tracking',
    live: true,
    color: '#3B82F6',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
  },
  {
    id: 'marketing',
    label: 'Marketing',
    description: 'Campaigns, leads, pipeline & website analytics',
    live: true,
    color: '#EBA117',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
      </svg>
    ),
  },
  {
    id: 'production',
    label: 'Production',
    description: 'Sample register — track physical samples in/out of storage',
    live: true,
    color: '#F97316',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
      </svg>
    ),
  },
  {
    id: 'projects',
    label: 'Project Management',
    description: 'Install job cards, crew scheduling & EOD reports',
    live: true,
    color: '#14B8A6',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    ),
  },
  {
    id: 'finance',
    label: 'Finance',
    description: 'Revenue, costs, margins & financial overview',
    live: false,
    color: '#22C55E',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    id: 'management',
    label: 'Management',
    description: 'Company-wide KPIs, overview & executive reporting',
    live: true,
    color: '#A855F7',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
]

export default function HomePage({
  onEnter,
  allowedDepts,
  earlyAccessDepts = [],
  isAdmin = false,
  isSuperAdmin = false,
  adminAccessDepts = [],
  onToggleAdminAccess,
  userName,
  userAvatar,
  onSignOut,
  onAdmin,
  accountButton,
}: HomePageProps) {
  const canAccess = (deptId: string) =>
    !allowedDepts || allowedDepts.includes('*') || allowedDepts.includes(deptId)
  const isLive = (dept: { id: string; live: boolean }) => dept.live || earlyAccessDepts.includes(dept.id)
  // Super admins see every department (even ones nobody has previewed yet) so
  // they can flip the admin-access switch on unreleased ones; everyone else
  // only sees what's actually live or already granted to them.
  // Fully live depts sort first, then early-access previews, then (super-admin-only)
  // fully unreleased ones — so the tiles someone can actually use aren't buried below
  // preview/coming-soon ones.
  const rankOf = (dept: Department) => (dept.live ? 0 : earlyAccessDepts.includes(dept.id) ? 1 : 2)
  const visibleDepartments = (isSuperAdmin ? DEPARTMENTS : DEPARTMENTS.filter(isLive))
    .slice()
    .sort((a, b) => rankOf(a) - rankOf(b))

  const greeting = userName ? `Hello, ${userName}` : 'Hello'

  const [sprinkles, setSprinkles] = useState<Sprinkle[]>([])
  const nextSprinkleId = useRef(0)

  const handleBackgroundClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a, input')) return
    const burst: Sprinkle[] = Array.from({ length: 14 }, () => {
      nextSprinkleId.current += 1
      return {
        id: nextSprinkleId.current,
        x: e.clientX,
        y: e.clientY,
        dx: (Math.random() - 0.5) * 240,
        dy: 300 + Math.random() * 300,
        rot: (Math.random() > 0.5 ? 1 : -1) * (180 + Math.random() * 540),
        dur: 900 + Math.random() * 700,
      }
    })
    setSprinkles(prev => [...prev, ...burst])
  }

  const removeSprinkle = (id: number) => setSprinkles(prev => prev.filter(s => s.id !== id))

  return (
    <div className="min-h-screen bg-[#f5f5f5] flex flex-col" onClick={handleBackgroundClick}>
      {sprinkles.map(s => (
        <div
          key={s.id}
          className="h-sprinkle"
          style={{ left: s.x, top: s.y, '--dx': `${s.dx}px`, '--dy': `${s.dy}px`, '--rot': `${s.rot}deg`, '--dur': `${s.dur}ms` } as React.CSSProperties}
          onAnimationEnd={() => removeSprinkle(s.id)}
        >
          <HSprinkleIcon />
        </div>
      ))}
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Wordmark tone="charcoal" className="h-7" />
          <div className="flex items-center gap-3">
            {isAdmin && onAdmin && (
              <button
                onClick={onAdmin}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Manage users
              </button>
            )}
            {accountButton ?? (onSignOut ? (
              <div className="flex items-center gap-2">
                {userAvatar
                  ? <img src={userAvatar} alt={userName ?? ''} className="w-7 h-7 rounded-full object-cover" />
                  : <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-semibold text-gray-600">
                      {(userName?.[0] ?? '?').toUpperCase()}
                    </div>
                }
                <button
                  onClick={onSignOut}
                  className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <span className="text-sm text-gray-400">Reporting & Insights</span>
            ))}
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="max-w-5xl mx-auto px-4 sm:px-8 pt-8 sm:pt-14 pb-6 sm:pb-8 w-full">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">{greeting}</h1>
        <p className="text-gray-500">Select a department to view its dashboard.</p>
      </div>

      {/* Department grid */}
      <div className="max-w-5xl mx-auto px-4 sm:px-8 pb-12 sm:pb-16 w-full">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleDepartments.map(dept => {
            // Super-admin-only preview control — a dept nobody's toggled on yet
            // (or that's still off) shows a dedicated block with a big central
            // switch, instead of the normal interactive tile, so a super admin
            // can flip admin-wide access on/off for it.
            if (isSuperAdmin && !isLive(dept)) {
              const enabled = adminAccessDepts.includes(dept.id)
              return (
                <div key={dept.id} className="relative bg-white rounded-2xl border border-dashed border-gray-200 p-6 flex flex-col items-center text-center">
                  <div className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl bg-gray-200" />
                  <div className="p-2 rounded-xl mb-3 bg-gray-50 text-gray-400">{dept.icon}</div>
                  <h2 className="text-lg font-bold text-gray-900 mb-1">{dept.label}</h2>
                  <p className="text-sm text-gray-400 leading-snug mb-5">{dept.description}</p>
                  <button
                    onClick={() => onToggleAdminAccess?.(dept.id, !enabled)}
                    className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                      enabled ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-purple-600 text-white hover:bg-purple-700'
                    }`}
                  >
                    {enabled ? 'Remove admin access' : 'Allow for admin access'}
                  </button>
                </div>
              )
            }

            const accessible = canAccess(dept.id)
            const locked = !canAccess(dept.id)
            return (
              <button
                key={dept.id}
                onClick={() => {
                  if (!accessible) return
                  if (dept.externalUrl) window.open(dept.externalUrl, '_blank', 'noopener,noreferrer')
                  else onEnter(dept.id)
                }}
                className={`group relative bg-white rounded-2xl border p-6 text-left transition-all ${
                  accessible
                    ? 'border-gray-200 hover:border-gray-300 hover:shadow-lg cursor-pointer'
                    : 'border-gray-100 cursor-default opacity-60'
                }`}
              >
                {/* Colour accent bar */}
                <div className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl" style={{ backgroundColor: accessible ? dept.color : '#e5e7eb' }} />

                <div className="flex items-start justify-between mb-4 mt-1">
                  <div className="p-2 rounded-xl" style={{ backgroundColor: accessible ? `${dept.color}18` : '#f9fafb', color: accessible ? dept.color : '#9ca3af' }}>
                    {dept.icon}
                  </div>
                  {accessible && !dept.live && (
                    <span className="text-xs px-2 py-1 bg-amber-50 text-amber-600 rounded-full">Early access</span>
                  )}
                  {accessible && dept.live && (
                    <span className="text-xs px-2 py-1 rounded-full font-medium" style={{ backgroundColor: `${dept.color}18`, color: dept.color }}>Live</span>
                  )}
                  {locked && (
                    <span className="text-xs px-2 py-1 bg-gray-100 text-gray-400 rounded-full">Restricted</span>
                  )}
                </div>

                <h2 className="text-lg font-bold text-gray-900 mb-1">{dept.label}</h2>
                <p className="text-sm text-gray-400 leading-snug">{dept.description}</p>

                {accessible && (
                  <div className="mt-4 flex items-center gap-1 text-xs font-medium" style={{ color: dept.color }}>
                    {dept.externalUrl ? 'Open site' : 'Open dashboard'}
                    {dept.externalUrl ? (
                      <svg className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </div>
                )}
                {isSuperAdmin && !dept.live && (
                  <span
                    onClick={e => { e.stopPropagation(); onToggleAdminAccess?.(dept.id, !adminAccessDepts.includes(dept.id)) }}
                    className="mt-3 inline-block text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 transition-colors cursor-pointer"
                  >
                    {adminAccessDepts.includes(dept.id) ? 'Remove admin access' : 'Allow for admin access'}
                  </span>
                )}
                {locked && (
                  <a
                    href={`mailto:hello@yourcompany.io?subject=Access request: ${dept.label} dashboard&body=Hi, I'd like to request access to the ${dept.label} dashboard.`}
                    onClick={e => e.stopPropagation()}
                    className="mt-4 inline-block text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 transition-colors"
                  >
                    Request permission to view {dept.label} dashboard
                  </a>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-auto pb-6 text-center text-xs text-gray-300">
        YourCompany · Internal Reporting Platform
      </div>
    </div>
  )
}
