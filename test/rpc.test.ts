import { describe, expect, it, vi } from "vitest"
import { signInStep } from "../src/domain/auth.js"
import { defaultRules } from "../src/host/permissions.js"
import { registerRpc } from "../src/host/rpc.js"
import { Plaud, READY_STEP, RPC_ID, StatusSchema, isStatus, overallState, rulesBlock, statusLines, type Status } from "../src/rpc.js"
import { AGENTS_STEP, buildStatus, readStatus, statusUnavailable, type StatusFacts } from "../src/status.js"
import { checkHost, PLUGIN_VERSION } from "../src/version.js"
import { schemaProblems } from "./json-schema.js"

const READS = ["list_files", "get_file", "get_note", "get_transcript", "get_current_user"]
const BASE_ALLOW = { action: "*", resource: "*", effect: "allow" } as const
/** The block for the two servers of `facts()`. */
const DEFAULT_RULES = defaultRules(["plaud", "plaud-work"])
const guarded = (id: string) => ({ id, permissions: [BASE_ALLOW, ...DEFAULT_RULES] })

const OWN_SKILLS = ["opencode-plaud", "opencode-plaud-digest", "opencode-plaud-export"].map((id) => ({ id, path: `/pkg/skills/${id}/SKILL.md` }))

function facts(overrides: Partial<StatusFacts> = {}): StatusFacts {
  return {
    host: checkHost("2.2.3", false),
    servers: [
      { account: "default", name: "plaud" },
      { account: "work", name: "plaud-work" },
    ],
    inUse: [],
    exportRoots: ["/fixture/Plaud"],
    mcp: [
      { name: "plaud", status: { status: "connected" } },
      { name: "plaud-work", status: { status: "connected" } },
    ],
    tools: [...READS.map((name) => `plaud_${name}`), ...READS.map((name) => `plaud-work_${name}`), "plaud_export", "github_get_me"],
    agents: [guarded("build"), guarded("plan")],
    skills: OWN_SKILLS,
    ownSkills: OWN_SKILLS,
    ...overrides,
  }
}

type McpEntry = StatusFacts["mcp"][number]

