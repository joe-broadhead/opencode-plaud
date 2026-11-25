/** Pure export rendering: default file names and the Markdown an export writes. */
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"
import type { RecordingMeta } from "../provider/recordings.js"
import type { Entry, TranscriptBlock, Utterance } from "../provider/transcript.js"
import type { NoteTab } from "../provider/note.js"

export const EXPORT_KINDS = ["audio", "transcript", "note"] as const
export type ExportKind = (typeof EXPORT_KINDS)[number]

export const DEFAULT_TRANSCRIPT_BLOCK: TranscriptBlock = "transaction"

/**
 * The largest transcript or note an export writes, 25 MiB: a guard against a runaway, about 50 times the longest
 * transcript seen live (1,300 segments, about 0.5 MB as Markdown).
 */
export const MAX_TEXT_BYTES = 25 * 1024 ** 2

/** Plaud ids are opaque, untrusted strings: only a plain one becomes a file name. */
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/

/**
 * `<recordingId>.<block>.md` for a transcript, so each block has its own file; `<recordingId>.md` for a note;
 * `<recordingId>.mp3` for audio, which Plaud serves as MP3.
 */
export function defaultFileName(recordingId: string, kind: ExportKind, block: TranscriptBlock = DEFAULT_TRANSCRIPT_BLOCK): string {
  if (!SAFE_FILE_NAME.test(recordingId)) {
    throw new SourceError({
      code: "INPUT_INVALID",
      what: "the recording id cannot be used as a file name",
      next: "Pass an absolute destination file path inside an export root.",
    })
  }
  if (kind === "transcript") return `${recordingId}.${block}.md`
  return kind === "note" ? `${recordingId}.md` : `${recordingId}.mp3`
}

interface TranscriptDocument {
  recording: RecordingMeta
  block: TranscriptBlock
  utterances: Utterance[]
  marks: Entry[]
  outlines: Entry[]
  exportedAt: Date
}

interface NoteDocument {
  recording: RecordingMeta
  tabs: NoteTab[]
  exportedAt: Date
}

/**
 * Frontmatter, then the device highlights, the outline topics and one line per utterance, each at its offset. Content
 * is written verbatim as data.
 */
export function renderTranscript(doc: TranscriptDocument): string {
  const lines = frontmatter(doc.recording, "transcript", doc.exportedAt, doc.block)
  lines.push("# Transcript", "")
  if (doc.marks.length > 0) {
    lines.push("## Highlights", "")
    for (const mark of doc.marks) lines.push(`- ${offset(mark.startMs)}${mark.text}`)
    lines.push("")
  }
  if (doc.outlines.length > 0) {
    lines.push("## Outline", "")
    for (const topic of doc.outlines) lines.push(`- ${offset(topic.startMs)}${topic.text}`)
    lines.push("")
  }
  if (doc.utterances.length > 0) {
    if (doc.marks.length > 0 || doc.outlines.length > 0) lines.push("## Utterances", "")
    for (const item of doc.utterances) {
      lines.push(`- ${offset(item.startMs)}${item.speaker === undefined ? "" : `${flatten(item.speaker)}: `}${item.text}`)
    }
    lines.push("")
  }
  if (doc.utterances.length + doc.marks.length + doc.outlines.length === 0) lines.push("_Plaud returned no content for this block._", "")
  return finish(lines)
}

/** Frontmatter, then one `## <tab>` section per note tab, body verbatim. */
export function renderNote(doc: NoteDocument): string {
  const lines = frontmatter(doc.recording, "note", doc.exportedAt)
  lines.push("# Note", "")
  if (doc.tabs.length === 0) lines.push("_Plaud returned no note tabs for this recording._", "")
  for (const tab of doc.tabs) {
    lines.push(`## ${flatten(tab.title) || "Untitled"}`, "")
    const body = tab.text.replace(/\r\n?/g, "\n").trimEnd()
    if (body.length > 0) lines.push(body, "")
    else if (tab.errorCode !== undefined) lines.push(`_Plaud could not load this tab (error code ${tab.errorCode})._`, "")
  }
  return finish(lines)
}

/** The machine's local calendar date the recording started, from a UTC ISO timestamp. */
function recordedOn(recording: RecordingMeta): string | undefined {
  const timestamp = recording.startedAt ?? recording.createdAt
  if (timestamp === undefined) return undefined
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return undefined
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function frontmatter(recording: RecordingMeta, kind: "transcript" | "note", exportedAt: Date, block?: TranscriptBlock): string[] {
  const entries: [string, string | number | undefined][] = [
    ["recording_id", JSON.stringify(recording.id)],
    // A JSON string is a valid YAML double-quoted scalar, newlines included.
    ["name", JSON.stringify(recording.name)],
    ["date", recordedOn(recording)],
    ["duration_ms", recording.durationMs],
    ["kind", kind],
    ["block", block],
    ["exported_at", exportedAt.toISOString()],
  ]
  return ["---", ...entries.flatMap(([key, value]) => (value === undefined ? [] : [`${key}: ${value}`])), "---", ""]
}

/** `[HH:MM:SS] ` for an offset in milliseconds; empty when Plaud gave none. */
function offset(startMs: number | undefined): string {
  if (startMs === undefined) return ""
  const total = Math.floor(startMs / 1000)
  return `[${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}] `
}

function flatten(value: string): string {
  return value.replace(/\s+/gu, " ").trim()
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

function finish(lines: string[]): string {
  while (lines.at(-1) === "") lines.pop()
  return `${lines.join("\n")}\n`
}
