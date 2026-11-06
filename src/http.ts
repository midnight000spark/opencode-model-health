/** Joins a base URL and an absolute path, collapsing the base's trailing slashes. */
export function joinURL(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, "")}${path}`
}
