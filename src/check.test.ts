import { describe, expect, test } from "bun:test"
import { fingerprint } from "./cache.js"
import { type Settings, type Store, runCheck, readSettings } from "./check.js"
import type { DialogUi } from "./dialog.js"
import type { Progress } from "./progress.js"
import type { Endpoint, FetchLike, ModelRef } from "./types.js"

const endpoint: Endpoint = { baseURL: "https://api.test/v1", apiKey: "secret" }
const credential = fingerprint("secret")

const settings: Settings = {
  provider: "p",
  mode: "text",
  ttlMs: 600_000,
  concurrency: 2,
  timeoutMs: 1000,
}

const configured: readonly ModelRef[] = [{ id: "cfg1", name: "Cfg 1", outputs: ["text"] }]

type SelectInput = Parameters<DialogUi["select"]>[0]

interface ProgressHandle {
  readonly progress: Progress
  readonly state: { begins: number; ends: number; lines: string[]; lastNote: string | undefined }
  dismiss(): void
}

function fakeProgress(): ProgressHandle {
  const state = { begins: 0, ends: 0, lines: [] as string[], lastNote: undefined as string | undefined }
  let closed = false
  const handlers = new Set<() => void>()
  const progress: Progress = {
    begin() {
      state.begins += 1
    },
    set(_done, _total, note) {
      if (note !== undefined) state.lastNote = note
    },
    push(line) {
      state.lines.push(line)
    },
    end() {
      state.ends += 1
    },
    onDismiss(handler) {
      if (closed) {
        handler()
        return () => undefined
      }
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
    get dismissed() {
      return closed
    },
  }
  const dismiss = () => {
    closed = true
    for (const handler of [...handlers]) handler()
  }
  return { progress, state, dismiss }
}

function fakeUi(behaviour: (input: SelectInput) => Promise<string | undefined>) {
  const record = {
    selects: [] as SelectInput[],
    toasts: [] as { message: string; variant?: string }[],
    alerts: [] as { title: string; message: string }[],
  }
  const ui: DialogUi = {
    async select(input) {
      record.selects.push(input)
      return behaviour(input)
    },
    toast(input) {
      record.toasts.push({ message: input.message, variant: input.variant })
    },
    async alert(input) {
      record.alerts.push(input)
    },
    clear() {},
  }
  return { ui, ...record }
}

/** Routes GET /models to `models`, everything else to a 200 answer. */
function httpFor(models: string, counters: { posts: number }): FetchLike {
  return async (url, init) => {
    if (url.endsWith("/models")) return { status: 200, text: async () => models }
    if (init.method === "POST") counters.posts += 1
    return { status: 200, text: async () => "" }
  }
}

function emptyStore(): Store {
  return { providers: {} }
}

const listOne = JSON.stringify({ data: [{ id: "m1", supported_endpoint_types: ["openai"] }] })
const listResponses = JSON.stringify({ data: [{ id: "m1", supported_endpoint_types: ["responses"] }] })

describe("readSettings", () => {
  test("applies defaults and coerces options", () => {
    expect(readSettings({})).toMatchObject({ provider: "reformboss", mode: "text", concurrency: 4 })
    expect(readSettings({ provider: "acme", mode: "all", ttlMs: 1, concurrency: 9, timeoutMs: 2 })).toEqual({
      provider: "acme",
      mode: "all",
      ttlMs: 1,
      concurrency: 9,
      timeoutMs: 2,
    })
  })
})

describe("runCheck", () => {
  test("warns and uses configured models when discovery fails", async () => {
    const handle = fakeProgress()
    const { ui, toasts } = fakeUi(async () => undefined)
    const counters = { posts: 0 }
    const http: FetchLike = async (url, init) => {
      if (url.endsWith("/models")) throw new Error("offline")
      if (init.method === "POST") counters.posts += 1
      return { status: 200, text: async () => "" }
    }
    const store = emptyStore()

    await runCheck({
      ui,
      progress: handle.progress,
      settings,
      store,
      update: async (mutation) => mutation(store),
      endpoint,
      configured,
      http,
    })

    expect(toasts.some((toast) => toast.variant === "warning")).toBe(true)
    expect(store.providers["p"]?.results.map((result) => result.modelID)).toEqual(["cfg1"])
  })

  test("uses the provider list without a fallback warning", async () => {
    const handle = fakeProgress()
    const { ui, toasts } = fakeUi(async () => undefined)
    const counters = { posts: 0 }
    const store = emptyStore()

    await runCheck({
      ui,
      progress: handle.progress,
      settings,
      store,
      update: async (mutation) => mutation(store),
      endpoint,
      configured,
      http: httpFor(listOne, counters),
    })

    expect(toasts.some((toast) => toast.variant === "warning")).toBe(false)
    expect(store.providers["p"]?.results.map((result) => result.modelID)).toEqual(["m1"])
  })

  test("alerts when nothing is left to check", async () => {
    const handle = fakeProgress()
    const { ui, alerts, selects } = fakeUi(async () => undefined)
    const counters = { posts: 0 }
    const store = emptyStore()

    await runCheck({
      ui,
      progress: handle.progress,
      settings,
      store,
      update: async (mutation) => mutation(store),
      endpoint,
      configured: [],
      http: httpFor(JSON.stringify({ data: [] }), counters),
    })

    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.title).toBe("Нет моделей")
    expect(selects).toHaveLength(0)
  })

  test("reuses a fresh cached snapshot without probing again", async () => {
    const handle = fakeProgress()
    const { ui } = fakeUi(async () => undefined)
    const counters = { posts: 0 }
    const store: Store = {
      providers: {
        p: {
          at: Date.now(),
          baseURL: endpoint.baseURL,
          credential,
          results: [{ modelID: "m1", kind: "ok", latencyMs: 1 }],
        },
      },
    }

    await runCheck({
      ui,
      progress: handle.progress,
      settings,
      store,
      update: async (mutation) => mutation(store),
      endpoint,
      configured,
      http: httpFor(listOne, counters),
    })

    expect(counters.posts).toBe(0)
  })

  test("rescans when the cached snapshot no longer covers the current models", async () => {
    const handle = fakeProgress()
    const { ui } = fakeUi(async () => undefined)
    const counters = { posts: 0 }
    const store: Store = {
      providers: {
        p: {
          at: Date.now(),
          baseURL: endpoint.baseURL,
          credential,
          results: [{ modelID: "old", kind: "ok", latencyMs: 1 }],
        },
      },
    }

    await runCheck({
      ui,
      progress: handle.progress,
      settings,
      store,
      update: async (mutation) => mutation(store),
      endpoint,
      configured,
      http: httpFor(listOne, counters),
    })

    expect(counters.posts).toBe(1)
    expect(store.providers["p"]?.results.map((result) => result.modelID)).toEqual(["m1"])
  })

  test("toggles mode and reopens the dialog without rescanning", async () => {
    const handle = fakeProgress()
    let calls = 0
    const { ui, selects } = fakeUi(async (input) => {
      calls += 1
      if (calls === 1) input.actions?.[1]?.onTrigger()
      return undefined
    })
    const counters = { posts: 0 }
    const store = emptyStore()

    await runCheck({
      ui,
      progress: handle.progress,
      settings,
      store,
      update: async (mutation) => mutation(store),
      endpoint,
      configured,
      http: httpFor(listOne, counters),
    })

    expect(selects).toHaveLength(2)
    expect(selects[1]?.title).toContain("все")
    expect(counters.posts).toBe(1)
  })

  test("rescans on a refresh intent", async () => {
    const handle = fakeProgress()
    let calls = 0
    const { ui } = fakeUi(async (input) => {
      calls += 1
      if (calls === 1) input.actions?.[0]?.onTrigger()
      return undefined
    })
    const counters = { posts: 0 }
    const store = emptyStore()

    await runCheck({
      ui,
      progress: handle.progress,
      settings,
      store,
      update: async (mutation) => mutation(store),
      endpoint,
      configured,
      http: httpFor(listOne, counters),
    })

    expect(counters.posts).toBe(2)
  })

  test("rescans when only the credential changed", async () => {
    const handle = fakeProgress()
    const { ui } = fakeUi(async () => undefined)
    const counters = { posts: 0 }
    const store: Store = {
      providers: {
        p: {
          at: Date.now(),
          baseURL: endpoint.baseURL,
          credential: fingerprint("old-key"),
          results: [{ modelID: "m1", kind: "ok", latencyMs: 1 }],
        },
      },
    }

    await runCheck({
      ui,
      progress: handle.progress,
      settings,
      store,
      update: async (mutation) => mutation(store),
      endpoint,
      configured,
      http: httpFor(listOne, counters),
    })

    expect(counters.posts).toBe(1)
  })

  test("rescans when a model switches to the responses protocol", async () => {
    const handle = fakeProgress()
    const { ui } = fakeUi(async () => undefined)
    const counters = { posts: 0 }
    const store: Store = {
      providers: {
        p: {
          at: Date.now(),
          baseURL: endpoint.baseURL,
          credential,
          results: [{ modelID: "m1", kind: "ok", latencyMs: 1 }],
        },
      },
    }

    await runCheck({
      ui,
      progress: handle.progress,
      settings,
      store,
      update: async (mutation) => mutation(store),
      endpoint,
      configured,
      http: httpFor(listResponses, counters),
    })

    expect(counters.posts).toBe(0)
    expect(store.providers["p"]?.results[0]?.kind).toBe("skipped")
  })

  test("does not show a warm cache after the progress window was dismissed", async () => {
    const handle = fakeProgress()
    handle.dismiss()
    const { ui, selects, toasts } = fakeUi(async () => undefined)
    const counters = { posts: 0 }
    const store: Store = {
      providers: {
        p: {
          at: Date.now(),
          baseURL: endpoint.baseURL,
          credential,
          results: [{ modelID: "m1", kind: "ok", latencyMs: 1 }],
        },
      },
    }

    await runCheck({
      ui,
      progress: handle.progress,
      settings,
      store,
      update: async (mutation) => mutation(store),
      endpoint,
      configured,
      http: httpFor(listOne, counters),
    })

    expect(counters.posts).toBe(0)
    expect(selects).toHaveLength(0)
    expect(toasts.some((toast) => toast.message === "Проверка отменена")).toBe(true)
  })

  test("drops the snapshot when a dismissal lands during the cache write", async () => {
    const handle = fakeProgress()
    const { ui, selects, toasts } = fakeUi(async () => undefined)
    const counters = { posts: 0 }
    const store = emptyStore()

    await runCheck({
      ui,
      progress: handle.progress,
      settings,
      store,
      update: async (mutation) => {
        mutation(store)
        handle.dismiss()
      },
      endpoint,
      configured,
      http: httpFor(listOne, counters),
    })

    expect(selects).toHaveLength(0)
    expect(toasts.some((toast) => toast.message === "Проверка отменена")).toBe(true)
    expect(store.providers["p"]).toBeUndefined()
  })

  test("restores the previous cache when a forced refresh is cancelled during the write", async () => {
    const handle = fakeProgress()
    let calls = 0
    const { ui, toasts } = fakeUi(async (input) => {
      calls += 1
      if (calls === 1) input.actions?.[0]?.onTrigger()
      return undefined
    })
    const counters = { posts: 0 }
    const previous = {
      at: Date.now() - 1_000,
      baseURL: endpoint.baseURL,
      credential,
      results: [{ modelID: "m1", kind: "ok" as const, latencyMs: 1 }],
    }
    const store: Store = { providers: { p: previous } }

    await runCheck({
      ui,
      progress: handle.progress,
      settings,
      store,
      update: async (mutation) => {
        mutation(store)
        handle.dismiss()
      },
      endpoint,
      configured,
      http: httpFor(listOne, counters),
    })

    expect(counters.posts).toBe(1)
    expect(toasts.some((toast) => toast.message === "Проверка отменена")).toBe(true)
    expect(store.providers["p"]).toEqual(previous)
  })

  test("returns a cancellation toast without I/O when the signal is already aborted", async () => {
    const handle = fakeProgress()
    const { ui, toasts, selects } = fakeUi(async () => undefined)
    const store = emptyStore()
    const controller = new AbortController()
    controller.abort()
    let calls = 0
    const http: FetchLike = async () => {
      calls += 1
      return { status: 200, text: async () => listOne }
    }

    await runCheck({
      ui,
      progress: handle.progress,
      settings,
      store,
      update: async (mutation) => mutation(store),
      endpoint,
      configured,
      http,
      signal: controller.signal,
    })

    expect(calls).toBe(0)
    expect(selects).toHaveLength(0)
    expect(toasts.some((toast) => toast.message === "Проверка отменена")).toBe(true)
  })

  test("cancels discovery without probing", async () => {
    const handle = fakeProgress()
    const { ui, toasts, selects } = fakeUi(async () => undefined)
    const store = emptyStore()
    const controller = new AbortController()
    let posts = 0
    const http: FetchLike = async (url, init) => {
      if (url.endsWith("/models")) {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const error = new Error("aborted")
            error.name = "AbortError"
            reject(error)
          })
          controller.abort()
        })
      }
      posts += 1
      return { status: 200, text: async () => "" }
    }

    await runCheck({
      ui,
      progress: handle.progress,
      settings,
      store,
      update: async (mutation) => mutation(store),
      endpoint,
      configured,
      http,
      signal: controller.signal,
    })

    expect(posts).toBe(0)
    expect(selects).toHaveLength(0)
    expect(toasts.some((toast) => toast.message === "Проверка отменена")).toBe(true)
  })

  test("cancels the scan and caches nothing when the progress window is dismissed", async () => {
    const handle = fakeProgress()
    const { ui, selects, toasts } = fakeUi(async () => undefined)
    const store = emptyStore()
    let posts = 0
    const http: FetchLike = async (url, init) => {
      if (url.endsWith("/models")) return { status: 200, text: async () => listOne }
      posts += 1
      if (init.signal?.aborted === true) return abort()
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(abortError()))
        // Simulate Esc while the first probe is in flight.
        handle.dismiss()
      })
    }

    await runCheck({
      ui,
      progress: handle.progress,
      settings,
      store,
      update: async (mutation) => mutation(store),
      endpoint,
      configured,
      http,
    })

    expect(posts).toBe(1)
    expect(selects).toHaveLength(0)
    expect(toasts.some((toast) => toast.message === "Проверка отменена")).toBe(true)
    expect(store.providers["p"]).toBeUndefined()
  })

  test("an already dismissed progress window never starts a scan", async () => {
    const handle = fakeProgress()
    handle.dismiss()
    const { ui, selects, toasts } = fakeUi(async () => undefined)
    const counters = { posts: 0 }
    const store = emptyStore()

    await runCheck({
      ui,
      progress: handle.progress,
      settings,
      store,
      update: async (mutation) => mutation(store),
      endpoint,
      configured,
      http: httpFor(listOne, counters),
    })

    expect(counters.posts).toBe(0)
    expect(selects).toHaveLength(0)
    expect(toasts.some((toast) => toast.message === "Проверка отменена")).toBe(true)
    expect(store.providers["p"]).toBeUndefined()
  })
})

function abortError(): Error {
  const error = new Error("aborted")
  error.name = "AbortError"
  return error
}

async function abort(): Promise<never> {
  throw abortError()
}
