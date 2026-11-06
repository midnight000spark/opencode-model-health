import { describe, expect, test } from "bun:test"
import { isRecord, isTokenLimit, kindOf, reason, truncate } from "./classify.js"
import { mapConcurrent, isInsecure, PROBE_MAX_TOKENS, probeAll, probeModel } from "./probe.js"
import type { Endpoint, FetchLike, HttpResponseLike } from "./types.js"

const endpoint: Endpoint = { baseURL: "https://api.example.com/v1/", apiKey: "sk-secret" }

function respond(status: number, body = ""): FetchLike {
  return async (): Promise<HttpResponseLike> => ({ status, text: async () => body })
}

describe("probeModel", () => {
  test("reports ok for a 200 answer", async () => {
    const result = await probeModel("gpt-x", endpoint, { fetch: respond(200, '{"ok":true}'), timeoutMs: 1000 })
    expect(result.kind).toBe("ok")
    expect(result.status).toBe(200)
    expect(typeof result.latencyMs).toBe("number")
  })

  test("carries the provider reason for failures", async () => {
    const body = JSON.stringify({ error: { message: "Insufficient Balance" } })
    const result = await probeModel("gpt-x", endpoint, { fetch: respond(402, body), timeoutMs: 1000 })
    expect(result.kind).toBe("denied")
    expect(result.detail).toBe("Insufficient Balance")
  })

  test("treats a token-limit rejection as reachable, not denied", async () => {
    const body = JSON.stringify({
      error: {
        message:
          "Could not finish the message because max_tokens or model output limit was reached.",
      },
    })
    const result = await probeModel("gpt-5.5", endpoint, {
      fetch: respond(400, body),
      timeoutMs: 1000,
    })
    expect(result.kind).toBe("reachable")
    expect(result.status).toBe(400)
    expect(result.detail).toContain("max_tokens")
  })

  test("calls the chat endpoint with the bearer token and a small token budget", async () => {
    let seenURL = ""
    let seenInit: { headers: Record<string, string>; body: string | undefined } | undefined
    const fetch: FetchLike = async (url, init) => {
      seenURL = url
      seenInit = { headers: init.headers, body: init.body }
      return { status: 200, text: async () => "" }
    }
    await probeModel("glm-5.3", endpoint, { fetch, timeoutMs: 1000 })
    expect(seenURL).toBe("https://api.example.com/v1/chat/completions")
    expect(seenInit?.headers["authorization"]).toBe("Bearer sk-secret")
    expect(JSON.parse(seenInit?.body ?? "{}")).toMatchObject({
      model: "glm-5.3",
      max_tokens: PROBE_MAX_TOKENS,
      stream: false,
    })
  })

  test("reports network when the transport throws", async () => {
    const fetch: FetchLike = async () => {
      throw new Error("connection refused")
    }
    const result = await probeModel("gpt-x", endpoint, { fetch, timeoutMs: 1000 })
    expect(result.kind).toBe("network")
    expect(result.detail).toBe("connection refused")
  })

  test("reports a timeout when the request aborts", async () => {
    const fetch: FetchLike = async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const error = new Error("aborted")
          error.name = "AbortError"
          reject(error)
        })
      })
    const result = await probeModel("slow", endpoint, { fetch, timeoutMs: 5 })
    expect(result.kind).toBe("network")
    expect(result.detail).toBe("timeout")
  })
})

describe("probeAll", () => {
  test("keeps the input order", async () => {
    const results = await probeAll(["a", "b", "c"], endpoint, { fetch: respond(200), timeoutMs: 1000 }, 3)
    expect(results.map((result) => result.modelID)).toEqual(["a", "b", "c"])
  })
})

describe("isInsecure", () => {
  test("flags cleartext to a remote host", () => {
    expect(isInsecure({ baseURL: "http://api.example.com/v1", apiKey: "k" })).toBe(true)
  })

  test("allows https and loopback", () => {
    expect(isInsecure({ baseURL: "https://api.example.com/v1", apiKey: "k" })).toBe(false)
    expect(isInsecure({ baseURL: "http://localhost:11434/v1", apiKey: "k" })).toBe(false)
    expect(isInsecure({ baseURL: "http://127.0.0.1:8000/v1", apiKey: "k" })).toBe(false)
  })

  test("does not flag an unparseable URL", () => {
    expect(isInsecure({ baseURL: "not a url", apiKey: "k" })).toBe(false)
  })
})

describe("mapConcurrent", () => {
  test("never exceeds the limit and preserves order", async () => {
    let inFlight = 0
    let peak = 0
    const results = await mapConcurrent([1, 2, 3, 4, 5, 6], 2, async (item) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return item * 2
    })
    expect(peak).toBeLessThanOrEqual(2)
    expect(results).toEqual([2, 4, 6, 8, 10, 12])
  })

  test("handles an empty list", async () => {
    expect(await mapConcurrent([], 4, async (item) => item)).toEqual([])
  })
})