describe("status model", () => {
  it("is ready when every account is signed in and every agent has the rules", () => {
    const status = buildStatus(facts())
    expect(schemaProblems(StatusSchema, status)).toEqual([])
    expect(isStatus(status)).toBe(true)
    expect(status.accounts).toEqual([
      { account: "default", server: "plaud", state: "signed_in" },
      { account: "work", server: "plaud-work", state: "signed_in" },
    ])
    expect(status.tools).toEqual({ visible: 11, unknown: 0, unknownNames: [] })
    expect(status.nextStep).toBe(READY_STEP)
    expect(overallState(status)).toBe("signed_in")
    // The shared status fields (S13).
    expect(status).toMatchObject({ version: PLUGIN_VERSION, state: "connected", host: { version: "2.2.3", range: ">=2.2.3 <2.3.0", tested: true }, unguardedAgents: [] })
    expect(statusLines(status).map((line) => line.label)).toEqual(["Connection", "Account", "Access", "Tools", "Agents without default rules", "OpenCode", "Next step"])
    expect(statusLines(status).find((line) => line.label === "Agents without default rules")).toEqual({ label: "Agents without default rules", value: "none", tone: "info" })
    expect(statusLines(status).at(-1)).toEqual({ label: "Next step", value: READY_STEP, tone: "info" })
    expect(statusLines(status).find((line) => line.label === "Tools")?.value).toBe("11 available")
    expect(statusLines(status).find((line) => line.label === "Access")?.value).toBe("Reads run without asking. Exports ask, and write only in /fixture/Plaud.")
    expect(rulesBlock(status)).toBeUndefined()
  })

  it("counts the Plaud servers' unknown tools and names the plain ones", () => {
    const unknown = ["plaud_delete_file", "plaud-work_delete_file", "plaud_share<script>", "plaudx_list_files", "plaud-other_list_files"]
    const status = buildStatus(facts({ tools: [...facts().tools, ...unknown] }))
    expect(status.tools).toEqual({ visible: 11, unknown: 3, unknownNames: ["delete_file"] })
    expect(statusLines(status).find((line) => line.label === "Tools")?.value).toBe("11 available, 3 unknown: delete_file (they ask before running)")
  })

  it("counts plaud_recent as the plugin's own tool, not an unknown server tool", () => {
    const status = buildStatus(facts({ tools: [...facts().tools, "plaud_recent"] }))
    expect(status.tools).toEqual({ visible: 12, unknown: 0, unknownNames: [] })
    expect(statusLines(status).find((line) => line.label === "Tools")?.value).toBe("12 available")
  })

  it("maps every OpenCode MCP state, and a server OpenCode does not list", () => {
    const mcp: McpEntry[] = [
      { name: "plaud", status: { status: "needs_auth", error: "unauthorized" } },
      { name: "plaud-a", status: { status: "pending" } },
      { name: "plaud-b", status: { status: "failed", error: "fetch failed" } },
      { name: "plaud-c", status: { status: "disabled" } },
    ]
    const servers = ["default", "a", "b", "c", "d"].map((account) => ({ account, name: account === "default" ? "plaud" : `plaud-${account}` }))
    const status = buildStatus(facts({ servers, mcp }))
    expect(status.accounts.map((account) => account.state)).toEqual(["sign_in_needed", "connecting", "failed", "disabled", "missing"])
    expect(status.state).toBe("sign_in_required")
    expect(status.accounts[2]!.reason).toBe("fetch failed")
    expect(status.nextStep).toBe(signInStep("default"))
    expect(overallState(status)).toBe("sign_in_needed")
    expect(schemaProblems(StatusSchema, JSON.parse(JSON.stringify(status)))).toEqual([])
  })

  it("names the sign-in command for each account that needs it", () => {
    const status = buildStatus(
      facts({
        mcp: [
          { name: "plaud", status: { status: "connected" } },
          { name: "plaud-work", status: { status: "needs_auth", error: "401" } },
        ],
      }),
    )
    expect(status.nextStep).toBe(signInStep("work"))
    expect(status.nextStep).toBe("Run /connect and choose Plaud (work), then press o or Enter to open the sign-in page.")
    expect(statusLines(status).find((line) => line.label === "Connection")).toEqual({
      label: "Connection",
      value: "default: connected; work: sign-in required",
      tone: "warning",
    })
  })

  it("withholds links and shortens OpenCode's failure text", () => {
    const error = `connect failed for https://mcp.example.test/mcp?token=abc ${"x".repeat(400)}`
    const status = buildStatus(facts({ mcp: [{ name: "plaud", status: { status: "failed", error } }] }))
    const reason = status.accounts[0]!.reason!
    expect(reason).not.toMatch(/https?:|token=/)
    expect(reason).toContain("[url withheld]")
    expect(reason.length).toBeLessThanOrEqual(200)
  })

  it("marks a server the user's config defines", () => {
    const status = buildStatus(facts({ inUse: ["plaud"] }))
    expect(status.accounts[0]).toEqual({ account: "default", server: "plaud", state: "signed_in", userServer: true })
    expect(statusLines(status)[1]).toEqual({ label: "Account", value: "default (server plaud, from your OpenCode config), work (server plaud-work)", tone: "info" })
  })

  it("names agents without the default rules and gives the per-agent fix", () => {
    const status = buildStatus(
      facts({
        agents: [
          guarded("build"),
          { id: "reviewer", permissions: [BASE_ALLOW] },
          { id: "explore", permissions: [BASE_ALLOW, ...DEFAULT_RULES, { action: "*", resource: "*", effect: "deny" }] },
          { id: "locked", permissions: [{ action: "*", resource: "*", effect: "deny" }] },
          // Its own rules end with an ask for everything, so every Plaud tool already asks there (LIVE-1).
          { id: "perf-probe", permissions: [BASE_ALLOW, { action: "*", resource: "*", effect: "ask" }] },
        ],
      }),
    )
    expect(status.unguardedAgents).toEqual(["reviewer"])
    expect(status.permissionsBlock).toEqual(DEFAULT_RULES)
    // The family's one sentence, verbatim, with no agent names (TRIAGE 1).
    expect(status.nextStep).toBe(AGENTS_STEP)
    expect(AGENTS_STEP).toBe("Put the default rules shown by /plaud-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Plaud tools.")
    expect(JSON.parse(rulesBlock(status)!)).toEqual(DEFAULT_RULES)
    const agents = statusLines(status).find((line) => line.label === "Agents without default rules")
    expect(agents).toMatchObject({ tone: "warning", block: rulesBlock(status) })
    expect(agents?.value).toBe("reviewer")
    expect(statusLines(status).map((line) => line.label)).toEqual(["Connection", "Account", "Access", "Tools", "Agents without default rules", "OpenCode", "Next step"])
    expect(overallState(status)).toBe("signed_in")
  })

  it("calls 2.2.5 tested, and a release inside or outside the range that is not tested untested (INSTALL-4)", () => {
    const tested = buildStatus(facts({ host: checkHost("2.2.5", false) }))
    expect(tested.host).toEqual({ version: "2.2.5", range: ">=2.2.3 <2.3.0", tested: true })
    expect(statusLines(tested).find((line) => line.label === "OpenCode")).toEqual({ label: "OpenCode", value: "2.2.5 (tested; supported range >=2.2.3 <2.3.0)", tone: "info" })
    // Inside the range, an untested release sets up normally: the state and the next step are unchanged by it (S13).
    for (const [version, allow, nextStep] of [
      ["2.2.6", false, READY_STEP],
      ["2.3.0", true, "If Plaud misbehaves, use a tested OpenCode release: 2.2.3, 2.2.4 or 2.2.5."],
    ] as const) {
      const status = buildStatus(facts({ host: checkHost(version, allow) }))
      expect(status.host).toEqual({ version, range: ">=2.2.3 <2.3.0", tested: false })
      expect(status.state).toBe("connected")
      expect(status.nextStep).toBe(nextStep)
      expect(statusLines(status).find((line) => line.label === "OpenCode")).toEqual({ label: "OpenCode", value: `${version} (untested; supported range >=2.2.3 <2.3.0)`, tone: "warning" })
    }
    expect(buildStatus(facts({ host: checkHost("", true) })).host.version).toBeNull()
  })

  it("reads OpenCode's MCP list, tools and agents through public APIs", async () => {
    const mcp = vi.fn(async () => ({ location: {}, data: [{ name: "plaud", status: { status: "needs_auth", error: "401" } }] }))
    const tools = vi.fn(async () => [{ id: "plaud_export" }, { id: "plaud_get_file" }, { id: "plaud_rename" }])
    const agents = vi.fn(async () => ({ location: {}, data: [{ id: "reviewer", permissions: [BASE_ALLOW] }] }))
    const skills = vi.fn(async () => ({ location: {}, data: [{ id: "opencode-plaud", path: "/home/u/.config/opencode/skills/opencode-plaud/SKILL.md" }] }))
    const status = await readStatus(
      { mcp: { list: mcp }, tool: { list: tools }, agent: { list: agents }, skill: { list: skills } } as never,
      {
        host: checkHost("2.2.4", false),
        servers: { list: [{ account: "default", name: "plaud" }], inUse: () => ["plaud"] },
        exportRoots: ["/fixture/Plaud"],
        skills: OWN_SKILLS,
      },
    )
    expect(skills).toHaveBeenCalledOnce()
    expect(status.shadowedSkills).toEqual([{ id: "opencode-plaud", path: "/home/u/.config/opencode/skills/opencode-plaud/SKILL.md" }])
    expect(mcp).toHaveBeenCalledOnce()
    expect(tools).toHaveBeenCalledOnce()
    expect(agents).toHaveBeenCalledOnce()
    expect(status.tools).toEqual({ visible: 2, unknown: 1, unknownNames: ["rename"] })
    expect(status.accounts).toEqual([{ account: "default", server: "plaud", state: "sign_in_needed", userServer: true }])
    expect(status.unguardedAgents).toEqual(["reviewer"])
    expect(status.host).toEqual({ version: "2.2.4", range: ">=2.2.3 <2.3.0", tested: true })
    // The block is the one for the configured servers.
    expect(status.permissionsBlock).toEqual(defaultRules(["plaud"]))
  })

  it("names a skill that shadows one of the plugin's, after the sign-in and agent fixes", () => {
    const path = "/home/u/.config/opencode/skills/opencode-plaud-export/SKILL.md"
    const skills = [...OWN_SKILLS.filter((skill) => skill.id !== "opencode-plaud-export"), { id: "opencode-plaud-export", path }]
    const status = buildStatus(facts({ skills }))
    expect(schemaProblems(StatusSchema, status)).toEqual([])
    expect(status).toMatchObject({ state: "connected", shadowedSkills: [{ id: "opencode-plaud-export", path }] })
    expect(status.nextStep).toBe(`Move or rename the skill at ${path}, so that this plugin's opencode-plaud-export skill loads, then run opencode reload.`)
    const lines = statusLines(status)
    expect(lines.map((line) => line.label)).toEqual(["Connection", "Account", "Access", "Skills", "Tools", "Agents without default rules", "OpenCode", "Next step"])
    expect(lines.find((line) => line.label === "Skills")).toEqual({
      label: "Skills",
      value: `opencode-plaud-export is shadowed by ${path}, so agents load that file instead of this plugin's skill`,
      tone: "warning",
    })
    // The agents fix comes first: those agents run exports without asking.
    expect(buildStatus(facts({ skills, agents: [{ id: "reviewer", permissions: [BASE_ALLOW] }] })).nextStep).toBe(AGENTS_STEP)
    // A skill list without the plugin's skills, or with them, shadows nothing.
    expect(buildStatus(facts({ skills: [] })).shadowedSkills).toEqual([])
    expect(buildStatus(facts()).shadowedSkills).toEqual([])
  })

  it("never carries a token, a link or a plan", () => {
    const text = JSON.stringify(buildStatus(facts({ mcp: [{ name: "plaud", status: { status: "failed", error: "Bearer eyJabc https://x.test" } }] })))
    expect(text).not.toMatch(/https?:|eyJ|plan/i)
  })
})

