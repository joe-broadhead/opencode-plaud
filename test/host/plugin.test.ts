import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AUDIO_URL_NOTICE, DATA_LINK_NOTICE } from "../../src/domain/redact.js"
import { Plaud } from "../../src/rpc.js"
import { PLUGIN_VERSION } from "../../src/version.js"
import { AUDIO_BYTES, SIGNATURE } from "../fixtures/fake-plaud.js"
import { defaultRules } from "../../src/host/permissions.js"
import { PLUGIN_ID, REPO, startHost, type Harness, type Rule } from "./harness.js"

/**
 * The plugin in a real OpenCode host, configured the way a user with two
 * extra accounts would: `team` is the plugin's own `plaud-team` server, and
 * `work` is a `plaud-work` server the user defined, which still needs sign-in.
 * The user's rules allow default-account transcripts and deny work audio, and
 * two agents exist only in the user's config: `reviewer` as is, and `fixed`
 * with the per-agent fix that status gives.
 */


/** The block for the three servers at this suite's access value, broad first: the last matching rule wins. */
const BLOCK: Rule[] = defaultRules(["plaud", "plaud-work", "plaud-team"], "ask-changes")
const USER_RULES: Rule[] = [
  { action: "plaud_export", resource: "default:transcript", effect: "allow" },
  { action: "plaud_export", resource: "work:audio", effect: "deny" },
]
const SKILLS = ["opencode-plaud", "opencode-plaud-digest", "opencode-plaud-export"]

let host: Harness

beforeAll(async () => {
  // The host runs at `ask-changes`, so an export still asks here: that is where the refusal and the fix are tested.
  host = await startHost({
    options: { accounts: ["work", "team"], access: "ask-changes" },
    config: (fake) => ({
      permissions: USER_RULES,
      agents: {
        reviewer: { description: "Defined only in the user's config", mode: "subagent" },
        fixed: { description: "Defined only in the user's config, with the fix", mode: "subagent", permissions: [...BLOCK, ...USER_RULES] },
        // Its own rules ask for everything, so Plaud's tools already ask there: status does not list it (LIVE-1).
        asker: { description: "Defined only in the user's config, asking for everything", mode: "subagent", permissions: [{ action: "*", resource: "*", effect: "ask" }] },
      },
      mcp: { servers: { "plaud-work": { type: "remote", url: fake.authUrl } } },
    }),
  })
  // Both of the plugin's servers connect to the fake; the user's plaud-work stops at sign-in.
  await host.until("the Plaud servers to settle", async () => {
    const { data } = await host.opencode.mcp.list({ location: host.location })
    const status = (name: string) => data.find((server) => server.name === name)?.status.status
    return status("plaud") === "connected" && status("plaud-team") === "connected" && status("plaud-work") === "needs_auth" ? data : undefined
  })
  // A connected server's tools are listed a moment later.
  await host.until("the Plaud tools", async () => {
    const ids = (await host.tools()).map((tool) => tool.id)
    return ids.includes("plaud_list_files") && ids.includes("plaud-team_list_files") ? ids : undefined
  })
})

afterAll(async () => {
  await host?.close()
})

const layout = (rules: readonly Rule[]) => rules.map((rule) => `${rule.effect} ${rule.action} ${rule.resource}`)
const files = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)).sort() : []
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex")
const mode = (path: string) => statSync(path).mode & 0o777

