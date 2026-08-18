import { useState, useEffect } from 'react'
import axios from 'axios'
import { LogoMark } from './components/Logo'
import HomePage from './HomePage'
import MarketingRevenue from './tabs/MarketingRevenue'
import MarketingDashboard from './tabs/MarketingDashboard'
import MQLDashboard from './tabs/MQLDashboard'
import MarketingPlan from './tabs/MarketingPlan'
import SocialMedia from './tabs/SocialMedia'
import SEODashboard from './tabs/SEODashboard'
import SalesTracking from './tabs/SalesTracking'
import DisplayDashboard from './tabs/DisplayDashboard'
import ForecastDashboard from './tabs/ForecastDashboard'
import CleanupDashboard from './tabs/CleanupDashboard'
import KPIDashboard from './tabs/KPIDashboard'
import SalesBreakdown from './tabs/SalesBreakdown'
import CustomerEngagement from './tabs/CustomerEngagement'
import MeetingTab from './tabs/MeetingTab'
import FloatingMeetingNotes from './FloatingMeetingNotes'
import AdminPage from './admin/AdminPage'
import { clearApiCache } from './lib/apiCache'
import MondayHuddle from './tabs/MondayHuddle'
import ContentPlan from './tabs/ContentPlan'
import LeadershipDashboard from './tabs/LeadershipDashboard'
import TopFiveScoreboard from './tabs/TopFiveScoreboard'
import ManagementKPIs from './tabs/ManagementKPIs'
import SampleRegister from './tabs/SampleRegister'
import InstallTracker from './tabs/InstallTracker'

const DEPT_TABS: Record<string, string[]> = {
  marketing: ['Marketing Dashboard', 'Marketing KPIs', 'SEO Dashboard', 'MQL Engagement', 'Planner', 'Social Media', 'Monday Huddle', 'Content Plan FY26/27'],
  sales: ['Display Dashboard', 'Daily Meeting', 'Sales Dashboard', 'KPIs', 'Sales Breakdown', 'Client Development', 'Forecast', 'Clean-up'],
  management: ['Leadership Dashboard', 'Top 5 - Scoreboard', 'Management KPIs'],
  production: ['Sample Register'],
  projects: ['Install Tracker'],
}

// Demo mode: there is no real auth, so a single fixed "demo user" is treated
// as a super admin — every department and every admin control is unlocked so
// there's nothing to configure before showing this off at a booth.
const DEMO_USER = { name: 'Alex Chen', email: 'alex@yourcompany.io' }

