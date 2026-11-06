import { resultsByID, summarize } from "./cache.js"
import {
  detailFor,
  optionFor,
  orderOf,
  statusLine,
  type HealthOption,
} from "./format.js"
import { pickModels, type ModelMode } from "./select.js"
import type { ModelRef, ProbeResult } from "./types.js"

/**
 * The subset of the plugin dialog API this view needs. Keeping it narrow lets
 * the loop be tested with a fake UI and keeps `tui.ts` free of view logic.
 */
export interface DialogAction {
  readonly bind: string
  readonly title: string
  readonly side?: "left" | "right"
  readonly selection: "none"
  readonly onTrigger: () => void
}

export interface DialogUi {
  select(input: {
    readonly title: string
    readonly placeholder?: string
    readonly options: readonly HealthOption[]
    readonly search?: (
      query: string,
      options: readonly HealthOption[],
    ) => readonly HealthOption[]
    readonly actions?: readonly DialogAction[]
  }): Promise<string | undefined>
  toast(input: {
    readonly message: string
    readonly variant?: "info" | "success" | "warning" | "error"
    readonly duration?: number
  }): void
  alert(input: { readonly title: string; readonly message: string }): Promise<void>
  clear(): void
}

export type HealthIntent = "close" | "refresh" | "toggle-mode"

export interface HealthView {
  readonly providerID: string
  readonly mode: ModelMode
  /** Superset that was actually probed. */
  readonly models: readonly ModelRef[]
  readonly results: readonly ProbeResult[]
  readonly at: number
  readonly now: number
}

/** What one round of the list dialog resolved to. */
type Choice =
  | { readonly kind: "intent"; readonly intent: HealthIntent }
  | { readonly kind: "model"; readonly id: string }
  | { readonly kind: "close" }

/**
 * Shows the result list and loops until the user leaves it. Selecting a model
 * opens a detail alert and then returns to the list, so several models can be
 * inspected without restarting the check.
 */
export async function showHealth(ui: DialogUi, view: HealthView): Promise<HealthIntent> {
  for (;;) {
    const options = optionsFor(view)
    if (options.length === 0) {
      await ui.alert({
        title: "Нет моделей для проверки",
        message: `Провайдер ${view.providerID} не отдал ни одной chat-модели для режима «${view.mode}».`,
      })
      return "close"
    }
    const choice = await choose(ui, view, options)
    if (choice.kind === "close") return "close"
    if (choice.kind === "intent") return choice.intent
    await showDetail(ui, view, choice.id)
  }
}

async function choose(
  ui: DialogUi,
  view: HealthView,
  options: readonly HealthOption[],
): Promise<Choice> {
  let intent: HealthIntent | undefined
  const trigger = (next: HealthIntent) => () => {
    intent = next
    ui.clear()
  }
  const choice = await ui.select({
    title: title(view),
    placeholder: "фильтр по id или имени…",
    options,
    search: match,
    actions: [
      { bind: "ctrl+o", title: "Перепроверить", selection: "none", onTrigger: trigger("refresh") },
      { bind: "ctrl+y", title: toggleTitle(view.mode), selection: "none", onTrigger: trigger("toggle-mode") },
    ],
  })
  if (intent !== undefined) return { kind: "intent", intent }
  if (choice !== undefined) return { kind: "model", id: choice }
  return { kind: "close" }
}

async function showDetail(ui: DialogUi, view: HealthView, modelID: string): Promise<void> {
  const name = view.models.find((model) => model.id === modelID)?.name ?? modelID
  const result = resultsByID(view.results).get(modelID)
  if (result === undefined) {
    await ui.alert({ title: name, message: modelID })
    return
  }
  await ui.alert(detailFor(result, name))
}

function title(view: HealthView): string {
  const mode = view.mode === "text" ? "только текст" : "все"
  const summary = summarize(visibleResults(view))
  return `${view.providerID} · ${statusLine(summary, view.at, view.now)} · ${mode}`
}

function toggleTitle(mode: ModelMode): string {
  return mode === "text" ? "Показать VL/omni" : "Только текст"
}

/** Only the models the current mode actually lists. */
function visibleResults(view: HealthView): readonly ProbeResult[] {
  const ids = new Set(pickModels(view.models, view.mode).map((model) => model.id))
  return view.results.filter((result) => ids.has(result.modelID))
}

function optionsFor(view: HealthView): readonly HealthOption[] {
  const names = new Map(view.models.map((model) => [model.id, model.name]))
  const results = resultsByID(view.results)
  return pickModels(view.models, view.mode)
    .map((model) => results.get(model.id))
    .filter((result): result is ProbeResult => result !== undefined)
    .map((result) => ({
      option: optionFor(result, names.get(result.modelID) ?? result.modelID),
      kind: result.kind,
    }))
    .toSorted((left, right) => {
      const bySeverity = orderOf(left.kind) - orderOf(right.kind)
      return bySeverity === 0 ? left.option.value.localeCompare(right.option.value) : bySeverity
    })
    .map((entry) => entry.option)
}

function match(query: string, options: readonly HealthOption[]): readonly HealthOption[] {
  const needle = query.trim().toLowerCase()
  if (needle === "") return options
  return options.filter((option) =>
    `${option.title} ${option.value} ${option.description ?? ""}`.toLowerCase().includes(needle),
  )
}
