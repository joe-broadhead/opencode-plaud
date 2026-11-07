import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AUDIO_URL_NOTICE, DATA_LINK_NOTICE } from "../../src/domain/redact.js"
import { Plaud } from "../../src/rpc.js"
import { SIGNATURE, UPSTREAM_FAILURE } from "../fixtures/fake-plaud.js"
import { startHost, type Harness, type Rule } from "./harness.js"
import { WORKER_ROOT } from "./setup.js"

/**
 * The tools RPC, `plaud.recordings.tools`, in a real OpenCode host: a script calls Plaud's reads with no model, as a
 * session and its agent. Accounts as a user with two extra ones would have them: `team` is the plugin's own
 * `plaud-team` server, and `work` is a `plaud-work` server the user defined, which still needs sign-in. Two agents
 * exist only in the user's config, so they carry exactly their own rules after the host's: `locked` denies every
 * Plaud tool, and `careful` asks before notes. `recent` is the plugin's own plaud_recent, which reads the envelope's
 * account through that account's list_files. The user's own skills folder holds a skill with the id of one of the
 * plugin's, which OpenCode loads instead, so status names it.
 */

const RPC = "plaud.recordings.tools"
const METHODS = ["describe", "list_files", "get_file", "get_note", "get_transcript", "get_current_user", "export"]
const RECENT = { items: [{ id: "rec-1", text: "Weekly sync · 2026-10-01 09:00 UTC · 1 min" }], editable: false }
const rule = (action: string, effect: Rule["effect"]): Rule => ({ action, resource: "*", effect })

let host: Harness
const sessions: Record<string, string> = {}

/** One RPC call: `{ value }` with the method's output, or the error's type, code and message. */
async function script(method: string, input: unknown): Promise<Record<string, any>> {
  try {
    return { value: (await host.opencode.rpc.call({ rpcID: RPC, method, input: input as never, location: host.location })).output }
  } catch (error) {
    const e = error as { type?: string; data?: { code?: string; next?: string }; message?: string }
    return { type: e.type, code: e.data?.code, next: e.data?.next, message: String(e.message ?? e) }
  }
}
const call = (session: string, method: string, envelope: Record<string, unknown>) => script(method, { sessionID: sessions[session] ?? session, ...envelope })
/** The fake's tool calls since `from`. */
const toolCalls = (from = 0) => host.fake.calls.slice(from).map((entry) => entry.tool)

/** The user's own skill under a plugin skill's id. */
const SHADOW = join(WORKER_ROOT, "user-skills", "opencode-plaud-digest", "SKILL.md")

beforeAll(async () => {
  mkdirSync(dirname(SHADOW), { recursive: true })
  writeFileSync(SHADOW, "---\nname: opencode-plaud-digest\ndescription: The user's own digest skill.\n---\n\nThe user's own digest steps.\n")
  host = await startHost({
    options: { accounts: ["work", "team"] },
    config: (fake) => ({
      skills: [dirname(dirname(SHADOW))],
      agents: {
        locked: { description: "Denies Plaud", mode: "subagent", permissions: [rule("plaud*_*", "deny")] },
        careful: { description: "Asks before notes", mode: "subagent", permissions: [rule("plaud*_get_note", "ask")] },
      },
      mcp: { servers: { "plaud-work": { type: "remote", url: fake.authUrl } } },
    }),
  })
  await host.until("the Plaud servers to settle", async () => {
    const { data } = await host.opencode.mcp.list({ location: host.location })
    const status = (name: string) => data.find((server) => server.name === name)?.status.status
    return status("plaud") === "connected" && status("plaud-team") === "connected" && status("plaud-work") === "needs_auth" ? data : undefined
  })
  await host.until("the Plaud tools", async () => {
    const ids = (await host.tools()).map((tool) => tool.id)
    return ids.includes("plaud_get_current_user") && ids.includes("plaud-team_get_current_user") ? ids : undefined
  })
  const create = async (input: Record<string, unknown>) => (await host.opencode.sessions.create({ location: host.location, ...input })).id
  sessions.build = await create({ agent: "build" })
  sessions.locked = await create({ agent: "locked" })
  sessions.careful = await create({ agent: "careful" })
  sessions.agentless = await create({})
  // Session rules come after the agent's: one narrows build, the other reopens one read for locked.
  sessions.narrow = await create({ agent: "build", permissions: [rule("plaud_get_file", "deny")] })
  sessions.reopen = await create({ agent: "locked", permissions: [rule("plaud_list_files", "allow")] })
  // An allow rule for a tool the plugin does not know still makes no method.
  sessions.reckless = await create({ agent: "build", permissions: [rule("plaud*_*", "allow")] })
  // plaud_recent is allowed, but the read it makes is denied, or asks.
  sessions.unlisted = await create({ agent: "build", permissions: [rule("plaud_list_files", "deny")] })
  sessions.hesitant = await create({ agent: "build", permissions: [rule("plaud_list_files", "ask")] })
  // A script's own grant for one export, and nothing else: v2 needs a prior allow before an export writes a file.
  sessions.granted = await create({ agent: "build", permissions: [rule("plaud_export", "allow")] })
})

