/**
 * Masks credential-shaped fragments before provider text is shown, logged or
 * persisted. Provider error bodies occasionally echo the request, so a token
 * can end up inside a `detail` string; this keeps the "key is never shown"
 * guarantee true even for a misbehaving upstream.
 */

/** `Bearer <token>` / `authorization: <token>` headers. */
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi
/** OpenAI-style secret keys, e.g. `sk-proj-abc123`. */
const SECRET_KEY = /\bsk-[A-Za-z0-9._-]{4,}/gi
/** `scheme://user:password@host` credentials embedded in a URL. */
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+:[^/@\s]+@/gi
/** `api_key=…`, `token: …`, `authorization=…` assignments (but not `Bearer`). */
const ASSIGNMENT = /\b(api[_-]?key|authorization|access[_-]?token|token)\b(\s*[:=]\s*)["']?(?!Bearer\b)[A-Za-z0-9._~+/-]{4,}/gi

const RULES: readonly (readonly [RegExp, string])[] = [
  [BEARER, "Bearer ***"],
  [URL_CREDENTIALS, "$1***:***@"],
  [SECRET_KEY, "sk-***"],
  [ASSIGNMENT, "$1$2***"],
]

/** Returns `text` with bearer tokens, API keys and URL credentials masked. */
export function redact(text: string): string {
  return RULES.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text)
}
