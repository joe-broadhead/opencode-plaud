/** Plaud's `get_note` tabs: one per app tab, its content already resolved. */
import { isRecord, nonEmpty, unreadable } from "./client.js"
import { identifier } from "./recordings.js"

export interface NoteTab {
  kind: string
  title: string
  text: string
  /** `data_error_code` when the tab has no content and a non-zero code: Plaud could not load it. */
  errorCode?: number
}

/**
 * `get_note` returns a list with one entry per app tab, named by `data_tab_name` (or `data_title`), its link already
 * resolved into `data_content`. A tab with no content and a non-zero `data_error_code` could not be loaded; live,
 * loaded tabs carry a non-zero code too (10), so the content wins. An entry with neither still becomes a tab with empty
 * text rather than vanishing.
 */
export function noteTabs(payload: unknown): NoteTab[] {
  if (!Array.isArray(payload)) unreadable("a note that is not a list of tabs")
  return payload.map((item) => {
    if (!isRecord(item)) return { kind: "note", title: "Note", text: json(item) }
    const kind = identifier(item["data_type"]) ?? "note"
    const errorCode = item["data_error_code"]
    return {
      kind,
      title: nonEmpty(item["data_tab_name"]) ?? nonEmpty(item["data_title"]) ?? humanize(kind),
      text: nonEmpty(item["data_content"]) ?? "",
      ...(typeof errorCode === "number" && errorCode !== 0 ? { errorCode } : {}),
    }
  })
}

function json(value: unknown): string {
  if (typeof value === "string") return value
  return JSON.stringify(value) ?? String(value)
}

function humanize(kind: string): string {
  const words = kind.replace(/[_-]+/g, " ").trim()
  return words.length === 0 ? kind : `${words[0]!.toUpperCase()}${words.slice(1)}`
}
