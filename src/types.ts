/** Shared types for the model-health probe. */

/**
 * Coarse outcome of probing one model. Two kinds are `neutral` rather than
 * healthy or broken:
 *
 * - `reachable`: the model answered but rejected the probe payload itself
 *   (e.g. a reasoning model that needs a bigger `max_tokens`) — the key works.
 * - `skipped`: the model is only served through a protocol this probe does not
 *   speak (currently `openai/responses`), so no verdict is possible.
 */
export type ProbeKind =
  | "ok"
  | "reachable"
  | "skipped"
  | "denied"
  | "quota"
  | "missing"
  | "unavailable"
  | "network"

/** Wire protocol a provider serves a chat model through. */
export type ChatProtocol = "chat" | "responses"

export interface ProbeResult {
  readonly modelID: string
  readonly kind: ProbeKind
  /** HTTP status when the provider answered at all. */
  readonly status?: number
  /** Short human-readable reason taken from the provider error body. */
  readonly detail?: string
  readonly latencyMs: number
}

/**
 * Everything needed to call an OpenAI-compatible endpoint. `apiKey` is optional:
 * local servers (Ollama, LM Studio, vLLM) usually accept unauthenticated calls,
 * and sending an `Authorization` header without a key would only break them.
 */
export interface Endpoint {
  readonly baseURL: string
  readonly apiKey?: string
}

/** A model as the health check sees it. */
export interface ModelRef {
  readonly id: string
  readonly name: string
  readonly type?: string
  readonly outputs: readonly string[]
  /** Omitted when the model speaks the default `chat/completions` protocol. */
  readonly protocol?: ChatProtocol
}

/** Minimal response shape so the probe does not depend on DOM types. */
export interface HttpResponseLike {
  readonly status: number
  text(): Promise<string>
}

export type FetchLike = (
  url: string,
  init: {
    readonly method: string
    readonly headers: Record<string, string>
    /** Omitted for bodyless requests such as `GET /models`. */
    readonly body?: string
    readonly signal?: AbortSignal
  },
) => Promise<HttpResponseLike>

/** Shared dependency bundle for an injected, timeout-bounded HTTP call. */
export interface HttpDeps {
  /** Injected so tests can run without network access. */
  readonly fetch: FetchLike
  readonly timeoutMs: number
  /** Aborts the request (discovery uses it when the progress window closes). */
  readonly signal?: AbortSignal
}

export type ProbeDeps = HttpDeps
