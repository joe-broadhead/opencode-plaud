/**
 * The export's matcher against OpenCode's own, on all three platforms.
 *
 * The host cannot see a plugin's file write, so the export evaluates `external_directory` itself. It must agree with
 * `@opencode/core` 2.4.1's `evaluate`, including the two shapes the 4a review found: a macOS deny whose case differs
 * from the on-disk path, and a Windows deny written with backslashes.
 */
import { evaluate } from "@opencode/core/permission"
import { afterEach, describe, expect, it } from "vitest"
import { effectFor, ignoresCase, match, type Rule } from "../src/export/matcher.js"

const real = process.platform
function onPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  Object.defineProperty(process, "platform", { value: platform, configurable: true })
  try {
    return run()
  } finally {
    Object.defineProperty(process, "platform", { value: real, configurable: true })
  }
}

afterEach(() => Object.defineProperty(process, "platform", { value: real, configurable: true }))

const BASE: readonly Rule[] = [{ action: "*", resource: "*", effect: "allow" }]

/** The host's own answer, with the same rulesets the plugin evaluates. */
function host(rules: readonly Rule[], action: string, resource: string): Rule["effect"] {
  return evaluate(action, resource, [...rules]).effect as Rule["effect"]
}

const CASES: readonly { readonly name: string; readonly rules: readonly Rule[]; readonly action: string; readonly resource: string }[] = [
  { name: "the base allow with no path rule", rules: BASE, action: "external_directory", resource: "/Users/me/report.md" },
  { name: "an exact allow after the base allow", rules: [...BASE, { action: "external_directory", resource: "/Users/me/*", effect: "allow" }], action: "external_directory", resource: "/Users/me/report.md" },
  { name: "an exact deny after the base allow", rules: [...BASE, { action: "external_directory", resource: "/Users/me/Secret/*", effect: "deny" }], action: "external_directory", resource: "/Users/me/Secret/report.md" },
  { name: "a deny with a different case", rules: [...BASE, { action: "external_directory", resource: "/Users/me/Secret/*", effect: "deny" }], action: "external_directory", resource: "/Users/me/secret/report.md" },
  { name: "a deny written with backslashes", rules: [...BASE, { action: "external_directory", resource: "C:\\Users\\me\\Secret\\*", effect: "deny" }], action: "external_directory", resource: "C:\\Users\\me\\secret\\report.md" },
  { name: "an ask with a different case", rules: [...BASE, { action: "external_directory", resource: "/Users/me/Secret/*", effect: "ask" }], action: "external_directory", resource: "/Users/me/sEcReT/report.md" },
  { name: "a wildcard action", rules: [{ action: "*", resource: "*", effect: "deny" }, { action: "external_directory", resource: "/tmp/*", effect: "allow" }], action: "external_directory", resource: "/tmp/report.md" },
  { name: "a ? wildcard", rules: [...BASE, { action: "external_directory", resource: "/tmp/?.md", effect: "deny" }], action: "external_directory", resource: "/tmp/a.md" },
  { name: "a non-path action stays case-sensitive", rules: [...BASE, { action: "plaud.export", resource: "Work:note", effect: "deny" }], action: "plaud.export", resource: "work:note" },
  { name: "no match asks", rules: [{ action: "plaud.events_list", resource: "*", effect: "allow" }], action: "external_directory", resource: "/tmp/report.md" },
] as const

describe.each(["linux", "darwin", "win32"] as const)("on %s", (platform) => {
  it.each(CASES)("$name", ({ rules, action, resource }) => {
    const answer = onPlatform(platform, () => ({ host: host(rules, action, resource), plugin: effectFor(rules, action, resource) }))
    expect(answer.plugin).toBe(answer.host)
  })

  it("ignores case for a path action only on darwin", () => {
    expect(onPlatform(platform, () => ignoresCase("external_directory"))).toBe(platform === "darwin")
    expect(onPlatform(platform, () => ignoresCase("plaud.export"))).toBe(false)
  })

  it("matches with the host's flags", () => {
    expect(onPlatform(platform, () => match("C:\\Users\\me\\a.md", "C:\\Users\\me\\*"))).toBe(true)
    expect(onPlatform(platform, () => match("C:\\Users\\me\\a.md", "/Users/me/*"))).toBe(false)
    expect(onPlatform(platform, () => match("/Users/Me/a.md", "/Users/me/*"))).toBe(platform === "win32")
    expect(onPlatform(platform, () => match("/Users/Me/a.md", "/Users/me/*", true))).toBe(true)
  })
})
