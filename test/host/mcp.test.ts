import { describe, expect, it } from "vitest"
import { startHost } from "./harness.js"

/**
 * MCP registration on a real OpenCode 2.4.1 host: the plugin itself must register one server per configured account,
 * `plaud` for `default` and `plaud-<alias>` for every other alias, on an empty temp project and an isolated config.
 */
describe("MCP registration", () => {
  it("registers one server per account: plaud, plaud-work, plaud-team", async () => {
    const host = await startHost({
      options: { accounts: { default: {}, work: {}, team: {} }, access: "all" },
      config: { permissions: [{ action: "external_directory", resource: "*", effect: "allow" }] },
    })
    try {
      const data = await host.until("the plugin's three MCP servers", async () => {
        const listed = (await host.opencode.mcp.list({ location: host.location })).data.filter((server) => server.name.startsWith("plaud"))
        return listed.length === 3 && listed.every((server) => server.status.status === "connected") ? listed : undefined
      })
      expect(data.map((server) => server.name).sort()).toEqual(["plaud", "plaud-team", "plaud-work"])
      for (const server of data) expect(server.status.status).toBe("connected")
    } finally {
      await host.close()
    }
  })
})
