/** The account wiring: one Plaud MCP server per alias, through the contract's `accounts` module. */
import { accountsOf } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { describe, expect, it } from "vitest"
import { registerPlaudAccounts } from "../src/accounts.js"
import { manifest } from "../src/manifest.js"

interface Editor {
  get(name: string): unknown
  set(name: string, config: Record<string, unknown>): void
}

/** A plugin context with only the two transforms registration needs. */
function context() {
  const servers = new Map<string, Record<string, unknown>>()
  const mcp: Editor = { get: (name) => servers.get(name), set: (name, config) => void servers.set(name, config) }
  return {
    servers,
    ctx: {
      mcp: { transform: async (callback: (editor: Editor) => void) => (callback(mcp), { dispose: async () => undefined }) },
      integration: { transform: async () => ({ dispose: async () => undefined }) },
    },
  }
}

describe("registerPlaudAccounts", () => {
  it("registers one server for the default account when no alias is configured", async () => {
    const { ctx, servers } = context()
    const result = await registerPlaudAccounts(ctx as never, manifest, {}, "https://mcp.plaud.ai/mcp")
    expect(result.mechanism).toBe("mcp")
    expect(result.accounts).toEqual([{ alias: "default", name: "plaud" }])
    expect([...servers.keys()]).toEqual(["plaud"])
    expect(servers.get("plaud")).toEqual({ type: "remote", url: "https://mcp.plaud.ai/mcp" })
  })

  it("registers plaud-<alias> for each alias, all on the one endpoint", async () => {
    const { ctx, servers } = context()
    const result = await registerPlaudAccounts(ctx as never, manifest, { accounts: { work: {}, personal: {} } }, "http://127.0.0.1:9/mcp")
    expect(result.accounts).toEqual([
      { alias: "work", name: "plaud-work" },
      { alias: "personal", name: "plaud-personal" },
    ])
    expect([...servers.keys()]).toEqual(["plaud-work", "plaud-personal"])
    expect(servers.get("plaud-work")).toEqual({ type: "remote", url: "http://127.0.0.1:9/mcp" })
  })

  it("keeps the default server beside an alias that names it", async () => {
    const { ctx, servers } = context()
    await registerPlaudAccounts(ctx as never, manifest, { accounts: { default: {}, work: {} } }, "https://mcp.plaud.ai/mcp")
    expect([...servers.keys()]).toEqual(["plaud", "plaud-work"])
  })

  it("records a bad alias as a problem instead of taking setup down", async () => {
    const { ctx } = context()
    const result = await registerPlaudAccounts(ctx as never, manifest, { accounts: { Work: {} } }, "https://mcp.plaud.ai/mcp")
    expect(result.accounts).toEqual([])
    expect(result.problems[0]).toMatch(/options\.accounts\.Work/)
  })
})

describe("accountsOf", () => {
  it("answers one default account with no option, and the option's aliases in order", () => {
    expect(accountsOf(manifest, {})).toMatchObject({ ok: true, value: { accounts: [{ alias: "default" }] } })
    expect(accountsOf(manifest, { accounts: { work: {}, personal: {} } })).toMatchObject({
      ok: true,
      value: { accounts: [{ alias: "work" }, { alias: "personal" }] },
    })
  })
})
