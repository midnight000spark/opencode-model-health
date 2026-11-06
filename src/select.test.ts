import { describe, expect, test } from "bun:test"
import { canChat, isTextOnly, pickModels, readEndpoint, readModels } from "./select.js"
import type { ModelRef } from "./types.js"

const model = (id: string, outputs: readonly string[], type?: string): ModelRef =>
  type === undefined ? { id, name: id, outputs } : { id, name: id, type, outputs }

describe("readEndpoint", () => {
  test("reads settings from a ProviderInfo", () => {
    const provider = { id: "reformboss", settings: { baseURL: "https://api.reformboss.com/v1", apiKey: "sk-1" } }
    expect(readEndpoint(provider)).toEqual({ baseURL: "https://api.reformboss.com/v1", apiKey: "sk-1" })
  })

  test("reads settings from an API envelope", () => {
    const envelope = { location: {}, data: { settings: { baseURL: "https://x/v1", apiKey: "sk-2" } } }
    expect(readEndpoint(envelope)?.apiKey).toBe("sk-2")
  })

  test("returns undefined when the key or url is missing", () => {
    expect(readEndpoint({ settings: { baseURL: "https://x/v1" } })).toBeUndefined()
    expect(readEndpoint({ settings: { apiKey: "sk-1" } })).toBeUndefined()
    expect(readEndpoint({ settings: { baseURL: "", apiKey: "sk-1" } })).toBeUndefined()
    expect(readEndpoint(undefined)).toBeUndefined()
  })
})

describe("readModels", () => {
  const payload = {
    data: [
      { id: "glm-5.3", modelID: "glm-5.3", providerID: "reformboss", name: "GLM 5.3", type: "chat", capabilities: { output: ["text"] } },
      { id: "other", modelID: "other", providerID: "openrouter", name: "Other", capabilities: { output: ["text"] } },
      { modelID: "no-capabilities", providerID: "reformboss" },
    ],
  }

  test("keeps only the requested provider", () => {
    expect(readModels(payload, "reformboss").map((m) => m.id)).toEqual(["glm-5.3", "no-capabilities"])
  })

  test("defaults the name to the id and unknown outputs to empty", () => {
    const [without] = readModels(payload, "reformboss").filter((m) => m.id === "no-capabilities")
    expect(without?.name).toBe("no-capabilities")
    expect(without?.outputs).toEqual([])
  })

  test("tolerates a bare array and junk entries", () => {
    expect(readModels([null, 42, { modelID: "a", providerID: "p", capabilities: { output: ["text"] } }], "p")).toHaveLength(1)
  })
})

describe("pickModels", () => {
  const models = [
    model("text-only", ["text"]),
    model("vl", ["text", "image"]),
    model("omni", ["text", "audio"]),
    model("image-gen", ["image"], "image"),
    model("embedder", ["text"], "embedding"),
    model("video-gen", ["video"]),
  ]

  test("canChat requires text output and a chat type", () => {
    expect(canChat(model("a", ["text"]))).toBe(true)
    expect(canChat(model("b", ["image"]))).toBe(false)
    expect(canChat(model("c", ["text"], "image"))).toBe(false)
    expect(canChat(model("d", ["text"], "embedding"))).toBe(false)
  })

  test("isTextOnly rejects any media output", () => {
    expect(isTextOnly(model("a", ["text"]))).toBe(true)
    expect(isTextOnly(model("b", ["text", "image"]))).toBe(false)
    expect(isTextOnly(model("c", ["text", "audio"]))).toBe(false)
  })

  test("text mode keeps only pure-text chat models", () => {
    expect(pickModels(models, "text").map((m) => m.id)).toEqual(["text-only"])
  })

  test("all mode keeps VL and omni but still drops generators and embedders", () => {
    expect(pickModels(models, "all").map((m) => m.id)).toEqual(["text-only", "vl", "omni"])
  })
})
