/**
 * `export`: the commit of the one `plaud.export` action (contract §8, effect `local`).
 *
 * It writes one file inside an export root: the recording's audio, one transcript block, or its note tabs, as Markdown
 * for text. The bytes are staged beside the destination, hashed and published atomically; a refused or failed export
 * leaves nothing behind. It reads Plaud through the host's own `get_file`, `get_transcript` and `get_note`, and it
 * re-checks the destination's `external_directory` gate itself, because the host does not see a plugin's file write.
 */
import { dirname } from "node:path"
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"
import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import { assertExternal } from "../export/gate.js"
import { audioUrl, recordingMeta } from "../provider/recordings.js"
import { download, onThisMachine, parseLink, prepare, publish, stream, underRoot } from "../export/files.js"
import { MAX_TEXT_BYTES, renderNote, renderTranscript } from "../export/render.js"
import { transcriptArgs, transcriptPage, TRANSCRIPT_BLOCKS, type Entry, type TranscriptBlock, type Utterance } from "../provider/transcript.js"
import { noteTabs } from "../provider/note.js"
import { TOOLS, type ProviderCall } from "../provider/client.js"
import type { ExportPlan } from "./plan-export.js"
import type { HandlerRuntime } from "./runtime.js"

/** Stops a cursor that never ends; a real transcript is far shorter. */
const MAX_TRANSCRIPT_PAGES = 1_000
const PROGRESS_INTERVAL_MS = 1_000

/** The answer's JSON Schema: the file, its size and its hash. */
const OUTPUT = {
  type: "object",
  properties: {
    output: {
      type: "object",
      properties: { path: { type: "string", minLength: 1 }, bytes: { type: "integer", minimum: 0 }, sha256: { type: "string", minLength: 64, maxLength: 64 } },
      required: ["path", "bytes", "sha256"],
      additionalProperties: false,
    },
    trust: { type: "string", enum: ["untrusted"] },
  },
  required: ["output", "trust"],
  additionalProperties: false,
} as const

/** The plan a commit runs with, checked: the register stores what `plan_export` answered. */
function planOf(value: unknown): ExportPlan {
  const plan = typeof value === "object" && value !== null ? (value as Record<string, unknown>)["output"] : undefined
  const record = typeof plan === "object" && plan !== null ? (plan as Record<string, unknown>) : undefined
  const recordingId = record?.["recordingId"]
  const kind = record?.["kind"]
  const path = record?.["path"]
  const overwrite = record?.["overwrite"]
  const block = record?.["block"]
  if (typeof recordingId !== "string" || recordingId === "" || (kind !== "audio" && kind !== "transcript" && kind !== "note") || typeof path !== "string" || path === "" || typeof overwrite !== "boolean") {
    throw new SourceError({ code: "PLAN_INVALID", what: "the export plan does not carry the file this commit writes", next: "Plan the export again, then commit the planId it answers." })
  }
  if (block !== undefined && (typeof block !== "string" || !(TRANSCRIPT_BLOCKS as readonly string[]).includes(block))) {
    throw new SourceError({ code: "PLAN_INVALID", what: "the export plan names an unknown transcript block", next: "Plan the export again, then commit the planId it answers." })
  }
  return { recordingId, kind, path, overwrite, ...(block === undefined ? {} : { block: block as TranscriptBlock }) }
}

