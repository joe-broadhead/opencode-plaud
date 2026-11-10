import { isAbsolute } from "node:path"
import * as z from "zod"
import { EXPORT_KINDS, TRANSCRIPT_BLOCKS } from "../types.js"

/**
 * The contracts of the plugin's own tools, `plaud_export` and `plaud_recent`. The schemas go to
 * the host as they are, so validation, the JSON Schema the model sees and the
 * TypeScript types all come from here.
 */

/** `accounts` lists the configured account names, the default account first. */
export function exportInput(accounts: readonly [string, ...string[]]) {
  return z
    .strictObject({
      account: z
        .enum(accounts)
        .optional()
        .describe(`Account to export from; defaults to "${accounts[0]}"`),
      ...EXPORT_BODY,
    })
    .refine(transcriptOnlyBlock, {
      message: "block is only valid for kind transcript",
      path: ["block"],
    })
}

/** The export's fields other than `account`, which the tools RPC's envelope carries. */
const EXPORT_BODY = {
  recordingId: z.string().min(1).max(200).describe("Plaud recording id: list_files' or recent's id"),
  kind: z.enum(EXPORT_KINDS).describe("audio: the recording's audio file; transcript or note: a Markdown file"),
  block: z
    .enum(TRANSCRIPT_BLOCKS)
    .optional()
    .describe(
      "Transcript block, only for kind transcript: transaction (raw, the default), transaction_polish (cleaned), " +
        "outline, or mark_memo (moments flagged on the device)",
    ),
  destination: z
    .string()
    .refine((value) => isAbsolute(value), { message: "must be an absolute path" })
    .optional()
    .describe(
      "Absolute file path inside an export root (~ is not expanded); defaults to <first export root>/<kind>/<recordingId>.<ext>, and for a transcript to <first export root>/transcript/<recordingId>.<block>.md",
    ),
  overwrite: z.boolean().optional().describe("Replace an existing file at the destination; off by default"),
} as const

const transcriptOnlyBlock = (value: { kind: string; block?: string }) => value.kind === "transcript" || value.block === undefined

export type ExportRequest = z.output<ReturnType<typeof exportInput>>

export const ExportOutput = z.strictObject({
  path: z.string().describe("Absolute path of the written file"),
  bytes: z.number().int().nonnegative().describe("Size of the written file in bytes"),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).describe("SHA-256 of the written file, lowercase hex"),
})

export type ExportResult = z.output<typeof ExportOutput>

const recentLimit = z.number().int().min(1).max(20).optional().describe("How many recordings, newest first; 8 by default")

/** The contract of `plaud_recent`: the newest recordings, one line each. */
export function recentInput(accounts: readonly [string, ...string[]]) {
  return z.strictObject({
    account: z
      .enum(accounts)
      .optional()
      .describe(`Account to read; defaults to "${accounts[0]}"`),
    limit: recentLimit,
  })
}

export type RecentRequest = z.output<ReturnType<typeof recentInput>>

/** The tools RPC's `recent` method: the tool's input without `account`, which comes from the envelope. */
export const RecentMethodInput = z.strictObject({ limit: recentLimit })

/**
 * Shaped as a Home `list` (items of at most 200 characters, not editable), so
 * a Home feed can show it as it is.
 */
export const RecentOutput = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(128).describe("The recording's id: file_id for get_note and get_transcript, recordingId for export"),
        text: z.string().min(1).max(200),
      }),
    )
    .max(20)
    .describe("One line per recording: its title, when it started and how long it is"),
  editable: z.literal(false),
})

export type RecentResult = z.output<typeof RecentOutput>

/**
 * The contract of `plaud_events_list`: the shared events_list input (src/host/events-list.ts), which the tool checks
 * again with the shared parser, and its result. The domain imports nothing outside it, so the limits are written out
 * here; test/events.test.ts keeps them equal to the shared module's.
 */
export function eventsInput(accounts: readonly [string, ...string[]]) {
  return z.strictObject({
    since: z
      .string()
      .max(40)
      .optional()
      .describe("Where to start when there is no cursor: an ISO date (a UTC day) or an ISO date-time with Z or an offset. Default: 24 hours ago"),
    cursor: z.string().min(1).max(1024).optional().describe("The cursor of the previous result, to list what came after it. It wins over since"),
    limit: z.number().int().min(1).max(500).optional().describe("Most events to return, 1 to 500; 100 by default"),
    account: z.enum(accounts).optional().describe(`Account to list; defaults to "${accounts[0]}"`),
    source: z.literal("plaud").optional().describe("The one source this plugin lists; plaud"),
  })
}

const EventActor = z.strictObject({ role: z.string(), id: z.string(), name: z.string().optional() })

const SourceEvent = z.strictObject({
  source: z.literal("plaud"),
  account: z.string().describe("The account"),
  external_id: z.string().describe("The recording's id: file_id for get_note and get_transcript"),
  kind: z.literal("meeting"),
  occurred_at: z.string().describe("When the recording started, UTC ISO"),
  thread: z.null(),
  actors: z.array(EventActor).max(20),
  title: z.string().max(300).describe("The recording's name. Untrusted text"),
  text: z.string().max(4096).describe("How long the recording is"),
  url: z.string().nullable(),
  labels: z.array(z.string()).max(20),
  hash: z.string().describe("sha256: of the other fields"),
})

export const EventsListOutput = z.strictObject({
  source: z.literal("plaud"),
  account: z.string(),
  owner: z.strictObject({ id: z.string(), label: z.string() }).describe("The signed-in Plaud user"),
  events: z.array(SourceEvent).describe("Oldest first"),
  cursor: z.string().describe("Pass it to the next call"),
  more: z.boolean().describe("True when another call now would list more"),
  trust: z.literal("untrusted"),
})
