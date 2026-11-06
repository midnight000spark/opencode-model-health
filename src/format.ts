import { agoLabel, type Summary } from "./cache.js"
import { truncate } from "./classify.js"
import type { ProbeKind, ProbeResult } from "./types.js"

/** One row of the health dialog. Mirrors the plugin dialog option shape. */
export interface HealthOption {
  readonly title: string
  readonly value: string
  readonly description?: string
  readonly category?: string
}

/** Max characters of a live progress row before it is ellipsised. */
const PROGRESS_LIMIT = 72

/** Problems first, healthy models last. */
const ORDER: readonly ProbeKind[] = [
  "denied",
  "quota",
  "unavailable",
  "network",
  "missing",
  "reachable",
  "ok",
]

const ICONS: Record<ProbeKind, string> = {
  ok: "✅",
  reachable: "🟢",
  denied: "⛔",
  quota: "⏳",
  missing: "❓",
  unavailable: "⚠️",
  network: "🌐",
}

const LABELS: Record<ProbeKind, string> = {
  ok: "работает",
  reachable: "отвечает (мал. лимит probe)",
  denied: "нет доступа",
  quota: "квота/лимит",
  missing: "нет модели",
  unavailable: "апстрим недоступен",
  network: "сеть/таймаут",
}

export function iconFor(kind: ProbeKind): string {
  return ICONS[kind]
}

export function labelFor(kind: ProbeKind): string {
  return LABELS[kind]
}

export function orderOf(kind: ProbeKind): number {
  const index = ORDER.indexOf(kind)
  return index === -1 ? ORDER.length : index
}

export function optionFor(result: ProbeResult, name: string): HealthOption {
  return {
    title: `${iconFor(result.kind)} ${name}`,
    value: result.modelID,
    description: describe(result),
    category: labelFor(result.kind),
  }
}

/** `нет доступа · HTTP 400 · arrearage · 210ms` */
export function describe(result: ProbeResult): string {
  const parts = [labelFor(result.kind)]
  if (result.status !== undefined) parts.push(`HTTP ${result.status}`)
  if (result.detail !== undefined) parts.push(result.detail)
  parts.push(`${result.latencyMs}ms`)
  return parts.join(" · ")
}

/** Title and multi-line body for the per-model detail alert. */
export interface Detail {
  readonly title: string
  readonly message: string
}

export function detailFor(result: ProbeResult, name: string): Detail {
  const lines = [`id: ${result.modelID}`, `статус: ${labelFor(result.kind)}`]
  if (result.status !== undefined) lines.push(`HTTP: ${result.status}`)
  if (result.detail !== undefined) lines.push(`причина: ${result.detail}`)
  lines.push(`задержка: ${result.latencyMs}ms`)
  return { title: `${iconFor(result.kind)} ${name}`, message: lines.join("\n") }
}

/** Compact one-liner for the live progress log: `✅ gpt-5.5 · работает · 210ms`. */
export function progressLine(result: ProbeResult, name = result.modelID, limit = PROGRESS_LIMIT): string {
  return truncate(`${iconFor(result.kind)} ${name} · ${describe(result)}`, limit)
}

/** `92/116 ✅ · 24 проблем · 5 мин назад` */
export function statusLine(summary: Summary, at: number, now: number): string {
  const parts = [`${summary.ok}/${summary.total} ✅`]
  if (summary.problems > 0) parts.push(`${summary.problems} проблем`)
  parts.push(agoLabel(at, now))
  return parts.join(" · ")
}
