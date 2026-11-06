import { describe, expect, it } from "vitest"
import { DEFAULT_ACCOUNT, loadConfig } from "../src/domain/config.js"
import { KNOWN_READS } from "../src/host/mcp.js"
import { defaultRules, evaluate, EXPORT_ACTION, RECENT_ACTION } from "../src/host/permissions.js"
import { type Declaration, type DeclaredTool, declarationProblems, docProblems, readPackage } from "./support/jelly-kit.js"

/**
 * The `jelly` section of package.json, which Jelly reads without loading the
 * plugin: it must say what the plugin does. Jelly writes each declared "ask"
 * as that tool's default on its agents (its agents have no base allow rule,
 * so the plugin's default rules never reach them), and offers a feed only a
 * declared read-only tool. The shared kit checks the declaration against
 * Jelly's plugin authors' standard; the tests below add what only Plaud
 * declares.
 */

const ROOT = new URL("../", import.meta.url)
const pkg = readPackage(ROOT)
const jelly = pkg.jelly as Declaration & {
  tools: DeclaredTool[]
  contributes: { homeFeeds: { id: string; feed: { tools: string[]; template: string; cadence: number; script: string } }[] }
}
const byPermission = new Map(jelly.tools.map((tool) => [tool.permission, tool]))
const rules = [{ action: "*", resource: "*", effect: "allow" } as const, ...defaultRules(["plaud"])]

describe("the jelly declaration", () => {
  it("follows the plugin authors' standard, with the effects the plugin's own default rules give", () => {
    expect(declarationProblems(ROOT, { effectOf: (permission) => evaluate(rules, permission) })).toEqual([])
  })

  it("declares each known read and plaud_recent as reads that run, and the export as a write that asks", () => {
    for (const read of KNOWN_READS) expect(byPermission.get(`plaud_${read}`)).toMatchObject({ name: `plaud.${read}`, effect: "allow", readOnly: true })
    expect(byPermission.get(EXPORT_ACTION)).toMatchObject({ name: "plaud.export", effect: "ask", readOnly: false })
    expect(byPermission.get(RECENT_ACTION)).toMatchObject({ name: "plaud.recent", effect: "allow", readOnly: true })
    expect(jelly.tools).toHaveLength(KNOWN_READS.length + 2)
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

describe("docs/jelly.md", () => {
  it("follows the plugin authors' standard", () => {
    expect(docProblems(ROOT)).toEqual([])
  })
})

describe("the declared accounts", () => {
  const [signIn] = (jelly as unknown as { signIns: { id: string; server: string; account?: { option: string; required: boolean; reserved: string[]; placeholder: string } }[] }).signIns
  it("name the accounts option, which an account Jelly adds there parses as, and keep the default account's name", () => {
    expect(signIn?.server).toBe("plaud*")
    expect(signIn?.account).toMatchObject({ option: "accounts", required: false, reserved: [DEFAULT_ACCOUNT] })
    const placeholder = signIn?.account?.placeholder ?? ""
    expect(loadConfig({ [signIn?.account?.option ?? ""]: [placeholder] }).accounts).toEqual([placeholder])
    expect(() => loadConfig({ accounts: [DEFAULT_ACCOUNT] })).toThrow()
  })
})
