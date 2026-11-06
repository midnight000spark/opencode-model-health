import { isRecord } from "./classify.js"
import { joinURL, withBearer } from "./http.js"
import { parseJSON } from "./json.js"
import type { ChatProtocol, Endpoint, HttpDeps, ModelRef } from "./types.js"

const MODELS_PATH = "/models"

/** Chat models are served through the OpenAI-compatible API. */
const CHAT_ENDPOINT = "openai"
/** Other common names for an OpenAI-style chat endpoint. `responses` is *not* one. */
const CHAT_ENDPOINTS = new Set(["chat", "chat-completions", "completions"])
/** Flags for the newer Responses API, which this probe cannot speak. */
const RESPONSES_ENDPOINTS = new Set(["responses", "openai-responses", "responses-api"])
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
  readonly protocol: ChatProtocol
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
  // A cancelled scan must not start a request it will immediately throw away.
  if (deps.signal?.aborted === true) return undefined
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs)
  const forwardAbort = () => controller.abort()
  deps.signal?.addEventListener("abort", forwardAbort, { once: true })
  try {
    const response = await deps.fetch(joinURL(endpoint.baseURL, MODELS_PATH), {
      method: "GET",
      headers: withBearer({ accept: "application/json" }, endpoint.apiKey),
      signal: controller.signal,
    })
    if (response.status < 200 || response.status >= 300) return undefined
    return parseModels(await response.text().catch(() => ""))
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
    deps.signal?.removeEventListener("abort", forwardAbort)
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
  return {
    models: discovered.map((model) => {
      const match = known.get(model.id)
      if (match === undefined) return model
      // Discovery is authoritative for the protocol: a configured guess must not
      // keep claiming `responses` when the provider says chat (or vice versa).
      const { protocol: _configuredProtocol, ...withoutProtocol } = match
      return model.protocol === undefined
        ? withoutProtocol
        : { ...withoutProtocol, protocol: model.protocol }
    }),
    source: "provider",
  }
}

/** Parses an OpenAI-style `{ data: [...] }` payload into chat model refs. */
export function parseModels(text: string): ModelRef[] | undefined {
  const payload = parseJSON(text)
  if (!isRecord(payload)) return undefined
  const data = payload["data"]
  if (!Array.isArray(data)) return undefined
  const protocols = new Map<string, ChatProtocol>()
  for (const model of data
    .filter(isRecord)
    .map(toRaw)
    .filter((model): model is RawModel => model !== undefined)) {
    if (!isChatModel(model)) continue
    // Duplicate ids are possible when a gateway lists one model per endpoint;
    // `chat/completions` is the stronger claim, so it wins the dedupe.
    const seen = protocols.get(model.id)
    protocols.set(model.id, seen === "chat" ? "chat" : model.protocol)
  }
  return [...protocols.keys()].sort().map((id) => toRef(id, protocols.get(id) as ChatProtocol))
}

/** True when the entry is a text chat model rather than media/internal noise. */
export function isChatModel(model: { readonly id: string; readonly endpoints: readonly string[] }): boolean {
  if (protocolFor(model.endpoints) === undefined) return false
  const name = model.id.toLowerCase()
  if (NON_CHAT_NAMES.some((fragment) => name.includes(fragment))) return false
  if (INTERNAL_NAMES.some((fragment) => name.includes(fragment))) return false
  return !INTERNAL_IDS.has(name)
}

/**
 * Picks the protocol this probe can use. `responses`-only models are kept so the
 * dialog can list them as "not checked"; returning `undefined` means the model
 * does not fit the OpenAI-compatible surface at all.
 */
function protocolFor(endpoints: readonly string[]): ChatProtocol | undefined {
  // Missing metadata is not proof of incompatibility: assume the standard path.
  if (endpoints.length === 0) return "chat"
  // An explicit media flag always rules the model out.
  if (endpoints.some((endpoint) => NON_CHAT_ENDPOINTS.includes(endpoint))) return undefined
  if (endpoints.some(isChatEndpoint)) return "chat"
  if (endpoints.some(isResponsesEndpoint)) return "responses"
  return undefined
}

function isChatEndpoint(endpoint: string): boolean {
  // `openai-responses`, `openai/responses` and the like mention `openai` but
  // are not Chat Completions; the responses check must win.
  if (isResponsesEndpoint(endpoint)) return false
  const value = endpoint.toLowerCase()
  return value.includes(CHAT_ENDPOINT) || CHAT_ENDPOINTS.has(value)
}

function isResponsesEndpoint(endpoint: string): boolean {
  const value = endpoint.toLowerCase()
  return RESPONSES_ENDPOINTS.has(value) || value.includes("responses")
}

function toRaw(entry: Record<string, unknown>): RawModel | undefined {
  const id = typeof entry["id"] === "string" && entry["id"] !== "" ? entry["id"] : undefined
  if (id === undefined) return undefined
  const endpoints = readEndpoints(entry["supported_endpoint_types"])
  const protocol = protocolFor(endpoints)
  if (protocol === undefined) return undefined
  return { id, endpoints, protocol }
}

function readEndpoints(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function toRef(id: string, protocol: ChatProtocol): ModelRef {
  const base = { id, name: id, outputs: outputsFor(id) }
  return protocol === "chat" ? base : { ...base, protocol }
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
