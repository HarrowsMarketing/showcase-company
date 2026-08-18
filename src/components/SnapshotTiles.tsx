import type { ReactNode } from 'react'

// Shared snapshot-mode layout for the management daily-email capture.
//
// When a management dashboard is rendered with `snapshot`, it lays its tiles out
// as a plain vertical stack of fixed-size, individually-tagged elements
// ([data-tile]) so the email cron (api/management/daily-email.js) can screenshot
// them one-by-one and compose a responsive grid of images — stacked on mobile,
// multi-column on desktop — exactly like the sales daily email, rather than one
// flat full-page picture.
//
// Each tile carries:
//   data-tile        unique key within the dashboard (becomes the image cid)
//   data-tile-label  human label, used as the image alt text
//   data-tile-group  optional section header (Management KPIs groups its tiles)

export interface SnapshotTileDef {
  key: string
  label: string
  group?: string
  node: ReactNode
  height?: number // tile pixel height (defaults to 360)
}

export function SnapshotTiles({ tiles, width = 560 }: { tiles: SnapshotTileDef[]; width?: number }) {
  return (
    <div data-snapshot-root data-snapshot-ready="true" style={{ width }}>
      {tiles.map(t => (
        <div
          key={t.key}
          data-tile={t.key}
          data-tile-label={t.label}
          {...(t.group ? { 'data-tile-group': t.group } : {})}
          style={{ width, height: t.height ?? 360, marginBottom: 20 }}
        >
          {t.node}
        </div>
      ))}
    </div>
  )
}