describe("activation and registration", () => {
  it("loads from the package as a local plugin with its server and TUI parts", () => {
    // features.rpc would mean a "./rpc" package export; the RPC itself is registered at setup.
    expect(host.plugin).toMatchObject({
      id: PLUGIN_ID,
      source: { type: "local", path: REPO },
      features: { server: true, tui: true },
      state: { status: "active" },
    })
  })

  it("registers plaud and plaud-team on the url option, and leaves the user's own plaud-work alone", async () => {
    const { data } = await host.opencode.mcp.list({ location: host.location })
    expect(Object.fromEntries(data.filter((server) => server.name.startsWith("plaud")).map((server) => [server.name, server.status.status]))).toEqual({
      plaud: "connected",
      "plaud-team": "connected",
      "plaud-work": "needs_auth",
    })
  })

  it("names each account's /connect entry Plaud or Plaud (<alias>)", async () => {
    const { data } = await host.opencode.mcp.list({ location: host.location })
    const names = async () =>
      Object.fromEntries(
        await Promise.all(
          data
            .filter((server) => server.name.startsWith("plaud") && server.integrationID)
            .map(async (server) => [server.name, (await host.opencode.integration.get({ integrationID: server.integrationID!, location: host.location })).data.name]),
        ),
      )
    const expected = { plaud: "Plaud", "plaud-team": "Plaud (team)", "plaud-work": "Plaud (work)" }
    await host.until("the /connect names", async () => (JSON.stringify(await names()) === JSON.stringify(expected) ? true : undefined))
    const listed = (await host.opencode.integration.list({ location: host.location })).data.filter((item) => item.name.startsWith("Plaud"))
    expect(listed.map((item) => item.name).sort()).toEqual(["Plaud", "Plaud (team)", "Plaud (work)"])
  })

  it("adds plaud_export and plaud_recent as its own tools, next to the server's own tools", async () => {
    const tools = (await host.tools()).filter((tool) => tool.id.startsWith("plaud"))
    expect(tools.map((tool) => tool.id).sort()).toEqual([
      "plaud-team_delete_everything",
      "plaud-team_get_current_user",
      "plaud-team_get_file",
      "plaud-team_get_note",
      "plaud-team_get_transcript",
      "plaud-team_list_files",
      "plaud_delete_everything",
      "plaud_export",
      "plaud_get_current_user",
      "plaud_get_file",
      "plaud_get_note",
      "plaud_get_transcript",
      "plaud_list_files",
      "plaud_recent",
    ])
    expect(tools.find((tool) => tool.id === "plaud_recent")?.options).toMatchObject({ namespace: "plaud" })
    const exporter = tools.find((tool) => tool.id === "plaud_export")
    expect(exporter?.options).toMatchObject({ namespace: "plaud", pinned: true })
    // The host refuses a result with `output` from a tool that declares no output schema.
    expect(exporter?.output).toBeDefined()
  })

  it("adds /plaud-status and the three skills from the package", async () => {
    const commands = (await host.opencode.command.list({ location: host.location })).data.filter((command) => command.name.startsWith("plaud"))
    expect(commands.map((command) => command.name)).toEqual(["plaud-status"])
    expect(commands[0]?.description).toMatch(/^Plaud: /)

    const skills = (await host.opencode.skill.list({ location: host.location })).data.filter((skill) => skill.id.startsWith("opencode-plaud"))
    expect(skills.map((skill) => skill.id).sort()).toEqual(SKILLS)
    for (const skill of skills) {
      expect(skill.path).toBe(join(REPO, "skills", skill.id, "SKILL.md"))
      expect(skill.content.length).toBeGreaterThan(200)
    }
  })
})

