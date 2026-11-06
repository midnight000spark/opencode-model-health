import { describe, expect, test } from "bun:test"
import { redact } from "./redact.js"

describe("redact", () => {
  test("masks bearer tokens", () => {
    expect(redact("Authorization: Bearer sk-proj-abc123 rejected")).toBe(
      "Authorization: Bearer *** rejected",
    )
  })

  test("masks standalone secret keys", () => {
    expect(redact("key sk-live-9f8e7d is invalid")).toBe("key sk-*** is invalid")
  })

  test("masks credentials embedded in a URL", () => {
    expect(redact("failed to reach https://user:hunter2@api.example.com/v1")).toBe(
      "failed to reach https://***:***@api.example.com/v1",
    )
  })

  test("masks a URL password that itself contains an @", () => {
    expect(redact("https://user:p@ss@api.example.com/v1")).toBe("https://***:***@api.example.com/v1")
  })

  test("masks Basic and Digest credentials, not just the scheme", () => {
    expect(redact("authorization: Basic dXNlcjpwYXNz")).toBe("authorization: Basic ***")
    const digest = redact("authorization: Digest abc123def456")
    expect(digest).toBe("authorization: Digest ***")
    expect(digest).not.toContain("abc123def456")
  })

  test("masks an authorization assignment that carries no scheme", () => {
    expect(redact("authorization=SECRET123")).toBe("authorization=***")
  })

  test("masks key/value assignments", () => {
    expect(redact("api_key=abcdef123456 not accepted")).toBe("api_key=*** not accepted")
  })

  test("leaves ordinary prose and model names untouched", () => {
    expect(redact("Insufficient Balance for gpt-5.5")).toBe("Insufficient Balance for gpt-5.5")
  })
})
