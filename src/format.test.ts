import { describe, expect, test } from "bun:test"
import { progressLine } from "./format.js"
import type { ProbeResult } from "./types.js"

const ok: ProbeResult = { modelID: "gpt-5.5", kind: "ok", status: 200, latencyMs: 210 }
const denied: ProbeResult = {
  modelID: "gemini-3-pro",
  kind: "denied",
  status: 402,
  detail: "Insufficient Balance",
  latencyMs: 340,
}

describe("progressLine", () => {
  test("uses the model id by default", () => {
    expect(progressLine(ok)).toBe("✅ gpt-5.5 · работает · HTTP 200 · 210ms")
  })

  test("prefers a display name when given one", () => {
    expect(progressLine(ok, "GPT-5.5")).toBe("✅ GPT-5.5 · работает · HTTP 200 · 210ms")
  })

  test("truncates long reasons to a single line", () => {
    const long = progressLine(denied, undefined, 20)
    expect(long.length).toBeLessThanOrEqual(20)
    expect(long).toEndWith("…")
  })
})
