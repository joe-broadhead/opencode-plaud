/**
 * `plan_export`: the preview of the one `plaud.export` action (contract §8, effect `local`). It writes nothing and reads
 * nothing from Plaud: it names the exact file the commit will write, so the person confirms a path, not a guess.
 */
import { isAbsolute, join } from "node:path"
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"
import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import { defaultFileName, DEFAULT_TRANSCRIPT_BLOCK, EXPORT_KINDS, type ExportKind } from "../export/render.js"
import { containingRoot } from "../export/files.js"
import type { TranscriptBlock } from "../provider/transcript.js"
import type { HandlerRuntime } from "./runtime.js"

/** What `plan_export` answers inside `output`, and what the commit reads from `call.plan`. */
export interface ExportPlan {
  readonly recordingId: string
  readonly kind: ExportKind
  readonly block?: TranscriptBlock
  /** The exact absolute file the commit writes. */
  readonly path: string
  readonly overwrite: boolean
}

/** `plan_export`: the file an export will write, without writing it. */
export function planExportHandler(runtime: HandlerRuntime): MethodHandler {
  return {
    description:
      "Preview the plaud.export action: name the recording, the kind (audio, transcript or note) and optionally a destination. " +
      "It writes nothing and reads no recording; it answers the exact file the commit will write, which the person confirms.",
    input: {
      type: "object",
      properties: {
        recordingId: { type: "string", minLength: 1, maxLength: 200, description: "The recording's id, from recent or list_files." },
        kind: { type: "string", enum: [...EXPORT_KINDS], description: "audio: the recording's audio; transcript or note: Markdown." },
        block: {
          type: "string",
          enum: ["transaction", "transaction_polish", "outline", "mark_memo"],
          description: "The transcript block, only for kind transcript: transaction (the default), transaction_polish, outline or mark_memo.",
        },
        destination: { type: "string", description: "An absolute file path inside an export root; the default is <first root>/<kind>/<name>." },
        overwrite: { type: "boolean", description: "Replace an existing file at the destination; off by default." },
      },
      required: ["recordingId", "kind"],
      additionalProperties: false,
    },
    output: {
      type: "object",
      properties: {
        method: { type: "string", enum: ["export"] },
        output: {
          type: "object",
          properties: {
            recordingId: { type: "string", minLength: 1 },
            kind: { type: "string", enum: [...EXPORT_KINDS] },
            block: { type: "string" },
            path: { type: "string", minLength: 1 },
            overwrite: { type: "boolean" },
          },
          required: ["recordingId", "kind", "path", "overwrite"],
          additionalProperties: false,
        },
        changes: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 500 } },
        trust: { type: "string", enum: ["untrusted"] },
      },
      required: ["method", "output", "changes", "trust"],
      additionalProperties: false,
    },
    async run(input) {
      const recordingId = String(input["recordingId"])
      const kind = input["kind"] as ExportKind
      const block = input["block"] as TranscriptBlock | undefined
      if (block !== undefined && kind !== "transcript") {
        throw new SourceError({ code: "INPUT_INVALID", what: "block is only valid for kind transcript", next: "Leave block out, or export a transcript." })
      }
      const named = input["destination"]
      if (named !== undefined && (typeof named !== "string" || !isAbsolute(named))) {
        throw new SourceError({ code: "INPUT_INVALID", what: "the destination must be an absolute file path", next: "Pass an absolute path inside an export root, or leave destination out." })
      }
      const root = runtime.settings.exportRoots[0]!
      const path = typeof named === "string" ? named : join(root, kind, defaultFileName(recordingId, kind, block ?? DEFAULT_TRANSCRIPT_BLOCK))
      // The destination must be inside an export root; a root itself is a folder, not a file.
      containingRoot(path, runtime.settings.exportRoots)
      if (isRoot(path, runtime.settings.exportRoots)) {
        throw new SourceError({ code: "INPUT_INVALID", what: `${path} is an export root, not a file`, next: "Pass a file path inside it." })
      }
      const overwrite = input["overwrite"] === true
      const output: ExportPlan = {
        recordingId,
        kind,
        ...(kind === "transcript" ? { block: block ?? DEFAULT_TRANSCRIPT_BLOCK } : {}),
        path,
        overwrite,
      }
      return {
        method: "export",
        output,
        changes: [`Write ${path}${overwrite ? ", replacing an existing file" : ""}.`],
        trust: "untrusted",
      }
    },
  }
}

function isRoot(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => join(root) === join(path))
}
