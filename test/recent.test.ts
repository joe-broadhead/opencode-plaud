import { describe, expect, it, vi } from "vitest"
import type { ToolContext } from "../src/host/context.js"
import { defaultRules, evaluate, RECENT_ACTION } from "../src/host/permissions.js"
import { line, MIN_PAGE_SIZE } from "../src/host/tools/recent.js"
import { registerTools, type ToolsHost } from "../src/host/tools/index.js"

/**
 * plaud_recent against a fake host: each account's list_files executor answers
 * like the hosted server (inside its untrusted-data envelope) and, like it,
 * refuses a page_size below 10; the tool returns a Home `list` with one line
 * per recording.
 */

type Tool = {
  name: string
  input: { "~standard": { validate(value: unknown): unknown } }
  output: { parse(value: unknown): unknown }
  execute(input: unknown, context: ToolContext): Promise<{ output: unknown }>
}

const RECORDINGS = [
  { id: "rec-3", name: "Design review", start_at: "2026-10-31T14:05:00", duration: 3_780_000, presigned_url: "https://files.example.invalid/a.mp3?X-Amz-Signature=s" },
  { id: "rec-2", name: "", created_at: "2026-10-30T09:00:00", duration: 20_000 },
  { name: "No id, skipped" },
  { id: "rec-1", name: "Two\nlines\tand  tabs" },
]

function enveloped(value: unknown) {
  const text = `Data below.\n<untrusted-user-data-ab12 source="plaud-recording">\n${JSON.stringify(value)}\n</untrusted-user-data-ab12>`
  return { content: [{ type: "text", text }] }
}

/** Plaud's server: a page_size below 10 is an error, as it is live. */
function plaud(answer: unknown) {
  return (args: Record<string, unknown>) => {
    if (typeof args["page_size"] === "number" && args["page_size"] < 10) throw new Error("page_size must be at least 10")
    return answer
  }
}

async function recent(list: (args: Record<string, unknown>) => unknown, accounts: string[] = []) {
  const added: Tool[] = []
  const calls: { id: string; args: Record<string, unknown> }[] = []
  const assert = vi.fn(async (_request: Record<string, unknown>) => undefined)
  const executor = (id: string) => ({
    id,
    execute: async (args: Record<string, unknown>) => {
      calls.push({ id, args })
      return list(args)
    },
  })
  const ctx: ToolsHost = {
    tool: {
      transform: async (callback) => {
        callback({ namespace: () => undefined, add: (tool: unknown) => added.push(tool as Tool) } as never)
        return { dispose: async () => undefined }
      },
      hook: (async () => ({ dispose: async () => undefined })) as ToolsHost["tool"]["hook"],
      list: async () => [executor("plaud_list_files"), ...accounts.map((account) => executor(`plaud-${account}_list_files`))] as never,
    },
    permission: { assert },
  }
  await registerTools(ctx, { accounts, exportRoots: ["/tmp/plaud"], maxAudioBytes: 1, exportTimeoutMs: 1_000 })
  const tool = added.find((entry) => entry.name === "recent")
  if (tool === undefined) throw new Error("recent was not registered")
  const run = async (input: unknown) => {
    const parsed = (await tool.input["~standard"].validate(input)) as { value?: unknown; issues?: unknown }
    if (parsed.issues) throw new Error(JSON.stringify(parsed.issues))
    const context = { sessionID: "ses_1", agent: "build", messageID: "msg_1", id: "call_1", signal: new AbortController().signal } as unknown as ToolContext
    return (await tool.execute(parsed.value, context)).output
  }
  return { tool, run, calls, assert }
}

