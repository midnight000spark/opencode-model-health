import { DEFAULT_TTL_MS, isFresh, summarize, type Snapshot } from "./cache.js"
import { showHealth, type DialogUi } from "./dialog.js"
import { resolveModels } from "./discover.js"
import { progressLine } from "./format.js"
import { DEFAULT_CONCURRENCY, DEFAULT_TIMEOUT_MS, probeAll } from "./probe.js"
import type { Progress } from "./progress.js"
import { pickModels, type ModelMode } from "./select.js"
import type { Endpoint, FetchLike, ModelRef, ProbeResult } from "./types.js"

/** Example default; users are expected to override it via plugin options. */
export const DEFAULT_PROVIDER = "reformboss"

export interface Settings {
  readonly provider: string
  readonly mode: ModelMode
  readonly ttlMs: number
  readonly concurrency: number
  readonly timeoutMs: number
}

export interface Store {
  providers: Record<string, Snapshot | undefined>
}

/** Everything the check needs, gathered once per invocation by the host. */
export interface CheckDeps {
  readonly ui: DialogUi
  readonly progress: Progress
  readonly settings: Settings
  readonly store: Store
  readonly update: (mutation: (draft: Store) => void) => Promise<void>
  readonly endpoint: Endpoint
  /** Models configured in OpenCode, used to enrich names and as a fallback. */
  readonly configured: readonly ModelRef[]
  readonly http: FetchLike
}

interface Session extends CheckDeps {
  readonly models: readonly ModelRef[]
}

/**
 * Resolves the model list (provider first, config fallback) and runs the result
 * dialog. UI, progress and transport are injected, so the whole flow is testable
 * without the OpenCode host.
 */
export async function runCheck(deps: CheckDeps): Promise<void> {
  const { ui, progress, settings, endpoint, configured, http } = deps
  progress.set(0, 0, "получаю список моделей…")
  const resolved = await resolveModels(
    endpoint,
    { fetch: http, timeoutMs: settings.timeoutMs },
    configured,
  )
  if (resolved.source === "config") {
    ui.toast({
      message: "Список моделей от провайдера недоступен — беру конфиг OpenCode",
      variant: "warning",
      duration: 6000,
    })
  }
  const models = pickModels(resolved.models, "all")
  if (models.length === 0) {
    await ui.alert({
      title: "Нет моделей",
      message: `Провайдер «${settings.provider}» не отдал ни одной chat-модели.`,
    })
    return
  }
  await loop({ ...deps, models })
}

async function loop(session: Session): Promise<void> {
  let mode = session.settings.mode
  let force = false
  for (;;) {
    const snapshot = await snapshotFor(session, force)
    force = false
    const dismissed = session.progress.dismissed
    session.progress.end()
    // Respect a manual close: keep the (now cached) results but do not pop a dialog.
    if (dismissed) {
      const summary = summarize(snapshot.results)
      const suffix = summary.problems > 0 ? ` · ${summary.problems} проблем` : ""
      session.ui.toast({
        message: `Проверка завершена: ${summary.ok}/${summary.total} ✅${suffix}`,
        variant: "info",
        duration: 5000,
      })
      return
    }
    const intent = await showHealth(session.ui, {
      providerID: session.settings.provider,
      mode,
      models: session.models,
      results: snapshot.results,
      at: snapshot.at,
      now: Date.now(),
    })
    if (intent === "close") return
    if (intent === "toggle-mode") {
      mode = mode === "text" ? "all" : "text"
      continue
    }
    // A refresh must rescan even while the cached snapshot is still fresh.
    force = true
  }
}

/** Reuses the cached scan until it expires, is forced, or no longer covers these models. */
async function snapshotFor(session: Session, force = false): Promise<Snapshot> {
  const cached = session.store.providers[session.settings.provider]
  if (
    cached !== undefined &&
    isFresh(cached, Date.now(), session.settings.ttlMs, force) &&
    coversModels(cached.results, session.models)
  ) {
    return cached
  }
  session.progress.begin()
  session.progress.set(0, session.models.length, "проверяю…")
  const names = new Map(session.models.map((model) => [model.id, model.name]))
  const results = await probeAll(
    session.models.map((model) => model.id),
    session.endpoint,
    { fetch: session.http, timeoutMs: session.settings.timeoutMs },
    session.settings.concurrency,
    (event) => {
      session.progress.set(event.done, event.total)
      session.progress.push(progressLine(event.result, names.get(event.result.modelID)))
    },
  )
  const snapshot: Snapshot = { at: Date.now(), results }
  await session.update((draft) => {
    draft.providers[session.settings.provider] = snapshot
  })
  return snapshot
}

/**
 * True when the cached scan covers exactly the models about to be checked, so a
 * changed provider list (or config fallback) is never shown from stale results.
 */
function coversModels(results: readonly ProbeResult[], models: readonly ModelRef[]): boolean {
  if (results.length !== models.length) return false
  const ids = new Set(models.map((model) => model.id))
  return results.every((result) => ids.has(result.modelID))
}

export function readSettings(options: Readonly<Record<string, unknown>>): Settings {
  return {
    provider: stringOption(options["provider"]) ?? DEFAULT_PROVIDER,
    mode: options["mode"] === "all" ? "all" : "text",
    ttlMs: numberOption(options["ttlMs"]) ?? DEFAULT_TTL_MS,
    concurrency: numberOption(options["concurrency"]) ?? DEFAULT_CONCURRENCY,
    timeoutMs: numberOption(options["timeoutMs"]) ?? DEFAULT_TIMEOUT_MS,
  }
}

function stringOption(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

function numberOption(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}
