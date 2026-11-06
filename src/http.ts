/** Joins a base URL and an absolute path, collapsing the base's trailing slashes. */
export function joinURL(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, "")}${path}`
}

/**
 * Adds a bearer token only when one is configured. Local servers often reject
 * an empty `Authorization` header, so an absent/empty key must stay absent.
 */
export function withBearer(
  headers: Record<string, string>,
  apiKey?: string,
): Record<string, string> {
  if (apiKey === undefined || apiKey === "") return headers
  return { ...headers, authorization: `Bearer ${apiKey}` }
}
