import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { Rpc } from "@opencode/plugin/rpc"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { manifest } from "../../src/manifest.js"
import { PLUGIN_ID, REPO, startHost, type Harness } from "./harness.js"
import { policy } from "./policy.js"

/**
 * The plugin in a real OpenCode host, configured the way a person with two Plaud accounts would: `work` and
 * `personal`, each its own MCP server on the loopback fake. The user's rules allow `external_directory` for the export
 * root (which is outside the project) and deny nothing.
 */

const EXPORT = { action: "plaud.export", resources: ["work:get_file", "work:get_note", "work:get_transcript"] }
const FILES = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)).sort() : []
const SHA = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex")
const MODE = (path: string) => statSync(path).mode & 0o777

/** A loose view of the host's RPC client, whose generated types name the plugin's own definition. */
type RpcCall = { readonly status: (input: unknown, options: { readonly location: unknown }) => Promise<unknown> }
const RpcClient = Rpc.define({ id: "plaud", methods: { status: { input: { type: "object", properties: {}, additionalProperties: false }, output: { type: "object", additionalProperties: true } } }, events: {} })
const rpc = (host: Harness) => (host.opencode as unknown as { rpc: (definition: unknown) => RpcCall }).rpc(RpcClient)

let host: Harness

beforeAll(async () => {
  host = await startHost({
    options: { accounts: { work: {}, personal: {} }, access: "ask-changes" },
    config: (fake) => ({
      permissions: [{ action: "external_directory", resource: "*", effect: "allow" }],
      // A server the user defined; the plugin must leave it alone, and it never completes a sign-in.
      mcp: { servers: { "plaud-team": { type: "remote", url: fake.authUrl } } },
    }),
  })
  // Both of the plugin's servers connect to the fake; the user's own server needs an OAuth sign-in it never gets.
  await host.until("the Plaud servers to settle", async () => {
    const { data } = await host.opencode.mcp.list({ location: host.location })
    const status = (name: string) => data.find((server) => server.name === name)?.status.status
    return status("plaud-work") === "connected" && status("plaud-personal") === "connected" && status("plaud-team") === "needs_auth" ? data : undefined
  })
  await host.until("the Plaud tools", async () => {
    const ids = (await host.tools()).map((tool) => tool.id)
    return ids.includes("plaud-work_list_files") && ids.includes("plaud-personal_list_files") ? ids : undefined
  })
})

afterAll(async () => {
  await host?.close()
})

describe("activation and registration", () => {
  it("loads from the package as a local plugin under the name plaud", () => {
    expect(host.plugin).toMatchObject({ id: PLUGIN_ID, source: { type: "local", path: REPO }, state: { status: "active" } })
  })

  it("registers plaud-work and plaud-personal on the url option, and leaves another server alone", async () => {
    const { data } = await host.opencode.mcp.list({ location: host.location })
    expect(Object.fromEntries(data.filter((server) => server.name.startsWith("plaud")).map((server) => [server.name, server.status.status]))).toEqual({
      "plaud-team": "needs_auth",
      "plaud-personal": "connected",
      "plaud-work": "connected",
    })
  })

  it("registers its six methods as tools next to the server's own tools", async () => {
    const ids = (await host.tools()).map((tool) => tool.id).filter((id) => id.startsWith("plaud"))
    expect(ids.sort()).toEqual(
      [
        "plaud-personal_get_current_user",
        "plaud-personal_get_file",
        "plaud-personal_get_note",
        "plaud-personal_get_transcript",
        "plaud-personal_list_files",
        "plaud-work_get_current_user",
        "plaud-work_get_file",
        "plaud-work_get_note",
        "plaud-work_get_transcript",
        "plaud-work_list_files",
        "plaud_events_list",
        "plaud_export",
        "plaud_plan_export",
        "plaud_probe",
        "plaud_recent",
        "plaud_status",
      ].sort(),
    )
    expect((await host.tools()).find((tool) => tool.id === "plaud_export")?.output).toBeDefined()
  })
})

