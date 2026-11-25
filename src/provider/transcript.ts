/** Plaud's `get_transcript` pages: one block of segments, marks or outline topics at a time. */
import { isRecord, nonEmpty, unreadable } from "./client.js"

export const TRANSCRIPT_BLOCKS = ["transaction", "transaction_polish", "outline", "mark_memo"] as const
export type TranscriptBlock = (typeof TRANSCRIPT_BLOCKS)[number]

/** Plaud's largest `get_transcript` page, in segments; its default is 50. */
export const TRANSCRIPT_PAGE = 500

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

export type TranscriptPage =
  | { kind: "items"; utterances: Utterance[]; marks: Entry[]; outlines: Entry[]; count: number; nextCursor?: string }
  | { kind: "unavailable" }
  | { kind: "empty" }

/** The arguments of one `get_transcript` page, at the largest page size, so a long transcript takes a few reads. */
export function transcriptArgs(recordingId: string, block: TranscriptBlock, cursor?: string): Record<string, unknown> {
  return { file_id: recordingId, block, limit: TRANSCRIPT_PAGE, ...(cursor === undefined ? {} : { cursor }) }
}

/**
 * One `get_transcript` page: `{ segments, next_cursor, ... }`, or `marks` for the `mark_memo` block. Outside the paged
 * JSON the MCP answers in plain text: the block is not available, or it has no content yet. Any other text is block
 * content that is not JSON, kept as one utterance.
 */
export function transcriptPage(payload: unknown, block: TranscriptBlock): TranscriptPage {
  if (isRecord(payload)) {
    const items = transcriptItems(payload)
    if (items === undefined) {
      if (Object.keys(payload).length === 0) return { kind: "empty" }
      unreadable("a transcript page without a list of items")
    }
    return itemsPage(items, block, nonEmpty(payload["next_cursor"]))
  }
  if (typeof payload === "string") {
    const text = payload.trim()
    if (/^Block\s+".*"\s+not available for this recording/i.test(text)) return { kind: "unavailable" }
    if (text.length === 0 || /has no content for this recording|no highlight was recorded/i.test(text)) return { kind: "empty" }
    return itemsPage([payload], block)
  }
  unreadable("a transcript page of an unknown shape")
}

function transcriptItems(payload: Record<string, unknown>): unknown[] | undefined {
  for (const key of ["segments", "marks"] as const) {
    const value = payload[key]
    if (Array.isArray(value)) return value
  }
  return undefined
}

function itemsPage(items: readonly unknown[], block: TranscriptBlock, nextCursor?: string): TranscriptPage {
  const page = { kind: "items" as const, utterances: [] as Utterance[], marks: [] as Entry[], outlines: [] as Entry[] }
  if (block === "mark_memo") page.marks = items.map((item) => entry(item, "content"))
  else if (block === "outline") page.outlines = items.map((item) => entry(item, "topic"))
  else page.utterances = items.map(utterance)
  return { ...page, count: items.length, ...(nextCursor === undefined ? {} : { nextCursor }) }
}

/** A segment `{ start_time, end_time, content, speaker, ... }`. An item without text is kept as JSON, never dropped. */
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

/** An outline topic `{ start_time, end_time, topic }` or a highlight, read from `field`. */
function entry(item: unknown, field: "topic" | "content"): Entry {
  if (!isRecord(item)) return { text: json(item) }
  const startMs = milliseconds(item["start_time"])
  return { text: nonEmpty(item[field]) ?? json(item), ...(startMs === undefined ? {} : { startMs }) }
}

function milliseconds(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  const rounded = Math.round(value)
  return rounded >= 0 ? rounded : undefined
}

function json(value: unknown): string {
  if (typeof value === "string") return value
  return JSON.stringify(value) ?? String(value)
}