describe("default permission rules", () => {
  it("inserts the rules once, right after each agent's base allow, before the agent's own rules", async () => {
    const agents = (await host.opencode.agent.list({ location: host.location })).data
    const block = layout(BLOCK)
    for (const agent of agents.filter((item) => !["reviewer", "fixed", "asker"].includes(item.id))) {
      const rules = layout(agent.permissions)
      expect(rules.slice(0, BLOCK.length + 1), agent.id).toEqual(["allow * *", ...block])
      expect(rules.filter((rule) => rule === block[0]), agent.id).toHaveLength(1)
    }
    const rules = (id: string) => layout(agents.find((agent) => agent.id === id)?.permissions ?? [])
    expect(rules("plan").indexOf("deny edit *")).toBeGreaterThan(BLOCK.length)
    expect(rules("explore").indexOf("deny * *")).toBeGreaterThan(BLOCK.length)
    // Agents defined only in the user's config are created after plugins run.
    expect(rules("reviewer")).not.toContain(block[0])
  })

  it.each([
    ["build", "plaud_list_files", "*", "allow"],
    ["build", "plaud_get_file", "*", "allow"],
    ["build", "plaud_get_note", "*", "allow"],
    ["build", "plaud_get_transcript", "*", "allow"],
    ["build", "plaud_get_current_user", "*", "allow"],
    ["build", "plaud-team_get_file", "*", "allow"],
    ["build", "plaud_delete_everything", "*", "ask"],
    ["build", "plaud-work_login", "*", "ask"],
    // Only the configured servers' reads, by exact name (PLAUD-5).
    ["build", "plaud_bulk_get_file", "*", "ask"],
    ["build", "plaud-other_get_file", "*", "ask"],
    ["build", "plaudit_get_file", "*", "ask"],
    ["build", "plaud_export", "default:audio", "ask"],
    ["build", "plaud_export", "default:transcript", "allow"],
    ["build", "plaud_export", "work:audio", "deny"],
    ["build", "plaud_export", "work:note", "ask"],
    // The plugin's own read, by exact name, for every account.
    ["build", "plaud_recent", "default", "allow"],
    ["build", "plaud_recent", "team", "allow"],
    ["build", "plaud_recentx", "*", "ask"],
    ["plan", "plaud_recent", "default", "allow"],
    ["explore", "plaud_recent", "default", "deny"],
    ["plan", "plaud_export", "default:audio", "ask"],
    ["plan", "plaud_list_files", "*", "allow"],
    ["plan", "edit", "src/index.ts", "deny"],
    ["explore", "plaud_list_files", "*", "deny"],
    ["explore", "plaud_export", "default:audio", "deny"],
    ["reviewer", "plaud_export", "default:audio", "allow"],
    ["fixed", "plaud_export", "default:audio", "ask"],
    ["fixed", "plaud_export", "default:transcript", "allow"],
    ["fixed", "plaud_export", "work:audio", "deny"],
    ["fixed", "plaud_get_file", "*", "allow"],
    ["fixed", "plaud-work_delete_everything", "*", "ask"],
  ])("%s: %s %s is %s", async (agent, action, resource, effect) => {
    const sessionID = await host.session(agent)
    expect((await host.evaluate(sessionID, agent, action, resource)).effect).toBe(effect)
  })

  it("lets a saved Always allow win for that account and kind only, in every agent, never over a deny", async () => {
    const sessionID = await host.session("build")
    const pending = await host.evaluate(sessionID, "build", "plaud_export", "work:transcript", ["work:transcript"])
    expect(pending.effect).toBe("ask")
    await host.opencode.permission.reply({ sessionID, requestID: pending.id, decision: "always" })
    const { projectID } = await host.opencode.sessions.get({ sessionID })
    expect(await host.opencode.permission.saved.list({ projectID })).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "plaud_export", resource: "work:transcript" })]),
    )
    for (const [agent, resource, effect] of [
      ["build", "work:transcript", "allow"],
      ["plan", "work:transcript", "allow"],
      ["build", "work:note", "ask"],
      ["build", "work:audio", "deny"],
    ] as const) {
      expect((await host.evaluate(await host.session(agent), agent, "plaud_export", resource)).effect, `${agent} ${resource}`).toBe(effect)
    }
  })
})