afterAll(async () => {
  await host?.close()
})

describe("the tools RPC in OpenCode", () => {
  it("describes every method with its class: the five reads, recent and export", async () => {
    const { value } = await script("describe", {})
    expect(value.id).toBe(RPC)
    expect(value.call).toContain(`"account":"<account>"`)
    expect(value.methods.map((method: { name: string }) => method.name)).toEqual(["list_files", "get_file", "get_note", "get_transcript", "get_current_user", "recent", "export"])
    for (const method of value.methods.slice(0, 5)) expect(method).toMatchObject({ kind: "mcp", class: "read", tool: `plaud_${method.name}`, action: `plaud_${method.name}`, available: true })
    expect(value.methods[5]).toMatchObject({ kind: "plugin", class: "read", tool: "recent", action: "plaud_recent", available: true, input: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 20 } }, additionalProperties: false } })
    expect(Object.keys(value.methods[5].input.properties)).toEqual(["limit"])
    expect(value.methods[6]).toMatchObject({ kind: "plugin", class: "export", tool: "export", action: "plaud_export", available: true })
    expect(Object.keys(value.methods[6].input.properties)).not.toContain("account")
    expect(value.methods[6].input.required).toContain("recordingId")
    expect(value.methods.find((method: { name: string }) => method.name === "get_file").input).toMatchObject({ properties: { file_id: { type: "string" } }, required: ["file_id"] })
    expect(Object.hasOwn(value.methods[0], "permission")).toBe(false)
    // With a session, describe gives each method's resolved permission.
    const resolved = (await script("describe", { sessionID: sessions.build })) as { value: { methods: { name: string; permission: string }[] } }
    const permission = Object.fromEntries(resolved.value.methods.map((method) => [method.name, method.permission]))
    expect(permission).toMatchObject({ list_files: "allow", recent: "allow", export: "ask" })
  })

  it("never makes an unknown Plaud tool a method, even with an allow rule", async () => {
    const from = host.fake.calls.length
    for (const method of ["delete_everything", "plaud_export", "plaud_recent"]) {
      const refused = await call("reckless", method, { input: {} })
      expect(refused.value, method).toBeUndefined()
      expect(refused.type, method).not.toBe("failed")
      expect(refused.message, method).toMatch(/not.?found|unknown/i)
    }
    expect(toolCalls(from)).toEqual([])
  })

  it("refuses export without a prior allow, before any read or prompt, and runs it with one", async () => {
    const from = host.fake.calls.length
    const refused = await call("build", "export", { input: { recordingId: "rec-1", kind: "note" } })
    expect(refused).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
    expect(refused.message).toContain("plaud_export would ask for this session's agent, and a script cannot answer")
    expect(await host.pending(sessions.build!)).toBe(0)
    expect(toolCalls(from)).toEqual([])
    const result = await call("granted", "export", { input: { recordingId: "rec-1", kind: "note" } })
    expect(result.value).toMatchObject({ path: expect.stringContaining(host.exportRoot), bytes: expect.any(Number), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(existsSync(result.value.path)).toBe(true)
    expect(await host.pending(sessions.granted!)).toBe(0)
  })

  it("runs a read as a session whose agent allows it, with no model turn and no prompt", async () => {
    const from = host.fake.calls.length
    const result = await call("build", "list_files", { input: { page_size: 10 } })
    expect(result.value.text).toContain(`"id": "rec-1"`)
    expect(result.value.text).toContain(`"duration": 63500`)
    // A result with no structured content, whose text is not JSON (it is in Plaud's envelope), has its text as output.
    expect(result.value.output).toBe(result.value.text)
    expect(host.fake.calls.slice(from)).toEqual([{ tool: "list_files", arguments: { page_size: 10 } }])
    const session = await host.opencode.sessions.get({ sessionID: sessions.build! })
    expect(session.tokens).toMatchObject({ input: 0, output: 0 })
    expect(await host.pending(sessions.build!)).toBe(0)
    expect(host.fake.model.requests).toEqual([])
  })

  it("never lets a signed link reach a script", async () => {
    for (const [method, account] of [["get_file", undefined], ["get_file", "team"], ["get_note", undefined]] as const) {
      const result = await call("build", method, { ...(account ? { account } : {}), input: { file_id: "rec-1" } })
      const serialised = JSON.stringify(result)
      expect(result.value, `${method} ${account}`).toBeDefined()
      for (const secret of [SIGNATURE, "X-Amz-Credential", "/audio/rec-1.mp3?", "/data/rec-1"]) expect(serialised, `${method} ${account}`).not.toContain(secret)
      if (method === "get_file") {
        expect(result.value.text).toContain(`"presigned_url":"${AUDIO_URL_NOTICE}"`)
        expect(result.value.text.split(`"data_link":"${DATA_LINK_NOTICE}"`)).toHaveLength(3)
      } else {
        expect(result.value.text).toContain(`"data_link":"${DATA_LINK_NOTICE}"`)
      }
    }
  })

  it("picks the account's server: the default, an alias, a user-defined server that needs sign-in, or none", async () => {
    const from = host.fake.calls.length
    // Plaud answers this one without its envelope, so OpenCode also parses the text into the output.
    const user = { id: "user-1", nickname: "Fixture" }
    expect((await call("build", "get_current_user", { account: "team", input: {} })).value).toEqual({ output: user, text: JSON.stringify(user) })
    expect((await call("build", "get_current_user", { account: "default", input: {} })).value).toMatchObject({ text: expect.stringContaining("user-1") })
    expect(toolCalls(from)).toEqual(["get_current_user", "get_current_user"])
    const work = await call("build", "list_files", { account: "work", input: {} })
    expect(work).toMatchObject({ type: "failed", code: "AUTH_REQUIRED" })
    expect(work.message).toContain(`the "plaud-work" server needs a sign-in`)
    const unknown = await call("build", "list_files", { account: "home", input: {} })
    expect(unknown).toMatchObject({ type: "failed", code: "ACCOUNT_UNKNOWN" })
    expect(unknown.next).toContain("/plaud-status")
    expect(toolCalls(from)).toHaveLength(2)
  })

  it("runs recent on the envelope's account, never asking Plaud for fewer than 10, and refuses an unknown account first", async () => {
    const from = host.fake.calls.length
    expect((await call("build", "recent", { input: {} })).value).toEqual(RECENT)
    expect((await call("build", "recent", { account: "team", input: { limit: 1 } })).value).toEqual(RECENT)
    expect((await call("build", "recent", { account: "default", input: { limit: 20 } })).value).toEqual(RECENT)
    expect(host.fake.calls.slice(from)).toEqual([
      { tool: "list_files", arguments: { page_size: 10 } },
      { tool: "list_files", arguments: { page_size: 10 } },
      { tool: "list_files", arguments: { page_size: 20 } },
    ])
    const unknown = await call("build", "recent", { account: "home", input: {} })
    expect(unknown).toMatchObject({ type: "failed", code: "ACCOUNT_UNKNOWN" })
    expect(unknown.next).toContain("/plaud-status")
    // plaud-work is the user's own server, still to sign in, so OpenCode lists no tool for it.
    const work = await call("build", "recent", { account: "work", input: {} })
    expect(work).toMatchObject({ type: "failed", code: "AUTH_REQUIRED" })
    expect(work.next).toContain("Plaud (work)")
    for (const input of [{ account: "team" }, { limit: 0 }, { limit: 21 }, "rec-1"]) {
      const invalid = await call("build", "recent", { input })
      expect(invalid, JSON.stringify(input)).toMatchObject({ type: "failed", code: "INPUT_INVALID" })
    }
    expect(host.fake.calls).toHaveLength(from + 3)
    expect(await host.pending(sessions.build!)).toBe(0)
  })

  it("refuses recent when the session's rules deny or ask for the read it makes, naming that read", async () => {
    const from = host.fake.calls.length
    // A deny: the message names the denied read, and the next step that rule (shared module v4).
    const denied = await call("unlisted", "recent", { input: {} })
    expect(denied).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
    expect(denied.message).toContain("plaud_recent needs plaud_list_files, which a deny rule refuses for this session's agent")
    expect(denied.next).toMatch(/^Remove or narrow the deny rule for plaud_list_files in the agent "build" or in the session/)
    // An ask: refused at once, with no prompt left waiting, and the message and next step name the read.
    const started = Date.now()
    const asked = await call("hesitant", "recent", { input: {} })
    expect(asked).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
    expect(asked.message).toContain("plaud_recent needs plaud_list_files, which was refused")
    expect(asked.next).toBe("Add an allow rule for plaud_list_files to the session's agent or to the session, or use a session whose agent allows it.")
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(await host.pending(sessions.hesitant!)).toBe(0)
    expect(toolCalls(from)).toEqual([])
  })

  it("refuses a session whose agent denies Plaud, before Plaud is called", async () => {
    const from = host.fake.calls.length
    for (const method of METHODS.slice(1)) expect(await call("locked", method, { input: { file_id: "rec-1" } }), method).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
    expect(await call("locked", "recent", { input: {} })).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
    expect(await call("reopen", "recent", { input: {} })).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
    // A deny names the denied read and says to change that rule (shared module v4).
    expect((await call("locked", "get_note", { input: { file_id: "rec-1" } })).next).toMatch(/^Remove or narrow the deny rule for plaud_get_note/)
    expect(toolCalls(from)).toEqual([])
  })

  it("refuses an ask at once, and leaves no approval prompt waiting", async () => {
    const from = host.fake.calls.length
    const started = Date.now()
    const result = await call("careful", "get_note", { input: { file_id: "rec-1" } })
    expect(result).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
    expect(result.message).toMatch(/would ask for this session's agent, and a script cannot answer/)
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(await host.pending(sessions.careful!)).toBe(0)
    expect(toolCalls(from)).toEqual([])
    // The same agent's other reads have no ask, so they run.
    expect((await call("careful", "list_files", { input: {} })).value).toMatchObject({ text: expect.stringContaining("rec-1") })
  })

  it("applies the session's rules after the agent's", async () => {
    expect(await call("narrow", "get_file", { input: { file_id: "rec-1" } })).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
    expect((await call("narrow", "get_file", { account: "team", input: { file_id: "rec-1" } })).value).toMatchObject({ text: expect.stringContaining("rec-1") })
    expect((await call("reopen", "list_files", { input: {} })).value).toMatchObject({ text: expect.stringContaining("rec-1") })
    expect(await call("reopen", "list_files", { account: "team", input: {} })).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
  })

  it("gives Plaud's own error as UPSTREAM_ERROR: its first line, with the signed link redacted", async () => {
    const result = await call("build", "get_file", { input: { file_id: "fail" } })
    expect(result).toMatchObject({ type: "failed", code: "UPSTREAM_ERROR" })
    expect(result.message).toContain("https://files.example.invalid/rec-fail.mp3?[redacted]")
    for (const hidden of [SIGNATURE, "second line"]) expect(result.message).not.toContain(hidden)
    expect(UPSTREAM_FAILURE).toContain(SIGNATURE)
  })

  it("names an unknown session and a session without an agent, and refuses a bad envelope before any call", async () => {
    const unknown = await call("ses_does_not_exist", "list_files", { input: {} })
    expect(unknown).toMatchObject({ type: "failed", code: "SESSION_UNKNOWN" })
    expect(unknown.next).toContain("x-opencode-directory")
    expect(await call("agentless", "list_files", { input: {} })).toMatchObject({ type: "failed", code: "SESSION_AGENT_REQUIRED" })
    const from = host.fake.calls.length
    for (const envelope of [
      { sessionID: sessions.build, input: {}, extra: true },
      { input: {} },
      { sessionID: sessions.build, input: "rec-1" },
      { sessionID: sessions.build, account: "", input: {} },
    ]) {
      expect(await script("list_files", envelope), JSON.stringify(envelope)).toMatchObject({ type: "rpc.invalid_input" })
    }
    expect(toolCalls(from)).toEqual([])
  })
})

describe("a skill that shadows one of the plugin's", () => {
  it("wins in OpenCode, and status names its file", async () => {
    const listed = (await host.opencode.skill.list({ location: host.location })).data.filter((skill) => skill.id === "opencode-plaud-digest")
    expect(listed.map((skill) => skill.path)).toEqual([SHADOW])
    const status = (await host.opencode.rpc(Plaud).status({}, { location: host.location })) as { shadowedSkills: unknown }
    expect(status.shadowedSkills).toEqual([{ id: "opencode-plaud-digest", path: SHADOW }])
  })
})
