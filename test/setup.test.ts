import type { Plugin } from "@opencode/plugin"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { McpEditor } from "../src/host/context.js"
import plugin from "../src/index.js"

type Config = Parameters<McpEditor["set"]>[1]

/**
 * Setup names the /connect entries, registers plaud_export and its result hook through ctx.tool, then /plaud-status,
 * the skills, the status RPC and the tools RPC with its permission hook.
 */
const registered = async () => ({ dispose: async () => undefined })
const tool = { transform: registered, hook: registered, list: async () => [] } as unknown as Plugin.Context["tool"]
const command = { transform: registered } as unknown as Plugin.Context["command"]
const skill = { transform: registered } as unknown as Plugin.Context["skill"]
const integration = { transform: registered, get: async () => ({ data: { name: "Plaud" } }) } as unknown as Plugin.Context["integration"]
const event = { subscribe: async function* () {} } as unknown as Plugin.Context["event"]

function fakeContext(version: string, options: unknown) {
  const servers = new Map<string, Config>()
  const dispose = vi.fn(async () => undefined)
  const transform = vi.fn(async (callback: (editor: McpEditor) => void) => {
    callback({ get: (name: string) => servers.get(name), set: (name: string, config: Config) => void servers.set(name, config) } as unknown as McpEditor)
    return { dispose }
  })
  const agentTransform = vi.fn(async () => ({ dispose: async () => undefined }))
  const register = vi.fn(async (_contract: { id: string }) => ({ dispose: async () => undefined }))
  const hook = vi.fn(async (_name: string) => ({ dispose }))
  const rpc = { register } as unknown as Plugin.Context["rpc"]
  const permission = { hook, assert: async () => undefined } as unknown as Plugin.Context["permission"]
  const ctx: Pick<Plugin.Context, "app" | "options" | "mcp" | "agent"> = {
    app: { name: "opencode", version, channel: "latest" },
    options: options as Plugin.Context["options"],
    mcp: { list: async () => ({ location: {}, data: [] }) as never, reload: async () => undefined, transform },
    agent: { transform: agentTransform } as unknown as Plugin.Context["agent"],
  }
  return { ctx: { ...ctx, tool, command, skill, rpc, permission, integration, event } as Plugin.Context, servers, transform, dispose, register, hook }
}

afterEach(() => vi.restoreAllMocks())

describe("plugin setup", () => {
  it("keeps the plugin id", () => {
    expect(plugin.id).toBe("plaud.recordings")
  })

  it("works with zero config: the plaud server on Plaud's hosted URL", async () => {
    const { ctx, servers, dispose, register, hook } = fakeContext("2.2.3", undefined)
    const cleanup = await plugin.setup(ctx)
    expect(Object.fromEntries(servers)).toEqual({ plaud: { type: "remote", url: "https://mcp.plaud.ai/mcp" } })
    expect(register.mock.calls.map(([contract]) => contract.id)).toEqual(["plaud.recordings", "plaud.recordings.tools"])
    expect(hook.mock.calls.map(([name]) => name)).toEqual(["evaluate"])
    expect(typeof cleanup).toBe("function")
    await (cleanup as () => Promise<void>)()
    await (cleanup as () => Promise<void>)()
    // The MCP registration and the tools RPC's permission hook, each once.
    expect(dispose).toHaveBeenCalledTimes(2)
  })

  it("registers extra accounts on the configured URL", async () => {
    const { ctx, servers } = fakeContext("2.2.4", { accounts: ["work"], url: "https://mcp.eu.example.test/mcp" })
    await plugin.setup(ctx)
    expect([...servers.keys()]).toEqual(["plaud", "plaud-work"])
    expect(servers.get("plaud-work")).toEqual({ type: "remote", url: "https://mcp.eu.example.test/mcp" })
  })

  it("accepts plain http only on localhost", async () => {
    await plugin.setup(fakeContext("2.2.3", { url: "http://127.0.0.1:4010/mcp" }).ctx)
    await expect(plugin.setup(fakeContext("2.2.3", { url: "http://mcp.plaud.ai/mcp" }).ctx)).rejects.toThrow(
      /^OPTIONS_INVALID: opencode-plaud has invalid options: url: must be an https URL/,
    )
  })

  it.each([
    [{ acounts: ["work"] }, /Unrecognized key: "acounts"/],
    [{ accounts: ["Work"] }, /accounts\.0: use lowercase letters/],
    [{ accounts: ["default"] }, /accounts\.0: "default" names the plaud server's account/],
    [{ accounts: ["work", "work"] }, /accounts: aliases must be unique/],
    [{ allowUntestedHost: "yes" }, /allowUntestedHost: /],
  ])("refuses invalid options %j with one message", async (options, message) => {
    const { ctx, transform } = fakeContext("2.2.3", options)
    await expect(plugin.setup(ctx)).rejects.toThrow(message)
    expect(transform).not.toHaveBeenCalled()
  })

  it("refuses an untested host before registering anything", async () => {
    const { ctx, transform } = fakeContext("2.3.0", {})
    await expect(plugin.setup(ctx)).rejects.toThrow(/^HOST_UNTESTED: .*OpenCode 2\.3\.0/)
    expect(transform).not.toHaveBeenCalled()
  })

  it("loads an untested host with a warning when allowUntestedHost is set", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const { ctx, servers } = fakeContext("unknown", { allowUntestedHost: true })
    await plugin.setup(ctx)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^opencode-plaud: .*OpenCode unknown.*allowUntestedHost/))
    expect(servers.has("plaud")).toBe(true)
  })
})
