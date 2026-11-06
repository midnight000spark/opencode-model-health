/**
 * Masks credential-shaped fragments before provider text is shown, logged or
 * persisted. Provider error bodies occasionally echo the request, so a token
 * can end up inside a `detail` string; this keeps the "key is never shown"
 * guarantee true even for a misbehaving upstream.
 */

/**
 * `Bearer`, `Basic`, `Digest` and `Token` credentials. The scheme word is kept
 * (it is not a secret) and everything that follows on the same token is masked.
 */
const AUTH_SCHEME = /\b(Bearer|Basic|Digest|Token)\s+[A-Za-z0-9._~+/=-]+/gi
/** OpenAI-style secret keys, e.g. `sk-proj-abc123`. */
const SECRET_KEY = /\bsk-[A-Za-z0-9._-]{4,}/gi
/**
 * `scheme://user:password@host` credentials embedded in a URL. The password may
 * itself contain `@`, so the authority is matched greedily up to the *last* `@`
 * before the path or host.
 */
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^/\s@]*:[^/\s]*@/gi
/** `api_key=…`, `token: …`, `authorization=…` assignments (but not the schemes). */
const ASSIGNMENT =
  /\b(api[_-]?key|authorization|access[_-]?token|token)\b(\s*[:=]\s*)["']?(?!Bearer\b|Basic\b|Digest\b|Token\b)[A-Za-z0-9._~+/-]{4,}/gi

const RULES: readonly (readonly [RegExp, string])[] = [
  [AUTH_SCHEME, "$1 ***"],
  [URL_CREDENTIALS, "$1***:***@"],
  [SECRET_KEY, "sk-***"],
  [ASSIGNMENT, "$1$2***"],
]

/** Returns `text` with a literal key, bearer/basic/digest tokens, API keys and URL credentials masked. */
export function redact(text: string, secret?: string): string {
  // Replace the exact credential first: providers may echo a key in a shape the
  // patterns below do not recognise (a bare key, a custom prefix, a query value).
  // A non-empty secret is always removed, even a short one: over-redacting prose
  // is preferable to leaking a credential.
  const guarded = secret !== undefined && secret !== "" ? text.split(secret).join("***") : text
  return RULES.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), guarded)
}
