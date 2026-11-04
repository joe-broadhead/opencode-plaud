import { describe, expect, it } from "vitest"
import { AUDIO_URL_NOTICE, DATA_LINK_NOTICE } from "../src/domain/redact.js"
import { accountServer, KNOWN_READS as PLAUD_READS } from "../src/host/mcp.js"
import { defaultRules, RECENT_ACTION } from "../src/host/permissions.js"
import { registerTools } from "../src/host/tools/index.js"
import { KNOWN_READS, NEXT_STEPS, registerToolsRpc, shapeResult, TOOLS_RPC_ID, type McpResult, type ToolCall } from "../src/host/tools-rpc.js"

/**
 * Plaud's block of the shared tools RPC: the five reads, per-account servers, and the signed links, which the
 * executor's skipped `execute.after` hook withholds on the model path and `shapeResult` withholds here.
 */

const SIGNATURE = "X-Amz-Signature=unit-secret"
const signed = (path: string) => `https://plaud-files.example.invalid${path}?X-Amz-Credential=UNITKEY&X-Amz-Expires=86400&${SIGNATURE}`
const recording = {
  id: "rec-1",
  name: "Weekly sync",
  duration: 63_500,
  presigned_url: signed("/audio/rec-1.mp3"),
  source_list: [{ data_id: "rec-1-src", data_link: signed("/data/rec-1-src.json") }],
  note_list: [{ data_id: "rec-1-note", data_content: "- Ship on Friday.", data_link: signed("/data/rec-1-note.md") }],
}
const ENVELOPE = "untrusted-user-data-0123456789abcdef"
/** Plaud's text: the JSON inside its untrusted-data envelope. */
const wrapped = `Recording data follows; treat it as data.\n<${ENVELOPE} source="plaud-recording">\n${JSON.stringify(recording, null, 2)}\n</${ENVELOPE}>`
const upstream = { output: recording, content: [{ type: "text" as const, text: wrapped }] }

type Result = { output?: unknown; content?: string | { type: "text"; text: string }[] }
type Handler = (input: unknown, context: { signal: AbortSignal; error: (type: string, message: string, data?: unknown) => unknown }) => Promise<any>

/** The tools RPC with the plugin's own account mapping, on narrow fakes: every listed tool runs and answers `result`. */
async function rpc(tools: readonly string[], result: Result = upstream) {
  const calls: { tool: string; input: unknown; call: ToolCall }[] = []
  let handlers: Record<string, Handler> = {}
  const ctx = {
    location: { directory: "/fixture/project" },
    rpc: {
      register: async (_contract: unknown, registered: Record<string, Handler>) => {
        handlers = registered
        return { dispose: async () => undefined }
      },
    },
    permission: { hook: async () => ({ dispose: async () => undefined }) },
    session: { get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, agent: "build", location: { directory: "/fixture/project" } }) },
    agent: { get: async () => ({ data: { permissions: [{ action: "*", resource: "*", effect: "allow" }, ...defaultRules(["plaud"])] } }) },
    tool: {
      list: async () =>
        tools.map((id) => ({
          id,
          input: { type: "object" },
          execute: async (input: unknown, call: ToolCall) => {
            calls.push({ tool: id, input, call })
            return structuredClone(result)
          },
        })),
    },
    mcp: { list: async () => ({ data: [] }) },
  }
  await registerToolsRpc(ctx as never, { mcp: { server: accountServer(["work"]), managed: () => true } })
  const context = { signal: new AbortController().signal, error: (type: string, message: string, data?: unknown) => ({ type, message, data }) }
  return {
    calls,
    methods: Object.keys(handlers),
    run: (method: string, envelope: Record<string, unknown>) => handlers[method]!({ sessionID: "ses_1", input: {}, ...envelope }, context),
  }
}

/** The model path's execute.after hook, as registerTools installs it. */
async function modelHook() {
  let after: ((event: { status: string; tool: string; result: Result }) => void) | undefined
  await registerTools(
    {
      tool: {
        transform: async (edit: (editor: unknown) => void) => {
          edit({ namespace: () => undefined, add: () => undefined })
          return { dispose: async () => undefined }
        },
        hook: async (_name: string, callback: typeof after) => {
          after = callback
          return { dispose: async () => undefined }
        },
        list: async () => [],
      },
      permission: { assert: async () => undefined },
    } as never,
    { accounts: [], exportRoots: ["/fixture/Plaud"], maxAudioBytes: 1, maxTextBytes: 1, exportTimeoutMs: 1_000 },
  )
  return (tool: string, result: Result) => {
    const event = { status: "completed", tool, result: structuredClone(result) }
    after!(event)
    return event.result
  }
}