describe("tools on the host", () => {
  it("runs the reads without a prompt and asks before a tool it does not know", async () => {
    const sessionID = await host.session()
    for (const [tool, input] of [
      ["plaud_list_files", {}],
      ["plaud_get_file", { file_id: "rec-1" }],
      ["plaud_get_note", { file_id: "rec-1" }],
      ["plaud_get_transcript", { file_id: "rec-1" }],
      ["plaud_get_current_user", {}],
      ["plaud-team_list_files", {}],
      ["plaud_recent", {}],
      ["plaud_recent", { account: "team", limit: 1 }],
    ] as const) {
      expect(await host.call(sessionID, tool, input), tool).toMatchObject({ ok: true })
      expect(await host.pending(sessionID), tool).toBe(0)
    }

    const unknown = host.call(sessionID, "plaud_delete_everything", {})
    expect(await host.asked(sessionID)).toMatchObject({ action: "plaud_delete_everything", resources: ["*"] })
    await host.opencode.permission.reply({ sessionID, requestID: (await host.asked(sessionID)).id, decision: "reject" })
    expect(await unknown).toMatchObject({ ok: false })
    expect(host.fake.calls.map((call) => call.tool)).not.toContain("delete_everything")
  })

  it("lists recent recordings through the account's own list_files, never asking Plaud for fewer than 10", async () => {
    const sessionID = await host.session()
    const from = host.fake.calls.length
    for (const input of [{}, { limit: 1 }, { account: "team", limit: 20 }]) {
      expect(await host.call(sessionID, "plaud_recent", input), JSON.stringify(input)).toEqual({
        ok: true,
        result: expect.objectContaining({ output: { items: [{ id: "rec-1", text: "Weekly sync · 2026-10-01 09:00 UTC · 1 min" }], editable: false } }),
      })
    }
    expect(host.fake.calls.slice(from)).toEqual([
      { tool: "list_files", arguments: { page_size: 10 } },
      { tool: "list_files", arguments: { page_size: 10 } },
      { tool: "list_files", arguments: { page_size: 20 } },
    ])
    expect(await host.pending(sessionID)).toBe(0)
  })

  it("asks before each export: a rejection writes nothing, an approval writes the file once", async () => {
    const sessionID = await host.session()
    const before = host.fake.downloads.length

    const rejected = host.call(sessionID, "plaud_export", { recordingId: "rec-1", kind: "audio" })
    const ask = await host.asked(sessionID)
    expect(ask).toMatchObject({
      action: "plaud_export",
      resources: ["default:audio"],
      save: ["default:audio"],
      metadata: { account: "default", kind: "audio", recordingId: "rec-1", destination: `${join(host.exportRoot, "audio")}/`, overwrite: false },
    })
    await host.opencode.permission.reply({ sessionID, requestID: ask.id, decision: "reject" })
    expect(await rejected).toMatchObject({ ok: false })
    expect(files(host.exportRoot)).toEqual([])
    expect(host.fake.downloads).toHaveLength(before)

    const approved = host.call(sessionID, "plaud_export", { recordingId: "rec-1", kind: "audio" })
    await host.opencode.permission.reply({ sessionID, requestID: (await host.asked(sessionID)).id, decision: "once" })
    const path = join(host.exportRoot, "audio", "rec-1.mp3")
    expect(await approved).toEqual({ ok: true, result: { output: { path, bytes: AUDIO_BYTES, sha256: sha256(path) } } })
    expect(files(host.exportRoot)).toEqual([path])
    expect([mode(path), mode(join(host.exportRoot, "audio"))]).toEqual([0o600, 0o700])
    expect(host.fake.downloads).toHaveLength(before + 1)
    // "once" is not remembered.
    const again = host.call(sessionID, "plaud_export", { recordingId: "rec-1", kind: "audio", destination: join(host.exportRoot, "again.mp3") })
    await host.opencode.permission.reply({ sessionID, requestID: (await host.asked(sessionID)).id, decision: "reject" })
    expect(await again).toMatchObject({ ok: false })
  })

  it("exports without asking where the user's rule allows it, through every transcript page", async () => {
    const sessionID = await host.session()
    const result = await host.call(sessionID, "plaud_export", { recordingId: "rec-1", kind: "transcript" })
    const path = join(host.exportRoot, "transcript", "rec-1.transaction.md")
    expect(result).toMatchObject({ ok: true, result: { output: { path } } })
    expect(await host.pending(sessionID)).toBe(0)
    const text = readFileSync(path, "utf8")
    // start_time is milliseconds: 61000 is one minute and one second in.
    expect(text).toContain("- [00:00:00] Alice: Hello.\n- [00:01:01] Bob: Bye.\n")
  })

  it("remembers Always allow for that account and kind", async () => {
    const sessionID = await host.session()
    const first = host.call(sessionID, "plaud_export", { account: "team", recordingId: "rec-1", kind: "note" })
    expect(await host.asked(sessionID)).toMatchObject({ resources: ["team:note"], save: ["team:note"] })
    await host.opencode.permission.reply({ sessionID, requestID: (await host.asked(sessionID)).id, decision: "always" })
    expect(await first).toMatchObject({ ok: true, result: { output: { path: join(host.exportRoot, "note", "rec-1.md") } } })
    expect(host.fake.calls.at(-1)).toEqual({ tool: "get_note", arguments: { file_id: "rec-1" } })

    const second = await host.call(await host.session(), "plaud_export", { account: "team", recordingId: "rec-1", kind: "note", overwrite: true })
    expect(second).toMatchObject({ ok: true })
  })

  it("is blocked without a prompt by the user's deny", async () => {
    const sessionID = await host.session()
    expect(await host.call(sessionID, "plaud_export", { account: "work", recordingId: "rec-1", kind: "audio" })).toEqual({
      ok: false,
      error: expect.stringContaining("Permission denied: plaud_export"),
    })
    expect(await host.pending(sessionID)).toBe(0)
  })

  it("names the sign-in step when the account's server is not signed in", async () => {
    const sessionID = await host.session()
    const running = host.call(sessionID, "plaud_export", { account: "work", recordingId: "rec-1", kind: "note" })
    await host.opencode.permission.reply({ sessionID, requestID: (await host.asked(sessionID)).id, decision: "once" })
    expect(await running).toEqual({ ok: false, error: expect.stringMatching(/AUTH_REQUIRED:.*Run \/connect and choose Plaud \(work\)/) })
  })

  it("withholds every signed link on the host's Code Mode path, and exports still read them", async () => {
    const sessionID = (
      await host.opencode.sessions.create({
        agent: "build",
        location: host.location,
        permissions: [{ action: "plaud_export", resource: "*", effect: "allow" }],
      })
    ).id
    const audio = join(host.exportRoot, "codemode", "rec-1.mp3")
    const note = join(host.exportRoot, "codemode", "rec-1.md")
    const seen = await host.codemode(
      sessionID,
      [
        'const file = await tools.plaud.get_file({ file_id: "rec-1" })',
        'const notes = await tools.plaud.get_note({ file_id: "rec-1" })',
        "const list = await tools.plaud.list_files({})",
        "const user = await tools.plaud.get_current_user({})",
        `const audio = await tools.plaud.export({ recordingId: "rec-1", kind: "audio", destination: ${JSON.stringify(audio)} })`,
        `const note = await tools.plaud.export({ recordingId: "rec-1", kind: "note", destination: ${JSON.stringify(note)} })`,
        'throw new Error("SEEN " + JSON.stringify({ file, notes, list, user, audio, note }))',
      ].join("\n"),
    )
    // Plaud's results are text in its untrusted-data envelope, so the program sees the text.
    const result = JSON.parse(/SEEN (\{.*\})/.exec(seen)?.[1] ?? "null") as Record<string, unknown>
    const file = result.file as string
    expect(file).toContain("<untrusted-user-data-")
    expect(file).toContain(`"presigned_url":"${AUDIO_URL_NOTICE}"`)
    // One data_link in source_list and one in note_list.
    expect(file.split(`"data_link":"${DATA_LINK_NOTICE}"`)).toHaveLength(3)
    expect(result.notes).toContain(`"data_link":"${DATA_LINK_NOTICE}"`)
    expect(JSON.stringify(result.user)).toContain('"nickname":"Fixture"')
    expect(seen).not.toContain(SIGNATURE)
    expect(seen).not.toContain("X-Amz-")
    // The exports read the raw results plugin-side: the audio from its link, the note from data_content.
    expect(result.audio).toEqual({ path: audio, bytes: AUDIO_BYTES, sha256: sha256(audio) })
    expect(result.note).toMatchObject({ path: note })
    expect(readFileSync(note, "utf8")).toContain("# Note\n\n## Summary\n\n- Ship on Friday.\n")
  })

  it("withholds every link from a failed Plaud call's error text on the host's Code Mode path (PLAUD-4)", async () => {
    const sessionID = await host.session()
    const seen = await host.codemode(
      sessionID,
      'try { await tools.plaud.get_file({ file_id: "fail" }) } catch (error) { throw new Error("SEEN " + String(error?.message ?? error)) }\nthrow new Error("no error")',
    )
    expect(seen).toContain("SEEN ")
    expect(seen).toContain("File not found: see [url withheld]")
    expect(seen).not.toContain(SIGNATURE)
    expect(seen).not.toContain("files.example.invalid")
  })

  it("refuses an export or an unknown tool in an unattended run that nobody can approve", async () => {
    const sessionID = await host.session()
    expect(await host.codemode(sessionID, 'await tools.plaud.export({ recordingId: "rec-1", kind: "note", overwrite: true }); throw new Error("ran")')).toContain(
      "Permission plaud_export needs approval",
    )
    expect(await host.codemode(sessionID, 'await tools.plaud.delete_everything({}); throw new Error("ran")')).toContain(
      "Permission plaud_delete_everything needs approval",
    )
    expect(host.fake.calls.map((call) => call.tool)).not.toContain("delete_everything")
  })
})

