import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TeamStats {
  member: { name: string; email: string; color: string; textColor: string; borderColor: string; initials: string }
  total: number; active: number; inProgress: number; todo: number
  overdue: number; complete: number
  focusedTasks: any[]; nextFive: any[]; recentlyCompleted: any[]
}

export interface DashboardReportData {
  country: string
  forms: { total: number; avgPerMonth: number; monthly: { label: string; count: number }[] } | null
  emails: { avgOpenRate: number; avgClickRate: number; totals: { sent: number; delivered: number; unsubscribed: number }; campaigns: { name: string; sent: number; openRate: string; clickRate: string; bounce: number; unsubscribed: number }[] } | null
  contacts: { total: number; monthly: { label: string; count: number }[] } | null
  analytics: { summary: { sessions: number; users: number; newUsers: number; bounceRate: number; engagementRate: number; pagesPerSession: number; avgSessionDuration: number }; monthly: { label: string; sessions: number }[]; sources: { source: string; sessions: number }[] } | null
  teamStats: TeamStats[]
  pipeline?: any
  chartImages?: { form?: string; email?: string; sessions?: string }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PW = 210, PH = 297, M = 14, CW = 182
const BRAND: [number, number, number] = [30, 41, 59]
const RED: [number, number, number]   = [220, 38, 38]
const GRAY: [number, number, number]  = [107, 114, 128]
const SLATE: [number, number, number] = [71, 85, 105]
const LIGHT: [number, number, number] = [249, 250, 251]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
function fmtDur(secs: number) { return `${Math.floor(secs / 60)}m ${secs % 60}s` }
function lastY(doc: jsPDF): number { return (doc as any).lastAutoTable.finalY }
function checkPage(doc: jsPDF, y: number, needed = 30): number {
  if (y + needed > PH - 16) { doc.addPage(); return 18 }
  return y
}
function sectionLabel(doc: jsPDF, text: string, y: number): number {
  doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...GRAY)
  doc.text(text.toUpperCase(), M, y)
  doc.setTextColor(0)
  return y + 4
}

function statCards(doc: jsPDF, y: number, cards: { label: string; value: string; sub?: string }[]): number {
  const n = cards.length, gap = 3, h = 20
  const w = (CW - gap * (n - 1)) / n
  cards.forEach((card, i) => {
    const x = M + i * (w + gap)
    doc.setFillColor(248, 250, 252)
    doc.roundedRect(x, y, w, h, 1.5, 1.5, 'F')
    doc.setDrawColor(226, 232, 240)
    doc.roundedRect(x, y, w, h, 1.5, 1.5, 'S')
    doc.setDrawColor(0)
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...BRAND)
    doc.text(card.value, x + w / 2, y + 9, { align: 'center' })
    doc.setFont('helvetica', 'bold').setFontSize(6).setTextColor(...SLATE)
    doc.text(card.label, x + w / 2, y + 14, { align: 'center' })
    if (card.sub) {
      doc.setFont('helvetica', 'normal').setFontSize(5.5).setTextColor(...GRAY)
      doc.text(card.sub, x + w / 2, y + 18.5, { align: 'center' })
    }
  })
  doc.setTextColor(0)
  return y + h + 5
}

// Embed a captured chart image, bordered like a card
function chartImage(doc: jsPDF, imgData: string, y: number, h = 48): number {
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(226, 232, 240)
  doc.roundedRect(M, y, CW, h, 2, 2, 'FD')
  doc.setDrawColor(0)
  doc.addImage(imgData, 'PNG', M + 2, y + 2, CW - 4, h - 4)
  return y + h + 6
}

// ── Main export ───────────────────────────────────────────────────────────────

