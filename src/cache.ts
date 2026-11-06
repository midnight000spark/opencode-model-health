import { createHash } from "node:crypto"
import type { Endpoint, ProbeKind, ProbeResult } from "./types.js"

export const DEFAULT_TTL_MS = 10 * 60 * 1000

/**
 * Cached outcome of one scan of a provider's models. The endpoint identity is
 * stored too: a changed `baseURL` or key must never reuse results from the old
 * account, so the credential is kept only as a SHA-256 fingerprint.
 */
export interface Snapshot {
  readonly at: number
  readonly baseURL: string
  readonly credential: string
  readonly results: readonly ProbeResult[]
}

export interface Summary {
  readonly total: number
  /** Models that answered successfully. */
  readonly ok: number
  /** `reachable` + `skipped`: no failure, but no clean success either. */
  readonly neutral: number
  readonly problems: number
  readonly byKind: Readonly<Record<ProbeKind, number>>
}

/**
 * SHA-256 of the credential. Used only to detect "same key as last time"; the
 * digest is one-way and the secret itself is never written to the store.
 */
export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

/** Neither the URL nor the key may be reused from a different account. */
export function sameEndpoint(snapshot: Snapshot, endpoint: Endpoint): boolean {
  return (
    snapshot.baseURL === endpoint.baseURL &&
    snapshot.credential === fingerprint(endpoint.apiKey ?? "")
  )
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
    skipped: 0,
    denied: 0,
    quota: 0,
    missing: 0,
    unavailable: 0,
    network: 0,
  }
  for (const result of results) byKind[result.kind] += 1
  const ok = byKind.ok
  const neutral = byKind.reachable + byKind.skipped
  return { total: results.length, ok, neutral, problems: results.length - ok - neutral, byKind }
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
