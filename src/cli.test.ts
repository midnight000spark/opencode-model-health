import { describe, expect, test } from "bun:test"
import { parseArgs, render } from "./cli.js"
import type { ProbeResult } from "./types.js"

describe("parseArgs", () => {
  test("applies defaults when no flags are given", () => {
    expect(parseArgs([])).toEqual({
      provider: "reformboss",
      mode: "text",
      concurrency: 4,
      timeoutMs: 30_000,
      json: false,
    })
  })

  test("reads provider, mode, limits and json", () => {
    expect(parseArgs(["--provider", "acme", "--mode", "all", "--concurrency", "8", "--timeout", "5000", "--json"])).toEqual({
      provider: "acme",
      mode: "all",
      concurrency: 8,
      timeoutMs: 5000,
      json: true,
    })
  })

  test("ignores invalid numbers and an unknown mode", () => {
    const args = parseArgs(["--concurrency", "0", "--timeout", "abc", "--mode", "weird"])
    expect(args.concurrency).toBe(4)
    expect(args.timeoutMs).toBe(30_000)
    expect(args.mode).toBe("text")
  })
})

describe("render", () => {
  const results: readonly ProbeResult[] = [
    { modelID: "z-ok", kind: "ok", status: 200, latencyMs: 5 },
    { modelID: "a-denied", kind: "denied", status: 403, latencyMs: 9 },
  ]

  test("prints a summary header and puts problems first", () => {
    const text = render(results)
    expect(text.split("\n")[0]).toBe("1/2 ✅ · проблем: 1")
    expect(text.indexOf("a-denied")).toBeLessThan(text.indexOf("z-ok"))
  })

  test("includes the icon, status and latency of each row", () => {
    const text = render(results)
    expect(text).toContain("⛔ a-denied")
    expect(text).toContain("HTTP 403")
    expect(text).toContain("9ms")
  })
})
