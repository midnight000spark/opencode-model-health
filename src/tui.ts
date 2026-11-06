import { Plugin } from "@opencode/plugin/tui"
import { type Settings, type Store, readSettings, runCheck } from "./check.js"
import { truncate } from "./classify.js"
import type { DialogUi } from "./dialog.js"
import { isInsecure } from "./probe.js"
import { createDialogProgress } from "./progress-view.js"
import { redact } from "./redact.js"
import { readEndpoint, readModels } from "./select.js"
import type { Endpoint, FetchLike } from "./types.js"

type Context = Plugin.Context

const COMMAND_ID = "model-health.check"

export default Plugin.define({
  id: "model-health",
  setup,
})

async function setup(context: Context): Promise<void> {
  const settings = readSettings(context.options)
  const [store, update] = context.storage.store<Store>("model-health", {
    initial: { providers: {} },
  })
  // One scan at a time: a second invocation would otherwise open a rival dialog.
  let active: Promise<void> | undefined
  context.keymap.layer(() => ({
    mode: "global",
    priority: 10,
    commands: [
      {
        id: COMMAND_ID,
        title: "Models: health check",
        description: `Проверить доступность моделей ${settings.provider}`,
        group: "Models",
        palette: true,
        slash: { name: "models-health" },
        bind: "<leader>mh",
        run: () => {
          if (active !== undefined) {
            context.ui.toast.show({
              message: "Проверка моделей уже выполняется…",
              variant: "warning",
              duration: 3000,
            })
            return
          }
          active = open(context, settings, store, update)
            .catch((error: unknown) => {
              const text = errorText(error)
              context.ui.toast.show({ message: `model-health: ${text}`, variant: "error", duration: 8000 })
            })
            .finally(() => {
              active = undefined
            })
          return active
        },
      },
    ],
    bindings: [COMMAND_ID],
  }))
}

async function open(
  context: Context,
  settings: Settings,
  store: Store,
  update: (mutation: (draft: Store) => void) => Promise<void>,
): Promise<void> {
  const ui = adapter(context)
  const progress = createDialogProgress(context.ui.dialog, context.theme, settings.provider)
  // Open the window before any I/O so the command always reacts instantly.
  progress.begin()
  try {
    const http = resolveFetch()
    if (http === undefined) {
      progress.end()
      ui.toast({ message: "fetch недоступен в этом рантайме", variant: "error" })
      return
    }
    progress.set(0, 0, "синхронизация…")
    await sync(context)
    const endpoint = await resolveEndpoint(context, settings.provider)
    if (endpoint === undefined) {
      progress.end()
      await ui.alert({
        title: "Провайдер недоступен",
        message: `Не удалось получить baseURL/apiKey для «${settings.provider}». Плагин работает с OpenAI-совместимыми провайдерами, у которых заданы baseURL и apiKey; проверь, что провайдер включён и ключ на месте.`,
      })
      return
    }
    if (isInsecure(endpoint)) {
      ui.toast({
        message: "baseURL без https — ключ уйдёт в открытом виде. Используй https или loopback.",
        variant: "warning",
        duration: 6000,
      })
    }
    const configured = readModels(context.data.location.model.list(), settings.provider)
    await runCheck({ ui, progress, settings, store, update, endpoint, configured, http })
  } finally {
    progress.end()
  }
}

async function sync(context: Context): Promise<void> {
  await Promise.all([
    context.data.location.provider.sync().catch(() => undefined),
    context.data.location.model.sync().catch(() => undefined),
  ])
}

/** Prefers the TUI data feed, falls back to the HTTP client. */
async function resolveEndpoint(context: Context, providerID: string): Promise<Endpoint | undefined> {
  const known = context.data.location.provider.list()?.find((provider) => provider.id === providerID)
  const fromData = readEndpoint(known)
  if (fromData !== undefined) return fromData
  const response = await context.client.provider.get({ providerID }).catch(() => undefined)
  return readEndpoint(response)
}

function adapter(context: Context): DialogUi {
  const dialog = context.ui.dialog
  return {
    select: (input) => dialog.select<string>(input),
    toast: (input) => context.ui.toast.show(input),
    alert: (input) => dialog.alert(input),
    clear: () => dialog.clear(),
  }
}

/** `fetch` lives on the runtime global; absence is reported instead of crashing. */
function resolveFetch(): FetchLike | undefined {
  const candidate = (globalThis as { fetch?: unknown }).fetch
  if (typeof candidate !== "function") return undefined
  return candidate as unknown as FetchLike
}

function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return truncate(redact(raw), 120)
}
