import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { cachedGet } from '../lib/apiCache'

interface DailyPoint { date: string; engagement: number; clicks?: number }

interface InstagramPost { caption: string; mediaType: string; timestamp: string; likeCount: number; commentsCount: number; permalink: string }
interface InstagramData {
  configured: boolean
  error?: string
  username?: string
  followersCount?: number
  mediaCount?: number
  avgLikes?: number
  avgComments?: number
  reach7d?: number | null
  impressions7d?: number | null
  recentPosts?: InstagramPost[]
  dailyTrend?: DailyPoint[]
}

interface LinkedInPost { text: string; publishedAt: number | null; likeCount: number; commentCount: number; shareCount: number }
interface LinkedInData {
  configured: boolean
  error?: string
  followersCount?: number
  recentPosts?: LinkedInPost[]
  dailyTrend?: DailyPoint[]
}

interface PinterestPin { title: string; thumbnail: string | null; link: string; createdAt: string }
interface PinterestData {
  configured: boolean
  error?: string
  username?: string
  followersCount?: number
  recentPins?: PinterestPin[]
  dailyTrend?: DailyPoint[]
}

function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function timeAgo(ts: string | number | null) {
  if (!ts) return ''
  const ms = typeof ts === 'number' ? ts : new Date(ts).getTime()
  const diff = Date.now() - ms
  const d = Math.floor(diff / 86400000)
  if (d === 0) return 'today'
  if (d === 1) return 'yesterday'
  if (d < 7) return `${d}d ago`
  if (d < 30) return `${Math.floor(d / 7)}w ago`
  return `${Math.floor(d / 30)}mo ago`
}

