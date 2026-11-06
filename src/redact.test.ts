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

  test("masks key/value assignments", () => {
    expect(redact("api_key=abcdef123456 not accepted")).toBe("api_key=*** not accepted")
  })

  test("leaves ordinary prose and model names untouched", () => {
    expect(redact("Insufficient Balance for gpt-5.5")).toBe("Insufficient Balance for gpt-5.5")
  })
})
