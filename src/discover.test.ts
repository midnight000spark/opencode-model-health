import { describe, expect, test } from "bun:test"
import { discoverModels, isChatModel, parseModels, resolveModels } from "./discover.js"
import type { Endpoint, FetchLike, HttpDeps, ModelRef } from "./types.js"

const endpoint: Endpoint = { baseURL: "https://api.test/v1", apiKey: "secret" }

function deps(fetch: FetchLike, timeoutMs = 1000): HttpDeps {
  return { fetch, timeoutMs }
}

function payload(data: readonly unknown[]): string {
  return JSON.stringify({ object: "list", data })
}

function chat(id: string, endpoints: readonly string[] = ["openai"]): unknown {
  return { id, object: "model", supported_endpoint_types: endpoints }
}

describe("parseModels", () => {
  test("keeps chat models and drops non-chat endpoint flags", () => {
    const text = payload([
      chat("gpt-5.4"),
      chat("gpt-image-2", ["image-generation", "openai"]),
      chat("gemini-only", ["gemini"]),
    ])
    expect(parseModels(text)).toEqual([
      { id: "gpt-5.4", name: "gpt-5.4", outputs: ["text"] },
    ])
  })

  test("keeps responses-only models, flagged as not probeable", () => {
    const text = payload([
      chat("resp-model", ["responses"]),
      chat("both", ["openai", "responses"]),
      chat("legacy", ["chat"]),
    ])
    expect(parseModels(text)).toEqual([
      { id: "both", name: "both", outputs: ["text"] },
      { id: "legacy", name: "legacy", outputs: ["text"] },
      { id: "resp-model", name: "resp-model", outputs: ["text"], protocol: "responses" },
    ])
  })

  test("treats openai-responses aliases as responses, not chat", () => {
    const text = payload([
      chat("a", ["openai-responses"]),
      chat("b", ["openai/responses"]),
      chat("c", ["openai", "openai/responses"]),
    ])
    expect(parseModels(text)).toEqual([
      { id: "a", name: "a", outputs: ["text"], protocol: "responses" },
      { id: "b", name: "b", outputs: ["text"], protocol: "responses" },
      { id: "c", name: "c", outputs: ["text"] },
    ])
  })

  test("prefers chat when the same id is listed under several protocols", () => {
    const text = payload([
      chat("m", ["responses"]),
      chat("m", ["openai"]),
    ])
    expect(parseModels(text)).toEqual([{ id: "m", name: "m", outputs: ["text"] }])
  })

  test("drops non-chat families by name", () => {
    const text = payload([
      chat("qwen3.7-text-embedding"),
      chat("qwen3.7-text-rerank"),
      chat("eleven-tts"),
      chat("qwen-audio-3.0-asr-flash"),
      chat("grok-image"),
      chat("flux"),
      chat("tongyi-tingwu-slp"),
      chat("unisound/unisound-u2"),
      chat("qwen3.6-27b"),
    ])
    expect(parseModels(text)?.map((model) => model.id)).toEqual(["qwen3.6-27b"])
  })

  test("drops gateway internals and pseudo ids", () => {
    const text = payload([
      chat("pre-mock_ptu_auth_v2_base"),
      chat("deepai-gemini"),
      chat("agent-tools"),
      chat("all"),
      chat("turbo"),
      chat("codestral-latest"),
      chat("auto"),
    ])
    expect(parseModels(text)?.map((model) => model.id)).toEqual(["auto", "codestral-latest"])
  })

  test("dedupes and sorts ids", () => {
    const text = payload([chat("b"), chat("a"), chat("a"), chat("c")])
    expect(parseModels(text)?.map((model) => model.id)).toEqual(["a", "b", "c"])
  })

  test("keeps models without endpoint metadata and skips id-less entries", () => {
    const text = payload([{ id: "mystery" }, { object: "model" }, chat("known")])
    expect(parseModels(text)?.map((model) => model.id)).toEqual(["known", "mystery"])
  })

  test("infers multimodal outputs from the id", () => {
    const text = payload([
      chat("Qwen2.5-VL-72B-Instruct"),
      chat("qwen3.5-omni-flash"),
      chat("meta/llama-3.2-11b-vision-instruct"),
      chat("plain-model"),
    ])
    expect(parseModels(text)).toEqual([
      { id: "Qwen2.5-VL-72B-Instruct", name: "Qwen2.5-VL-72B-Instruct", outputs: ["text", "image"] },
      { id: "meta/llama-3.2-11b-vision-instruct", name: "meta/llama-3.2-11b-vision-instruct", outputs: ["text", "image"] },
      { id: "plain-model", name: "plain-model", outputs: ["text"] },
      { id: "qwen3.5-omni-flash", name: "qwen3.5-omni-flash", outputs: ["text", "image", "audio"] },
    ])
  })

  test("returns undefined for unusable payloads", () => {
    expect(parseModels("not json")).toBeUndefined()
    expect(parseModels(JSON.stringify({ object: "list" }))).toBeUndefined()
    expect(parseModels("[]")).toBeUndefined()
  })

  test("returns an empty list when the provider lists nothing", () => {
    expect(parseModels(payload([]))).toEqual([])
  })
})