describe("doors", () => {
  it("runs every read as a tool, and a page after its account's probe", async () => {
    const sessionID = await host.session()
    expect(await host.call(sessionID, "plaud_probe", { account: "work" }, "build")).toMatchObject({ ok: true, result: { output: { account: "work", owner: { id: "plaud:user-1" } } } })
    expect(await host.call(sessionID, "plaud_probe", { account: "personal" }, "build")).toMatchObject({ ok: true })
    expect(await host.call(sessionID, "plaud_recent", { account: "work", limit: 2 }, "build")).toMatchObject({ ok: true, result: { output: { data: { items: expect.any(Array) } } } })
    expect(await host.call(sessionID, "plaud_events_list", { source: "recordings", account: "work" }, "build")).toMatchObject({ ok: true })
    expect(await host.call(sessionID, "plaud_recent", { account: "personal" }, "build")).toMatchObject({ ok: true })
  })

  it("answers status over RPC under the id plaud", async () => {
    const sessionID = await host.session()
    const status = (await rpc(host).status({ sessionID, input: {} }, { location: host.location })) as Record<string, unknown>
    expect(status).toMatchObject({
      name: "plaud",
      version: "0.0.0",
      host: { version: host.sdkVersion, range: ">=2.4.1 <2.5.0", tested: ["2.4.1"] },
      state: "ready",
      accounts: [
        { alias: "work", state: "ready" },
        { alias: "personal", state: "ready" },
      ],
      nextStep: null,
    })
  })

  it("refuses to collect without an account, and one it does not serve", async () => {
    const sessionID = await host.session()
    expect(await host.call(sessionID, "plaud_recent", {}, "build")).toMatchObject({ ok: false, error: expect.stringContaining("ACCOUNT_REQUIRED") })
    expect(await host.call(sessionID, "plaud_recent", { account: "nobodyhere" }, "build")).toMatchObject({ ok: false, error: expect.stringContaining("ACCOUNT_UNKNOWN") })
  })

  it("refuses another account's cursor", async () => {
    const sessionID = await host.session()
    await host.call(sessionID, "plaud_probe", { account: "personal" }, "build")
    await host.call(sessionID, "plaud_probe", { account: "work" }, "build")
    const page = (await host.call(sessionID, "plaud_events_list", { source: "recordings", account: "work" }, "build")) as { result: { output: { cursor: string } } }
    expect(await host.call(sessionID, "plaud_events_list", { source: "recordings", account: "personal", cursor: page.result.output.cursor }, "build")).toMatchObject({
      ok: false,
      error: expect.stringContaining("CURSOR_INVALID"),
    })
  })
})

