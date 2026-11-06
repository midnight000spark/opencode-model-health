import { describe, expect, test } from "bun:test"
import { bar, createProgress, line, MAX_LINES, percent, type ProgressSignals } from "./progress.js"

function signals(done: number, total: number, note = "n"): ProgressSignals {
  return { done: () => done, total: () => total, note: () => note, lines: () => [] }
}

describe("bar", () => {
  test("fills proportionally", () => {
    expect(bar(0, 10, 10)).toBe("░".repeat(10))
    expect(bar(10, 10, 10)).toBe("█".repeat(10))
    expect(bar(5, 10, 10)).toBe("█".repeat(5) + "░".repeat(5))
  })

  test("clamps to the requested width", () => {
    expect(bar(999, 10, 10)).toBe("█".repeat(10))
    expect(bar(1, 3, 10)).toHaveLength(10)
    expect(bar(0, 0, 10)).toBe("░".repeat(10))
  })
})

describe("percent", () => {
  test("rounds and stays in range", () => {
    expect(percent(1, 3)).toBe(33)
    expect(percent(2, 3)).toBe(67)
    expect(percent(10, 10)).toBe(100)
    expect(percent(0, 0)).toBe(0)
  })
})

describe("line", () => {
  test("falls back to the note before the first result", () => {
    expect(line(signals(0, 0, "синхронизация…"))).toBe("синхронизация…")
  })

  test("shows the counter and percentage once probing starts", () => {
    expect(line(signals(5, 10))).toContain("5/10")
    expect(line(signals(5, 10))).toContain("50%")
  })
})

describe("createProgress", () => {
  test("opens once, reflects updates, closes once", () => {
    let opens = 0
    let clears = 0
    let render: (() => unknown) | undefined
    const progress = createProgress(
      {
        show: (next) => {
          opens += 1
          render = next
        },
        clear: () => {
          clears += 1
        },
      },
      (state) => () => ({
        done: state.done(),
        total: state.total(),
        note: state.note(),
        lines: state.lines(),
      }),
    )

    progress.begin()
    progress.begin()
    expect(opens).toBe(1)

    progress.set(3, 10, "проверяю…")
    progress.push("✅ a")
    progress.push("⛔ b")
    expect(render?.()).toEqual({
      done: 3,
      total: 10,
      note: "проверяю…",
      lines: ["✅ a", "⛔ b"],
    })

    progress.end()
    progress.end()
    expect(clears).toBe(1)
  })

  test("keeps only the newest rows and clears them on reopen", () => {
    let render: (() => { readonly lines: readonly string[] }) | undefined
    const progress = createProgress(
      {
        show: (next) => {
          render = next as () => { readonly lines: readonly string[] }
        },
        clear: () => undefined,
      },
      (state) => () => ({ lines: state.lines() }),
    )

    progress.begin()
    for (let index = 0; index < MAX_LINES + 5; index += 1) progress.push(`row ${index}`)
    const rows = render?.().lines ?? []
    expect(rows).toHaveLength(MAX_LINES)
    expect(rows[0]).toBe("row 5")
    expect(rows.at(-1)).toBe(`row ${MAX_LINES + 4}`)

    progress.end()
    progress.begin()
    expect(render?.().lines).toHaveLength(0)
  })

  test("stays closed once the user dismisses the dialog", () => {
    let opens = 0
    let onClose: (() => void) | undefined
    const progress = createProgress(
      {
        show: (_render, close) => {
          opens += 1
          onClose = close
        },
        clear: () => undefined,
      },
      () => () => ({}),
    )

    progress.begin()
    onClose?.()
    progress.begin()
    expect(progress.dismissed).toBe(true)
    expect(opens).toBe(1)
  })

  test("flags a user dismissal but not a programmatic close", () => {
    let closes = 0
    let onClose: (() => void) | undefined
    const progress = createProgress(
      {
        show: (_render, close) => {
          onClose = close
        },
        // Mirrors the host, which invokes onClose when the dialog is cleared.
        clear: () => {
          closes += 1
          onClose?.()
        },
      },
      () => () => ({}),
    )

    progress.begin()
    expect(progress.dismissed).toBe(false)
    onClose?.()
    expect(progress.dismissed).toBe(true)

    progress.end()
    expect(closes).toBe(0)
  })

  test("a programmatic end is not a dismissal", () => {
    let onClose: (() => void) | undefined
    const progress = createProgress(
      {
        show: (_render, close) => {
          onClose = close
        },
        clear: () => {
          onClose?.()
        },
      },
      () => () => ({}),
    )

    progress.begin()
    progress.end()
    expect(progress.dismissed).toBe(false)
  })
})
