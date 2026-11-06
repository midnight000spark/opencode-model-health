import { isRecord } from "./classify.js"
import { joinURL } from "./http.js"
import { parseJSON } from "./json.js"
import type { Endpoint, HttpDeps, ModelRef } from "./types.js"

const MODELS_PATH = "/models"

/** Chat models are served through the OpenAI-compatible API. */
const CHAT_ENDPOINT = "openai"
/** Other common names for an OpenAI-style chat endpoint. */
const CHAT_ENDPOINTS = new Set(["chat", "chat-completions", "completions", "responses"])
/** Gateway flags that announce media generation rather than text. */
const NON_CHAT_ENDPOINTS = ["image-generation"]

/** Name fragments that never answer a chat completion. */
const NON_CHAT_NAMES = [
  "embed",
  "rerank",
  "tts",
  "asr",
  "speech",
  "whisper",
  "audio",
  "image",
  "imagine",
  "flux",
  "gptimage",
  "dall",
  "video",
  "sora",
  "kling",
  "veo",
  "moderation",
  "ocr",
  "realtime",
  "voice",
  "tingwu",
  "unisound",
  "translat",
]

/** Gateway internals and test fixtures that are not real chat models. */
const INTERNAL_NAMES = ["mock", "deepai", "agent-tools"]

/** Exact ids the gateway exposes as pseudo-models. */
const INTERNAL_IDS = new Set(["all", "turbo"])

interface RawModel {
  readonly id: string
  readonly endpoints: readonly string[]
}

/**
 * Fetches the provider's `/models` list and keeps only chat-capable models.
 * Returns `undefined` when the list could not be fetched or parsed, so callers
 * fall back to their configured models instead of reporting a false outage.
 */
export async function discoverModels(
  endpoint: Endpoint,
  deps: HttpDeps,
): Promise<ModelRef[] | undefined> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs)
  try {
    const response = await deps.fetch(joinURL(endpoint.baseURL, MODELS_PATH), {
      method: "GET",
      headers: { authorization: `Bearer ${endpoint.apiKey}`, accept: "application/json" },
      signal: controller.signal,
    })
    if (response.status < 200 || response.status >= 300) return undefined
    return parseModels(await response.text().catch(() => ""))
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/** Where a resolved model list came from, so the caller can surface a fallback. */
export type ModelSource = "provider" | "config"

export interface ModelResolution {
  readonly models: readonly ModelRef[]
  readonly source: ModelSource
}

/**
 * Prefers the provider's own chat list and falls back to the configured models
 * when discovery fails or yields nothing usable. Known models keep their
 * configured name and capabilities; discovered-only models are used as-is.
 */
export async function resolveModels(
  endpoint: Endpoint,
  deps: HttpDeps,
  configured: readonly ModelRef[],
): Promise<ModelResolution> {
  const discovered = await discoverModels(endpoint, deps)
  // An empty list is treated as a discovery failure: a provider that answers
  // with no chat models is far more likely misconfigured than truly empty.
  if (discovered === undefined || discovered.length === 0) {
    return { models: configured, source: "config" }
  }
  const known = new Map(configured.map((model) => [model.id, model]))
  return { models: discovered.map((model) => known.get(model.id) ?? model), source: "provider" }
}

/** Parses an OpenAI-style `{ data: [...] }` payload into chat model refs. */
export function parseModels(text: string): ModelRef[] | undefined {
  const payload = parseJSON(text)
  if (!isRecord(payload)) return undefined
  const data = payload["data"]
  if (!Array.isArray(data)) return undefined
  const ids = data
    .filter(isRecord)
    .map(toRaw)
    .filter((model): model is RawModel => model !== undefined)
    .filter(isChatModel)
    .map((model) => model.id)
  return [...new Set(ids)].sort().map(toRef)
}

/** True when the entry is a text chat model rather than media/internal noise. */
export function isChatModel(model: { readonly id: string; readonly endpoints: readonly string[] }): boolean {
  if (!supportsChat(model.endpoints)) return false
  const name = model.id.toLowerCase()
  if (NON_CHAT_NAMES.some((fragment) => name.includes(fragment))) return false
  if (INTERNAL_NAMES.some((fragment) => name.includes(fragment))) return false
  return !INTERNAL_IDS.has(name)
}

function supportsChat(endpoints: readonly string[]): boolean {
  // Missing metadata is not proof of incompatibility: keep the model.
  if (endpoints.length === 0) return true
  // An explicit media flag always rules the model out.
  if (endpoints.some((endpoint) => NON_CHAT_ENDPOINTS.includes(endpoint))) return false
  // Otherwise require at least one chat-shaped endpoint; an unknown vocabulary
  // is dropped here, and the empty result triggers the config fallback.
  return endpoints.some(isChatEndpoint)
}

function isChatEndpoint(endpoint: string): boolean {
  const value = endpoint.toLowerCase()
  return value.includes(CHAT_ENDPOINT) || CHAT_ENDPOINTS.has(value)
}

function toRaw(entry: Record<string, unknown>): RawModel | undefined {
  const id = typeof entry["id"] === "string" && entry["id"] !== "" ? entry["id"] : undefined
  if (id === undefined) return undefined
  return { id, endpoints: readEndpoints(entry["supported_endpoint_types"]) }
}

function readEndpoints(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function toRef(id: string): ModelRef {
  return { id, name: id, outputs: outputsFor(id) }
}

/**
 * Discovery has no capability metadata, so media outputs are inferred from the
 * id. Only multimodal chat families survive the filter, so the check is small.
 */
function outputsFor(id: string): readonly string[] {
  const name = id.toLowerCase()
  if (hasMarker(name, "omni")) return ["text", "image", "audio"]
  if (hasMarker(name, "vision") || hasMarker(name, "vl")) return ["text", "image"]
  return ["text"]
}

/** Matches a marker on an id delimiter so `vl` does not hit inside another word. */
function hasMarker(name: string, marker: string): boolean {
  return name.split(/[-_./]/).includes(marker)
}
