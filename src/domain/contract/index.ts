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

/** The tools RPC's `export` method: the tool's input without `account`, which comes from the envelope. */
export function exportMethodInput() {
  return z.strictObject(EXPORT_BODY).refine(transcriptOnlyBlock, { message: "block is only valid for kind transcript", path: ["block"] })
}

export type ExportMethodRequest = z.output<ReturnType<typeof exportMethodInput>>

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
