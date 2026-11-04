import { readdirSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { KNOWN_READS } from "../src/host/mcp.js"
import { defaultRules, evaluate, EXPORT_ACTION, RECENT_ACTION } from "../src/host/permissions.js"

/**
 * The `jelly` section of package.json, which Jelly reads without loading the
 * plugin: it must say what the plugin does. Jelly writes each declared "ask"
 * as that tool's default on its agents (its agents have no base allow rule,
 * so the plugin's default rules never reach them), and offers a feed only a
 * declared read-only tool. Jelly's declaration schema accepts no unknown
 * keys, so only the fields its released contract has are declared.
 */

type Tool = { name: string; permission: string; effect: string; readOnly: boolean }
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { files: string[]; jelly: Record<string, unknown> }
const jelly = pkg.jelly as {
  tools: Tool[]
  skills: string[]
  contributes: { homeFeeds: { id: string; feed: { tools: string[]; template: string; cadence: number; script: string } }[] }
}
const byPermission = new Map(jelly.tools.map((tool) => [tool.permission, tool]))

describe("the jelly declaration", () => {
  it("has only the fields of Jelly's released declaration schema", () => {
    expect(Object.keys(pkg.jelly).sort()).toEqual(["contributes", "rpc", "signIns", "skills", "title", "tools", "views"])
    expect(pkg.files).not.toContain("assets")
  })

  it("declares each known read and plaud_recent as reads that run, and the export as a write that asks", () => {
    for (const read of KNOWN_READS) expect(byPermission.get(`plaud_${read}`)).toMatchObject({ name: `plaud.${read}`, effect: "allow", readOnly: true })
    expect(byPermission.get(EXPORT_ACTION)).toMatchObject({ name: "plaud.export", effect: "ask", readOnly: false })
    expect(byPermission.get(RECENT_ACTION)).toMatchObject({ name: "plaud.recent", effect: "allow", readOnly: true })
    expect(jelly.tools).toHaveLength(KNOWN_READS.length + 2)
  })

  it("agrees with the plugin's own default rules after a base allow", () => {
    const rules = [{ action: "*", resource: "*", effect: "allow" } as const, ...defaultRules(["plaud"])]
    for (const tool of jelly.tools) expect(evaluate(rules, tool.permission), tool.permission).toBe(tool.effect)
  })

  it("names every skill the package ships", () => {
    expect([...jelly.skills].sort()).toEqual(readdirSync(new URL("../skills", import.meta.url)).sort())
  })

  it("feeds Home only from a declared read-only tool, which the feed's script calls", () => {
    const reads = new Set(jelly.tools.filter((tool) => tool.readOnly).map((tool) => tool.name))
    expect(jelly.contributes.homeFeeds.map((preset) => preset.id)).toEqual(["plaud.recent"])
    for (const preset of jelly.contributes.homeFeeds) {
      for (const tool of preset.feed.tools) {
        expect(reads.has(tool), tool).toBe(true)
        expect(preset.feed.script).toContain(`tools.${tool}(`)
      }
      expect(preset.feed.template).toBe("list")
      expect(preset.feed.cadence).toBeGreaterThanOrEqual(30)
      expect(preset.feed.cadence).toBeLessThanOrEqual(86_400)
    }
  })
})
