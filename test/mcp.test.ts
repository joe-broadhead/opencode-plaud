import type { Plugin } from "@opencode/plugin"
import { describe, expect, it } from "vitest"
import type { McpEditor } from "../src/host/context.js"
import { DEFAULT_URL } from "../src/domain/config.js"
import { mcpServers, registerMcp, serverName } from "../src/host/mcp.js"

type Config = Parameters<McpEditor["set"]>[1]

/** A fresh editor per replay, as the host rebuilds MCP state from scratch. */
function editor(existing: Record<string, Config> = {}) {
  const servers = new Map(Object.entries(existing))
  const value = {
    list: () => [...servers.entries()],
    get: (name: string) => servers.get(name),
    set: (name: string, config: Config) => void servers.set(name, config),
    update: () => undefined,
    remove: (name: string) => void servers.delete(name),
  } as unknown as McpEditor
  return { value, servers }
}

function fakeMcp() {
  const callbacks: ((editor: McpEditor) => void)[] = []
  const ctx: Pick<Plugin.Context, "mcp"> = {
    mcp: {
      list: async () => ({ location: {}, data: [] }) as never,
      reload: async () => undefined,
      transform: async (callback) => {
        callbacks.push(callback)
        return { dispose: async () => undefined }
      },
    },
  }
  const replay = (existing?: Record<string, Config>) => {
    const fresh = editor(existing)
    for (const callback of callbacks) callback(fresh.value)
    return fresh.servers
  }
  return { ctx, replay, callbacks }
}

describe("MCP registration", () => {
  it("names the default account's server plaud and extra accounts plaud-<alias>", () => {
    expect(serverName("default")).toBe("plaud")
    expect(mcpServers(["work", "home"])).toEqual([
      { account: "default", name: "plaud" },
      { account: "work", name: "plaud-work" },
      { account: "home", name: "plaud-home" },
    ])
  })

  it("registers one remote server per account, with OAuth left to OpenCode", async () => {
    const { ctx, replay, callbacks } = fakeMcp()
    const servers = await registerMcp(ctx, { accounts: ["work"], url: DEFAULT_URL })
    expect(callbacks).toHaveLength(1)
    expect(Object.fromEntries(replay())).toEqual({
      plaud: { type: "remote", url: "https://mcp.plaud.ai/mcp" },
      "plaud-work": { type: "remote", url: "https://mcp.plaud.ai/mcp" },
    })
    expect(servers.list.map((server) => server.name)).toEqual(["plaud", "plaud-work"])
    expect(servers.inUse()).toEqual([])
  })

  it("uses the configured URL", async () => {
    const { ctx, replay } = fakeMcp()
    await registerMcp(ctx, { accounts: [], url: "https://mcp.example.test/mcp" })
    expect(replay().get("plaud")).toEqual({ type: "remote", url: "https://mcp.example.test/mcp" })
  })

  it("leaves a server the user already defined alone and reports it on every replay", async () => {
    const { ctx, replay } = fakeMcp()
    const servers = await registerMcp(ctx, { accounts: ["work"], url: DEFAULT_URL })
    const own: Config = { type: "local", command: ["plaud-mcp"] }
    const result = replay({ "plaud-work": own })
    expect(result.get("plaud-work")).toBe(own)
    expect(result.get("plaud")).toEqual({ type: "remote", url: DEFAULT_URL })
    expect(servers.inUse()).toEqual(["plaud-work"])

    replay()
    expect(servers.inUse()).toEqual([])
  })
})
