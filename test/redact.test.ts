import { describe, expect, it } from "vitest"
import { AUDIO_URL_NOTICE, DATA_LINK_NOTICE, scrubUrls, withholdSignedLinks, withholdSignedLinksInText } from "../src/domain/redact.js"
import { registerTools, type ToolsHost } from "../src/host/tools/index.js"

/**
 * Signed links never reach the model: the execute.after hook rewrites every
 * Plaud tool result before the host shows it to the model or stores it in
 * the session. The shapes are the hosted server's.
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

type AfterEvent = { tool: string; status: "completed"; result: { output?: unknown; content?: unknown } } | { tool: string; status: "error"; error: Error }

async function hook() {
  const callbacks: ((event: AfterEvent) => void)[] = []
  const ctx: ToolsHost = {
    tool: {
      transform: async () => ({ dispose: async () => undefined }),
      hook: (async (_name: string, callback: (event: AfterEvent) => void) => {
        callbacks.push(callback)
        return { dispose: async () => undefined }
      }) as ToolsHost["tool"]["hook"],
      list: async () => [],
    },
    permission: { assert: async () => undefined },
  }
  await registerTools(ctx, { accounts: [], exportRoots: ["/tmp/plaud"], maxAudioBytes: 1, exportTimeoutMs: 1_000 })
  /** Runs the hooks on a completed result, like the host does after a tool call. */
  return { callbacks, after: (tool: string, result: { output?: unknown; content?: unknown }) => {
    const event: AfterEvent = { tool, status: "completed", result }
    for (const callback of callbacks) callback(event)
    return event.status === "completed" ? event.result : undefined
  } }
}

describe("signed-link withholding", () => {
  it("replaces the audio link and every data_link in get_file's output and text, for every account", async () => {
    const { after } = await hook()
    for (const tool of ["plaud_get_file", "plaud-work_get_file"]) {
      const result = after(tool, { output: FILE, content: [{ type: "text", text: JSON.stringify(FILE) }] })
      expect(result).toEqual({ output: FILE_WITHHELD, content: [{ type: "text", text: JSON.stringify(FILE_WITHHELD) }] })
      expect(JSON.stringify(result)).not.toContain(SECRET)
    }
  })

  it("replaces data_link in get_note's list and keeps the rest of each tab", async () => {
    const { after } = await hook()
    const result = after("plaud_get_note", { output: [NOTE], content: [{ type: "text", text: JSON.stringify([NOTE]) }] })
    expect(result).toEqual({
      output: [{ ...NOTE, data_link: DATA_LINK_NOTICE }],
      content: [{ type: "text", text: JSON.stringify([{ ...NOTE, data_link: DATA_LINK_NOTICE }]) }],
    })
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })

  it("withholds the links from text output in Plaud's envelope, keeping the envelope", async () => {
    const { after } = await hook()
    for (const [tool, payload, expected] of [
      ["plaud_get_file", FILE, FILE_WITHHELD],
      ["plaud_get_note", [NOTE], [{ ...NOTE, data_link: DATA_LINK_NOTICE }]],
    ] as const) {
      const wrapped = `Data below.\n<untrusted-user-data-ab12 source="plaud-recording">\n${JSON.stringify(payload, null, 2)}\n</untrusted-user-data-ab12>`
      const result = after(tool, { output: wrapped, content: [{ type: "text", text: wrapped }] }) as { output: string; content: { text: string }[] }
      expect(JSON.stringify(result), tool).not.toContain(SECRET)
      expect(result.output).toBe(`Data below.\n<untrusted-user-data-ab12 source="plaud-recording">\n${JSON.stringify(expected)}\n</untrusted-user-data-ab12>`)
      expect(result.content[0]!.text).toBe(result.output)
    }
  })

  it("withholds the links from any Plaud tool's result, at any depth, and from plain text", async () => {
    const { after } = await hook()
    const listed = after("plaud_list_files", { output: { data: [FILE] }, content: `data_link: ${ITEM.data_link}` })
    expect(JSON.stringify(listed)).not.toContain(SECRET)
    expect(listed).toEqual({ output: { data: [FILE_WITHHELD] }, content: "data_link: [url withheld]" })
  })

  it("leaves other tools, results without a link and failed calls alone", async () => {
    const { after, callbacks } = await hook()
    const other = { output: FILE }
    expect(after("github_get_file", other)).toBe(other)
    const transcript = { output: { segments: [{ content: "see https://example.test" }] }, content: [{ type: "text", text: "see https://example.test" }] }
    expect(after("plaud_get_transcript", transcript)).toEqual(transcript)
    const failed: AfterEvent = { tool: "plaud_get_file", status: "error", error: new Error("offline") }
    const original = failed.error
    for (const callback of callbacks) callback(failed)
    expect(failed.error).toBe(original)
    const elsewhere: AfterEvent = { tool: "github_get_file", status: "error", error: new Error(`failed at ${FILE.presigned_url}`) }
    for (const callback of callbacks) callback(elsewhere)
    expect(elsewhere.error.message).toContain(SECRET)
  })

  it("withholds every link from a failed Plaud call's error text, keeping its class, cause and metadata (PLAUD-4)", async () => {
    /** Stands in for OpenCode's Tool.Error: built from its fields, with an optional cause. */
    class ToolError extends Error {
      readonly error?: unknown
      readonly metadata?: Record<string, unknown>
      constructor(fields: { message: string; error?: unknown; metadata?: Record<string, unknown> }) {
        super(fields.message)
        if (fields.error !== undefined) this.error = fields.error
        if (fields.metadata !== undefined) this.metadata = fields.metadata
      }
    }
    const { callbacks } = await hook()
    const cause = new Error("upstream")
    const failed: AfterEvent = {
      tool: "plaud-work_get_file",
      status: "error",
      error: new ToolError({ message: `get_file failed: presigned_url=${FILE.presigned_url} (see ${ITEM.data_link}).`, error: cause, metadata: { step: 1 } }),
    }
    for (const callback of callbacks) callback(failed)
    const error = failed.status === "error" ? (failed.error as ToolError) : undefined
    expect(error).toBeInstanceOf(ToolError)
    expect(error?.message).toBe("get_file failed: presigned_url=[url withheld] (see [url withheld]).")
    expect(error?.error).toBe(cause)
    expect(error?.metadata).toEqual({ step: 1 })
  })
})

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
