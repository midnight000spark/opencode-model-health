import { describe, expect, test } from "bun:test"
import { agoLabel, isFresh, resultsByID, summarize, type Snapshot } from "./cache.js"
import type { ProbeResult } from "./types.js"

const result = (modelID: string, kind: ProbeResult["kind"]): ProbeResult => ({ modelID, kind, latencyMs: 1 })

describe("isFresh", () => {
  const snapshot: Snapshot = { at: 1_000, results: [] }

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

  test("counts reachable as healthy but keeps it in byKind", () => {
    const summary = summarize([result("a", "ok"), result("b", "reachable"), result("c", "denied")])
    expect(summary).toMatchObject({ total: 3, ok: 2, problems: 1 })
    expect(summary.byKind.reachable).toBe(1)
    expect(summary.byKind.ok).toBe(1)
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
