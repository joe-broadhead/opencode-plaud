import { describe, expect, it, vi } from "vitest"
import type { ToolContext } from "../src/host/context.js"
import { DEFAULT_RULES, RECENT_ACTION } from "../src/host/permissions.js"
import { line } from "../src/host/tools/recent.js"
import { registerTools, type ToolsHost } from "../src/host/tools/index.js"

/**
 * plaud_recent against a fake host: the server's list_files executor answers
 * like the hosted server (inside its untrusted-data envelope), and the tool
 * returns a Home `list` with one line per recording.
 */

type Tool = {
  name: string
  input: { "~standard": { validate(value: unknown): unknown } }
  output: { parse(value: unknown): unknown }
  execute(input: unknown, context: ToolContext): Promise<{ output: unknown }>
}

const RECORDINGS = [
  { id: "rec-2", name: "Design review", start_at: "2026-10-31T14:05:00Z", duration: 3_780_000 },
  { id: "rec-1", name: "", created_at: "2026-10-30T09:00:00Z", duration: 20_000 },
  { name: "No id, skipped" },
]

function enveloped(value: unknown) {
  const text = `Data below.\n<untrusted-user-data-ab12 source="plaud-recording">\n${JSON.stringify(value)}\n</untrusted-user-data-ab12>`
  return { content: [{ type: "text", text }] }
}

async function recent(list: (args: Record<string, unknown>) => unknown) {
  const added: Tool[] = []
  const calls: { id: string; args: Record<string, unknown> }[] = []
  const ctx: ToolsHost = {
    tool: {
      transform: async (callback) => {
        callback({ namespace: () => undefined, add: (tool: unknown) => added.push(tool as Tool) } as never)
        return { dispose: async () => undefined }
      },
      hook: (async () => ({ dispose: async () => undefined })) as ToolsHost["tool"]["hook"],
      list: async () =>
        [
          {
            id: "plaud_list_files",
            execute: async (args: Record<string, unknown>) => {
              calls.push({ id: "plaud_list_files", args })
              return list(args)
            },
          },
        ] as never,
    },
    permission: { assert: vi.fn(async () => undefined) },
  }
  await registerTools(ctx, { accounts: [], exportRoots: ["/tmp/plaud"], maxAudioBytes: 1, maxTextBytes: 1, exportTimeoutMs: 1_000 })
  const tool = added.find((entry) => entry.name === "recent")
  if (tool === undefined) throw new Error("recent was not registered")
  const run = async (input: unknown) => {
    const parsed = (await tool.input["~standard"].validate(input)) as { value?: unknown; issues?: unknown }
    if (parsed.issues) throw new Error(JSON.stringify(parsed.issues))
    const context = { sessionID: "ses_1", agent: "build", messageID: "msg_1", id: "call_1", signal: new AbortController().signal } as unknown as ToolContext
    return (await tool.execute(parsed.value, context)).output
  }
  return { tool, run, calls }
}

describe("plaud_recent", () => {
  it("lists the newest recordings as a Home list, through the server's own read", async () => {
    const { tool, run, calls } = await recent(() => enveloped({ type: "files", data: RECORDINGS, page: 1 }))
    const output = await run({ limit: 5 })
    expect(output).toEqual({
      items: [
        { id: "rec-2", text: "Design review · 2026-10-31 14:05 UTC · 1 h 3 min" },
        { id: "rec-1", text: "Untitled recording · 2026-10-30 09:00 UTC · 1 min" },
      ],
      editable: false,
    })
    expect(tool.output.parse(output)).toEqual(output)
    expect(calls).toEqual([{ id: "plaud_list_files", args: { page_size: 5 } }])
  })

  it("says what it could not read, rather than an empty list", async () => {
    const { run } = await recent(() => enveloped("Not a list"))
    await expect(run({})).rejects.toThrow(/PLAUD_UNREADABLE|instead of a list/)
  })

  it("refuses a limit outside 1 to 20", async () => {
    const { run } = await recent(() => enveloped([]))
    await expect(run({ limit: 0 })).rejects.toThrow()
    await expect(run({ limit: 21 })).rejects.toThrow()
  })

  it("keeps a line within a Home list item's 200 characters", () => {
    expect(line({ id: "x", name: "a".repeat(300) }).length).toBe(200)
  })

  it("runs without asking by default, like the server's reads", () => {
    expect(DEFAULT_RULES).toContainEqual({ action: RECENT_ACTION, resource: "*", effect: "allow" })
  })
})
