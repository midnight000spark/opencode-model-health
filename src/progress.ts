import { createSignal, type Accessor } from "./signals.js"

/** Reactive values the progress view reads; accessors let Solid track updates. */
export interface ProgressSignals {
  readonly done: Accessor<number>
  readonly total: Accessor<number>
  readonly note: Accessor<string>
  readonly lines: Accessor<readonly string[]>
}

/** The narrow dialog surface the controller needs; satisfied by `context.ui.dialog`. */
export interface ProgressApi {
  show(render: () => unknown, onClose?: () => void): void
  clear(): void
}

/** Imperative handle to the live progress dialog. */
export interface Progress {
  /** Opens the dialog unless it is already visible. */
  begin(): void
  /** Updates the counter and, optionally, the phase note. */
  set(done: number, total: number, note?: string): void
  /** Appends one result row, keeping only the most recent lines. */
  push(line: string): void
  /** Closes the dialog if this controller still owns the visible one. */
  end(): void
  /** True once the user closed the dialog themselves rather than via `end()`. */
  readonly dismissed: boolean
}

/** Ribbon width of the textual progress bar. */
export const BAR_WIDTH = 28

/** How many recent result rows the dialog keeps on screen. */
export const MAX_LINES = 12

/**
 * Wraps a caller-supplied render factory in a begin/set/push/end controller.
 * Signals live here so one dialog instance updates in place instead of reopening.
 */
export function createProgress(
  api: ProgressApi,
  render: (signals: ProgressSignals) => () => unknown,
): Progress {
  const [done, setDone] = createSignal(0)
  const [total, setTotal] = createSignal(0)
  const [note, setNote] = createSignal("подготовка…")
  const [lines, setLines] = createSignal<readonly string[]>([])
  let visible = false
  let dismissed = false
  // Distinguishes our own `clear()` from the host closing the dialog on the user's behalf.
  let closing = false
  return {
    begin() {
      // Once the user has dismissed the window, never reopen it in this run.
      if (visible || dismissed) return
      visible = true
      setLines([])
      api.show(render({ done, total, note, lines }), () => {
        visible = false
        if (!closing) dismissed = true
      })
    },
    set(next, size, text) {
      setTotal(size)
      setDone(next)
      if (text !== undefined) setNote(text)
    },
    push(line) {
      setLines((current) => [...current, line].slice(-MAX_LINES))
    },
    end() {
      if (!visible) return
      visible = false
      closing = true
      api.clear()
      closing = false
    },
    get dismissed() {
      return dismissed
    },
  }
}

/** Renders the bar plus counter as `[███░░░] 12/104 12%`. */
export function line(signals: ProgressSignals): string {
  const total = signals.total()
  if (total === 0) return signals.note()
  const done = signals.done()
  return `${bar(done, total, BAR_WIDTH)}  ${done}/${total}  ${percent(done, total)}%`
}

/** A fixed-width bar; `filled` is clamped so rounding never overflows the width. */
export function bar(done: number, total: number, width: number): string {
  const filled = total === 0 ? 0 : Math.min(width, Math.round((done / total) * width))
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`
}

/** Whole-number completion, floored at 0 and capped at 100. */
export function percent(done: number, total: number): number {
  if (total === 0) return 0
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)))
}