describe("plaud_recent", () => {
  it("lists the newest recordings as a Home list, on one line each, through the server's own read", async () => {
    const { tool, run, calls } = await recent(plaud(enveloped({ type: "files", data: RECORDINGS, page: 1 })))
    const output = await run({ limit: 12 })
    expect(output).toEqual({
      items: [
        { id: "rec-3", text: "Design review · 2026-10-31 14:05 UTC · 1 h 3 min" },
        { id: "rec-2", text: "Untitled recording · 2026-10-30 09:00 UTC · 1 min" },
        { id: "rec-1", text: "Two lines and tabs" },
      ],
      editable: false,
    })
    expect(tool.output.parse(output)).toEqual(output)
    expect(JSON.stringify(output)).not.toContain("X-Amz-Signature")
    expect(calls).toEqual([{ id: "plaud_list_files", args: { page_size: 12 } }])
  })

  it("skips an entry with no id and still fills the limit from the rest of the page", async () => {
    const { run } = await recent(plaud(enveloped({ type: "files", data: RECORDINGS, page: 1 })))
    // The third entry has no id; the fourth fills its place.
    expect(((await run({ limit: 3 })) as { items: { id: string }[] }).items.map((item) => item.id)).toEqual(["rec-3", "rec-2", "rec-1"])
  })

  it("never asks Plaud for fewer than 10, and keeps only the limit", async () => {
    expect(MIN_PAGE_SIZE).toBe(10)
    const { run, calls } = await recent(plaud(enveloped({ type: "files", data: RECORDINGS, page: 1 })))
    expect(await run({})).toMatchObject({ items: [{ id: "rec-3" }, { id: "rec-2" }, { id: "rec-1" }] })
    expect(await run({ limit: 1 })).toEqual({ items: [{ id: "rec-3", text: "Design review · 2026-10-31 14:05 UTC · 1 h 3 min" }], editable: false })
    expect(await run({ limit: 10 })).toMatchObject({ editable: false })
    expect(calls.map((call) => call.args)).toEqual([{ page_size: 10 }, { page_size: 10 }, { page_size: 10 }])
  })

  it("asserts plaud_recent for the account, then reads that account's server", async () => {
    const { run, calls, assert } = await recent(plaud(enveloped([])), ["work"])
    await run({ account: "work", limit: 3 })
    expect(assert).toHaveBeenCalledWith(
      expect.objectContaining({ action: RECENT_ACTION, resources: ["work"], save: ["work"], metadata: { account: "work", limit: 3 }, source: { type: "tool", messageID: "msg_1", id: "call_1" } }),
    )
    expect(calls).toEqual([{ id: "plaud-work_list_files", args: { page_size: 10 } }])
  })

  it("reads nothing when the assertion is declined", async () => {
    const { run, calls, assert } = await recent(plaud(enveloped([])))
    assert.mockRejectedValueOnce(new Error(""))
    await expect(run({})).rejects.toThrow()
    expect(calls).toEqual([])
  })

  it("says what it could not read, rather than an empty list", async () => {
    const { run } = await recent(plaud(enveloped("Not a list")))
    await expect(run({})).rejects.toThrow(/PLAUD_UNREADABLE|instead of a list/)
  })

  it("refuses a limit outside 1 to 20", async () => {
    const { run } = await recent(plaud(enveloped([])))
    await expect(run({ limit: 0 })).rejects.toThrow()
    await expect(run({ limit: 21 })).rejects.toThrow()
  })

  it("keeps a line within a Home list item's 200 characters", () => {
    expect(line({ id: "x", name: "a".repeat(300) }).length).toBe(200)
  })

  it("runs by its exact name at every access value, like the server's reads", () => {
    for (const access of ["all", "ask-changes", "read-only"] as const) {
      expect(defaultRules(["plaud"], access)).toContainEqual({ action: RECENT_ACTION, resource: "*", effect: "allow" })
      const rules = [{ action: "*", resource: "*", effect: "allow" } as const, ...defaultRules(["plaud", "plaud-work"], access)]
      expect(evaluate(rules, RECENT_ACTION), access).toBe("allow")
      // A tool that only ends like it follows the namespace rule instead.
      expect(evaluate(rules, "plaud-work_recent"), access).toBe(access === "all" ? "allow" : access === "ask-changes" ? "ask" : "deny")
    }
  })
})
