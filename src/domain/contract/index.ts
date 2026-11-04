import { isAbsolute } from "node:path"
import * as z from "zod"
import { EXPORT_KINDS, TRANSCRIPT_BLOCKS } from "../types.js"

/**
 * The contract of `plaud_export`, the plugin's only tool. The schemas go to
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
      recordingId: z.string().min(1).max(200).describe("Plaud recording id, from list_files"),
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
          "Absolute file path inside an export root; defaults to <first export root>/<kind>/<recordingId>.<ext>, and for a transcript to <first export root>/transcript/<recordingId>.<block>.md",
        ),
      overwrite: z.boolean().optional().describe("Replace an existing file at the destination; off by default"),
    })
    .refine((value) => value.kind === "transcript" || value.block === undefined, {
      message: "block is only valid for kind transcript",
      path: ["block"],
    })
}

export type ExportRequest = z.output<ReturnType<typeof exportInput>>

export const ExportOutput = z.strictObject({
  path: z.string().describe("Absolute path of the written file"),
  bytes: z.number().int().nonnegative().describe("Size of the written file in bytes"),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).describe("SHA-256 of the written file, lowercase hex"),
})

export type ExportResult = z.output<typeof ExportOutput>

/** The contract of `plaud_recent`: the newest recordings, one line each. */
export function recentInput(accounts: readonly [string, ...string[]]) {
  return z.strictObject({
    account: z
      .enum(accounts)
      .optional()
      .describe(`Account to read; defaults to "${accounts[0]}"`),
    limit: z.number().int().min(1).max(20).optional().describe("How many recordings, newest first; 8 by default"),
  })
}

export type RecentRequest = z.output<ReturnType<typeof recentInput>>

/**
 * Shaped as a Home `list` (items of at most 200 characters, not editable), so
 * a Home feed can show it as it is.
 */
export const RecentOutput = z.strictObject({
  items: z
    .array(z.strictObject({ id: z.string().min(1).max(128), text: z.string().min(1).max(200) }))
    .max(20)
    .describe("One line per recording: its title, when it started and how long it is"),
  editable: z.literal(false),
})

export type RecentResult = z.output<typeof RecentOutput>
