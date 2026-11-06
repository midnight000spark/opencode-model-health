import type { ProbeKind, ProbeResult } from "./types.js"

export const DEFAULT_TTL_MS = 10 * 60 * 1000

/** Cached outcome of one scan of a provider's models. */
export interface Snapshot {
  readonly at: number
  readonly results: readonly ProbeResult[]
}

export interface Summary {
  readonly total: number
  readonly ok: number
  readonly problems: number
  readonly byKind: Readonly<Record<ProbeKind, number>>
}

/** A snapshot is reusable unless it is stale or the caller forces a rescan. */
export function isFresh(
  snapshot: Snapshot | undefined,
  now: number,
  ttlMs = DEFAULT_TTL_MS,
  force = false,
): boolean {
  if (force) return false
  if (snapshot === undefined) return false
  const age = now - snapshot.at
  return age >= 0 && age < ttlMs
}

export function summarize(results: readonly ProbeResult[]): Summary {
  const byKind: Record<ProbeKind, number> = {
    ok: 0,
    reachable: 0,
    denied: 0,
    quota: 0,
    missing: 0,
    unavailable: 0,
    network: 0,
  }
  for (const result of results) byKind[result.kind] += 1
  const ok = byKind.ok + byKind.reachable
  return { total: results.length, ok, problems: results.length - ok, byKind }
}

export function resultsByID(results: readonly ProbeResult[]): ReadonlyMap<string, ProbeResult> {
  return new Map(results.map((result) => [result.modelID, result]))
}

export function agoLabel(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 45) return "только что"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} мин назад`
  return `${Math.round(minutes / 60)} ч назад`
}