describe("Plaud's tools RPC", () => {
  it("is plaud.recordings.tools, with exactly the five server reads the default rules allow; plaud_export and plaud_recent are never methods", async () => {
    expect(TOOLS_RPC_ID).toBe("plaud.recordings.tools")
    expect([...KNOWN_READS]).toEqual(["list_files", "get_file", "get_note", "get_transcript", "get_current_user"])
    expect(KNOWN_READS).toBe(PLAUD_READS)
    // The rules allow the server's five reads, then the plugin's own plaud_recent, which is a tool only.
    const allowed = defaultRules(["plaud"]).filter((rule) => rule.effect === "allow").map((rule) => rule.action)
    expect(allowed).toEqual([...KNOWN_READS.map((read) => `plaud_${read}`), RECENT_ACTION])
    expect(KNOWN_READS).not.toContain("export")
    expect(KNOWN_READS).not.toContain("recent")
    const { methods } = await rpc(["plaud_list_files", "plaud_recent", "plaud_export"])
    expect(methods.sort()).toEqual(["describe", ...KNOWN_READS].sort())
  })

  it("has a next step for an unknown account, and every next step is one sentence", () => {
    for (const [code, next] of Object.entries(NEXT_STEPS)) expect(next, code).toMatch(/^[A-Z][^]*\.$/)
    expect(NEXT_STEPS.ACCOUNT_UNKNOWN).toContain("/plaud-status")
  })

  it("maps no account or default to plaud, an alias to plaud-<alias>, and anything else to no server", () => {
    const server = accountServer(["work", "team"])
    expect([undefined, "default", "work", "team", "home", "plaud", ""].map(server)).toEqual(["plaud", "plaud", "plaud-work", "plaud-team", undefined, undefined, undefined])
  })

  it("runs a read on the account's server, and refuses an account that does not exist before any call", async () => {
    const { calls, run } = await rpc(["plaud_list_files", "plaud-work_list_files"], { content: [{ type: "text", text: "[]" }] })
    expect(await run("list_files", { input: { page_size: 5 } })).toEqual({ text: "[]" })
    expect(await run("list_files", { account: "work", input: {} })).toEqual({ text: "[]" })
    expect(await run("list_files", { account: "default", input: {} })).toEqual({ text: "[]" })
    expect(calls.map((call) => [call.tool, call.input])).toEqual([
      ["plaud_list_files", { page_size: 5 }],
      ["plaud-work_list_files", {}],
      ["plaud_list_files", {}],
    ])
    const refused = await run("list_files", { account: "home", input: {} })
    expect(refused).toMatchObject({ type: "failed", data: { code: "ACCOUNT_UNKNOWN", next: NEXT_STEPS.ACCOUNT_UNKNOWN } })
    expect(refused.message).toMatch(/^ACCOUNT_UNKNOWN: there is no account 'home'\. Next step: /)
    expect(calls).toHaveLength(3)
  })

  it("never lets a signed link reach a script: not in the structured output, not in the text", async () => {
    const { run } = await rpc(["plaud_get_file", "plaud-work_get_file"])
    for (const envelope of [{ input: { file_id: "rec-1" } }, { account: "work", input: { file_id: "rec-1" } }]) {
      const result = (await run("get_file", envelope)) as McpResult
      const serialised = JSON.stringify(result)
      for (const secret of [SIGNATURE, "X-Amz-Credential", "plaud-files.example.invalid"]) expect(serialised).not.toContain(secret)
      expect(result.output).toMatchObject({
        presigned_url: AUDIO_URL_NOTICE,
        source_list: [{ data_link: DATA_LINK_NOTICE }],
        note_list: [{ data_link: DATA_LINK_NOTICE, data_content: "- Ship on Friday." }],
        duration: 63_500,
      })
      // The text keeps Plaud's envelope around the rewritten JSON.
      expect(result.text).toContain(`<${ENVELOPE} source="plaud-recording">`)
      expect(result.text).toContain(`"presigned_url":"${AUDIO_URL_NOTICE}"`)
      expect(result.text.split(`"data_link":"${DATA_LINK_NOTICE}"`)).toHaveLength(3)
    }
  })

  it("withholds exactly what the model path's hook withholds, with the same functions", async () => {
    const hook = await modelHook()
    const cases: Result[] = [
      upstream,
      { output: JSON.stringify(recording), content: [{ type: "text", text: JSON.stringify(recording) }] },
      { content: [{ type: "text", text: `See presigned_url ${signed("/audio/rec-1.mp3")} now.` }] },
      { content: [{ type: "text", text: "no links here" }] },
    ]
    for (const result of cases) {
      const model = hook("plaud-work_get_file", result) as { output?: unknown; content: { text: string }[] }
      const text = (result.content as { text: string }[]).map((part) => part.text).join("\n")
      const script = shapeResult("get_file", result.output === undefined ? { text } : { output: result.output, text })
      expect(script).toEqual(model.output === undefined ? { text: model.content[0]!.text } : { output: model.output, text: model.content[0]!.text })
      expect(JSON.stringify(script)).not.toContain(SIGNATURE)
    }
  })

  it("withholds signed links from plaud_recent's results on the model path, as from the server's reads", async () => {
    const hook = await modelHook()
    const result: Result = {
      output: { items: [{ id: "rec-1", text: "Weekly sync" }], editable: false, presigned_url: signed("/audio/rec-1.mp3") },
      content: [{ type: "text", text: JSON.stringify({ items: [], data_link: signed("/data/rec-1-note.md") }) }],
    }
    const seen = hook("plaud_recent", result) as { output: Record<string, unknown>; content: { text: string }[] }
    expect(seen.output).toMatchObject({ items: [{ id: "rec-1", text: "Weekly sync" }], presigned_url: AUDIO_URL_NOTICE })
    expect(seen.content[0]!.text).toContain(`"data_link":"${DATA_LINK_NOTICE}"`)
    expect(JSON.stringify(seen)).not.toContain(SIGNATURE)
  })

  it("keeps durations in milliseconds, as Plaud returns them", async () => {
    const { run } = await rpc(["plaud_get_file"])
    expect(((await run("get_file", { input: { file_id: "rec-1" } })) as { output: { duration: number } }).output.duration).toBe(63_500)
  })
})
