import { describe, expect, it } from "vitest"
import { AUDIO_URL_NOTICE, DATA_LINK_NOTICE, scrubUrls, withholdSignedLinks, withholdSignedLinksInText } from "../src/domain/redact.js"

/**
 * The tools RPC for scripts never returns a signed link: `shapeResult` rewrites every Plaud result before the caller
 * sees it. The plugin's own tools return no link at all. Plaud's own read tools pass Plaud's results through unchanged,
 * links included. The shapes below are the hosted server's.
 */

const SECRET = "X-Amz-Signature=SECRET"
const signed = (path: string) =>
  `https://plaud-data.test/${path}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=KEY%2F20261031&X-Amz-Date=20261031T090000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&x-id=GetObject&${SECRET}`
const ITEM = { data_id: "d-1", data_type: "transaction", data_title: "Weekly sync", data_content: "Hello.", data_link: signed("d-1.json") }
const NOTE = { ...ITEM, data_type: "auto_sum_note", data_tab_name: "AI summary", data_path: "note/d-2", data_error_code: 0, data_link: signed("d-2.md") }
const FILE = { id: "rec-1", name: "Weekly sync", duration: 1_834_000, presigned_url: signed("rec-1.mp3"), source_list: [ITEM], note_list: [NOTE] }
const FILE_WITHHELD = {
  ...FILE,
  presigned_url: AUDIO_URL_NOTICE,
  source_list: [{ ...ITEM, data_link: DATA_LINK_NOTICE }],
  note_list: [{ ...NOTE, data_link: DATA_LINK_NOTICE }],
}

describe("redaction helpers", () => {
  it("returns the same value when there is nothing to withhold, and leaves an empty link alone", () => {
    const value = { data: [{ id: "a" }], note: "x", presigned_url: null, data_link: "" }
    expect(withholdSignedLinks(value)).toBe(value)
    expect(withholdSignedLinks([1, "two", null])).toEqual([1, "two", null])
    expect(withholdSignedLinksInText("no link here")).toBe("no link here")
  })

  it("rewrites JSON text field by field and scrubs URLs from other text", () => {
    expect(JSON.parse(withholdSignedLinksInText(JSON.stringify({ files: [FILE], next: "https://keep.test" })))).toEqual({
      files: [FILE_WITHHELD],
      next: "https://keep.test",
    })
    expect(withholdSignedLinksInText(`id rec-1\npresigned_url=${FILE.presigned_url}`)).toBe("id rec-1\npresigned_url=[url withheld]")
  })

  it("scrubs every URL scheme from error text", () => {
    expect(scrubUrls(`failed: ${FILE.presigned_url} and s3://bucket/key, file:///etc/passwd`)).toBe("failed: [url withheld] and [url withheld], [url withheld]")
  })
})