describe("status schema", () => {
  it("refuses a missing field, an unknown field, a wrong type and an unknown state", () => {
    const status = buildStatus(facts())
    const { nextStep: _, ...missing } = status
    expect(schemaProblems(StatusSchema, missing)).toEqual(["$.nextStep: missing"])
    expect(schemaProblems(StatusSchema, { ...status, extra: 1 })).toEqual(["$.extra: not allowed"])
    expect(schemaProblems(StatusSchema, { ...status, tools: { ...status.tools, visible: 1.5 } })).toEqual(["$.tools.visible: not an integer"])
    expect(schemaProblems(StatusSchema, { ...status, accounts: [{ ...status.accounts[0], state: "asleep" }] })[0]).toMatch(/^\$\.accounts\[0\]\.state: "asleep" is not one of/)
    expect(schemaProblems(StatusSchema, { ...status, state: "signed_in" })[0]).toMatch(/^\$\.state: "signed_in" is not one of/)
  })

  it("is what the TUI's guard accepts, and nothing else", () => {
    expect(isStatus(buildStatus(facts()))).toBe(true)
    expect(isStatus({ ...buildStatus(facts()), tools: undefined })).toBe(false)
    expect(isStatus({ ...buildStatus(facts()), next: "x", nextStep: undefined })).toBe(false)
    expect(isStatus({ ...buildStatus(facts()), host: { version: "2.2.3", tested: true } })).toBe(false)
    expect(isStatus(null)).toBe(false)
  })
})

