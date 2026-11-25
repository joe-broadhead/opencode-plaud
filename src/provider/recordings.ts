/** Plaud's recording payloads, read tolerantly. An answer the plugin cannot read is refused, never treated as empty. */
import { isRecord, nonEmpty, unreadable } from "./client.js"

/** The `get_file` field holding the signed audio link, a credential valid for about 24 hours. */
export const AUDIO_URL_FIELD = "presigned_url"

/** The signed link to each source or note item in `get_file` (`source_list`, `note_list`) and `get_note`. */
export const DATA_LINK_FIELD = "data_link"

export interface RecordingMeta {
  id: string
  name: string
  createdAt?: string
  startedAt?: string
  durationMs?: number
}

/** Recording metadata for an export's frontmatter. Only the object shape is required. */
export function recordingMeta(payload: unknown, recordingId: string): RecordingMeta {
  if (!isRecord(payload)) unreadable(`a recording`)
  const createdAt = iso(payload["created_at"]) ?? iso(payload["start_at"])
  const startedAt = iso(payload["start_at"])
  const durationMs = milliseconds(payload["duration"])
  return {
    id: identifier(payload["id"]) ?? recordingId,
    name: nonEmpty(payload["name"])?.replace(/\s+/g, " ").trim() ?? "",
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(durationMs === undefined ? {} : { durationMs }),
  }
}

/**
 * The recordings of a `list_files` payload, as Plaud returns them: `{ data: [...] }`, or the list itself. An entry
 * without an id is skipped; a payload with no list at all is refused.
 */
export function recordingList(payload: unknown): RecordingMeta[] {
  const list = Array.isArray(payload) ? payload : isRecord(payload) ? payload["data"] : undefined
  if (!Array.isArray(list)) unreadable("a list of recordings")
  return list.flatMap((item) => {
    const id = isRecord(item) ? identifier(item["id"]) : undefined
    return id === undefined ? [] : [recordingMeta(item, id)]
  })
}

/** The signed audio link of a `get_file` payload, when Plaud has one. */
export function audioUrl(payload: unknown): string | undefined {
  return isRecord(payload) ? nonEmpty(payload[AUDIO_URL_FIELD]) : undefined
}

/** A non-negative whole number of milliseconds. */
function milliseconds(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  const rounded = Math.round(value)
  return rounded >= 0 ? rounded : undefined
}

/**
 * An ISO timestamp, normalised. Plaud sends UTC times with no zone, such as `2026-10-31T14:05:00`, which `Date.parse`
 * would read as the machine's local time; a date-time with no zone gets `Z`, as Plaud's own server does.
 */
function iso(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined
  const text = value.trim()
  const parsed = Date.parse(/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text) ? `${text}Z` : text)
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString()
}

export function identifier(value: unknown): string | undefined {
  return nonEmpty(value)?.trim()
}
