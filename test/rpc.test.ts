import { describe, expect, it, vi } from "vitest"
import { signInStep } from "../src/domain/auth.js"
import { DEFAULT_RULES } from "../src/host/permissions.js"
import { registerRpc } from "../src/host/rpc.js"
import { Plaud, READY_STEP, RPC_ID, StatusSchema, isStatus, overallState, rulesBlock, statusLines, type Status } from "../src/rpc.js"
import { agentsFix, buildStatus, readStatus, statusUnavailable, type StatusFacts } from "../src/status.js"
import { checkHost } from "../src/version.js"
import { schemaProblems } from "./json-schema.js"

const READS = ["list_files", "get_file", "get_note", "get_transcript", "get_current_user"]
const BASE_ALLOW = { action: "*", resource: "*", effect: "allow" } as const
const guarded = (id: string) => ({ id, permissions: [BASE_ALLOW, ...DEFAULT_RULES] })

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
    expect(statusLines(status).map((line) => line.label)).toEqual(["Connection", "Account", "Access", "Tools", "OpenCode", "Next step"])
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
        ],
      }),
    )
    expect(status.unguardedAgents).toEqual(["reviewer"])
    expect(status.permissionsBlock).toEqual(DEFAULT_RULES)
    expect(status.nextStep).toBe(agentsFix(["reviewer"]))
    const fix = status.nextStep
    expect(fix).toMatch(/^Put the block first in the own permissions of reviewer /)
    expect(fix).toContain("agents.<id>.permissions")
    expect(fix).toMatch(/followed by your top-level rules for Plaud's actions\./)
    expect(fix).toMatch(/Don't add the block to the top-level permissions/)
    expect(JSON.parse(rulesBlock(status)!)).toEqual(DEFAULT_RULES)
    const agents = statusLines(status).find((line) => line.label === "Agents without default rules")
    expect(agents).toMatchObject({ tone: "warning", block: rulesBlock(status) })
    expect(agents?.value).toMatch(/^reviewer\. Exports and other Plaud tools run there without asking\./)
    expect(statusLines(status).map((line) => line.label)).toEqual(["Connection", "Account", "Access", "Tools", "Agents without default rules", "OpenCode", "Next step"])
    expect(overallState(status)).toBe("signed_in")
  })

  it("carries the untested-host warning", () => {
    const host = checkHost("2.3.0", true)
    const status = buildStatus(facts({ host }))
    expect(status.host).toEqual({ version: "2.3.0", tested: false, warning: host.tested ? undefined : host.warning })
    expect(status.nextStep).toBe("If Plaud misbehaves, install an OpenCode release in the tested range.")
    expect(statusLines(status).find((line) => line.label === "OpenCode")).toMatchObject({ tone: "warning" })
    expect(statusLines(status).find((line) => line.label === "OpenCode")?.value).toMatch(/allowUntestedHost/)
  })

  it("reads OpenCode's MCP list, tools and agents through public APIs", async () => {
    const mcp = vi.fn(async () => ({ location: {}, data: [{ name: "plaud", status: { status: "needs_auth", error: "401" } }] }))
    const tools = vi.fn(async () => [{ id: "plaud_export" }, { id: "plaud_get_file" }, { id: "plaud_rename" }])
    const agents = vi.fn(async () => ({ location: {}, data: [{ id: "reviewer", permissions: [BASE_ALLOW] }] }))
    const status = await readStatus(
      { mcp: { list: mcp }, tool: { list: tools }, agent: { list: agents } } as never,
      {
        host: checkHost("2.2.4", false),
        servers: { list: [{ account: "default", name: "plaud" }], inUse: () => ["plaud"] },
        exportRoots: ["/fixture/Plaud"],
      },
    )
    expect(mcp).toHaveBeenCalledOnce()
    expect(tools).toHaveBeenCalledOnce()
    expect(agents).toHaveBeenCalledOnce()
    expect(status.tools).toEqual({ visible: 2, unknown: 1, unknownNames: ["rename"] })
    expect(status.accounts).toEqual([{ account: "default", server: "plaud", state: "sign_in_needed", userServer: true }])
    expect(status.unguardedAgents).toEqual(["reviewer"])
    expect(status.host).toEqual({ version: "2.2.4", tested: true })
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
  })

  it("is what the TUI's guard accepts, and nothing else", () => {
    expect(isStatus(buildStatus(facts()))).toBe(true)
    expect(isStatus({ ...buildStatus(facts()), tools: undefined })).toBe(false)
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
