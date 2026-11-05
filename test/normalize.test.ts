import { describe, expect, it } from "vitest"
import {
  audioUrl,
  fileArgs,
  noteTabs,
  recordingMeta,
  resultData,
  transcriptArgs,
  transcriptPage,
} from "../src/domain/normalize.js"

/**
 * The mapping of the hosted server's payloads, in the shapes it returns:
 * optional fields may be missing, and an unreadable shape fails loudly
 * instead of exporting an empty file. Times are milliseconds.
 */

const FILE = {
  id: "rec_01",
  name: "Weekly sync",
  created_at: "2026-10-27T09:00:00.000Z",
  serial_number: "P0000000000",
  start_at: "2026-10-27T09:00:00.000Z",
  duration: 1_834_000,
  presigned_url: "https://audio.plaud.test/rec_01.mp3?X-Amz-Signature=SECRET",
  source_list: [],
  note_list: [],
}

describe("Plaud tool arguments", () => {
  it("names the recording with file_id and passes the block and cursor", () => {
    expect(fileArgs("rec_01")).toEqual({ file_id: "rec_01" })
    expect(transcriptArgs("rec_01", "outline")).toEqual({ file_id: "rec_01", block: "outline", limit: 500 })
    expect(transcriptArgs("rec_01", "transaction", "cur_2")).toEqual({ file_id: "rec_01", block: "transaction", limit: 500, cursor: "cur_2" })
  })
})

describe("host MCP results", () => {
  it("uses the parsed output, then JSON text, then plain text", () => {
    expect(resultData({ output: { id: "a" }, content: [{ type: "text", text: "{}" }] })).toEqual({ id: "a" })
    expect(resultData({ output: '{"id":"b"}' })).toEqual({ id: "b" })
    expect(resultData({ content: [{ type: "text", text: '[{"id":"c"}]' }] })).toEqual([{ id: "c" }])
    expect(resultData({ output: "Block is empty" })).toBe("Block is empty")
    expect(resultData({ output: "{not json" })).toBe("{not json")
  })

  it("takes the payload out of Plaud's untrusted-data envelope", () => {
    const wrap = (payload: string, note = "") =>
      `The block delimited by <untrusted-user-data-ab12> below contains user recording data.\n<untrusted-user-data-ab12 source="plaud-recording">\n${payload}\n</untrusted-user-data-ab12>${note}`
    expect(resultData({ content: [{ type: "text", text: wrap('{"id":"d"}', "\n\nNote: presigned_url is null.") }] })).toEqual({ id: "d" })
    expect(resultData({ output: wrap("Launch\n- checklist") })).toBe("Launch\n- checklist")
  })
})

describe("recordings", () => {
  it("maps the fields as they are, duration in milliseconds", () => {
    expect(recordingMeta(FILE, "rec_01")).toStrictEqual({
      id: "rec_01",
      name: "Weekly sync",
      createdAt: "2026-10-27T09:00:00.000Z",
      startedAt: "2026-10-27T09:00:00.000Z",
      durationMs: 1_834_000,
    })
  })

  it("needs only the object, and ignores durations and dates in other forms", () => {
    expect(recordingMeta({}, "rec_3")).toStrictEqual({ id: "rec_3", name: "" })
    expect(recordingMeta({ id: "rec_2", created_at: 1_790_000_000, duration: "2400000" }, "x")).toStrictEqual({ id: "rec_2", name: "" })
    expect(recordingMeta({ id: "rec_2", duration: -1 }, "x")).toStrictEqual({ id: "rec_2", name: "" })
  })

  it("fails loudly on a payload that is not a recording", () => {
    expect(() => recordingMeta("Failed to get file", "rec_1")).toThrow(/^PLAUD_UNREADABLE: get_file returned text/)
  })

  it("reads the audio link only from presigned_url", () => {
    expect(audioUrl(FILE)).toBe(FILE.presigned_url)
    expect(audioUrl({ ...FILE, presigned_url: "" })).toBeUndefined()
    expect(audioUrl({ url: "https://elsewhere.test/a.mp3" })).toBeUndefined()
    expect(audioUrl("text")).toBeUndefined()
  })
})

