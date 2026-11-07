import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { exemptUses, forbiddenUses, moduleSpecifiers, type Exemption, type Scope } from "./module-specifiers.js"

/**
 * The lint stage of `npm run check`, before anything is built: import
 * boundaries in src/, and no forbidden host API anywhere in src/, test/ or
 * scripts/. The built dist/ is checked by the pack test.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url))
const SRC = join(ROOT, "src")
const DOMAIN = join(SRC, "domain")

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(path)
    return /\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name) && !/\.d\.[cm]?ts$/.test(entry.name) ? [path] : []
  })
}

const rel = (file: string) => relative(ROOT, file).split(sep).join("/")
const sources = walk(SRC)
const imports = (file: string) => moduleSpecifiers(readFileSync(file, "utf8"), file)

describe("source layout", () => {
  it("finds the source tree, in TypeScript only", () => {
    expect(sources.map(rel)).toEqual(expect.arrayContaining(["src/index.ts", "src/rpc.ts", "src/tui.tsx", "src/host/mcp.ts", "src/domain/config.ts"]))
    expect(sources.map(rel).filter((file) => !/\.tsx?$/.test(file))).toEqual([])
  })

  it("imports @opencode/plugin only from the entry points and src/host", () => {
    const entries = new Set(["src/index.ts", "src/rpc.ts", "src/tui.tsx"])
    expect(
      sources.flatMap((file) =>
        imports(file)
          .filter((specifier) => /^@opencode\/plugin(?:\/|$)/.test(specifier) && !entries.has(rel(file)) && !rel(file).startsWith("src/host/"))
          .map((specifier) => `${rel(file)} -> ${specifier}`),
      ),
    ).toEqual([])
  })

  it("keeps src/domain free of the host: only domain modules, zod and node built-ins", () => {
    const violations = sources
      .filter((file) => file.startsWith(DOMAIN + sep))
      .flatMap((file) =>
        imports(file).flatMap((specifier) => {
          if (specifier.startsWith(".")) {
            const target = resolve(dirname(file), specifier)
            return target.startsWith(DOMAIN + sep) ? [] : [`${rel(file)} -> ${specifier}`]
          }
          return specifier === "zod" || specifier.startsWith("node:") ? [] : [`${rel(file)} -> ${specifier}`]
        }),
      )
    expect(violations).toEqual([])
  })
})

/**
 * The only exemptions, by file: the tools RPC's one evaluate hook and its reads of OpenCode's error tags, and its
 * shared unit test's fakes of those errors. See AGENTS.md.
 */
const EXEMPT: Readonly<Record<string, readonly Exemption[]>> = {
  "src/host/tools-rpc.ts": ["evaluate hook", "error tags"],
  "test/tools-rpc.test.ts": ["error tags"],
  "test/resolve.test.ts": ["error tags"],
}