export function generateDashboardPDF(data: DashboardReportData) {
  const { country, forms, emails, contacts, analytics, teamStats, chartImages } = data
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  // ── Header ─────────────────────────────────────────────────────────────────
  doc.setFillColor(...BRAND)
  doc.rect(0, 0, PW, 26, 'F')
  doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(255, 255, 255)
  doc.text('YourCompany Marketing', M, 11)
  doc.setFont('helvetica', 'normal').setFontSize(9)
  doc.text('Performance Snapshot', M, 19)
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(PW - 28, 9, 12, 7, 1.5, 1.5, 'F')
  doc.setTextColor(...BRAND).setFont('helvetica', 'bold').setFontSize(7.5)
  doc.text(country, PW - 22, 14, { align: 'center' })
  doc.setTextColor(180, 180, 180).setFont('helvetica', 'normal').setFontSize(8)
  doc.text(dateStr, PW - M - 14, 19, { align: 'right' })
  doc.setTextColor(0)

  let y = 34

  // ── Overview ───────────────────────────────────────────────────────────────
  y = sectionLabel(doc, 'Overview', y)
  y = statCards(doc, y, [
    { label: 'Form Submissions', value: forms ? String(forms.total) : '–', sub: `avg ${forms?.avgPerMonth ?? '–'} / month` },
    { label: 'Avg Email Open Rate', value: emails ? `${emails.avgOpenRate}%` : '–', sub: 'last 10 campaigns' },
    { label: 'Website Sessions', value: analytics ? fmtNum(analytics.summary.sessions) : '–', sub: 'last 30 days' },
    { label: 'Total Contacts', value: contacts ? fmtNum(contacts.total) : '–', sub: 'in HubSpot CRM' },
  ])

  // ── Form Submissions ───────────────────────────────────────────────────────
  y = checkPage(doc, y, 60)
  y = sectionLabel(doc, `Form Submissions — ${country}`, y)
  if (chartImages?.form) {
    y = chartImage(doc, chartImages.form, y)
  } else {
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GRAY)
    doc.text('Chart unavailable', M, y + 5)
    doc.setTextColor(0); y += 14
  }

  // ── Email Marketing ────────────────────────────────────────────────────────
  y = checkPage(doc, y, 70)
  y = sectionLabel(doc, 'Email Marketing', y)
  if (emails) {
    y = statCards(doc, y, [
      { label: 'Emails Sent', value: fmtNum(emails.totals.sent) },
      { label: 'Avg Open Rate', value: `${emails.avgOpenRate}%` },
      { label: 'Avg Click Rate', value: `${emails.avgClickRate}%` },
      { label: 'Unsubscribes', value: String(emails.totals.unsubscribed) },
    ])
  }
  if (chartImages?.email) {
    y = chartImage(doc, chartImages.email, y)
  }

  // ── Website Analytics ──────────────────────────────────────────────────────
  y = checkPage(doc, y, 75)
  y = sectionLabel(doc, `Website Analytics — Last 30 Days  (GA4 · ${country})`, y)
  if (analytics) {
    const s = analytics.summary
    y = statCards(doc, y, [
      { label: 'Sessions', value: fmtNum(s.sessions), sub: 'last 30 days' },
      { label: 'Users', value: fmtNum(s.users) },
      { label: 'Bounce Rate', value: `${s.bounceRate}%` },
      { label: 'Avg Duration', value: fmtDur(s.avgSessionDuration) },
      { label: 'Engagement Rate', value: `${s.engagementRate}%` },
    ])
  }
  if (chartImages?.sessions) {
    y = chartImage(doc, chartImages.sessions, y, 42)
  }
  if (analytics?.sources?.length) {
    y = checkPage(doc, y, 30)
    autoTable(doc, {
      startY: y,
      head: [['Traffic Channel', 'Sessions']],
      body: analytics.sources.slice(0, 8).map(src => [src.source.replace(/_/g, ' '), fmtNum(src.sessions)]),
      headStyles: { fillColor: SLATE, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: LIGHT },
      columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
      tableWidth: 90,
      margin: { left: M, right: M },
    })
    y = lastY(doc) + 9
  }

  // ── Contact Database ───────────────────────────────────────────────────────
  y = checkPage(doc, y, 35)
  y = sectionLabel(doc, 'Contact Database', y)
  if (contacts?.monthly?.length) {
    const monthly = contacts.monthly
    const newThisMonth = monthly[monthly.length - 1]?.count ?? 0
    const avg = Math.round(monthly.reduce((s, m) => s + m.count, 0) / monthly.length)
    y = statCards(doc, y, [
      { label: 'Total Contacts', value: fmtNum(contacts.total), sub: 'in HubSpot CRM' },
      { label: 'New This Month', value: String(newThisMonth) },
      { label: 'Avg New / Month', value: String(avg), sub: 'last 6 months' },
    ])
  } else { y += 14 }

  // ── Team Activity ──────────────────────────────────────────────────────────
  y = checkPage(doc, y, 30)
  y = sectionLabel(doc, 'Team Activity', y)
  autoTable(doc, {
    startY: y,
    head: [['Person', 'Active Tasks', 'Overdue', '% Complete']],
    body: teamStats.map(({ member, active, overdue, complete, total }) => {
      const pct = total > 0 ? Math.round((complete / total) * 100) : 0
      return [member.name, String(active), overdue > 0 ? String(overdue) : '—', `${pct}%`]
    }),
    headStyles: { fillColor: BRAND, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: LIGHT },
    didParseCell: (d) => {
      if (d.section === 'body' && d.column.index === 2 && String(d.cell.raw) !== '—')
        Object.assign(d.cell.styles, { textColor: RED, fontStyle: 'bold' })
    },
    margin: { left: M, right: M },
  })

  // ── Footer ─────────────────────────────────────────────────────────────────
  const pages = (doc as any).getNumberOfPages?.() ?? 1
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(7).setTextColor(...GRAY)
    doc.text(`YourCompany Marketing  ·  reporting.yourcompany.io  ·  Page ${i} of ${pages}`, PW / 2, PH - 7, { align: 'center' })
  }

  doc.save(`yourcompany-marketing-${now.toISOString().slice(0, 10)}.pdf`)
}

export function generateActivityPDF(..._args: any[]) { generateDashboardPDF(_args[0]) }
