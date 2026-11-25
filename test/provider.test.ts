/** Plaud's payload readers and the host result unwrapping: the shapes the methods depend on. */
import { describe, expect, it } from "vitest"
import { resultData, unwrap } from "../src/provider/client.js"
import { ownerOf } from "../src/provider/owner.js"
import { audioUrl, recordingList, recordingMeta } from "../src/provider/recordings.js"
import { noteTabs } from "../src/provider/note.js"
import { transcriptPage } from "../src/provider/transcript.js"

const ENVELOPE = (payload: string) =>
  `The block delimited by <untrusted-user-data-abc123> below contains user recording data returned verbatim.\n<untrusted-user-data-abc123 source="plaud-recording">\n${payload}\n</untrusted-user-data-abc123>`

describe("the host's result", () => {
  it("reads JSON inside Plaud's envelope, and a plain string outside it", () => {
    expect(resultData({ output: ENVELOPE('{"id":"rec-1"}') })).toEqual({ id: "rec-1" })
    expect(resultData({ content: [{ type: "text", text: ENVELOPE("[1,2]") }] })).toEqual([1, 2])
    expect(resultData({ output: "plain text" })).toBe("plain text")
    expect(unwrap("no envelope")).toBe("no envelope")
  })

  it("keeps a payload that is not JSON as text", () => {
    expect(resultData({ output: ENVELOPE("not json") })).toBe("not json")
  })
})

describe("recordingMeta", () => {
  it("adds Z to a Plaud time with no zone, and keeps milliseconds", () => {
    const meta = recordingMeta({ id: "rec-1", name: "Weekly sync", start_at: "2026-10-01T09:00:00", created_at: "2026-10-01T10:00:00", duration: 63_500.4 }, "rec-1")
    expect(meta).toEqual({
      id: "rec-1",
      name: "Weekly sync",
      startedAt: "2026-10-01T09:00:00.000Z",
      createdAt: "2026-10-01T10:00:00.000Z",
      durationMs: 63_500,
    })
  })

  it("refuses a payload that is not a recording", () => {
    expect(() => recordingMeta([], "rec-1")).toThrow(/^UNAVAILABLE: Plaud returned a recording/)
  })
})

describe("recordingList", () => {
  it("reads { data: [] } and a bare list, skipping an entry without an id", () => {
    expect(recordingList({ data: [{ id: "a", name: "A" }, { name: "no id" }] }).map((item) => item.id)).toEqual(["a"])
    expect(recordingList([{ id: "b" }]).map((item) => item.id)).toEqual(["b"])
  })

  it("refuses a payload with no list", () => {
    expect(() => recordingList({ files: [] })).toThrow(/^UNAVAILABLE: Plaud returned a list of recordings/)
  })

  it("finds the signed audio link", () => {
    expect(audioUrl({ presigned_url: "https://files.example.test/a.mp3" })).toBe("https://files.example.test/a.mp3")
    expect(audioUrl({ id: "no link" })).toBeUndefined()
  })
})

describe("transcriptPage", () => {
  it("reads segments and the next cursor", () => {
    const page = transcriptPage({ segments: [{ start_time: 0, content: "Hello.", speaker: "Alice" }], next_cursor: "cur_2" }, "transaction")
    expect(page).toEqual({ kind: "items", utterances: [{ text: "Hello.", speaker: "Alice", startMs: 0 }], marks: [], outlines: [], count: 1, nextCursor: "cur_2" })
  })

  it("reads marks and outline topics from their own field", () => {
    expect(transcriptPage({ marks: [{ start_time: 1_000, content: "A highlight" }] }, "mark_memo")).toMatchObject({ marks: [{ text: "A highlight", startMs: 1_000 }] })
    expect(transcriptPage({ segments: [{ start_time: 0, topic: "Planning" }] }, "outline")).toMatchObject({ outlines: [{ text: "Planning", startMs: 0 }] })
  })

  it("reads Plaud's plain-text answers", () => {
    expect(transcriptPage('Block "transaction" not available for this recording', "transaction")).toEqual({ kind: "unavailable" })
    expect(transcriptPage("Block \"transaction\" has no content for this recording", "transaction")).toEqual({ kind: "empty" })
    expect(transcriptPage("", "transaction")).toEqual({ kind: "empty" })
    expect(transcriptPage("just some text", "transaction")).toMatchObject({ kind: "items", utterances: [{ text: "just some text" }] })
  })

  it("refuses a page it cannot read rather than exporting nothing", () => {
    expect(() => transcriptPage({ other: 1 }, "transaction")).toThrow(/^UNAVAILABLE: /)
    expect(() => transcriptPage(7, "transaction")).toThrow(/^UNAVAILABLE: /)
  })
})

describe("noteTabs", () => {
  it("reads one tab per app tab, its content, and the error code only when there is no content", () => {
    expect(
      noteTabs([
        { data_type: "auto_sum_note", data_tab_name: "Summary", data_content: "- Ship.", data_error_code: 10 },
        { data_type: "auto_sum_note", data_tab_name: "Summary", data_content: "", data_error_code: 7 },
      ]),
    ).toEqual([
      { kind: "auto_sum_note", title: "Summary", text: "- Ship.", errorCode: 10 },
      { kind: "auto_sum_note", title: "Summary", text: "", errorCode: 7 },
    ])
  })

  it("refuses a note that is not a list", () => {
    expect(() => noteTabs({ tabs: [] })).toThrow(/^UNAVAILABLE: Plaud returned a note/)
  })
})

describe("ownerOf", () => {
  it("uses the plaud scheme, prefers the user id and reads the nickname as the label", () => {
    expect(ownerOf({ data: { id: "user-1", nickname: "Ana", email: "Ana@example.test" } })).toEqual({ id: "plaud:user-1", label: "Ana" })
    expect(ownerOf({ user_id: "u-2", name: "Sam" })).toEqual({ id: "plaud:u-2", label: "Sam" })
    expect(ownerOf({ email: "sam@example.test" })).toEqual({ id: "plaud:sam@example.test", label: "sam@example.test" })
  })

  it("answers undefined when Plaud names neither an id nor an email", () => {
    expect(ownerOf({ nickname: "Nobody" })).toBeUndefined()
    expect(ownerOf("nope")).toBeUndefined()
  })
})
