import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { summarize } from "./cache.js"
import { resolveModels } from "./discover.js"
import { describe, iconFor, orderOf, summaryLine } from "./format.js"
import { DEFAULT_CONCURRENCY, DEFAULT_TIMEOUT_MS, probeModels } from "./probe.js"
import { redact } from "./redact.js"
import { pickModels, readEndpoint, readModels, type ModelMode } from "./select.js"
import type { FetchLike, ProbeResult } from "./types.js"

const exec = promisify(execFile)

export interface Args {
  readonly provider: string
  readonly mode: ModelMode
  readonly concurrency: number
  readonly timeoutMs: number
  readonly json: boolean
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv)
  const http = resolveFetch()
  const endpoint = readEndpoint(await api(`/api/provider/${args.provider}`))
  if (endpoint === undefined) {
    process.stderr.write(`Не удалось получить baseURL для «${args.provider}»\n`)
    return 2
  }
  try {
    const configured = readModels(await api("/api/model"), args.provider)
    const resolved = await resolveModels(
      endpoint,
      { fetch: http, timeoutMs: args.timeoutMs },
      configured,
    )
    if (resolved.source === "config") {
      process.stderr.write("Список моделей от провайдера недоступен — беру конфиг OpenCode\n")
    }
    const models = pickModels(resolved.models, args.mode)
    if (models.length === 0) {
      process.stderr.write(`Провайдер «${args.provider}» не отдал chat-моделей для режима ${args.mode}\n`)
      return 2
    }
    process.stderr.write(`Проверяю ${models.length} моделей ${args.provider} (режим ${args.mode})…\n`)
    const results = await probeModels(
      models,
      endpoint,
      { fetch: http, timeoutMs: args.timeoutMs },
      args.concurrency,
    )
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ provider: args.provider, results }, null, 2)}\n`)
      return 0
    }
    process.stdout.write(`${render(results)}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`${redact(errorMessage(error), endpoint.apiKey)}\n`)
    return 2
  }
}

export function render(results: readonly ProbeResult[]): string {
  const sorted = results.toSorted((left, right) => {
    const bySeverity = orderOf(left.kind) - orderOf(right.kind)
    return bySeverity === 0 ? left.modelID.localeCompare(right.modelID) : bySeverity
  })
  const width = sorted.reduce((max, result) => Math.max(max, result.modelID.length), 0)
  const rows = sorted.map(
    (result) => `${iconFor(result.kind)} ${result.modelID.padEnd(width)}  ${describe(result)}`,
  )
  const summary = summarize(results)
  const head = summaryLine(summary)
  return [head, "", ...rows].join("\n")
}

async function api(path: string): Promise<unknown> {
  let stdout: string
  try {
    ;({ stdout } = await exec("opencode", ["api", "get", path], { maxBuffer: 64 * 1024 * 1024 }))
  } catch {
    // Never embed child stderr: provider settings there can contain the key.
    throw new Error(`opencode api get ${path} завершился ошибкой`)
  }
  const start = stdout.indexOf("{")
  if (start === -1) throw new Error(`Пустой ответ на ${path}`)
  try {
    return JSON.parse(stdout.slice(start))
  } catch {
    throw new Error(`Некорректный JSON в ответе на ${path}`)
  }
}

export function parseArgs(argv: readonly string[]): Args {
  const read = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)
    return index === -1 ? undefined : argv[index + 1]
  }
  const number = (flag: string, fallback: number): number => {
    const raw = read(flag)
    if (raw === undefined) return fallback
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }
  return {
    provider: read("--provider") ?? "reformboss",
    mode: read("--mode") === "all" ? "all" : "text",
    concurrency: number("--concurrency", DEFAULT_CONCURRENCY),
    timeoutMs: number("--timeout", DEFAULT_TIMEOUT_MS),
    json: argv.includes("--json"),
  }
}

function resolveFetch(): FetchLike {
  const candidate = (globalThis as { fetch?: unknown }).fetch
  if (typeof candidate !== "function") throw new Error("fetch недоступен в этом рантайме")
  return candidate as unknown as FetchLike
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Only run when executed directly; importing this module (e.g. from tests) must
// not fire a network scan.
if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => {
      // Set the code instead of calling exit(): a hard exit can truncate stdout
      // before a large --json document has drained.
      process.exitCode = code
    })
    .catch((error: unknown) => {
      process.stderr.write(`${redact(errorMessage(error))}\n`)
      process.exitCode = 2
    })
}
