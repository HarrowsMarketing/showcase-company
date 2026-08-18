// Tiny seeded PRNG so the fake data is stable across hot-reloads within a demo
// session (nothing visibly "jumps" when a component re-renders/refetches) but
// still looks varied across the many fixture files that use it.
// mulberry32 — small, fast, good-enough distribution for fake business data.
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return function rng() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Rng = () => number

// Master seed — change this (and only this) if the whole dataset ever needs to
// visibly "reshuffle" for a new demo. Sub-generators below derive their own
// seeded streams from it so unrelated fixture files don't accidentally share
// draw order.
export const MASTER_SEED = 8271_2026

const substreamCounters = new Map<string, number>()

/** A named, independently-seeded RNG stream — e.g. rngFor('sales') vs rngFor('seo'). */
export function rngFor(name: string): Rng {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  const n = (substreamCounters.get(name) || 0) + 1
  substreamCounters.set(name, n)
  return mulberry32((MASTER_SEED ^ hash ^ (n * 2654435761)) >>> 0)
}

export const randInt = (rng: Rng, min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min
export const randFloat = (rng: Rng, min: number, max: number, decimals = 2) => {
  const v = rng() * (max - min) + min
  const p = Math.pow(10, decimals)
  return Math.round(v * p) / p
}
export function pick<T>(rng: Rng, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}
export function pickN<T>(rng: Rng, arr: T[], n: number): T[] {
  const copy = shuffle(rng, arr)
  return copy.slice(0, Math.min(n, copy.length))
}
export function shuffle<T>(rng: Rng, arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
/** ±pct jitter around a base value, e.g. jitter(rng, 100000, 0.15) -> 85000..115000. */
export function jitter(rng: Rng, base: number, pct: number) {
  return base * (1 + randFloat(rng, -pct, pct, 4))
}
export function weightedBool(rng: Rng, pTrue: number) {
  return rng() < pTrue
}
