import { parseJSON } from "./json.js"
import { redact } from "./redact.js"
import type { ProbeKind } from "./types.js"

const MESSAGE_LIMIT = 140

/**
 * Some providers reject the request because the model could not fit its answer
 * (or reasoning) into `max_tokens`. That is not an access problem: the model is
 * up and the key is accepted, only the probe budget was too small.
 */
const TOKEN_LIMIT = /max_tokens|max_completion|output limit|token limit/i

export function isTokenLimit(body: string): boolean {
  return TOKEN_LIMIT.test(body)
}

/** Maps an HTTP status (plus the error body) to the coarse state the dialog shows. */
export function kindOf(status: number, body = ""): ProbeKind {
  if (status >= 200 && status < 300) return "ok"
  if ((status === 400 || status === 422) && isTokenLimit(body)) return "reachable"
  if (status === 404 || status === 410) return "missing"
  if (status === 429) return "quota"
  if (status >= 500) return "unavailable"
  return "denied"
}

/**
 * Pulls a short, display-safe reason out of a provider error body. Plain-text
 * bodies are kept; a JSON body without a message yields `undefined` instead of
 * dumping the whole blob. Credential-shaped fragments are always masked.
 */
export function reason(body: string): string | undefined {
  const text = body.trim()
  if (text === "") return undefined
  const parsed = parseJSON(text)
  if (parsed === undefined) return truncate(redact(text))
  if (!isRecord(parsed)) return undefined
  const message = messageOf(parsed)
  return message === undefined ? undefined : truncate(redact(message))
}

export function truncate(text: string, limit = MESSAGE_LIMIT): string {
  const oneLine = text.replace(/\s+/g, " ").trim()
  if (oneLine.length <= limit) return oneLine
  return `${oneLine.slice(0, limit - 1)}…`
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function messageOf(parsed: Record<string, unknown>): string | undefined {
  const error = parsed["error"]
  if (isRecord(error) && typeof error["message"] === "string") return error["message"]
  if (typeof parsed["message"] === "string") return parsed["message"]
  return undefined
}