describe("access", () => {
  it("asks before an export, writes nothing on a refusal, and writes on an approval", async () => {
    const sessionID = await host.session()
    const before = FILES(host.exportRoot)
    const plan = (await host.call(sessionID, "plaud_plan_export", { account: "work", recordingId: "rec-1", kind: "note" }, "build")) as { result: { output: { planId: string; output: { path: string } } } }
    const running = host.call(sessionID, "plaud_export", { planId: plan.result.output.planId }, "build")
    const ask = await host.asked(sessionID)
    expect(ask).toMatchObject(EXPORT)
    await host.opencode.permission.reply({ sessionID, requestID: ask.id, decision: "reject" })
    expect(await running).toMatchObject({ ok: false })
    expect(FILES(host.exportRoot)).toEqual(before)

    const approved = (await host.call(sessionID, "plaud_plan_export", { account: "work", recordingId: "rec-1", kind: "note" }, "build")) as { result: { output: { planId: string; output: { path: string } } } }
    const again = host.call(sessionID, "plaud_export", { planId: approved.result.output.planId }, "build")
    await host.opencode.permission.reply({ sessionID, requestID: (await host.asked(sessionID)).id, decision: "once" })
    expect(await again).toMatchObject({ ok: true, result: { output: { output: { path: approved.result.output.output.path, sha256: SHA(approved.result.output.output.path) } } } })
    expect(MODE(approved.result.output.output.path)).toBe(0o600)
  })

  it("lets a plan name the file, and the commit writes exactly it", async () => {
    const sessionID = await host.session()
    const path = join(host.exportRoot, "chosen", "note.md")
    const plan = (await host.call(sessionID, "plaud_plan_export", { account: "work", recordingId: "rec-1", kind: "note", destination: path }, "build")) as { result: { output: { planId: string; output: { path: string } } } }
    expect(plan.result.output.output.path).toBe(path)
    const running = host.call(sessionID, "plaud_export", { planId: plan.result.output.planId }, "build")
    await host.opencode.permission.reply({ sessionID, requestID: (await host.asked(sessionID)).id, decision: "once" })
    expect(await running).toMatchObject({ ok: true, result: { output: { output: { path } } } })
    expect(readFileSync(path, "utf8")).toContain("# Note")
  })

  it("refuses an export whose external_directory rule denies the folder, and asks nobody", async () => {
    const sessionID = (await host.opencode.sessions.create({ agent: "build", location: host.location, permissions: [{ action: "external_directory", resource: join(host.exportRoot, "denied", "*"), effect: "deny" }, { action: "plaud.export", resource: "*", effect: "allow" }] })).id
    const plan = (await host.call(sessionID, "plaud_plan_export", { account: "work", recordingId: "rec-1", kind: "note", destination: join(host.exportRoot, "denied", "note.md") }, "build")) as { result: { output: { planId: string } } }
    expect(await host.call(sessionID, "plaud_export", { planId: plan.result.output.planId }, "build")).toMatchObject({ ok: false, error: expect.stringContaining("PERMISSION_DENIED") })
    expect(await host.pending(sessionID)).toBe(0)
    expect(existsSync(join(host.exportRoot, "denied", "note.md"))).toBe(false)
  })

  it("fails closed on an external_directory ask, with no prompt", async () => {
    const sessionID = (await host.opencode.sessions.create({ agent: "build", location: host.location, permissions: [{ action: "external_directory", resource: join(host.exportRoot, "maybe", "*"), effect: "ask" }, { action: "plaud.export", resource: "*", effect: "allow" }] })).id
    const plan = (await host.call(sessionID, "plaud_plan_export", { account: "work", recordingId: "rec-1", kind: "note", destination: join(host.exportRoot, "maybe", "note.md") }, "build")) as { result: { output: { planId: string } } }
    expect(await host.call(sessionID, "plaud_export", { planId: plan.result.output.planId }, "build")).toMatchObject({ ok: false, error: expect.stringContaining("PERMISSION_DENIED") })
    expect(await host.pending(sessionID)).toBe(0)
  })

  it("is not stopped by a policy plugin's permission.evaluate hook, the documented hole", async () => {
    const guarded = await startHost({
      options: { accounts: { work: {} }, access: "all" },
      config: { permissions: [{ action: "external_directory", resource: "*", effect: "allow" }] },
      plugins: [policy],
    })
    try {
      await guarded.until("the Plaud tools", async () => ((await guarded.tools()).some((tool) => tool.id === "plaud-work_list_files") ? true : undefined))
      const sessionID = await guarded.session()
      const plan = (await guarded.call(sessionID, "plaud_plan_export", { recordingId: "rec-1", kind: "note" }, "build")) as { result: { output: { planId: string } } }
      // The hook denies every external_directory evaluation; the export's own gate reads the agent's and session's rules
      // only, so it writes. docs/security.md states the hole; a deny in the rules themselves still refuses.
      expect(await guarded.call(sessionID, "plaud_export", { planId: plan.result.output.planId }, "build")).toMatchObject({ ok: true })
    } finally {
      await guarded.close()
    }
  })

  it("does not see a saved external_directory approval: the gate reads only the agent's and session's rules", async () => {
    const folder = join(host.exportRoot, "saved")
    const sessionID = (await host.opencode.sessions.create({ agent: "build", location: host.location, permissions: [{ action: "external_directory", resource: join(folder, "*"), effect: "ask" }, { action: "plaud.export", resource: "*", effect: "allow" }] })).id
    const pending = await host.evaluate(sessionID, "build", "external_directory", join(folder, "*"), [join(folder, "*")])
    expect(pending.effect).toBe("ask")
    await host.opencode.permission.reply({ sessionID, requestID: pending.id, decision: "always" })
    const plan = (await host.call(sessionID, "plaud_plan_export", { account: "work", recordingId: "rec-1", kind: "note", destination: join(folder, "note.md") }, "build")) as { result: { output: { planId: string } } }
    expect(await host.call(sessionID, "plaud_export", { planId: plan.result.output.planId }, "build")).toMatchObject({ ok: false, error: expect.stringContaining("PERMISSION_DENIED") })
  })
})

