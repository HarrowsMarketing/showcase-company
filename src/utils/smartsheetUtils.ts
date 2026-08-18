import { TEAM } from './teamConfig'
import type { TeamStats } from './generateActivityPDF'

export type { TeamStats }

export function flattenTree(rows: any[]): any[] {
  const result: any[] = []
  function walk(row: any) {
    const children = rows.filter(r => r.parentId === row.id)
    if (children.length === 0) result.push(row)
    else children.forEach(walk)
  }
  rows.filter(r => !r.parentId).forEach(walk)
  return result
}

// focusMode 'priority'  → focused tasks are those with a Priority field set (MarketingActivity)
// focusMode 'urgency'   → focused tasks are In Progress or due within 3 days
export function buildTeamStats(rows: any[], focusMode: 'priority' | 'urgency' = 'urgency'): TeamStats[] {
  const leaves = flattenTree(rows)

  return TEAM.map(member => {
    const memberRows = leaves.filter(row =>
      String(row['Assigned To'] || '').toLowerCase().includes(member.email)
    )
    const now = new Date()
    let complete = 0, inProgress = 0, todo = 0, overdue = 0
    const focusedTasks: any[] = []
    const recentlyCompleted: any[] = []
    const upcomingTasks: any[] = []

    for (const row of memberRows) {
      const pctRaw = parseFloat(String(row['% Complete'] || '0'))
      const pct = pctRaw <= 1 ? Math.round(pctRaw * 100) : Math.round(pctRaw)
      const status = String(row['Status'] || '')
      const dueDate = row['Required Date'] ? new Date(row['Required Date']) : null
      const isComplete = pct === 100 || status === 'Complete'

      if (isComplete) { complete++; recentlyCompleted.push({ name: row['Task Name'], cells: row }) }
      else if (status === 'In Progress') inProgress++
      else todo++

      if (dueDate && dueDate < now && !isComplete) overdue++
      if (!isComplete) upcomingTasks.push({ name: row['Task Name'], dueDate: row['Required Date'], cells: row })

      if (focusMode === 'priority') {
        if (row['Priority']) focusedTasks.push({ name: row['Task Name'], dueDate: row['Required Date'], cells: row })
      } else {
        const threeDaysFromNow = new Date(now.getTime() + 3 * 86400000)
        const isDueSoon = dueDate && dueDate <= threeDaysFromNow && dueDate >= now
        if (!isComplete && (status === 'In Progress' || isDueSoon)) {
          focusedTasks.push({ name: row['Task Name'], dueDate: row['Required Date'], cells: row })
        }
      }
    }

    upcomingTasks.sort((a, b) => {
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
    })

    const total = memberRows.length
    return {
      member, total, active: total - complete,
      inProgress, todo, overdue, complete,
      focusedTasks,
      nextFive: upcomingTasks.slice(0, 5),
      recentlyCompleted: recentlyCompleted.slice(-10).reverse(),
    }
  })
}
