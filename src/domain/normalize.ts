import type { TranscriptBlock } from "./types.js"
import { fail, UNREADABLE_STEP } from "./errors.js"

/**
 * Everything this plugin knows about Plaud's MCP tools lives here: tool
 * names, arguments and result fields. Exports read them and render
 * Markdown; nothing else interprets Plaud data.
 *
 * Each reader maps the fields Plaud's hosted server returns and tolerates
 * missing optional ones. A payload it cannot read at all fails with
 * PLAUD_UNREADABLE rather than exporting a file that looks empty.
 *
 * Times: `duration`, `start_time` and `end_time` are milliseconds.
 */

export const PLAUD_TOOLS = { list: "list_files", file: "get_file", transcript: "get_transcript", note: "get_note" } as const

/** The `get_file` field holding the signed audio link, a credential valid for about 24 hours. */
export const AUDIO_URL_FIELD = "presigned_url"

/** The signed link to each source or note item in `get_file` (`source_list`, `note_list`) and `get_note`. */
export const DATA_LINK_FIELD = "data_link"

/** The arguments of `get_file` and `get_note`. */
export function fileArgs(recordingId: string): Record<string, unknown> {
  return { file_id: recordingId }
}

/** Plaud's largest `get_transcript` page, in segments; its default is 50. */
const TRANSCRIPT_PAGE = 500

/** The arguments of one `get_transcript` page, at the largest page size, so a long transcript takes a few reads. */
export function transcriptArgs(recordingId: string, block: TranscriptBlock, cursor?: string): Record<string, unknown> {
  return { file_id: recordingId, block, limit: TRANSCRIPT_PAGE, ...(cursor === undefined ? {} : { cursor }) }
}

export interface RecordingMeta {
  id: string
  name: string
  createdAt?: string
  startedAt?: string
  durationMs?: number
}

export interface Utterance {
  speaker?: string
  /** Offset inside the recording, in milliseconds. */
  startMs?: number
  text: string
}

/** A device highlight or an outline topic: one line of text at an offset. */
export interface Entry {
  startMs?: number
  text: string
}

export interface NoteTab {
  kind: string
  title: string
  text: string
  /** `data_error_code` when Plaud could not load the tab's content. */
  errorCode?: number
}


/**
 * Plaud wraps recording data in an envelope: a sentence that names a random
 * tag, then `<untrusted-user-data-<hex> source="plaud-recording">`, the
 * payload, the closing tag, and sometimes a note. Only the tag with
 * attributes opens the payload; the sentence names it bare.
 */
const ENVELOPE = /<(untrusted-user-data-[0-9a-z]+)\s[^>]*>\n?([\s\S]*?)\n?<\/\1>/

/** The payload inside Plaud's envelope, or the text itself when it has none. */
export function unwrap(text: string): string {
  return ENVELOPE.exec(text)?.[2] ?? text
}

/**
 * The data of a host MCP tool result. The host parses JSON text into
 * `output` when the server declares no output schema; anything still a
 * string is taken out of its envelope and parsed here when it looks like JSON.
 */
export function resultData(result: { readonly output?: unknown; readonly content?: unknown }): unknown {
  const value = result.output ?? contentText(result.content)
  if (typeof value !== "string") return value
  const inner = unwrap(value)
  const text = inner.trim()
  if (!text.startsWith("{") && !text.startsWith("[")) return inner
  try {
    return JSON.parse(text) as unknown
  } catch {
    return inner
  }
}

function contentText(content: unknown): string | undefined {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return undefined
  return content.flatMap((part) => (isRecord(part) && typeof part["text"] === "string" ? [part["text"]] : [])).join("\n")
}

/** Recording metadata for an export's frontmatter. Only the object shape is required. */
export function recordingMeta(payload: unknown, recordingId: string): RecordingMeta {
  if (!isRecord(payload)) {
    fail("PLAUD_UNREADABLE", `get_file returned ${describe(payload)} instead of a recording.`, UNREADABLE_STEP)
  }
  const createdAt = iso(payload["created_at"]) ?? iso(payload["start_at"])
  const startedAt = iso(payload["start_at"])
  const durationMs = milliseconds(payload["duration"])
  return {
    id: identifier(payload["id"]) ?? recordingId,
    name: nonEmpty(payload["name"]) ?? "",
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(durationMs === undefined ? {} : { durationMs }),
  }
}

/**
 * The recordings of a `list_files` payload, newest first as Plaud returns them:
 * `{ data: [...] }`, or the list itself. An entry without an id is skipped; a
 * payload with no list at all fails with PLAUD_UNREADABLE.
 */
export function recordingList(payload: unknown): RecordingMeta[] {
  const list = Array.isArray(payload) ? payload : isRecord(payload) ? payload["data"] : undefined
  if (!Array.isArray(list)) {
    fail("PLAUD_UNREADABLE", `list_files returned ${describe(payload)} instead of a list of recordings.`, UNREADABLE_STEP)
  }
  return list.flatMap((item) => {
    const id = isRecord(item) ? identifier(item["id"]) : undefined
    return id === undefined ? [] : [recordingMeta(item, id)]
  })
}

