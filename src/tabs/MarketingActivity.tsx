import { useEffect, useState, useCallback } from 'react'
import axios from 'axios'
import { cachedGet } from '../lib/apiCache'
import { generateActivityPDF } from '../utils/generateActivityPDF'
import { TEAM } from '../utils/teamConfig'
import { buildTeamStats } from '../utils/smartsheetUtils'
import type { TeamStats } from '../utils/smartsheetUtils'

export default function MarketingActivity() {
  const [rawData, setRawData] = useState<{ rows: any[]; columns: any[] } | null>(null)
  const [teamStats, setTeamStats] = useState<TeamStats[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedMember, setSelectedMember] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await cachedGet('/api/smartsheet')
      setRawData(r.data)
      setTeamStats(buildTeamStats(r.data.rows || [], 'priority'))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="flex items-center justify-center py-16 text-gray-400">Loading activity data...</div>

  return (
    <div className="space-y-6">
      {/* Header row with download button */}
      <div className="flex justify-end">
        <button
          onClick={() => rawData && generateActivityPDF({ teamStats, rawRows: rawData.rows, snapshot: null, extended: null, instagram: null, linkedin: null, country: 'NZ' })}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          </svg>
          Download Weekly Report
        </button>
      </div>

      {/* Today's Focus */}
      <section>
        <h2 className="text-sm font-semibold tracking-widest text-gray-400 uppercase mb-3">Today's Focus</h2>
        <div className="grid grid-cols-4 gap-4">
          {teamStats.map(({ member, focusedTasks }) => (
            <div key={member.initials} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-8 h-8 rounded-full ${member.color} flex items-center justify-center text-white text-xs font-bold`}>
                  {member.initials}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{member.name.split(' ')[0]}</p>
                  <p className="text-xs text-gray-400">{focusedTasks.length} focused</p>
                </div>
              </div>
              {focusedTasks.length === 0 ? (
                <p className="text-xs text-gray-400">Star tasks below to add focus</p>
              ) : (
                <div className="space-y-1.5">
                  {focusedTasks.slice(0, 3).map((t, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-yellow-400 text-xs">★</span>
                      <span className="text-xs text-gray-700 truncate flex-1">{t.name}</span>
                      {t.dueDate && (
                        <span className="text-xs px-1.5 py-0.5 bg-orange-50 text-orange-500 rounded shrink-0">
                          {new Date(t.dueDate).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Team Activity */}
      <section>
        <h2 className="text-sm font-semibold tracking-widest text-gray-400 uppercase mb-3">Team Activity</h2>
        <div className="grid grid-cols-4 gap-4">
          {teamStats.map(({ member, total, active, inProgress, todo, overdue, complete }) => {
            const pct = total > 0 ? Math.round((complete / total) * 100) : 0
            return (
              <div key={member.initials} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <div className={`w-9 h-9 rounded-full ${member.color} flex items-center justify-center text-white text-sm font-bold`}>
                    {member.initials}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{member.name}</p>
                    <p className="text-xs text-gray-400">{total} tasks total</p>
                  </div>
                </div>

                <p className="text-3xl font-bold text-gray-900 mb-1">{active}</p>
                <p className="text-xs text-gray-400 mb-1">active tasks</p>
                <p className="text-xs text-gray-500 mb-2">{inProgress} in progress · {todo} to do</p>

                {overdue > 0 && (
                  <span className="inline-block text-xs px-2 py-0.5 bg-red-100 text-red-600 rounded-full mb-2">
                    {overdue} overdue
                  </span>
                )}

                <p className="text-xs text-gray-400 mb-1">{complete} of {total} tasks completed</p>
                <div className="w-full bg-gray-100 rounded-full h-2 mb-1">
                  <div className={`h-2 rounded-full ${member.color}`} style={{ width: `${pct}%` }} />
                </div>
                <p className="text-sm font-semibold text-gray-700">{pct}%</p>
              </div>
            )
          })}
        </div>
      </section>

      {/* Next 5 Tasks Per Person */}
      <section>
        <h2 className="text-sm font-semibold tracking-widest text-gray-400 uppercase mb-3">Next 5 Tasks Per Person</h2>
        <div className="flex gap-2 mb-4">
          {teamStats.map(({ member, active }, i) => (
            <button
              key={member.initials}
              onClick={() => setSelectedMember(i)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedMember === i ? `${member.color} text-white` : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {member.name} <span className="text-xs opacity-75">({active})</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-2">
          {teamStats[selectedMember]?.nextFive.map((task, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">{task.name}</p>
                <p className="text-xs text-gray-400">{teamStats[selectedMember].member.name}</p>
              </div>
              {task.dueDate && (
                <span className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-lg">
                  {new Date(task.dueDate).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                </span>
              )}
            </div>
          ))}
          {teamStats[selectedMember]?.nextFive.length === 0 && (
            <p className="text-sm text-gray-400 py-4">No upcoming tasks</p>
          )}
        </div>
      </section>

      {/* Recently Completed + Overdue */}
      <section>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h2 className="text-sm font-semibold tracking-widest text-gray-400 uppercase mb-3">Recently Completed (last 10)</h2>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-50">
              {teamStats.flatMap(s => s.recentlyCompleted.slice(0, 3).map(t => ({ ...t, member: s.member }))).slice(0, 10).map((task, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm text-gray-800 truncate max-w-[260px]">{task.name}</p>
                    <p className="text-xs text-gray-400">{task.member.name}</p>
                  </div>
                  <span className="text-xs text-green-600">✓</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold tracking-widest text-gray-400 uppercase mb-3">
              Overdue Tasks ({teamStats.reduce((s, m) => s + m.overdue, 0)} total)
            </h2>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-50">
              {teamStats.flatMap(s => {
                const overdueTasks: any[] = []
                // This is a simplified version — we mark tasks as overdue based on stats
                if (s.overdue > 0) {
                  s.nextFive.forEach(t => {
                    if (t.dueDate && new Date(t.dueDate) < new Date()) {
                      overdueTasks.push({ ...t, member: s.member })
                    }
                  })
                }
                return overdueTasks
              }).slice(0, 10).map((task, i) => {
                const daysOverdue = task.dueDate ? Math.floor((Date.now() - new Date(task.dueDate).getTime()) / 86400000) : 0
                return (
                  <div key={i} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm text-gray-800 truncate max-w-[240px]">{task.name}</p>
                      <p className="text-xs text-gray-400">{task.member.name}</p>
                    </div>
                    <span className="text-xs px-2 py-0.5 bg-red-50 text-red-500 rounded-full">{daysOverdue}d overdue</span>
                  </div>
                )
              })}
              {teamStats.every(s => s.overdue === 0) && (
                <p className="text-sm text-gray-400 px-4 py-4">No overdue tasks</p>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
