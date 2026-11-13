import { describe, expect, it } from "vitest"
import { DEFAULT_ACCOUNT, loadConfig } from "../src/domain/config.js"
import { KNOWN_READS } from "../src/host/mcp.js"
import { defaultRules, evaluate, EVENTS_ACTION, EXPORT_ACTION, RECENT_ACTION } from "../src/host/permissions.js"
import { ACCESS_VALUES } from "../src/domain/types.js"
import { type Declaration, type DeclaredTool, declarationProblems, docProblems, readPackage } from "./support/jelly-kit.js"
import { ACCESS_CHOICES, type DeclaredSetting, settingChoices, settingsProblems, settingValueIssue } from "./support/jelly-settings.js"

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
  const settings = (jelly.contributes as unknown as { settings: DeclaredSetting[] }).settings
  const setting = (key: string) => settings.find((item) => item.key === key)!
  const refused = (options: Record<string, unknown>) => () => loadConfig(options)

  it("declares access with Jelly's three choices and the two export limits as bounded numbers, each default the parser's", () => {
    expect(settings).toEqual([
      {
        key: "access",
        label: "Access",
        type: "string",
        choices: ACCESS_CHOICES,
        default: "all",
        description: "all, ask-changes or read-only. Generates default rules for agents with a base allow rule.",
      },
      {
        key: "maxAudioBytes",
        label: "Largest audio export",
        type: "number",
        integer: true,
        min: 1,
        max: 68_719_476_736,
        default: 2_147_483_648,
        description: "The largest audio file an export writes, in bytes: a whole number up to 64 GiB. The default is 2 GiB.",
      },
      {
        key: "exportTimeoutMs",
        label: "Export time limit",
        type: "number",
        integer: true,
        min: 1000,
        max: 86_400_000,
        default: 1_800_000,
        description: "How long one export may take, in milliseconds, counted from your approval: 1 second to 24 hours. The default is 30 minutes.",
      },
    ])
    const defaults = loadConfig({})
    for (const item of settings) expect([item.key, item.default]).toEqual([item.key, defaults[item.key as keyof typeof defaults]])
  })

  it("passes Jelly's setting contract", () => {
    expect(settingsProblems(settings)).toEqual([])
  })

  it("offers only access values the parser takes, and the parser refuses one outside the set", () => {
    const access = setting("access")
    const values = settingChoices(access)!.map((choice) => choice.value)
    expect(values).toEqual([...ACCESS_VALUES])
    for (const value of values) {
      expect(settingValueIssue(access, value)).toBeNull()
      expect(loadConfig({ access: value }).access).toBe(value)
    }
    for (const outside of ["write", "read", "none", ""]) {
      expect(settingValueIssue(access, outside)).not.toBeNull()
      expect(refused({ access: outside })).toThrow("OPTIONS_INVALID")
    }
  })

  it("bounds each number exactly as the parser does: its ends are taken, a step past either end or a fraction refused", () => {
    for (const key of ["maxAudioBytes", "exportTimeoutMs"]) {
      const { min, max } = setting(key) as { min: number; max: number }
      for (const value of [min, max]) {
        expect(settingValueIssue(setting(key), value)).toBeNull()
        expect(loadConfig({ [key]: value })[key as "maxAudioBytes" | "exportTimeoutMs"]).toBe(value)
      }
      for (const value of [min - 1, max + 1, min + 0.5]) {
        expect(settingValueIssue(setting(key), value)).not.toBeNull()
        expect(refused({ [key]: value })).toThrow("OPTIONS_INVALID")
      }
    }
  })
  it("follows the plugin authors' standard, with the effects the plugin's own default rules give", () => {
    expect(declarationProblems(ROOT, { effectOf: (permission) => evaluate(rules, permission) })).toEqual([])
  })

  it("declares each known read, plaud_recent and plaud_events_list as reads that run, and the export as a write that runs by default", () => {
    for (const read of KNOWN_READS) expect(byPermission.get(`plaud_${read}`)).toMatchObject({ name: `plaud.${read}`, effect: "allow", readOnly: true })
    expect(byPermission.get(EXPORT_ACTION)).toMatchObject({ name: "plaud.export", effect: "allow", readOnly: false })
    expect(byPermission.get(RECENT_ACTION)).toMatchObject({ name: "plaud.recent", effect: "allow", readOnly: true })
    expect(byPermission.get(EVENTS_ACTION)).toMatchObject({ name: "plaud.events_list", effect: "allow", readOnly: true })
    expect(jelly.tools).toHaveLength(KNOWN_READS.length + 3)
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
