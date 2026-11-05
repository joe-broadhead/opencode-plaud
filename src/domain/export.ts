import { extname } from "node:path"
import { fail } from "./errors.js"
import type { Entry, NoteTab, RecordingMeta, Utterance } from "./normalize.js"
import type { PluginConfig, TranscriptBlock } from "./types.js"

/**
 * Pure export rules: the settings an export runs under, default file names
 * and Markdown rendering. The filesystem and network work is in
 * `src/host/tools/export.ts`.
 */

/** The options an export runs under. The first export root holds default destinations. */
export type ExportSettings = Pick<PluginConfig, "exportRoots" | "maxAudioBytes" | "exportTimeoutMs">

/**
 * The largest transcript or note an export writes, 25 MiB: a guard against a runaway, about 50 times the longest
 * transcript seen live (1,300 segments, about 0.5 MB as Markdown).
 */
export const MAX_TEXT_BYTES = 25 * 1024 ** 2

export const DEFAULT_TRANSCRIPT_BLOCK: TranscriptBlock = "transaction"

/** Plaud ids are opaque, untrusted strings: only a plain one becomes a file name. */
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
const AUDIO_EXTENSION = /^\.[A-Za-z0-9]{1,8}$/
const AUDIO_TYPES: Record<string, string> = {
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/ogg": ".ogg",
  "audio/opus": ".opus",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/webm": ".webm",
  "audio/flac": ".flac",
}

/**
 * `<recordingId>.<block>.md` for a transcript, so each block of a recording
 * has its own file; `<recordingId>.md` for a note; for audio `<recordingId>`
 * with the link's extension, then the content type's, then `.bin`.
 */
export function defaultFileName(recordingId: string, file: { readonly block: string } | { readonly audio: { url: URL; contentType: string | null } } | { readonly note: true }): string {
  if (!SAFE_FILE_NAME.test(recordingId)) {
    fail(
      "EXPORT_BAD_DESTINATION",
      "The recording id cannot be used as a file name.",
      "Pass an absolute destination file path inside an export root.",
    )
  }
  if ("block" in file) return `${recordingId}.${file.block}.md`
  return `${recordingId}${"audio" in file ? audioExtension(file.audio.url, file.audio.contentType) : ".md"}`
}

function audioExtension(url: URL, contentType: string | null): string {
  const fromUrl = extname(url.pathname)
  if (AUDIO_EXTENSION.test(fromUrl)) return fromUrl.toLowerCase()
  return AUDIO_TYPES[contentType?.split(";")[0]?.trim().toLowerCase() ?? ""] ?? ".bin"
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
 * Frontmatter, then the device highlights, the outline topics and one line
 * per utterance, each at its offset. Content is written verbatim as data.
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
  if (doc.utterances.length + doc.marks.length + doc.outlines.length === 0) {
    lines.push("_Plaud returned no content for this block._", "")
  }
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
