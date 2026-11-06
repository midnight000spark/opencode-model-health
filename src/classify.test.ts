import { describe, expect, test } from "bun:test"
import { isRecord, isTokenLimit, kindOf, reason, truncate } from "./classify.js"

describe("kindOf", () => {
  test("maps 2xx to ok", () => {
    expect(kindOf(200)).toBe("ok")
    expect(kindOf(204)).toBe("ok")
  })

  test("maps missing models to missing", () => {
    expect(kindOf(404)).toBe("missing")
    expect(kindOf(410)).toBe("missing")
  })

  test("maps rate limits to quota", () => {
    expect(kindOf(429)).toBe("quota")
  })

  test("maps upstream failures to unavailable", () => {
    expect(kindOf(500)).toBe("unavailable")
    expect(kindOf(503)).toBe("unavailable")
  })

  test("maps auth, payment and bad requests to denied", () => {
    expect(kindOf(401)).toBe("denied")
    expect(kindOf(402)).toBe("denied")
    expect(kindOf(403)).toBe("denied")
    expect(kindOf(400)).toBe("denied")
  })

  test("treats a 400/422 token-limit body as reachable", () => {
    const body = JSON.stringify({
      error: {
        message: "Could not finish the message because max_tokens or model output limit was reached.",
      },
    })
    expect(kindOf(400, body)).toBe("reachable")
    expect(kindOf(422, "context length / token limit exceeded")).toBe("reachable")
  })

  test("never downgrades non-400/422 statuses even with a token-limit body", () => {
    expect(kindOf(500, "max_tokens limit")).toBe("unavailable")
    expect(kindOf(429, "max_tokens limit")).toBe("quota")
    expect(kindOf(403, "max_tokens limit")).toBe("denied")
  })

  test("keeps a plain 400 without a token-limit reason denied", () => {
    expect(kindOf(400, JSON.stringify({ error: { message: "invalid model" } }))).toBe("denied")
  })
})

describe("isTokenLimit", () => {
  test("matches the various provider wordings", () => {
    expect(isTokenLimit("max_tokens or model output limit was reached")).toBe(true)
    expect(isTokenLimit("max_completion_tokens is too small")).toBe(true)
    expect(isTokenLimit("token limit exceeded")).toBe(true)
    expect(isTokenLimit("Insufficient Balance")).toBe(false)
  })
})

describe("reason", () => {
  test("extracts error.message from an OpenAI-style body", () => {
    const body = JSON.stringify({ error: { message: "Incorrect API key provided.", type: "invalid_request_error" } })
    expect(reason(body)).toBe("Incorrect API key provided.")
  })

  test("extracts a top-level message", () => {
    expect(reason(JSON.stringify({ message: "No available channel" }))).toBe("No available channel")
  })

  test("falls back to the raw body when it is not JSON", () => {
    expect(reason("upstream is down")).toBe("upstream is down")
  })

  test("returns undefined for an empty body", () => {
    expect(reason("   ")).toBeUndefined()
  })

  test("collapses whitespace and truncates long messages", () => {
    const long = reason(` \n ${"x".repeat(300)} `)
    expect(long?.endsWith("…")).toBe(true)
    expect(long?.length).toBe(140)
  })

  test("masks credentials echoed inside the error body", () => {
    const body = JSON.stringify({ error: { message: "bad key sk-live-abcdef123456" } })
    expect(reason(body)).toBe("bad key sk-***")
  })

  test("returns undefined for a JSON body without a message", () => {
    expect(reason(JSON.stringify({ code: 500, upstream: "down" }))).toBeUndefined()
  })
})

describe("truncate", () => {
  test("keeps short text untouched", () => {
    expect(truncate("ok")).toBe("ok")
  })

  test("respects a custom limit", () => {
    expect(truncate("abcdef", 4)).toBe("abc…")
  })
})

describe("isRecord", () => {
  test("accepts objects and rejects null, arrays and primitives", () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord(null)).toBe(false)
    expect(isRecord([])).toBe(false)
    expect(isRecord("x")).toBe(false)
  })
})
