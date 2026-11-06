/** Parses JSON, returning `undefined` instead of throwing on malformed input. */
export function parseJSON(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
