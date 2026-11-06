/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import { createProgress, line, type Progress, type ProgressSignals } from "./progress.js"

type Dialog = Plugin.Context["ui"]["dialog"]
type Theme = Plugin.Context["theme"]

/** Separates the model name from its details in a live progress row. */
const ROW_SEPARATOR = " · "

/**
 * Binds the generic progress controller to the OpenCode dialog and the terminal
 * view below. The render factory returns a fresh element per `begin()`.
 */
export function createDialogProgress(dialog: Dialog, theme: Theme, provider: string): Progress {
  return createProgress(dialog, (signals) => () => (
    <ProgressView provider={provider} theme={theme} signals={signals} />
  ))
}

function ProgressView(props: {
  readonly provider: string
  readonly theme: Theme
  readonly signals: ProgressSignals
}) {
  return (
    <box>
      <text>Проверка моделей {props.provider}</text>
      <text>{line(props.signals)}</text>
      {props.signals.lines().map((row) => {
        const [name, detail] = splitRow(row)
        return (
          <text>
            <span style={{ fg: props.theme.accent }}>{name}</span>
            <span style={{ fg: props.theme.textMuted }}>{detail}</span>
          </text>
        )
      })}
    </box>
  )
}

/** Splits `✅ gpt-5.5 · работает · 210ms` into a highlighted name and muted detail. */
function splitRow(row: string): readonly [string, string] {
  const at = row.indexOf(ROW_SEPARATOR)
  if (at === -1) return [row, ""]
  return [row.slice(0, at), row.slice(at)]
}
