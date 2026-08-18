// /api/installs/* — Install Tracker (Project Management dept). New feature for
// this demo, not ported from the real app (there, "Project Management" just
// links out to a separate site) — built fresh to the same fidelity bar as the
// other tabs: job cards for on-site install/fitout work at customer accounts,
// plus end-of-day (EOD) crew reports logged against each job.
import { rngFor, randInt, pick, pickN, shuffle } from '../prng'
import { NOW, ymd, addDays, CE_ACCOUNTS } from './company'

export interface EodReport { id: string; date: string; crewMember: string; hours: number; notes: string }
export interface InstallJob {
  id: string
  display_id: string
  title: string
  installType: string
  account: string
  country: 'NZ' | 'AU'
  siteAddress: string
  crew: string[]
  scheduledDate: string
  completedDate: string | null
  status: 'scheduled' | 'in_progress' | 'complete' | 'delayed'
  notes: string
  eodReports: EodReport[]
}

export const INSTALL_TYPES = [
  'Workshop Tool Storage Fitout',
  'Retail Tool Wall Install',
  'Compressed Air / Pneumatic System',
  'Equipment Servicing & Calibration',
  'Trade Counter Fitout',
]
export const INSTALL_CREW = ['Dave Brennan', 'Kai Ngata', 'Ryan Foster', 'Isaac Wells', 'Marcus Lee']
const CITIES_NZ = ['Auckland', 'Timaru', 'Christchurch', 'Wellington', 'Hamilton']
const CITIES_AU = ['Sydney', 'Melbourne', 'Brisbane', 'Perth']
const STREETS = ['Industrial Rd', 'Trade St', 'Workshop Dr', 'Depot Ave', 'Commerce Pl', 'Harbour Way', 'Enterprise Cres']
const EOD_NOTES = [
  'Racking and wall units installed, power tool station wired in — on schedule.',
  'Delayed start due to site access — team on-site by 10am, good progress made.',
  'Compressed air lines run and pressure-tested. No issues found.',
  'Client walked the site with us — signed off on layout changes.',
  'Final fit-out complete, handover walkthrough booked for tomorrow.',
  'Awaiting an extra pallet of shelving from the warehouse — held up half the crew.',
  'Punch list from client addressed, two items outstanding (signage, cable covers).',
]

function buildJobs(): InstallJob[] {
  const rng = rngFor('install-jobs')
  const accounts = shuffle(rng, CE_ACCOUNTS)
  return Array.from({ length: 18 }, (_, i) => {
    const acc = accounts[i % accounts.length]
    const city = pick(rng, acc.country === 'AU' ? CITIES_AU : CITIES_NZ)
    const installType = pick(rng, INSTALL_TYPES)
    const scheduledOffset = randInt(rng, -35, 40)
    const scheduled = addDays(NOW, scheduledOffset)
    let status: InstallJob['status']
    let completedDate: string | null = null
    if (scheduledOffset > 3) {
      status = 'scheduled'
    } else if (scheduledOffset >= -2) {
      status = rng() < 0.75 ? 'in_progress' : 'delayed'
    } else {
      status = rng() < 0.88 ? 'complete' : 'delayed'
      if (status === 'complete') completedDate = ymd(addDays(scheduled, randInt(rng, 0, 3)))
    }
    const crew = pickN(rng, INSTALL_CREW, randInt(rng, 1, 3))
    const eodCount = status === 'complete' ? randInt(rng, 1, 3) : status === 'in_progress' ? randInt(rng, 0, 2) : 0
    const eodReports: EodReport[] = Array.from({ length: eodCount }, (_, j) => ({
      id: `eod-${i}-${j}`,
      date: ymd(addDays(scheduled, j)),
      crewMember: pick(rng, crew),
      hours: randInt(rng, 4, 9),
      notes: pick(rng, EOD_NOTES),
    }))
    return {
      id: `install-${i + 1}`,
      display_id: `INST-${String(i + 1).padStart(4, '0')}`,
      title: `${installType} — ${acc.name}`,
      installType,
      account: acc.name,
      country: acc.country,
      siteAddress: `${randInt(rng, 4, 248)} ${pick(rng, STREETS)}, ${city}`,
      crew,
      scheduledDate: ymd(scheduled),
      completedDate,
      status,
      notes: '',
      eodReports,
    }
  })
}

export const installsStore = { jobs: buildJobs() }