describe("isChatModel", () => {
  test("treats unknown endpoint metadata as chat", () => {
    expect(isChatModel({ id: "some-model", endpoints: [] })).toBe(true)
  })

  test("rejects media endpoints", () => {
    expect(isChatModel({ id: "sdxl", endpoints: ["image-generation", "openai"] })).toBe(false)
  })

  test("accepts alternate OpenAI endpoint names and rejects other vocabularies", () => {
    expect(isChatModel({ id: "m", endpoints: ["openai-completions"] })).toBe(true)
    expect(isChatModel({ id: "m", endpoints: ["chat"] })).toBe(true)
    expect(isChatModel({ id: "m", endpoints: ["responses"] })).toBe(true)
    expect(isChatModel({ id: "m", endpoints: ["gemini"] })).toBe(false)
  })
})

describe("discoverModels", () => {
  test("requests GET /models with a bearer token and no body", async () => {
    const calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = []
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, init })
      return { status: 200, text: async () => payload([chat("gpt-5.4")]) }
    }

    const models = await discoverModels(endpoint, deps(fetch))

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe("https://api.test/v1/models")
    expect(calls[0]?.init.method).toBe("GET")
    expect(calls[0]?.init.body).toBeUndefined()
    expect(calls[0]?.init.headers["authorization"]).toBe("Bearer secret")
    expect(models?.map((model) => model.id)).toEqual(["gpt-5.4"])
  })

  test("returns undefined on a non-2xx response", async () => {
    const fetch: FetchLike = async () => ({ status: 403, text: async () => "denied" })
    expect(await discoverModels(endpoint, deps(fetch))).toBeUndefined()
  })

  test("omits Authorization when no key is configured", async () => {
    const calls: Array<{ init: Parameters<FetchLike>[1] }> = []
    const fetch: FetchLike = async (_url, init) => {
      calls.push({ init })
      return { status: 200, text: async () => payload([chat("m")]) }
    }
    await discoverModels({ baseURL: "http://localhost:11434/v1" }, deps(fetch))
    expect(calls[0]?.init.headers["authorization"]).toBeUndefined()
    expect(calls[0]?.init.headers["accept"]).toBe("application/json")
  })

  test("returns undefined when the request throws", async () => {
    const fetch: FetchLike = async () => {
      throw new Error("network down")
    }
    expect(await discoverModels(endpoint, deps(fetch))).toBeUndefined()
  })

  test("returns undefined when the body cannot be parsed", async () => {
    const fetch: FetchLike = async () => ({ status: 200, text: async () => "<html/>" })
    expect(await discoverModels(endpoint, deps(fetch))).toBeUndefined()
  })
})

describe("resolveModels", () => {
  const configured: readonly ModelRef[] = [
    { id: "gpt-5.4", name: "GPT 5.4", type: "chat", outputs: ["text"] },
  ]

  test("uses the provider list and keeps configured names for known ids", async () => {
    const fetch: FetchLike = async () => ({
      status: 200,
      text: async () => payload([chat("gpt-5.4"), chat("brand-new-model")]),
    })

    const resolved = await resolveModels(endpoint, deps(fetch), configured)

    expect(resolved.source).toBe("provider")
    expect(resolved.models).toEqual([
      { id: "brand-new-model", name: "brand-new-model", outputs: ["text"] },
      { id: "gpt-5.4", name: "GPT 5.4", type: "chat", outputs: ["text"] },
    ])
  })

  test("keeps the discovered protocol when the id is also configured", async () => {
    const fetch: FetchLike = async () => ({
      status: 200,
      text: async () => payload([chat("gpt-5.4", ["responses"])]),
    })

    const resolved = await resolveModels(endpoint, deps(fetch), configured)

    expect(resolved.models[0]).toMatchObject({ id: "gpt-5.4", protocol: "responses" })
  })

  test("drops a configured responses guess when discovery reports chat", async () => {
    const guesses: readonly ModelRef[] = [
      { id: "gpt-5.4", name: "GPT 5.4", outputs: ["text"], protocol: "responses" },
    ]
    const fetch: FetchLike = async () => ({
      status: 200,
      text: async () => payload([chat("gpt-5.4", ["openai"])]),
    })

    const resolved = await resolveModels(endpoint, deps(fetch), guesses)

    expect(resolved.models[0]).toEqual({ id: "gpt-5.4", name: "GPT 5.4", outputs: ["text"] })
  })

  test("falls back to the configured list when discovery fails", async () => {
    const fetch: FetchLike = async () => {
      throw new Error("offline")
    }

    const resolved = await resolveModels(endpoint, deps(fetch), configured)

    expect(resolved.source).toBe("config")
    expect(resolved.models).toBe(configured)
  })

  test("falls back when the provider returns an empty list", async () => {
    const fetch: FetchLike = async () => ({ status: 200, text: async () => payload([]) })

    const resolved = await resolveModels(endpoint, deps(fetch), configured)

    expect(resolved.source).toBe("config")
    expect(resolved.models).toBe(configured)
  })
})