describe("RPC contract", () => {
  it("has the plugin id, one status method and no events", () => {
    expect(Plaud.id).toBe(RPC_ID)
    expect(RPC_ID).toBe("plaud.recordings")
    expect(Object.keys(Plaud.methods)).toEqual(["status"])
    expect(Object.keys(Plaud.events)).toEqual([])
  })
})

describe("RPC registration", () => {
  type Handler = (input: unknown, context: { error: (...args: unknown[]) => unknown }) => Promise<unknown>

  function register(read: () => Promise<Status>) {
    let definition: unknown
    let handlers: Record<string, Handler> = {}
    const ctx = {
      rpc: {
        register: vi.fn(async (value: unknown, table: Record<string, Handler>) => {
          definition = value
          handlers = table
          return { dispose: async () => undefined, events: { emit: async () => undefined } }
        }),
      },
    }
    return { registration: registerRpc(ctx as never, read), definition: () => definition, handlers: () => handlers }
  }

  it("serves the status model", async () => {
    const status = buildStatus(facts())
    const { registration, definition, handlers } = register(async () => status)
    await registration
    expect(definition()).toBe(Plaud)
    expect(Object.keys(handlers())).toEqual(["status"])
    await expect(handlers()["status"]!({}, { error: () => undefined })).resolves.toBe(status)
  })

  it("answers a failed read with the declared unavailable error and its next step", async () => {
    const { registration, handlers } = register(async () => {
      throw new Error("agent list failed at https://x.test")
    })
    await registration
    const error = vi.fn((...args: unknown[]) => ({ declared: args }))
    const result = await handlers()["status"]!({}, { error })
    const expected = statusUnavailable(new Error("agent list failed at https://x.test"))
    expect(error).toHaveBeenCalledWith("unavailable", expected.message, { nextStep: expected.nextStep })
    expect(result).toEqual({ declared: ["unavailable", expected.message, { nextStep: expected.nextStep }] })
    expect(expected.message).toMatch(/^STATUS_UNAVAILABLE: /)
    expect(expected.message).not.toContain("https://")
  })
})
