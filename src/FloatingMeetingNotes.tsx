import { useState } from 'react'
import axios from 'axios'
import { TEAM } from './utils/teamConfig'

interface Item {
  id: number
  type: 'task' | 'note'
  content: string
  assignee: string
  assigneeName: string
  dueDate: string
  notes: string
}

function todayStr() {
  // Local (NZ) calendar day — toISOString() is UTC and shows yesterday during the NZ morning.
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function formatDate(str: string) {
  if (!str) return ''
  const d = new Date(str + 'T00:00:00')
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
}

export default function FloatingMeetingNotes() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [type, setType] = useState<'task' | 'note'>('task')
  const [content, setContent] = useState('')
  const [assignee, setAssignee] = useState('RJ')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [nextId, setNextId] = useState(1)

  const addItem = () => {
    if (!content.trim()) return
    const member = TEAM.find(t => t.initials === assignee)!
    setItems(prev => [...prev, {
      id: nextId,
      type,
      content: content.trim(),
      assignee,
      assigneeName: member.name,
      dueDate,
      notes: notes.trim(),
    }])
    setNextId(n => n + 1)
    setContent('')
    setNotes('')
    setDueDate('')
  }

  const removeItem = (id: number) => setItems(prev => prev.filter(i => i.id !== id))

  const buildEmailBody = () => {
    const dateStr = new Date().toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    const tasks = items.filter(i => i.type === 'task')
    const noteItems = items.filter(i => i.type === 'note')
    const lines: string[] = [`Meeting Minutes - ${dateStr}`, '']
    if (tasks.length) {
      lines.push('TASKS', '------')
      for (const t of tasks) {
        lines.push(`[ ] ${t.content} - ${t.assigneeName}${t.dueDate ? ` (due ${formatDate(t.dueDate)})` : ''}`)
        if (t.notes) lines.push(`    ${t.notes}`)
      }
      lines.push('')
    }
    if (noteItems.length) {
      lines.push('NOTES', '------')
      for (const n of noteItems) lines.push(`- ${n.content}`)
    }
    return lines.join('\n')
  }

  const submit = async () => {
    setStatus('saving')
    setErrorMsg('')
    try {
      const today = todayStr()
      const tasks = items
        .filter(i => i.type === 'task')
        .map(i => ({
          name: i.content,
          assignee: i.assignee,
          assigneeName: i.assigneeName,
          startDate: today,
          dueDate: i.dueDate || undefined,
          notes: i.notes || undefined,
        }))

      if (tasks.length > 0) {
        await axios.post('/api/smartsheet/meeting', { tasks })
      }

      // Open email with meeting minutes
      const to = TEAM.map(m => m.fullEmail).join(',')
      const subject = `Meeting Minutes - ${new Date().toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}`
      const link = document.createElement('a')
      link.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(buildEmailBody())}`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      setStatus('done')
      setTimeout(() => {
        setStatus('idle')
        setOpen(false)
        setItems([])
      }, 2500)
    } catch (e: any) {
      console.error('Meeting submit error:', e)
      setErrorMsg(e?.response?.data?.error || e?.message || 'Failed — check console')
      setStatus('error')
    }
  }

  const taskCount = items.filter(i => i.type === 'task').length

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gray-900 text-white shadow-xl hover:bg-gray-700 transition-all flex items-center justify-center"
        title="Meeting Notes"
      >
        {items.length > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
            {items.length}
          </span>
        )}
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-96 bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col max-h-[80vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
            <div>
              <h2 className="text-sm font-bold text-gray-900">Meeting Notes</h2>
              <p className="text-xs text-gray-400">{new Date().toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'short' })}</p>
            </div>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
            {/* Add form */}
            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
              <div className="flex gap-2">
                {(['task', 'note'] as const).map(t => (
                  <button key={t} onClick={() => setType(t)}
                    className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors ${type === t ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}>
                    {t === 'task' ? 'Task' : 'Note'}
                  </button>
                ))}
              </div>

              <input
                type="text"
                placeholder={type === 'task' ? 'Task name...' : 'Note...'}
                value={content}
                onChange={e => setContent(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addItem()}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-300"
              />

              {type === 'task' && (
                <>
                  <div className="flex gap-2">
                    {TEAM.map(m => (
                      <button key={m.initials} onClick={() => setAssignee(m.initials)}
                        className={`flex-1 text-xs py-1.5 rounded-lg font-semibold transition-colors ${assignee === m.initials ? `${m.color} text-white` : 'bg-white text-gray-500 border border-gray-200'}`}>
                        {m.initials}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="text-xs text-gray-400 mb-1 block">Due by</label>
                      <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                        className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-300" />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-gray-400 mb-1 block">Note</label>
                      <input type="text" placeholder="Optional..." value={notes} onChange={e => setNotes(e.target.value)}
                        className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-300" />
                    </div>
                  </div>
                </>
              )}

              <button onClick={addItem} disabled={!content.trim()}
                className="w-full text-xs py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors font-medium">
                + Add
              </button>
            </div>

            {/* Items */}
            {items.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase">Added ({items.length})</p>
                {items.map(item => {
                  const member = TEAM.find(t => t.initials === item.assignee)
                  return (
                    <div key={item.id} className="flex items-start gap-2 bg-gray-50 rounded-lg px-3 py-2">
                      <span className="text-gray-500 mt-0.5 shrink-0 text-xs font-mono">{item.type === 'task' ? '[ ]' : '--'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800">{item.content}</p>
                        {item.type === 'task' && (
                          <p className="text-xs text-gray-400">
                            {member?.name}
                            {item.dueDate ? ` · due ${formatDate(item.dueDate)}` : ''}
                            {item.notes ? ` · ${item.notes}` : ''}
                          </p>
                        )}
                      </div>
                      <button onClick={() => removeItem(item.id)} className="text-gray-300 hover:text-red-400 shrink-0 mt-0.5">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          {items.length > 0 && (
            <div className="px-5 py-4 border-t border-gray-100 shrink-0">
              {errorMsg && <p className="text-xs text-red-500 mb-2 text-center">{errorMsg}</p>}
              <button
                onClick={submit}
                disabled={status === 'saving' || status === 'done'}
                className={`w-full text-sm py-3 rounded-xl font-semibold transition-colors ${
                  status === 'done' ? 'bg-green-500 text-white' :
                  status === 'error' ? 'bg-red-500 text-white' :
                  'bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-60'
                }`}
              >
                {status === 'done' ? 'Done — check your email' :
                 status === 'saving' ? 'Saving to Smartsheet...' :
                 status === 'error' ? 'Retry' :
                 `Complete Meeting${taskCount > 0 ? ` (${taskCount} task${taskCount !== 1 ? 's' : ''})` : ''}`}
              </button>
              <p className="text-xs text-gray-400 text-center mt-2">Creates tasks in Smartsheet + opens email to team</p>
            </div>
          )}
        </div>
      )}
    </>
  )
}