/** `export`: write one recording's audio, transcript block or note to a local file. */
export function exportHandler(runtime: HandlerRuntime): MethodHandler {
  return {
    description:
      "Commit a plaud.export plan: write the recording's audio, one transcript block, or its note tabs to the file the preview named. " +
      "It takes only the planId plan_export answered. It returns the file's path, size and SHA-256, never its content.",
    input: { type: "object", properties: { planId: { type: "string", minLength: 1 } }, required: ["planId"], additionalProperties: false },
    output: OUTPUT,
    async run(_input, call) {
      const plan = planOf(call.plan)
      const roots = runtime.settings.exportRoots
      if (!roots.some((root) => underRoot(plan.path, root))) {
        throw new SourceError({ code: "PLAN_INVALID", what: `${plan.path} is outside the export roots`, next: "Plan the export again with a destination inside an export root." })
      }
      // Re-checked here, never trusted from the preview alone: the session's rules can change between the two calls.
      await assertExternal(dirname(plan.path), call, runtime.location, { agentRules: runtime.agentRules, sessionRules: runtime.sessionRules })
      const timeout = AbortSignal.timeout(runtime.settings.exportTimeoutMs)
      const signal = AbortSignal.any([call.signal, timeout])
      const report = reporter(call.progress, signal)
      const providerCall: ProviderCall = { ...call, signal }
      try {
        const file = await runtime.provider.read(call.account, TOOLS.file, { file_id: plan.recordingId }, providerCall)
        const recording = recordingMeta(file, plan.recordingId)
        if (plan.kind === "audio") {
          const link = audioUrl(file)
          if (link === undefined) {
            throw new SourceError({ code: "UNAVAILABLE", what: "Plaud has no audio for this recording yet", next: "Retry once Plaud has processed it, or export its transcript or note." })
          }
          const url = parseLink(link)
          const response = await download(url.href, { maxBytes: runtime.settings.maxAudioBytes, signal, local: onThisMachine })
          try {
            const path = await prepare(plan.path, roots, plan.overwrite)
            const written = await publish(path, plan.overwrite, (write) => stream(response, write, runtime.settings.maxAudioBytes, signal, (bytes, total) => report({ phase: "audio", bytes, ...(total === undefined ? {} : { totalBytes: total }) })))
            return { output: written, trust: "untrusted" }
          } finally {
            if (!response.bodyUsed) await response.body?.cancel().catch(() => undefined)
          }
        }
        const exportedAt = new Date(runtime.clock())
        let markdown: string
        if (plan.kind === "transcript") {
          const block = plan.block ?? "transaction"
          const content = await transcript(runtime, call.account, plan.recordingId, block, providerCall, report)
          markdown = renderTranscript({ recording, block, exportedAt, ...content })
        } else {
          markdown = renderNote({ recording, exportedAt, tabs: noteTabs(await runtime.provider.read(call.account, TOOLS.note, { file_id: plan.recordingId }, providerCall)) })
        }
        const bytes = Buffer.from(markdown, "utf8")
        if (bytes.byteLength > MAX_TEXT_BYTES) {
          throw new SourceError({ code: "TOO_LARGE", what: `the ${plan.kind} is ${bytes.byteLength} bytes, over the 25 MiB limit for a text export`, next: "Export the outline block or the note instead, which are shorter." })
        }
        // The folder and the file are created only once the bytes are ready, so a failed read leaves nothing.
        const path = await prepare(plan.path, roots, plan.overwrite)
        const written = await publish(path, plan.overwrite, (write) => write(bytes))
        return { output: written, trust: "untrusted" }
      } catch (error) {
        if (timeout.aborted) {
          throw new SourceError({ code: "UNAVAILABLE", what: `the export did not finish within exportTimeoutMs (${runtime.settings.exportTimeoutMs} ms)`, next: "Raise the exportTimeoutMs plugin option, or retry on a faster connection." })
        }
        if (error instanceof SourceError || call.signal.aborted) throw error
        const message = error instanceof Error ? error.message : String(error)
        throw new SourceError({ code: "UNAVAILABLE", what: `writing the export failed: ${message.split("\n", 1)[0]}`, next: "Check the free disk space and the export folder's permissions, then retry." })
      }
    },
  }
}

/** One transcript block, page by page, through the provider's `get_transcript`. */
async function transcript(runtime: HandlerRuntime, account: string, recordingId: string, block: TranscriptBlock, call: ProviderCall, report: (update: Record<string, unknown>) => void): Promise<{ utterances: Utterance[]; marks: Entry[]; outlines: Entry[] }> {
  const collected = { utterances: [] as Utterance[], marks: [] as Entry[], outlines: [] as Entry[] }
  let cursor: string | undefined
  for (let pages = 1; pages <= MAX_TRANSCRIPT_PAGES; pages++) {
    const page = transcriptPage(await runtime.provider.read(account, TOOLS.transcript, transcriptArgs(recordingId, block, cursor), call), block)
    if (page.kind === "unavailable") {
      throw new SourceError({ code: "UNAVAILABLE", what: `Plaud has no ${block} block for this recording`, next: "Export another transcript block, or the note." })
    }
    if (page.kind === "empty") return collected
    collected.utterances.push(...page.utterances)
    collected.marks.push(...page.marks)
    collected.outlines.push(...page.outlines)
    report({ phase: "transcript", pages })
    if (page.nextCursor === undefined || page.count === 0) return collected
    cursor = page.nextCursor
  }
  throw new SourceError({ code: "UNAVAILABLE", what: `the ${block} block did not end after ${MAX_TRANSCRIPT_PAGES} pages`, next: "Export another block, or report it to the plugin's maintainers." })
}

/** Progress, at most once a second; a failure to report never fails the export. */
function reporter(progress: (update?: Readonly<Record<string, unknown>>) => Promise<void>, signal: AbortSignal): (update: Record<string, unknown>) => void {
  let last = -Infinity
  return (update) => {
    if (signal.aborted) return
    const now = Date.now()
    if (now - last < PROGRESS_INTERVAL_MS) return
    last = now
    void progress(update).catch(() => undefined)
  }
}
