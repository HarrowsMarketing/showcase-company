import { useState } from 'react'
import { useUser } from '../lib/fakeAuth'
import ManagementEmailPanel, { type MgmtDashId } from './ManagementEmailPanel'
import TargetsPanel from './TargetsPanel'

// Admin-only "Edit" button shown in a management dashboard's header. Opens an
// edit panel scoped to just this dashboard. Renders nothing for non-admins or in
// snapshot (chrome-less capture) mode.
//
// Leadership opens TargetsPanel scoped to just the two things it owns — the
// Forward Order Value target and its own Daily Email — rather than the full sales
// targets editor. Top 5 and Management KPIs open the lighter email-only panel.
export default function ManagementEmailButton({ dashboard, snapshot = false, onSaved }: {
  dashboard: MgmtDashId
  snapshot?: boolean
  onSaved?: () => void
}) {
  const { user } = useUser()
  const isAdmin = !snapshot && ['admin', 'super_admin'].includes((user?.publicMetadata as any)?.role)
  const [open, setOpen] = useState(false)

  if (!isAdmin) return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-medium hover:bg-gray-700 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        Edit
      </button>
      {open && (dashboard === 'leadership'
        ? <TargetsPanel onClose={() => setOpen(false)} onSaved={onSaved} emailDashboard="leadership" tabs={['forward', 'email']} initialTab="forward" />
        : <ManagementEmailPanel onClose={() => setOpen(false)} dashboard={dashboard} />
      )}
    </>
  )
}
