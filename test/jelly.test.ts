import { readdirSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { KNOWN_READS } from "../src/host/mcp.js"
import { DEFAULT_RULES, EXPORT_ACTION, RECENT_ACTION } from "../src/host/permissions.js"

/**
 * The `jelly` section of package.json, which Jelly reads without loading the
 * plugin: it must say what the plugin does. Jelly writes each declared "ask"
 * as that tool's default on its agents (its agents have no base allow rule,
 * so DEFAULT_RULES never reach them), and offers a feed only a declared
 * read-only tool.
 */

type Tool = { name: string; permission: string; effect: string; readOnly: boolean }
const jelly = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).jelly as {
  tools: Tool[]
  skills: string[]
  contributes: { homeFeeds: { feed: { tools: string[]; template: string } }[] }
}
const byPermission = new Map(jelly.tools.map((tool) => [tool.permission, tool]))

describe("the jelly declaration", () => {
  it("declares each known read as a read that runs, and the export as a write that asks", () => {
    for (const read of KNOWN_READS) expect(byPermission.get(`plaud_${read}`)).toMatchObject({ effect: "allow", readOnly: true })
    expect(byPermission.get(EXPORT_ACTION)).toMatchObject({ name: "plaud.export", effect: "ask", readOnly: false })
    expect(byPermission.get(RECENT_ACTION)).toMatchObject({ name: "plaud.recent", effect: "allow", readOnly: true })
  })

  it("agrees with the plugin's own default rules", () => {
    for (const tool of jelly.tools) {
      const rule = DEFAULT_RULES.findLast((entry) => new RegExp(`^${entry.action.replaceAll("*", ".*")}$`).test(tool.permission))
      expect(rule?.effect, tool.permission).toBe(tool.effect)
    }
  })

  it("names every skill the package ships", () => {
    expect([...jelly.skills].sort()).toEqual(readdirSync(new URL("../skills", import.meta.url)).sort())
  })

  it("feeds Home only from a declared read-only tool", () => {
    const reads = new Set(jelly.tools.filter((tool) => tool.readOnly).map((tool) => tool.name))
    for (const preset of jelly.contributes.homeFeeds) for (const tool of preset.feed.tools) expect(reads.has(tool)).toBe(true)
  })
})