describe("Code Mode", () => {
  it("runs the reads and refuses an export nobody can approve", async () => {
    const sessionID = await host.session()
    const seen = await host.codemode(sessionID, 'const recent = await tools.plaud.recent({ account: "work", limit: 1 })\nthrow new Error("SEEN " + JSON.stringify(recent))')
    expect(seen).toContain("SEEN ")
    expect(seen).toContain("rec-1")
    const plan = await host.codemode(sessionID, 'try { await tools.plaud.export({ planId: (await tools.plaud.plan_export({ account: "work", recordingId: "rec-1", kind: "note" })).planId }) } catch (error) { throw new Error("SEEN " + String(error?.message ?? error)) }\nthrow new Error("ran")')
    expect(plan).toContain("Permission plaud.export needs approval")
    expect(await host.pending(sessionID)).toBe(0)
  })
})

describe("other access levels", () => {
  it("runs the export without asking at access all", async () => {
    const all = await startHost({ options: { accounts: { work: {} }, access: "all" }, config: { permissions: [{ action: "external_directory", resource: "*", effect: "allow" }] } })
    try {
      await all.until("the Plaud tools", async () => ((await all.tools()).some((tool) => tool.id === "plaud-work_list_files") ? true : undefined))
      const sessionID = await all.session()
      const plan = (await all.call(sessionID, "plaud_plan_export", { account: "work", recordingId: "rec-1", kind: "note" }, "build")) as { result: { output: { planId: string; output: { path: string } } } }
      expect(await all.call(sessionID, "plaud_export", { planId: plan.result.output.planId }, "build")).toMatchObject({ ok: true, result: { output: { output: { path: plan.result.output.output.path } } } })
      expect(await all.pending(sessionID)).toBe(0)
    } finally {
      await all.close()
    }
  })

  it("denies the export at access read-only", async () => {
    const readOnly = await startHost({ options: { accounts: { work: {} }, access: "read-only" }, config: { permissions: [{ action: "external_directory", resource: "*", effect: "allow" }] } })
    try {
      await readOnly.until("the Plaud tools", async () => ((await readOnly.tools()).some((tool) => tool.id === "plaud-work_list_files") ? true : undefined))
      const sessionID = await readOnly.session()
      const plan = (await readOnly.call(sessionID, "plaud_plan_export", { account: "work", recordingId: "rec-1", kind: "note" }, "build")) as { result: { output: { planId: string } } }
      expect(await readOnly.call(sessionID, "plaud_export", { planId: plan.result.output.planId }, "build")).toMatchObject({ ok: false, error: expect.stringContaining("Permission denied: plaud.export") })
      expect(await readOnly.pending(sessionID)).toBe(0)
    } finally {
      await readOnly.close()
    }
  })
})

describe("one account", () => {
  it("serves the default alias on the plaud server and needs no account", async () => {
    const single = await startHost({ options: { access: "all" }, config: { permissions: [{ action: "external_directory", resource: "*", effect: "allow" }] } })
    try {
      await single.until("the plaud server", async () => {
        const { data } = await single.opencode.mcp.list({ location: single.location })
        return data.find((server) => server.name === "plaud")?.status.status === "connected" ? true : undefined
      })
      await single.until("the Plaud tools", async () => ((await single.tools()).some((tool) => tool.id === "plaud_list_files") ? true : undefined))
      const sessionID = await single.session()
      expect(await single.call(sessionID, "plaud_probe", {}, "build")).toMatchObject({ ok: true, result: { output: { account: "default" } } })
      expect(await single.call(sessionID, "plaud_recent", {}, "build")).toMatchObject({ ok: true })
      expect(await single.call(sessionID, "plaud_recent", { account: "work" }, "build")).toMatchObject({ ok: false, error: expect.stringContaining("ACCOUNT_UNKNOWN") })
    } finally {
      await single.close()
    }
  })
})

describe("the namespace line", () => {
  it("is the manifest's summary, within the budget", () => {
    expect(manifest.plugin.summary.length).toBeLessThanOrEqual(400)
    expect(manifest.plugin.summary).not.toMatch(/tools\.plaud\./)
  })
})