/** The signed audio link of a `get_file` payload, when Plaud has one. */
export function audioUrl(payload: unknown): string | undefined {
  return isRecord(payload) ? nonEmpty(payload[AUDIO_URL_FIELD]) : undefined
}

export type TranscriptPage =
  | { kind: "items"; utterances: Utterance[]; marks: Entry[]; outlines: Entry[]; count: number; nextCursor?: string }
  | { kind: "unavailable" }
  | { kind: "empty" }

/**
 * One `get_transcript` page: `{segments, next_cursor, ...}`, or `marks` for
 * the `mark_memo` block. Outside the paged JSON the MCP answers in plain
 * text: the block is not available, or it has no content yet. Any other text
 * is block content that is not JSON, kept as one utterance.
 */
export function transcriptPage(payload: unknown, block: TranscriptBlock): TranscriptPage {
  if (isRecord(payload)) {
    const items = transcriptItems(payload)
    if (items === undefined) {
      if (Object.keys(payload).length === 0) return { kind: "empty" }
      fail("PLAUD_UNREADABLE", "get_transcript returned no list of transcript items.", UNREADABLE_STEP)
    }
    return itemsPage(items, block, nonEmpty(payload["next_cursor"]))
  }
  if (typeof payload === "string") {
    const text = payload.trim()
    if (/^Block\s+".*"\s+not available for this recording/i.test(text)) return { kind: "unavailable" }
    if (text.length === 0 || /has no content for this recording|no highlight was recorded/i.test(text)) return { kind: "empty" }
    return itemsPage([payload], block)
  }
  fail("PLAUD_UNREADABLE", `get_transcript returned ${describe(payload)}.`, UNREADABLE_STEP)
}

function transcriptItems(payload: Record<string, unknown>): unknown[] | undefined {
  for (const key of ["segments", "marks"] as const) {
    const value = payload[key]
    if (Array.isArray(value)) return value
  }
  return undefined
}

function itemsPage(items: unknown[], block: TranscriptBlock, nextCursor?: string): TranscriptPage {
  const page = { kind: "items" as const, utterances: [] as Utterance[], marks: [] as Entry[], outlines: [] as Entry[] }
  if (block === "mark_memo") page.marks = items.map((item) => entry(item, "content"))
  else if (block === "outline") page.outlines = items.map((item) => entry(item, "topic"))
  else page.utterances = items.map(utterance)
  return { ...page, count: items.length, ...(nextCursor === undefined ? {} : { nextCursor }) }
}

/** A segment `{start_time, end_time, content, speaker, ...}`. An item without text is kept as JSON, never dropped. */
function utterance(item: unknown): Utterance {
  if (!isRecord(item)) return { text: json(item) }
  const speaker = nonEmpty(item["speaker"])
  const startMs = milliseconds(item["start_time"])
  return {
    text: nonEmpty(item["content"]) ?? json(item),
    ...(speaker === undefined ? {} : { speaker }),
    ...(startMs === undefined ? {} : { startMs }),
  }
}

/** An outline topic `{start_time, end_time, topic}` or a highlight, read from `field`. */
function entry(item: unknown, field: "topic" | "content"): Entry {
  if (!isRecord(item)) return { text: json(item) }
  const startMs = milliseconds(item["start_time"])
  return { text: nonEmpty(item[field]) ?? json(item), ...(startMs === undefined ? {} : { startMs }) }
}

/**
 * `get_note` returns a list with one entry per app tab, named by
 * `data_tab_name` (or `data_title`), its link already resolved into
 * `data_content`. A tab Plaud could not load has a non-zero
 * `data_error_code`. An entry with neither still becomes a tab with empty
 * text rather than vanishing.
 */
export function noteTabs(payload: unknown): NoteTab[] {
  if (!Array.isArray(payload)) {
    fail("PLAUD_UNREADABLE", `get_note returned ${describe(payload)} instead of a list of note tabs.`, UNREADABLE_STEP)
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function identifier(value: unknown): string | undefined {
  return nonEmpty(value)?.trim()
}

/** A non-negative whole number of milliseconds. */
function milliseconds(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  const rounded = Math.round(value)
  return rounded >= 0 ? rounded : undefined
}

/**
 * An ISO timestamp, normalised. Plaud sends UTC times with no zone, such as
 * `2026-10-31T14:05:00`, which `Date.parse` would read as the machine's local
 * time; a date-time with no zone gets `Z`, as Plaud's own server does.
 */
function iso(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined
  const text = value.trim()
  const parsed = Date.parse(/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text) ? `${text}Z` : text)
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString()
}

function json(value: unknown): string {
  if (typeof value === "string") return value
  return JSON.stringify(value) ?? String(value)
}

function humanize(kind: string): string {
  const words = kind.replace(/[_-]+/g, " ").trim()
  return words.length === 0 ? kind : `${words[0]!.toUpperCase()}${words.slice(1)}`
}

function describe(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "a list"
  return typeof value === "string" ? "text" : typeof value
}
