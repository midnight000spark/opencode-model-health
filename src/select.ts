import { isRecord } from "./classify.js"
import type { Endpoint, ModelRef } from "./types.js"

/** `text` probes only pure-text models; `all` additionally probes VL/omni. */
export type ModelMode = "text" | "all"

const MEDIA_OUTPUTS = ["image", "video", "audio"] as const
const NON_CHAT_TYPES = ["image", "embedding"] as const

/**
 * Reads baseURL/apiKey from a provider payload. Accepts either a `ProviderInfo`
 * or an API envelope (`{ location, data }`) because the TUI feed and the HTTP
 * API wrap the same object differently. Only `baseURL` is required: local
 * OpenAI-compatible servers (Ollama, LM Studio, vLLM) often have no key.
 */
export function readEndpoint(source: unknown): Endpoint | undefined {
  const settings = readSettings(source)
  if (settings === undefined) return undefined
  const baseURL = settings["baseURL"]
  if (!isFilledString(baseURL)) return undefined
  const apiKey = settings["apiKey"]
  return isFilledString(apiKey) ? { baseURL, apiKey } : { baseURL }
}

/**
 * Chooses between the data-feed endpoint and the HTTP-client endpoint. A keyed
 * data record wins; otherwise a keyed client record is preferred, because the
 * data feed may omit or redact the key. Keyless results fall back to whichever
 * record exists.
 */
export function preferEndpoint(
  fromData?: Endpoint,
  fromClient?: Endpoint,
): Endpoint | undefined {
  if (fromData?.apiKey !== undefined) return fromData
  if (fromClient?.apiKey !== undefined) return fromClient
  return fromData ?? fromClient
}

/** Normalises raw model payloads (array or `{ data: [] }`) into refs of one provider. */
export function readModels(source: unknown, providerID: string): ModelRef[] {
  return toArray(source)
    .filter(isRecord)
    .filter((raw) => raw["providerID"] === providerID)
    .map(toModelRef)
    .filter((model): model is ModelRef => model !== undefined)
}

export function pickModels(models: readonly ModelRef[], mode: ModelMode): ModelRef[] {
  return models.filter((model) => canChat(model) && (mode === "all" || isTextOnly(model)))
}

/** True when a chat completion is a meaningful probe for this model. */
export function canChat(model: ModelRef): boolean {
  if (!model.outputs.includes("text")) return false
  const type = model.type ?? "chat"
  return !(NON_CHAT_TYPES as readonly string[]).includes(type)
}

/** True when the model produces nothing but text (no image/video/audio output). */
export function isTextOnly(model: ModelRef): boolean {
  return MEDIA_OUTPUTS.every((kind) => !model.outputs.includes(kind))
}

function readSettings(source: unknown): Record<string, unknown> | undefined {
  if (!isRecord(source)) return undefined
  const direct = source["settings"]
  if (isRecord(direct)) return direct
  const data = source["data"]
  if (isRecord(data) && isRecord(data["settings"])) return data["settings"]
  return undefined
}

function toArray(source: unknown): readonly unknown[] {
  if (Array.isArray(source)) return source
  if (isRecord(source) && Array.isArray(source["data"])) return source["data"]
  return []
}

function toModelRef(raw: Record<string, unknown>): ModelRef | undefined {
  const id = stringValue(raw["modelID"]) ?? stringValue(raw["id"])
  if (id === undefined) return undefined
  const name = stringValue(raw["name"]) ?? id
  const type = stringValue(raw["type"])
  if (type === undefined) return { id, name, outputs: readOutputs(raw["capabilities"]) }
  return { id, name, type, outputs: readOutputs(raw["capabilities"]) }
}

function readOutputs(capabilities: unknown): readonly string[] {
  if (!isRecord(capabilities)) return []
  const output = capabilities["output"]
  if (!Array.isArray(output)) return []
  return output.filter(isFilledString)
}

function stringValue(value: unknown): string | undefined {
  return isFilledString(value) ? value : undefined
}

function isFilledString(value: unknown): value is string {
  return typeof value === "string" && value !== ""
}
