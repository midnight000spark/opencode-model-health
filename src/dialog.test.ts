import { describe, expect, test } from "bun:test"
import { showHealth, type DialogUi, type HealthView } from "./dialog.js"
import type { HealthOption } from "./format.js"
import type { ModelRef, ProbeResult } from "./types.js"

interface SelectInput {
  readonly title: string
  readonly options: readonly HealthOption[]
  readonly actions?: readonly { bind: string; title: string; onTrigger: () => void }[]
  readonly search?: (query: string, options: readonly HealthOption[]) => readonly HealthOption[]
}

interface Fake {
  readonly ui: DialogUi
  readonly selects: SelectInput[]
  readonly toasts: { message: string; variant?: string }[]
  readonly alerts: { title: string; message: string }[]
  clears: number
}

/** `behaviour` decides how the dialog resolves; actions are triggered explicitly. */
function fakeUi(behaviour: (input: SelectInput, api: Fake) => Promise<string | undefined>): Fake {
  const fake = {
    selects: [] as SelectInput[],
    toasts: [] as { message: string; variant?: string }[],
    alerts: [] as { title: string; message: string }[],
    clears: 0,
  } as Fake
  const ui: DialogUi = {
    async select(input) {
      fake.selects.push(input)
      return behaviour(input, fake)
    },
    toast(input) {
      fake.toasts.push({ message: input.message, variant: input.variant ?? undefined })
    },
    async alert(input) {
      fake.alerts.push({ title: input.title, message: input.message })
    },
    clear() {
      fake.clears += 1
    },
  }
  return Object.assign(fake, { ui })
}

const models: readonly ModelRef[] = [
  { id: "glm-5.3", name: "GLM 5.3", outputs: ["text"] },
  { id: "vl-model", name: "VL Model", outputs: ["text", "image"] },
]

function probed(id: string, kind: ProbeResult["kind"], status?: number): ProbeResult {
  return status === undefined ? { modelID: id, kind, latencyMs: 10 } : { modelID: id, kind, status, latencyMs: 10 }
}

function view(overrides: Partial<HealthView> = {}): HealthView {
  return {
    providerID: "reformboss",
    mode: "text",
    models,
    results: [probed("glm-5.3", "ok", 200), probed("vl-model", "denied", 403)],
    at: 1_000,
    now: 1_000,
    ...overrides,
  }
}

describe("showHealth", () => {
  test("lists problems first and includes the summary in the title", async () => {
    const fake = fakeUi(async () => undefined)
    await showHealth(fake.ui, view({ mode: "all" }))
    const [input] = fake.selects
    expect(input?.title).toBe("reformboss · 1/2 ✅ · 1 проблем · только что · все")
    expect(input?.options.map((option) => option.value)).toEqual(["vl-model", "glm-5.3"])
    expect(input?.options[0]?.title).toBe("⛔ VL Model")
    expect(input?.options[0]?.description).toContain("HTTP 403")
  })

  test("text mode hides VL and omni models", async () => {
    const fake = fakeUi(async () => undefined)
    await showHealth(fake.ui, view({ mode: "text" }))
    expect(fake.selects[0]?.options.map((option) => option.value)).toEqual(["glm-5.3"])
  })

  test("counts reachable as healthy and renders it below problems", async () => {
    const three: readonly ModelRef[] = [
      { id: "ok-model", name: "OK", outputs: ["text"] },
      { id: "reach-model", name: "Reach", outputs: ["text"] },
      { id: "bad-model", name: "Bad", outputs: ["text"] },
    ]
    const fake = fakeUi(async () => undefined)
    await showHealth(
      fake.ui,
      view({
        mode: "text",
        models: three,
        results: [
          probed("ok-model", "ok", 200),
          probed("reach-model", "reachable", 400),
          probed("bad-model", "denied", 403),
        ],
      }),
    )
    const [input] = fake.selects
    expect(input?.options.map((option) => option.value)).toEqual([
      "bad-model",
      "reach-model",
      "ok-model",
    ])
    expect(input?.options[1]?.title).toBe("🟢 Reach")
    expect(input?.title).toContain("2/3 ✅")
  })

  test("closes on escape without a toast", async () => {
    const fake = fakeUi(async () => undefined)
    expect(await showHealth(fake.ui, view())).toBe("close")
    expect(fake.toasts).toEqual([])
  })

  test("opens the model details and returns to the list", async () => {
    let calls = 0
    const fake = fakeUi(async () => {
      calls += 1
      return calls === 1 ? "vl-model" : undefined
    })
    expect(await showHealth(fake.ui, view({ mode: "all" }))).toBe("close")
    expect(fake.selects).toHaveLength(2)
    expect(fake.alerts).toHaveLength(1)
    expect(fake.alerts[0]?.title).toContain("VL Model")
    expect(fake.alerts[0]?.message).toContain("id: vl-model")
    expect(fake.alerts[0]?.message).toContain("HTTP: 403")
    expect(fake.alerts[0]?.message).toContain("нет доступа")
    expect(fake.toasts).toEqual([])
  })

  test("summarizes only the models visible in the current mode", async () => {
    const fake = fakeUi(async () => undefined)
    await showHealth(fake.ui, view({ mode: "text" }))
    // vl-model is denied but hidden in text mode: the header must not count it.
    expect(fake.selects[0]?.title).toContain("1/1 ✅")
    expect(fake.selects[0]?.title).not.toContain("проблем")
  })

  test("asks for a refresh when the refresh action fires", async () => {
    const fake = fakeUi(async (input, api) => {
      input.actions?.[0]?.onTrigger()
      return undefined
    })
    expect(await showHealth(fake.ui, view())).toBe("refresh")
    expect(fake.clears).toBe(1)
  })

  test("asks to toggle the mode and labels the toggle for the current mode", async () => {
    const fake = fakeUi(async (input) => {
      expect(input.actions?.[1]?.title).toBe("Показать VL/omni")
      input.actions?.[1]?.onTrigger()
      return undefined
    })
    expect(await showHealth(fake.ui, view({ mode: "text" }))).toBe("toggle-mode")
  })

  test("alerts when the mode leaves nothing to show", async () => {
    const fake = fakeUi(async () => undefined)
    const only = view({ models: [models[1] as ModelRef], results: [probed("vl-model", "ok")], mode: "text" })
    expect(await showHealth(fake.ui, only)).toBe("close")
    expect(fake.alerts).toHaveLength(1)
    expect(fake.selects).toHaveLength(0)
  })
})