describe("forbidden host APIs", () => {
  const scopes: [string, Scope][] = [
    ["src", "shipped"],
    ["test", "test"],
    ["scripts", "tooling"],
  ]
  it.each(scopes)("none in %s/", (directory, scope) => {
    const files = walk(join(ROOT, directory))
    expect(files.length).toBeGreaterThan(0)
    expect(files.flatMap((file) => forbiddenUses(readFileSync(file, "utf8"), file, scope, EXEMPT[rel(file)]).map((problem) => `${rel(file)}:${problem}`))).toEqual([])
  })

  it("uses each exemption only where it is granted, and counts it", () => {
    const uses = (directory: string, exemption: Exemption) =>
      walk(join(ROOT, directory)).map((file) => [rel(file), exemptUses(readFileSync(file, "utf8"), file, exemption)] as const).filter(([, count]) => count > 0)
    expect(uses("src", "evaluate hook")).toEqual([["src/host/tools-rpc.ts", 1]])
    expect(uses("src", "error tags").map(([file]) => file)).toEqual(["src/host/tools-rpc.ts"])
    // Without its exemptions, the tools RPC breaks both rules.
    const rpc = join(SRC, "host", "tools-rpc.ts")
    const problems = forbiddenUses(readFileSync(rpc, "utf8"), rpc, "shipped").join("\n")
    expect(problems).toContain("a permission evaluate hook")
    expect(problems).toContain("_tag: private host error tags")
  })

  it("finds every module a file loads", () => {
    for (const text of [
      'import { spawn as run } from "node:child_process"',
      'export * from "node:child_process"',
      "const load = () => import(`node:child_process`)",
      'type Process = import("node:child_process")',
      'import process = require("node:child_process")',
      'const process = module["require"]("node:child_process")',
      '(require)("node:child_process")',
      'export const identity = <T>(value: T) => value; export type { SpawnOptions } from "node:child_process";',
    ]) {
      expect(moduleSpecifiers(text), text).toEqual(["node:child_process"])
    }
    expect(moduleSpecifiers('const example = "import(unsafe)"; // import "node:child_process"')).toEqual([])
    expect(moduleSpecifiers('import("./" + name)')).toEqual(["#computed-module"])
    expect(() => moduleSpecifiers("import {")).toThrow("invalid syntax")
  })

  // A probe: each line breaks one rule, so the scan above is known to catch it.
  const PROBE = [
    ['import { generateText } from "@opencode/ai"', "@opencode/ai"],
    ['const ai = await import("@opencode/ai/providers/openai-compatible")', "@opencode/ai"],
    ['import type { Session } from "@opencode/core/session"', "a private host package"],
    ['import { Mcp } from "@opencode/plugin/src/mcp.js"', "a path inside an @opencode package"],
    ['import { tool } from "@opencode-ai/plugin"', "the OpenCode V1 plugin API"],
    ['import { x } from "../../opencode/packages/core/src/tool.ts"', "private host source"],
    ['import { x } from "/Users/someone/plugin/index.js"', "an absolute, machine-local module path"],
    ["await ctx.experimental.artifact.create({})", "experimental.artifact is experimental"],
    ["ctx.experimental.policies.add({})", "experimental.policies is deprecated"],
    ["await ctx.generate.text({})", "ctx.generate.text is deprecated"],
    ["if (supportsCancellation) run()", "supportsCancellation: support markers"],
    ['await ctx.permission.hook("evaluate", () => undefined)', "a permission evaluate hook"],
    ["await ctx.permission.assert(input, { signal })", "with the input only"],
    ["await ctx.permission.assert({ ...input, signal })", "with the input only"],
    ['Plugin.define({ id: "x", image: "data:", setup })', "Plugin.image is dropped"],
    ['if (error._tag === "Permission.DeclinedError") throw error', "_tag: private host error tags"],
    ['throw Object.assign(new Error("no"), { _tag: "Permission.DeclinedError" })', "_tag: private host error tags"],
    ['context.ui.slot({ append: "home.footer.status", render })', "ui.slot: nothing is always visible"],
  ] as const
  it.each(PROBE)("catches %s", (code, problem) => {
    expect(forbiddenUses(code, "probe.ts", "test").join("\n")).toContain(problem)
  })

  it.each([
    ['import { Effect } from "effect"', "effect, which plugins must neither bundle nor depend on"],
    ['import { spawn } from "node:child_process"', "child_process: the plugin starts no process"],
    ['const module = await import(`./${name}.js`)', "a computed module path"],
  ])("catches %s in the shipped code", (code, problem) => {
    expect(forbiddenUses(code, "probe.ts", "shipped").join("\n")).toContain(problem)
  })

  it.each(["it.skip", "it.skipIf(process.env.CI)", "describe.only", "test.todo", "it.runIf(false)"])("catches %s in tests", (call) => {
    expect(forbiddenUses(`${call}("x", () => {})`, "probe.test.ts", "test").join("\n")).toContain("every test runs")
  })

  it("passes the public API, strings and comments that only mention a forbidden name", () => {
    const clean = [
      'import { Plugin } from "@opencode/plugin"',
      'import { Rpc } from "@opencode/plugin/rpc"',
      'import { OpenCode } from "@opencode/sdk"',
      "await ctx.permission.assert({ sessionID, action, resources, save })",
      "await ctx.experimental.generate.text({ prompt })",
      '// @opencode/ai is forbidden: "ctx.experimental.artifact"',
    ].join("\n")
    expect(forbiddenUses(clean, "clean.ts", "test")).toEqual([])
  })
})
