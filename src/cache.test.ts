import { describe, expect, test } from "bun:test"
import {
  agoLabel,
  fingerprint,
  isFresh,
  resultsByID,
  sameEndpoint,
  summarize,
  type Snapshot,
} from "./cache.js"
import type { Endpoint, ProbeResult } from "./types.js"

const result = (modelID: string, kind: ProbeResult["kind"]): ProbeResult => ({ modelID, kind, latencyMs: 1 })

const endpoint: Endpoint = { baseURL: "https://api.test/v1", apiKey: "sk-secret" }

describe("fingerprint", () => {
  test("is stable, fixed-width and does not contain the secret", () => {
    const hash = fingerprint("sk-secret")
    expect(hash).toBe(fingerprint("sk-secret"))
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain("secret")
    expect(fingerprint("sk-other")).not.toBe(hash)
  })

  test("distinguishes an absent key from any real one", () => {
    expect(fingerprint("")).not.toBe(fingerprint("k"))
  })
})

describe("sameEndpoint", () => {
  const snapshot: Snapshot = { at: 1, baseURL: endpoint.baseURL, credential: fingerprint("sk-secret"), results: [] }

  test("matches the same baseURL and credential", () => {
    expect(sameEndpoint(snapshot, endpoint)).toBe(true)
  })

  test("rejects a changed baseURL or credential", () => {
    expect(sameEndpoint(snapshot, { ...endpoint, baseURL: "https://other.test/v1" })).toBe(false)
    expect(sameEndpoint(snapshot, { ...endpoint, apiKey: "sk-other" })).toBe(false)
    expect(sameEndpoint(snapshot, { baseURL: endpoint.baseURL })).toBe(false)
  })
})

describe("isFresh", () => {
  const snapshot: Snapshot = { at: 1_000, baseURL: endpoint.baseURL, credential: "", results: [] }

  test("is false without a snapshot", () => {
    expect(isFresh(undefined, 1_000)).toBe(false)
  })

  test("is true inside the ttl", () => {
    expect(isFresh(snapshot, 1_000 + 60_000, 120_000)).toBe(true)
  })

  test("is false once the ttl passes", () => {
    expect(isFresh(snapshot, 1_000 + 120_000, 120_000)).toBe(false)
  })

  test("is false when a rescan is forced even inside the ttl", () => {
    expect(isFresh(snapshot, 1_000 + 60_000, 120_000, true)).toBe(false)
  })
})

describe("summarize", () => {
  test("counts every kind and the problem total", () => {
    const summary = summarize([result("a", "ok"), result("b", "ok"), result("c", "denied"), result("d", "quota")])
    expect(summary).toMatchObject({ total: 4, ok: 2, problems: 2 })
    expect(summary.byKind.denied).toBe(1)
    expect(summary.byKind.quota).toBe(1)
  })

  test("counts ok separately from neutral outcomes", () => {
    const summary = summarize([result("a", "ok"), result("b", "reachable"), result("c", "denied")])
    expect(summary).toMatchObject({ total: 3, ok: 1, neutral: 1, problems: 1 })
    expect(summary.byKind.reachable).toBe(1)
    expect(summary.byKind.ok).toBe(1)
  })

  test("treats skipped as neutral too", () => {
    const summary = summarize([result("a", "ok"), result("b", "skipped")])
    expect(summary).toMatchObject({ total: 2, ok: 1, neutral: 1, problems: 0 })
  })

  test("handles an empty scan", () => {
    expect(summarize([])).toMatchObject({ total: 0, ok: 0, problems: 0 })
  })
})

describe("resultsByID", () => {
  test("keys results by model id", () => {
    const index = resultsByID([result("a", "ok"), result("b", "network")])
    expect(index.get("b")?.kind).toBe("network")
    expect(index.get("missing")).toBeUndefined()
  })
})

describe("agoLabel", () => {
  test("describes recent, minutes and hours", () => {
    expect(agoLabel(1_000, 1_000)).toBe("только что")
    expect(agoLabel(1_000, 1_000 + 5 * 60_000)).toBe("5 мин назад")
    expect(agoLabel(1_000, 1_000 + 3 * 3_600_000)).toBe("3 ч назад")
  })
})
