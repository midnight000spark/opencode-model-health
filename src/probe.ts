import { kindOf, reason, truncate } from "./classify.js"
import { joinURL, withBearer } from "./http.js"
import { redact } from "./redact.js"
import type { Endpoint, ModelRef, ProbeDeps, ProbeResult } from "./types.js"

const CHAT_PATH = "/chat/completions"
const PING = "ping"

/** Numbers are conservative: a health check must not look like load testing. */
export const DEFAULT_CONCURRENCY = 4
/** Slow reasoning models regularly need >20s before the first byte comes back. */
export const DEFAULT_TIMEOUT_MS = 30_000
/**
 * A single token makes reasoning models fail with a token-limit error before
 * they ever answer. 32 is still tiny but lets them complete the probe turn.
 */
export const PROBE_MAX_TOKENS = 32

/**
 * Sends the smallest possible chat request. A successful answer proves the key
 * is accepted for that specific model, which `GET /models` cannot tell us.
 */
export async function probeModel(
  modelID: string,
  endpoint: Endpoint,
  deps: ProbeDeps,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  // Do not even open a request for a scan that has already been cancelled.
  if (isAborted(signal)) return cancelled(modelID)
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs)
  const forwardAbort = () => controller.abort()
  if (isAborted(signal)) controller.abort()
  else signal?.addEventListener("abort", forwardAbort, { once: true })
  try {
    const response = await deps.fetch(joinURL(endpoint.baseURL, CHAT_PATH), {
      method: "POST",
      headers: headers(endpoint.apiKey),
      body: body(modelID),
      signal: controller.signal,
    })
    return await describe(modelID, response, started, endpoint.apiKey)
  } catch (error) {
    return {
      modelID,
      kind: "network",
      detail: failureText(error, endpoint.apiKey),
      latencyMs: Date.now() - started,
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", forwardAbort)
  }
}

/** Result for a model the probe protocol cannot speak; it is neither healthy nor broken. */
export function skippedResult(modelID: string): ProbeResult {
  return {
    modelID,
    kind: "skipped",
    detail: "модель обслуживается только через /responses",
    latencyMs: 0,
  }
}

export interface ProbeEvent {
  readonly result: ProbeResult
  readonly done: number
  readonly total: number
}

export async function probeAll(
  modelIDs: readonly string[],
  endpoint: Endpoint,
  deps: ProbeDeps,
  concurrency = DEFAULT_CONCURRENCY,
  onEvent?: (event: ProbeEvent) => void,
  signal?: AbortSignal,
): Promise<ProbeResult[]> {
  let done = 0
  return mapConcurrent(modelIDs, Math.max(1, concurrency), async (modelID) => {
    const result = await probeModel(modelID, endpoint, deps, signal)
    done += 1
    try {
      onEvent?.({ result, done, total: modelIDs.length })
    } catch {
      // A misbehaving UI callback must not abort the whole scan.
    }
    return result
  })
}

/**
 * Probes model refs rather than bare ids so models that only speak the
 * Responses API are reported as `skipped` instead of being called on a path
 * that cannot work for them.
 */
export async function probeModels(
  models: readonly ModelRef[],
  endpoint: Endpoint,
  deps: ProbeDeps,
  concurrency = DEFAULT_CONCURRENCY,
  onEvent?: (event: ProbeEvent) => void,
  signal?: AbortSignal,
): Promise<ProbeResult[]> {
  let done = 0
  return mapConcurrent(models, Math.max(1, concurrency), async (model) => {
    const result =
      model.protocol === "responses"
        ? skippedResult(model.id)
        : await probeModel(model.id, endpoint, deps, signal)
    done += 1
    try {
      onEvent?.({ result, done, total: models.length })
    } catch {
      // A misbehaving UI callback must not abort the whole scan.
    }
    return result
  })
}

/** Worker-pool map that keeps the input order and never exceeds `limit` in flight. */
export async function mapConcurrent<Item, Result>(
  items: readonly Item[],
  limit: number,
  run: (item: Item, index: number) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await run(items[index] as Item, index)
    }
  }
  const size = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: size }, worker))
  return results
}

async function describe(
  modelID: string,
  response: { readonly status: number; text(): Promise<string> },
  started: number,
  apiKey?: string,
): Promise<ProbeResult> {
  const latencyMs = Date.now() - started
  const text = await response.text().catch(() => "")
  const kind = kindOf(response.status, text)
  const detail = reason(text, apiKey)
  const base = { modelID, kind, status: response.status, latencyMs }
  return detail === undefined ? base : { ...base, detail }
}

function headers(apiKey?: string): Record<string, string> {
  const base = { "content-type": "application/json" }
  // No key means a local server: sending an empty `Bearer ` header is worse
  // than sending none, and some servers reject the request outright.
  return withBearer(base, apiKey)
}

function body(modelID: string): string {
  return JSON.stringify({
    model: modelID,
    messages: [{ role: "user", content: PING }],
    max_tokens: PROBE_MAX_TOKENS,
    stream: false,
  })
}

/**
 * True when the API key would travel in cleartext to a non-loopback host.
 * Loopback is allowed: local OpenAI-compatible servers commonly speak http.
 */
export function isInsecure(endpoint: Endpoint): boolean {
  // Without a key nothing secret leaves the machine, so cleartext to a local or
  // remote OpenAI-compatible server is not a credential leak.
  if (endpoint.apiKey === undefined || endpoint.apiKey === "") return false
  const url = parseURL(endpoint.baseURL)
  if (url === undefined || url.protocol !== "http:") return false
  return !isLoopbackURL(endpoint.baseURL)
}

/** True for `localhost`, `127.0.0.1`, `::1` and similar local bind addresses. */
export function isLoopbackURL(baseURL: string): boolean {
  const url = parseURL(baseURL)
  if (url === undefined) return false
  return LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
}

/** Cleartext is acceptable to a local server: `http://localhost:11434` is common. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0", "[::]"])

function parseURL(value: string): URL | undefined {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

/** Never leaks the key: only a redacted failure reason is reported. */
function failureText(error: unknown, apiKey?: string): string {
  // Check the name first: an aborted fetch rejects with a DOMException, which
  // is an Error on some runtimes and not on others.
  if (isNamed(error, "AbortError")) return "timeout"
  if (error instanceof Error) return truncate(redact(error.message, apiKey), 80)
  return "unknown error"
}

function cancelled(modelID: string): ProbeResult {
  return { modelID, kind: "network", detail: "timeout", latencyMs: 0 }
}

function isNamed(error: unknown, name: string): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === name
}

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true
}
