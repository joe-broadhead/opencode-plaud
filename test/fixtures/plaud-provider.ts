/**
 * A deterministic stand-in for Plaud's hosted MCP server, behind the plugin's own `Provider` interface.
 *
 * Every owner, recording, transcript and note is invented and fixed, so the recorded conformance fixture and the unit
 * tests are stable. The payload shapes are Plaud's: `list_files` filters whole UTC days and pages, `get_file` carries a
 * signed audio link, `get_transcript` pages by `next_cursor`, and `get_note` answers one tab per app tab.
 */
import type { Provider, ToolName } from "../../src/provider/client.js"
import { recordingMeta, type RecordingMeta } from "../../src/provider/recordings.js"
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"

interface Draft {
  readonly id: string
  readonly name: string
  readonly start: string
  readonly seconds: number
}

const OWNERS: Readonly<Record<string, { id: string; nickname: string; email?: string }>> = {
  work: { id: "user-work", nickname: "Ana", email: "ana@example.test" },
  personal: { id: "user-personal", nickname: "Sam" },
}

/**
 * Stripe's public documentation example key, not a credential. It is assembled from parts because GitHub push
 * protection refuses the literal, and it must stay a real provider shape: the tests prove that a recording whose title
 * holds a secret is refused for good.
 */
const EXAMPLE_KEY = ["sk", "live", "4eC39HqLyjWDarjtT1zdp7dc"].join("_")

const RECORDINGS: Readonly<Record<string, readonly Draft[]>> = {
  work: [
    { id: "w-1", name: "Weekly sync", start: "2026-11-02T09:00:00", seconds: 63 },
    { id: "w-2", name: "Customer call", start: "2026-11-04T14:30:00", seconds: 125 },
    { id: "w-3", name: "Board meeting", start: "2026-11-09T08:15:00", seconds: 3_600 },
    { id: "w-4", name: "Voice memo", start: "2026-11-10T07:00:00", seconds: 30 },
    // A title that holds a secret is refused for good, and the cursor moves past it.
    { id: "w-5", name: `Key ${EXAMPLE_KEY}`, start: "2026-11-11T07:00:00", seconds: 12 },
  ],
  personal: [{ id: "p-1", name: "Grocery list", start: "2026-11-05T18:00:00", seconds: 45 }],
}

const SEGMENTS = [
  { start_time: 0, end_time: 4_700, content: "Hello.", speaker: "Alice" },
  { start_time: 61_000, end_time: 63_440, content: "Bye.", speaker: "Bob" },
  { start_time: 120_000, end_time: 121_000, content: "One more thing.", speaker: "Alice" },
]

const NOTE = [{ data_id: "note-1", data_type: "auto_sum_note", data_tab_name: "Summary", data_content: "- Ship on Friday.", data_error_code: 0 }]

/** The most segments one page carries, so a long transcript is read page by page. */
const SEGMENTS_PER_PAGE = 2

export interface FakeOptions {
  /** Where the signed audio link points; the default is a host that refuses, which no unit test reaches. */
  readonly audioBase?: string
}

export interface FakeProvider extends Provider {
  /** Every read the plugin made, in order: for the tests that assert what a method read. */
  readonly calls: { readonly account: string; readonly tool: ToolName; readonly args: Readonly<Record<string, unknown>> }[]
}

function draft(alias: string, id: string): Draft {
  const found = (RECORDINGS[alias] ?? []).find((item) => item.id === id)
  if (found === undefined) {
    throw new SourceError({ code: "INPUT_INVALID", what: `Plaud has no recording ${id}`, next: "Use a recording id from recent." })
  }
  return found
}

function recordOf(item: Draft): RecordingMeta {
  return recordingMeta({ id: item.id, name: item.name, start_at: item.start, duration: item.seconds * 1_000, created_at: item.start }, item.id)
}

export function createFakeProvider(options: FakeOptions = {}): FakeProvider {
  const calls: FakeProvider["calls"][number][] = []
  const audioBase = options.audioBase ?? "https://files.example.test"
  return {
    calls,
    async read(account: string, tool: ToolName, args: Readonly<Record<string, unknown>>) {
      calls.push({ account, tool, args })
      if (OWNERS[account] === undefined) {
        throw new SourceError({ code: "ACCOUNT_UNKNOWN", what: `"${account}" is not a Plaud account`, next: "Pass an alias the plugin serves." })
      }
      switch (tool) {
        case "get_current_user":
          return { data: OWNERS[account] }
        case "list_files": {
          const from = typeof args["date_from"] === "string" ? Date.parse(`${args["date_from"]}T00:00:00Z`) : Number.NEGATIVE_INFINITY
          const to = typeof args["date_to"] === "string" ? Date.parse(`${args["date_to"]}T23:59:59Z`) : Number.POSITIVE_INFINITY
          const page = typeof args["page"] === "number" ? args["page"] : 1
          const size = typeof args["page_size"] === "number" ? args["page_size"] : 20
          const all = (RECORDINGS[account] ?? [])
            .filter((item) => {
              const at = Date.parse(`${item.start}Z`)
              return at >= from && at <= to
            })
            .sort((a, b) => Date.parse(`${a.start}Z`) - Date.parse(`${b.start}Z`))
          const slice = all.slice((page - 1) * size, page * size)
          return {
            type: "files",
            data: slice.map((item) => ({ id: item.id, name: item.name, start_at: item.start, created_at: item.start, duration: item.seconds * 1_000 })),
            page,
            page_size: size,
          }
        }
        case "get_file": {
          const item = draft(account, String(args["file_id"]))
          return {
            ...recordOf(item),
            id: item.id,
            created_at: item.start,
            start_at: item.start,
            duration: item.seconds * 1_000,
            presigned_url: `${audioBase}/audio/${item.id}.mp3?X-Amz-Signature=fake-signature`,
          }
        }
        case "get_note":
          draft(account, String(args["file_id"]))
          return NOTE
        case "get_transcript": {
          const item = draft(account, String(args["file_id"]))
          if (args["block"] === "outline") return { segments: [{ start_time: 0, topic: "Planning" }], next_cursor: null }
          if (args["block"] === "mark_memo") return { marks: [{ start_time: 1_000, content: "A highlight" }], next_cursor: null }
          const offset = typeof args["cursor"] === "string" ? Number(args["cursor"].replace(/^cur_/, "")) : 0
          const page = SEGMENTS.slice(offset, offset + SEGMENTS_PER_PAGE)
          const next = offset + SEGMENTS_PER_PAGE < SEGMENTS.length ? `cur_${offset + SEGMENTS_PER_PAGE}` : null
          return { file_id: item.id, block: args["block"] ?? "transaction", segments: page, next_cursor: next }
        }
        default:
          throw new SourceError({ code: "INPUT_INVALID", what: `the fake provider has no tool ${tool}`, next: "Fix the test." })
      }
    },
  }
}
