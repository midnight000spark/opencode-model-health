import {
  DEFAULT_TTL_MS,
  fingerprint,
  isFresh,
  sameEndpoint,
  type Snapshot,
} from "./cache.js"
import { showHealth, type DialogUi } from "./dialog.js"
import { resolveModels } from "./discover.js"
import { progressLine } from "./format.js"
import { DEFAULT_CONCURRENCY, DEFAULT_TIMEOUT_MS, probeModels } from "./probe.js"
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
    const outcome = await snapshotFor(session, force)
    force = false
    session.progress.end()
    // A dismissed progress window cancels the scan: report it and keep the
    // previous snapshot instead of showing results the user did not wait for.
    if (outcome.cancelled) {
      session.ui.toast({ message: "Проверка отменена", variant: "info", duration: 4000 })
      return
    }
    const snapshot = outcome.snapshot
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

type ScanOutcome =
  | { readonly cancelled: true }
  | { readonly cancelled: false; readonly snapshot: Snapshot }

/**
 * Reuses the cached scan until it expires, is forced, no longer covers these
 * models, or belongs to a different endpoint/credential. A user dismissal
 * aborts the in-flight scan and is reported as `cancelled` without caching.
 */
async function snapshotFor(session: Session, force = false): Promise<ScanOutcome> {
  const cached = session.store.providers[session.settings.provider]
  if (
    cached !== undefined &&
    isFresh(cached, Date.now(), session.settings.ttlMs, force) &&
    sameEndpoint(cached, session.endpoint) &&
    coversModels(cached.results, session.models)
  ) {
    // A dismissal that raced the lookup must not pop results anyway.
    if (session.progress.dismissed) return { cancelled: true }
    return { cancelled: false, snapshot: cached }
  }
  const controller = new AbortController()
  const off = session.progress.onDismiss(() => controller.abort())
  try {
    // Closing the progress window before the scan even starts must not fire it.
    if (controller.signal.aborted) return { cancelled: true }
    session.progress.begin()
    session.progress.set(0, session.models.length, "проверяю…")
    const names = new Map(session.models.map((model) => [model.id, model.name]))
    const results = await probeModels(
      session.models,
      session.endpoint,
      { fetch: session.http, timeoutMs: session.settings.timeoutMs },
      session.settings.concurrency,
      (event) => {
        session.progress.set(event.done, event.total)
        session.progress.push(progressLine(event.result, names.get(event.result.modelID)))
      },
      controller.signal,
    )
    if (controller.signal.aborted) return { cancelled: true }
    const snapshot: Snapshot = {
      at: Date.now(),
      baseURL: session.endpoint.baseURL,
      credential: fingerprint(session.endpoint.apiKey ?? ""),
      results,
    }
    await session.update((draft) => {
      draft.providers[session.settings.provider] = snapshot
    })
    // A dismissal that lands during the write must win: drop the fresh entry so
    // the next run cannot show results the user cancelled.
    if (controller.signal.aborted) {
      const previous =
        cached === undefined ? undefined : { ...cached, results: [...cached.results] }
      await session.update((draft) => {
        if (draft.providers[session.settings.provider]?.at === snapshot.at) {
          // Restore the pre-scan snapshot (usually undefined) instead of
          // destroying a cache the user already had. Copy it so a store proxy
          // is never written back as-is.
          draft.providers[session.settings.provider] = previous
        }
      })
      return { cancelled: true }
    }
    return { cancelled: false, snapshot }
  } finally {
    off()
  }
}

/**
 * True when the cached scan covers exactly the models about to be checked, so a
 * changed provider list (or config fallback) is never shown from stale results.
 * The protocol is part of the identity: a model that moved between chat and
 * responses must not reuse the previous verdict.
 */
function coversModels(results: readonly ProbeResult[], models: readonly ModelRef[]): boolean {
  if (results.length !== models.length) return false
  const protocols = new Map(models.map((model) => [model.id, model.protocol ?? "chat"]))
  return results.every((result) => {
    const protocol = protocols.get(result.modelID)
    if (protocol === undefined) return false
    return (protocol === "responses") === (result.kind === "skipped")
  })
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