function mergeDailyTrends(instagram?: DailyPoint[], linkedin?: DailyPoint[], pinterest?: DailyPoint[]) {
  const rows = new Map<string, Record<string, number | string>>()
  const add = (data: DailyPoint[] | undefined, prefix: string, withClicks: boolean) => {
    (data || []).forEach(d => {
      if (!rows.has(d.date)) rows.set(d.date, { date: d.date })
      const row = rows.get(d.date)!
      row[`${prefix}Engagement`] = d.engagement
      if (withClicks) row[`${prefix}Clicks`] = d.clicks || 0
    })
  }
  add(instagram, 'ig', false)
  add(linkedin, 'li', true)
  add(pinterest, 'pin', true)
  return Array.from(rows.values())
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map(row => ({
      ...row,
      label: new Date(`${row.date}T00:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }),
    }))
}

function ChannelTrendChart({ instagram, linkedin, pinterest }: { instagram?: DailyPoint[]; linkedin?: DailyPoint[]; pinterest?: DailyPoint[] }) {
  const data = mergeDailyTrends(instagram, linkedin, pinterest)
  if (data.length === 0) return null
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Engagement &amp; Clicks — Last 30 Days</p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} />
          <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} allowDecimals={false} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="igEngagement" stroke="#E1306C" strokeWidth={2} dot={false} name="Instagram engagement" connectNulls />
          <Line type="monotone" dataKey="liEngagement" stroke="#0A66C2" strokeWidth={2} dot={false} name="LinkedIn engagement" connectNulls />
          <Line type="monotone" dataKey="liClicks" stroke="#0A66C2" strokeWidth={2} strokeDasharray="4 3" dot={false} name="LinkedIn clicks" connectNulls />
          <Line type="monotone" dataKey="pinEngagement" stroke="#E60023" strokeWidth={2} dot={false} name="Pinterest engagement" connectNulls />
          <Line type="monotone" dataKey="pinClicks" stroke="#E60023" strokeWidth={2} strokeDasharray="4 3" dot={false} name="Pinterest clicks" connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function SocialNotConfigured({ platform, envVars }: { platform: string; envVars: string[] }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-3">
        <span className="text-gray-400 text-lg">🔗</span>
      </div>
      <p className="text-sm font-medium text-gray-700 mb-1">{platform} not connected</p>
      <p className="text-xs text-gray-400 mb-3">Add these env vars to Vercel to connect</p>
      <div className="space-y-1">
        {envVars.map(v => (
          <code key={v} className="block text-xs bg-gray-100 text-gray-600 px-3 py-1 rounded">{v}</code>
        ))}
      </div>
    </div>
  )
}

export default function SocialMedia() {
  const [instagram, setInstagram] = useState<InstagramData | null>(null)
  const [linkedin, setLinkedin] = useState<LinkedInData | null>(null)
  const [pinterest, setPinterest] = useState<PinterestData | null>(null)

  useEffect(() => {
    cachedGet('/api/social/instagram')
      .then(r => setInstagram(r.data))
      .catch(() => setInstagram({ configured: false }))

    cachedGet('/api/social/linkedin')
      .then(r => setLinkedin(r.data))
      .catch(() => setLinkedin({ configured: false }))

    cachedGet('/api/social/pinterest')
      .then(r => setPinterest(r.data))
      .catch(() => setPinterest({ configured: false }))
  }, [])

  const today = new Date().toLocaleDateString('en-NZ', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Social Media</h1>
        <p className="text-sm text-gray-400">{today}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Instagram */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Instagram</p>
              {instagram?.configured && instagram.username && (
                <p className="text-xs text-gray-400">@{instagram.username}</p>
              )}
            </div>
            {instagram?.configured && instagram.followersCount !== undefined && (
              <div className="ml-auto text-right">
                <p className="text-lg font-bold text-gray-900">{fmtNum(instagram.followersCount)}</p>
                <p className="text-xs text-gray-400">followers</p>
              </div>
            )}
          </div>

          <div className="px-5 py-4">
            {instagram === null && (
              <div className="h-20 bg-gray-50 rounded animate-pulse" />
            )}
            {instagram !== null && !instagram.configured && (
              <SocialNotConfigured
                platform="Instagram"
                envVars={['INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_USER_ID']}
              />
            )}
            {instagram?.configured && !instagram.error && (
              <>
                {/* Stats row */}
                <div className="flex gap-4 mb-4 pb-4 border-b border-gray-50">
                  <div className="text-center">
                    <p className="text-lg font-bold text-gray-900">{instagram.avgLikes ?? '–'}</p>
                    <p className="text-xs text-gray-400">avg ♥ / post</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-gray-900">{instagram.avgComments ?? '–'}</p>
                    <p className="text-xs text-gray-400">avg 💬 / post</p>
                  </div>
                  {instagram.reach7d != null && (
                    <div className="text-center">
                      <p className="text-lg font-bold text-gray-900">{fmtNum(instagram.reach7d)}</p>
                      <p className="text-xs text-gray-400">reach 7d</p>
                    </div>
                  )}
                  {instagram.impressions7d != null && (
                    <div className="text-center">
                      <p className="text-lg font-bold text-gray-900">{fmtNum(instagram.impressions7d)}</p>
                      <p className="text-xs text-gray-400">impressions 7d</p>
                    </div>
                  )}
                </div>

                {/* Recent posts */}
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Recent Posts</p>
                <div className="space-y-2">
                  {(instagram.recentPosts || []).map((post, i) => (
                    <a key={i} href={post.permalink} target="_blank" rel="noreferrer"
                      className="flex items-start justify-between gap-3 p-2.5 rounded-lg hover:bg-gray-50 transition-colors group">
                      <p className="text-xs text-gray-700 flex-1 line-clamp-2">
                        {post.caption || <span className="text-gray-400 italic">{post.mediaType}</span>}
                      </p>
                      <div className="shrink-0 text-right">
                        <p className="text-xs text-gray-500">♥ {post.likeCount} · 💬 {post.commentsCount}</p>
                        <p className="text-xs text-gray-400">{timeAgo(post.timestamp)}</p>
                      </div>
                    </a>
                  ))}
                  {(instagram.recentPosts || []).length === 0 && (
                    <p className="text-xs text-gray-400">No posts found</p>
                  )}
                </div>
              </>
            )}
            {instagram?.configured && instagram.error && (
              <p className="text-xs text-red-500 py-4">Error loading Instagram: {instagram.error}</p>
            )}
          </div>
        </div>

        {/* LinkedIn */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
            <div className="w-8 h-8 rounded-lg bg-[#0A66C2] flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">LinkedIn</p>
              <p className="text-xs text-gray-400">Company page</p>
            </div>
            {linkedin?.configured && linkedin.followersCount !== undefined && (
              <div className="ml-auto text-right">
                <p className="text-lg font-bold text-gray-900">{fmtNum(linkedin.followersCount)}</p>
                <p className="text-xs text-gray-400">followers</p>
              </div>
            )}
          </div>

          <div className="px-5 py-4">
            {linkedin === null && (
              <div className="h-20 bg-gray-50 rounded animate-pulse" />
            )}
            {linkedin !== null && !linkedin.configured && (
              <SocialNotConfigured
                platform="LinkedIn"
                envVars={['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_COMPANY_ID']}
              />
            )}
            {linkedin?.configured && !linkedin.error && (
              <>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Recent Posts</p>
                <div className="space-y-2">
                  {(linkedin.recentPosts || []).map((post, i) => (
                    <div key={i} className="flex items-start justify-between gap-3 p-2.5 rounded-lg hover:bg-gray-50">
                      <p className="text-xs text-gray-700 flex-1 line-clamp-2">
                        {post.text || <span className="text-gray-400 italic">No text</span>}
                      </p>
                      <div className="shrink-0 text-right">
                        <p className="text-xs text-gray-500">♥ {post.likeCount} · 💬 {post.commentCount} · 🔄 {post.shareCount}</p>
                        <p className="text-xs text-gray-400">{timeAgo(post.publishedAt)}</p>
                      </div>
                    </div>
                  ))}
                  {(linkedin.recentPosts || []).length === 0 && (
                    <p className="text-xs text-gray-400">No posts found</p>
                  )}
                </div>
              </>
            )}
            {linkedin?.configured && linkedin.error && (
              <p className="text-xs text-red-500 py-4">Error loading LinkedIn: {linkedin.error}</p>
            )}
          </div>
        </div>

        {/* Pinterest */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
            <div className="w-8 h-8 rounded-lg bg-[#E60023] flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.164-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.25 3.772-5.495 0-2.873-2.064-4.881-5.012-4.881-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146 1.124.347 2.317.535 3.554.535 6.62 0 11.987-5.367 11.987-11.987C23.987 5.367 18.62.001 12 .001l.017-.001z"/>
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Pinterest</p>
              {pinterest?.configured && pinterest.username && (
                <p className="text-xs text-gray-400">@{pinterest.username}</p>
              )}
            </div>
            {pinterest?.configured && pinterest.followersCount !== undefined && (
              <div className="ml-auto text-right">
                <p className="text-lg font-bold text-gray-900">{fmtNum(pinterest.followersCount)}</p>
                <p className="text-xs text-gray-400">followers</p>
              </div>
            )}
          </div>

          <div className="px-5 py-4">
            {pinterest === null && (
              <div className="h-20 bg-gray-50 rounded animate-pulse" />
            )}
            {pinterest !== null && !pinterest.configured && (
              <SocialNotConfigured
                platform="Pinterest"
                envVars={['PINTEREST_ACCESS_TOKEN']}
              />
            )}
            {pinterest?.configured && !pinterest.error && (
              <>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Recent Pins</p>
                <div className="space-y-2">
                  {(pinterest.recentPins || []).map((pin, i) => (
                    <a key={i} href={pin.link} target="_blank" rel="noreferrer"
                      className="flex items-start justify-between gap-3 p-2.5 rounded-lg hover:bg-gray-50 transition-colors group">
                      <p className="text-xs text-gray-700 flex-1 line-clamp-2">
                        {pin.title || <span className="text-gray-400 italic">Untitled pin</span>}
                      </p>
                      <p className="shrink-0 text-xs text-gray-400">{timeAgo(pin.createdAt)}</p>
                    </a>
                  ))}
                  {(pinterest.recentPins || []).length === 0 && (
                    <p className="text-xs text-gray-400">No pins found</p>
                  )}
                </div>
              </>
            )}
            {pinterest?.configured && pinterest.error && (
              <p className="text-xs text-red-500 py-4">Error loading Pinterest: {pinterest.error}</p>
            )}
          </div>
        </div>

      </div>

      <ChannelTrendChart
        instagram={instagram?.dailyTrend}
        linkedin={linkedin?.dailyTrend}
        pinterest={pinterest?.dailyTrend}
      />
    </div>
  )
}