describe("status", () => {
  it("answers the status RPC with each account, the tools, the unguarded agents and the next step", async () => {
    const status = await host.opencode.rpc(Plaud).status({}, { location: host.location })
    expect(status).toEqual({
      version: PLUGIN_VERSION,
      state: "sign_in_required",
      access: "ask-changes",
      accounts: [
        { account: "default", server: "plaud", state: "signed_in" },
        { account: "work", server: "plaud-work", state: "sign_in_needed", userServer: true },
        { account: "team", server: "plaud-team", state: "signed_in" },
      ],
      exportRoots: [host.exportRoot],
      tools: { visible: 12, unknown: 2, unknownNames: ["delete_everything"] },
      host: { version: host.sdkVersion, range: ">=2.2.3 <2.3.0", tested: true },
      // asker's own rules already ask for every Plaud tool (LIVE-1).
      unguardedAgents: ["reviewer"],
      permissionsBlock: BLOCK,
      // OpenCode lists the plugin's skills under the paths the plugin gave, so none is shadowed.
      shadowedSkills: [],
      nextStep: "Run /connect and choose Plaud (work), then press o or Enter to open the sign-in page.",
    })
  })

  it("posts the same status for /plaud-status as a message, with no model turn", async () => {
    const sessionID = await host.session()
    await host.opencode.sessions.command({ sessionID, name: "plaud-status", text: "" })
    // resume: false queues the text in the session's inbox and starts no turn.
    const item = await host.until("the /plaud-status message", async () => {
      const event = host.events.find((entry) => entry.type === "session.inbox.enqueued" && entry.data?.sessionID === sessionID)
      return event?.data?.item as { type: string; payload: { text: string } } | undefined
    })
    expect(item.type).toBe("synthetic")
    const lines = item.payload.text.split("\n")
    expect(lines[0]).toBe("**Plaud status**")
    expect(lines).toContain("- Connection: default: connected; work: sign-in required; team: connected")
    expect(lines).toContain("- Account: default (server plaud), work (server plaud-work, from your OpenCode config), team (server plaud-team)")
    expect(lines).toContain("- Tools: 12 available, 2 unknown: delete_everything (they ask before running)")
    expect(lines.filter((line) => line === "- Agents without default rules: reviewer")).toHaveLength(1)
    expect(lines).toContain('  {"action":"plaud*_*","resource":"*","effect":"ask"},')
    expect(host.events.filter((event) => event.type === "session.execution.started" && event.data?.sessionID === sessionID)).toEqual([])
  })
})