describe("transcript pages", () => {
  const page = (segments: unknown[], next_cursor: string | null = null) => ({
    file_id: "rec_01",
    block: "transaction",
    total: segments.length,
    offset: 0,
    limit: 50,
    returned: segments.length,
    next_cursor,
    segments,
  })

  it("maps segments with start_time in milliseconds, as is", () => {
    const segment = (start_time: number, speaker: string, content: string) => ({
      start_time,
      end_time: start_time + 4_700,
      content,
      speaker,
      original_speaker: "Speaker 1",
      segment_uid: `seg-${start_time}`,
    })
    expect(transcriptPage(page([segment(0, "Alice", "Hi."), segment(4_200, "Bob", "Hello."), segment(3_723_500, "Alice", "Late.")], "cur_2"), "transaction")).toStrictEqual({
      kind: "items",
      utterances: [
        { speaker: "Alice", startMs: 0, text: "Hi." },
        { speaker: "Bob", startMs: 4_200, text: "Hello." },
        { speaker: "Alice", startMs: 3_723_500, text: "Late." },
      ],
      marks: [],
      outlines: [],
      count: 3,
      nextCursor: "cur_2",
    })
  })

  it("keeps an item without content as JSON instead of dropping it", () => {
    const result = transcriptPage(page([{ speaker: "Bob", start_time: 10 }]), "transaction")
    if (result.kind !== "items") throw new Error("expected items")
    expect(result.utterances).toEqual([{ speaker: "Bob", startMs: 10, text: '{"speaker":"Bob","start_time":10}' }])
  })

  it("reads the outline block's topics as text at their offsets", () => {
    const result = transcriptPage(page([{ start_time: 0, end_time: 300_000, topic: "Launch checklist" }, { start_time: 300_000, end_time: 900_000, topic: "Pricing" }]), "outline")
    if (result.kind !== "items") throw new Error("expected items")
    expect(result.outlines).toEqual([
      { startMs: 0, text: "Launch checklist" },
      { startMs: 300_000, text: "Pricing" },
    ])
  })

  it("reads the mark_memo block's marks", () => {
    expect(transcriptPage({ marks: [{ start_time: 11_000, content: "Pricing decision" }], next_cursor: null }, "mark_memo")).toStrictEqual({
      kind: "items",
      utterances: [],
      marks: [{ startMs: 11_000, text: "Pricing decision" }],
      outlines: [],
      count: 1,
    })
  })

  it("classifies the plain-text answers the MCP gives outside paging", () => {
    expect(transcriptPage('Block "mark_memo" not available for this recording. Available: transaction.', "mark_memo")).toEqual({ kind: "unavailable" })
    expect(transcriptPage('Block "mark_memo" has no content for this recording yet.', "mark_memo")).toEqual({ kind: "empty" })
    expect(transcriptPage("It is empty — no highlight was recorded.", "mark_memo")).toEqual({ kind: "empty" })
    expect(transcriptPage({}, "mark_memo")).toEqual({ kind: "empty" })
    expect(transcriptPage("Launch\n- checklist", "transaction")).toMatchObject({ kind: "items", utterances: [{ text: "Launch\n- checklist" }] })
  })

  it("rejects a record with no segments or marks, and a list", () => {
    expect(() => transcriptPage({ total: 3 }, "transaction")).toThrow(/^PLAUD_UNREADABLE:/)
    expect(() => transcriptPage({ items: [] }, "transaction")).toThrow(/^PLAUD_UNREADABLE:/)
    expect(() => transcriptPage([{ content: "x" }], "transaction")).toThrow(/^PLAUD_UNREADABLE:/)
    expect(() => transcriptPage(42, "transaction")).toThrow(/^PLAUD_UNREADABLE:/)
  })
})

describe("note tabs", () => {
  const tab = (fields: Record<string, unknown>) => ({
    data_id: "d-1",
    data_type: "auto_sum_note",
    data_title: "Weekly sync",
    data_tab_name: "AI summary",
    data_content: "",
    data_link: "https://plaud-data.test/d-1.md?X-Amz-Signature=SECRET",
    data_path: "note/d-1",
    data_error_code: 0,
    ...fields,
  })

  it("names each tab by data_tab_name, then data_title, then its type", () => {
    expect(
      noteTabs([
        tab({ data_content: "# Summary\n\n- Ship on Friday." }),
        tab({ data_type: "custom_note", data_tab_name: "", data_title: "Decisions", data_content: "Body" }),
        tab({ data_type: "my_custom_tab", data_tab_name: null, data_title: "", data_content: "Body" }),
      ]),
    ).toEqual([
      { kind: "auto_sum_note", title: "AI summary", text: "# Summary\n\n- Ship on Friday." },
      { kind: "custom_note", title: "Decisions", text: "Body" },
      { kind: "my_custom_tab", title: "My custom tab", text: "Body" },
    ])
  })

  it("keeps a tab Plaud could not load, with its data_error_code", () => {
    expect(noteTabs([tab({ data_error_code: 3 }), tab({})])).toEqual([
      { kind: "auto_sum_note", title: "AI summary", text: "", errorCode: 3 },
      { kind: "auto_sum_note", title: "AI summary", text: "" },
    ])
  })

  it("accepts an empty list, and rejects a wrapped list or text", () => {
    expect(noteTabs([])).toEqual([])
    expect(() => noteTabs({ notes: [tab({})] })).toThrow(/^PLAUD_UNREADABLE: get_note returned object/)
    expect(() => noteTabs("Failed to get note")).toThrow(/^PLAUD_UNREADABLE: get_note returned text/)
  })
})