function AuthedApp() {
  const isSuperAdmin = true
  const isAdmin = true

  const [adminAccessDepts, setAdminAccessDepts] = useState<string[]>([])
  useEffect(() => {
    axios.get('/api/admin-access-depts').then(r => setAdminAccessDepts(r.data.depts || [])).catch(() => {})
  }, [])
  const handleToggleAdminAccess = async (deptId: string, allow: boolean) => {
    const r = await axios.put('/api/admin-access-depts', { deptId, allow })
    setAdminAccessDepts(r.data.depts || [])
  }

  const earlyAccessDepts = adminAccessDepts
  const allowedDepts = ['sales', 'marketing', 'production', 'projects', 'finance', 'management']

  const defaultTabFor = (d: string | null) => (d === 'sales' ? 2 : 0)
  const parseLocation = () => {
    const [d, t] = window.location.pathname.replace(/^\/|\/$/g, '').split('/')
    const tab = t !== undefined && t !== '' && !Number.isNaN(Number(t)) ? Number(t) : null
    return { dept: d || null, tab }
  }
  const resolveTab = (d: string | null, tab: number | null) => {
    if (tab === null) return defaultTabFor(d)
    const count = (d && DEPT_TABS[d]?.length) || 0
    return count > 0 ? Math.max(0, Math.min(tab, count - 1)) : tab
  }
  const initial = parseLocation()
  const [dept, setDept] = useState<string | null>(initial.dept)
  const [activeTab, setActiveTab] = useState(resolveTab(initial.dept, initial.tab))
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const newPath = dept ? (DEPT_TABS[dept] ? `/${dept}/${activeTab}` : `/${dept}`) : '/'
    if (window.location.pathname !== newPath) {
      window.history.pushState({}, '', newPath)
    }
  }, [dept, activeTab])

  useEffect(() => {
    const onPop = () => {
      const { dept: d, tab } = parseLocation()
      setDept(d)
      setActiveTab(resolveTab(d, tab))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const userName = DEMO_USER.name
  const userAvatar: string | null = null
  const handleSignOut = () => {}

  if (dept === 'admin') {
    return (
      <AdminPage
        onBack={() => setDept(null)}
        userName={userName}
        userAvatar={userAvatar}
        onSignOut={handleSignOut}
        isSuperAdmin={isSuperAdmin}
      />
    )
  }

  if (!dept) {
    return (
      <HomePage
        onEnter={(d) => { setDept(d); setActiveTab(defaultTabFor(d)) }}
        allowedDepts={allowedDepts}
        earlyAccessDepts={earlyAccessDepts}
        isAdmin={isAdmin}
        isSuperAdmin={isSuperAdmin}
        adminAccessDepts={adminAccessDepts}
        onToggleAdminAccess={handleToggleAdminAccess}
        userName={userName}
        userAvatar={userAvatar}
        onSignOut={handleSignOut}
        onAdmin={() => setDept('admin')}
      />
    )
  }

  // Display Dashboard — immersive full-screen mode with an exit button
  if (dept === 'sales' && activeTab === 0) {
    return (
      <div className="fixed inset-0 z-50 bg-[#f5f5f5] p-4">
        <button
          onClick={() => setActiveTab(2)}
          title="Exit full screen"
          className="absolute top-3 right-3 z-10 w-10 h-10 rounded-full bg-white/90 border border-gray-200 shadow flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <DisplayDashboard key={refreshKey} fullscreen />
      </div>
    )
  }

  const tabs = DEPT_TABS[dept] ?? []

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3">
        <div className="flex items-center justify-between max-w-screen-2xl mx-auto">
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => setDept(null)}
              className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="hidden sm:inline">Home</span>
            </button>
            <span className="text-gray-200 hidden sm:inline">|</span>
            <LogoMark className="h-6 sm:h-7 w-6 sm:w-7" />
            <span className="text-base sm:text-lg text-gray-400 capitalize">{dept}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { clearApiCache(); setRefreshKey(k => k + 1) }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-semibold text-gray-600">
                {userName[0]}
              </div>
            </div>
          </div>
        </div>
        <div className="flex gap-0 max-w-screen-2xl mx-auto mt-3 -mb-px overflow-x-auto scrollbar-hide">
          {tabs.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setActiveTab(i)}
              className={`px-4 sm:px-5 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === i ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </header>
      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {dept === 'marketing' && activeTab === 0 && <MarketingRevenue key={refreshKey} />}
        {dept === 'marketing' && activeTab === 1 && <MarketingDashboard key={refreshKey} />}
        {dept === 'marketing' && activeTab === 2 && <SEODashboard key={refreshKey} />}
        {dept === 'marketing' && activeTab === 3 && <MQLDashboard key={refreshKey} />}
        {dept === 'marketing' && activeTab === 4 && <MarketingPlan key={refreshKey} />}
        {dept === 'marketing' && activeTab === 5 && <SocialMedia key={refreshKey} />}
        {dept === 'marketing' && activeTab === 6 && <MondayHuddle key={refreshKey} />}
        {dept === 'marketing' && activeTab === 7 && <ContentPlan key={refreshKey} />}
        {/* activeTab === 0 (Display Dashboard) is rendered full-screen above */}
        {dept === 'sales' && activeTab === 1 && <MeetingTab key={refreshKey} />}
        {dept === 'sales' && activeTab === 2 && <SalesTracking key={refreshKey} />}
        {dept === 'sales' && activeTab === 3 && <KPIDashboard key={refreshKey} />}
        {dept === 'sales' && activeTab === 4 && <SalesBreakdown key={refreshKey} />}
        {dept === 'sales' && activeTab === 5 && <CustomerEngagement key={refreshKey} isAdmin={isAdmin} />}
        {dept === 'sales' && activeTab === 6 && <ForecastDashboard key={refreshKey} />}
        {dept === 'sales' && activeTab === 7 && <CleanupDashboard key={refreshKey} />}
        {dept === 'management' && activeTab === 0 && <LeadershipDashboard key={refreshKey} />}
        {dept === 'management' && activeTab === 1 && <TopFiveScoreboard key={refreshKey} />}
        {dept === 'management' && activeTab === 2 && <ManagementKPIs key={refreshKey} />}
        {dept === 'production' && activeTab === 0 && <SampleRegister key={refreshKey} />}
        {dept === 'projects' && activeTab === 0 && <InstallTracker key={refreshKey} />}
        {!DEPT_TABS[dept] && (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-sm text-gray-400">
            This dashboard isn't built yet — check back soon.
          </div>
        )}
      </main>
      {dept === 'marketing' && <FloatingMeetingNotes />}
    </div>
  )
}

export default function App() {
  // Chrome-less snapshot routes — same idea as the real app's daily-email
  // screenshot cron, kept here purely as a nice thing to point at during a demo.
  const snapshotPath = window.location.pathname.replace(/\/$/, '')
  if (snapshotPath === '/snapshot/sales') {
    return (
      <div className="bg-[#f5f5f5] p-4">
        <DisplayDashboard snapshot />
      </div>
    )
  }
  if (snapshotPath.startsWith('/snapshot/management/')) {
    const which = snapshotPath.slice('/snapshot/management/'.length)
    const view = which === 'leadership' ? <LeadershipDashboard snapshot />
      : which === 'top5' ? <TopFiveScoreboard snapshot />
      : which === 'kpis' ? <ManagementKPIs snapshot />
      : null
    if (view) return <div className="bg-[#f5f5f5] p-4">{view}</div>
  }

  return <AuthedApp />
}
