// The README, the docs and the shipped code are one contract: the error codes, the tested releases and the scripting
// examples must match the source. A drift fails this file; run UPDATE_DOCS=1 npm test to regenerate the README block.
import { describe, expect, test } from "vitest"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { ERROR_CODES, ERRORS } from "../src/domain/errors.js"
import { NEXT_STEPS, TOOLS_RPC_ID } from "../src/host/tools-rpc.js"
import { PLUGIN_ID, TESTED_HOSTS } from "../src/version.js"

const ROOT = fileURLToPath(new URL("../", import.meta.url))
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8")
const UPDATE = process.env.UPDATE_DOCS === "1"

function walk(dir: string, extensions: readonly string[]): string[] {
  return readdirSync(`${ROOT}${dir}`, { withFileTypes: true })
    .flatMap(entry => {
      const path = `${dir}/${entry.name}`
      if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "dist" ? [] : walk(path, extensions)
      return extensions.some(extension => entry.name.endsWith(extension)) ? [path] : []
    })
    .sort()
}

const SOURCES = walk("src", [".ts", ".tsx"])
const TESTS = walk("test", [".ts", ".tsx"])
const DOCS = walk("docs", [".md"])
const FILES = ["README.md", "AGENTS.md", "SECURITY.md", "CHANGELOG.md", "CONTRIBUTING.md"]

/** Every code a caller can see: the plugin's own, and the refusals its tools RPC adds. */
const CODES = [...new Set<string>([...ERROR_CODES, ...Object.keys(NEXT_STEPS)])].sort()

const storyOf = (code: string): readonly [string, string] =>
  Object.hasOwn(ERRORS, code)
    ? [ERRORS[code as keyof typeof ERRORS].meaning, ERRORS[code as keyof typeof ERRORS].next]
    : ["The tools RPC refused the call.", NEXT_STEPS[code as keyof typeof NEXT_STEPS]!]

test("the README's code table is the code table: every code, in both directions", () => {
  const open = "<!-- generated:codes -->"
  const close = "<!-- /generated:codes -->"
  const body = ["| Code | What happened | Next step |", "| --- | --- | --- |", ...CODES.map(code => {
    const [what, next] = storyOf(code)
    return `| \`${code}\` | ${what} | ${next} |`
  })].join("\n")
  const text = read("README.md")
  const start = text.indexOf(open)
  const end = text.indexOf(close)
  expect(start !== -1 && end > start).toBe(true)
  const expected = `${text.slice(0, start + open.length)}\n\n${body}\n\n${text.slice(end)}`
  if (UPDATE && expected !== text) writeFileSync(`${ROOT}README.md`, expected)
  expect(read("README.md"), "the README codes block is stale; run UPDATE_DOCS=1 npm test").toBe(expected)
  // A code raised anywhere in the source has a row, and no row names a code the plugin does not have.
  const raised = new Set<string>()
  for (const path of SOURCES) {
    // The shared tools RPC module declares every code any plugin may raise; this plugin's own sites are elsewhere.
    if (path.endsWith("src/host/tools-rpc.ts")) continue
    const source = read(path)
    for (const match of source.matchAll(/\b(?:fail|error|reason)\(\s*"([A-Z][A-Z0-9_]{2,})"/g)) raised.add(match[1]!)
    for (const match of source.matchAll(/"(?:code|reason)":\s*"([A-Z][A-Z0-9_]{2,})"/g)) raised.add(match[1]!)
  }
  expect([...raised].filter(code => !CODES.includes(code))).toEqual([])
})

describe("the tested releases", () => {
  test("every tested-host mention is TESTED_HOSTS, in the same order", () => {
    const unreleased = read("CHANGELOG.md").split(/^## \[/m).find(section => section.startsWith("[Unreleased]")) ?? ""
    const files = [...FILES.filter(file => file !== "CHANGELOG.md"), ...DOCS]
    for (const file of files) {
      const text = read(file)
      for (const match of text.matchAll(/tested on ([0-9][0-9.,\s]*(?:and\s+[0-9][0-9.]*)?)/g)) {
        const said = match[1]!.replace(/[.,\s]+$/u, "").split(/,\s*|\s+and\s+/).map(part => part.trim()).filter(Boolean)
        expect({ file, said }).toEqual({ file, said: TESTED_HOSTS })
      }
    }
    for (const match of unreleased.matchAll(/tested on ([0-9][0-9.,\s]*(?:and\s+[0-9][0-9.]*)?)/g)) {
      const said = match[1]!.replace(/[.,\s]+$/u, "").split(/,\s*|\s+and\s+/).map(part => part.trim()).filter(Boolean)
      expect({ file: "CHANGELOG.md (Unreleased)", said }).toEqual({ file: "CHANGELOG.md (Unreleased)", said: TESTED_HOSTS })
    }
    expect(TESTED_HOSTS).toContain("2.2.6")
  })

  test("the Unreleased section states no tested release it has not run on", () => {
    const unreleased = read("CHANGELOG.md").split(/^## \[/m).find(section => section.startsWith("[Unreleased]")) ?? ""
    expect(unreleased).not.toMatch(/2\.2\.[0-5]\b(?!.*2\.2\.6)/)
  })
})

test("no shipped text carries internal wording", () => {
  const banned = [/\bowner'?s? (decision|ruling)\b/iu, /\bthe lead\b/iu, /\blane\b/iu, /hey-jelly #/iu, /\b(?:G[1-4]|W2|R1[0-8])\b/u]
  for (const file of [...FILES, ...DOCS, ...SOURCES, ...TESTS]) {
    if (file === "test/docs.test.ts") continue
    const text = read(file)
    for (const pattern of banned) expect({ file, pattern: String(pattern), hit: pattern.test(text) }).toEqual({ file, pattern: String(pattern), hit: false })
  }
})

describe("docs/scripting.md", () => {
  // Continuation lines joined, so a call split over lines is read whole.
  const text = read("docs/scripting.md").replace(/\\\n\s*/g, " ")
  const prefix = `/api/rpc/${TOOLS_RPC_ID}/`

  test("names the shipped RPC ids", () => {
    expect(text).toContain(`\`${TOOLS_RPC_ID}\``)
    expect(text).toContain('x-opencode-directory:$PWD')
    expect(PLUGIN_ID).toBe("plaud.recordings")
  })

  test("every call has the location header and the envelope, and names a method the plugin has", () => {
    const methods = new Set([...read("src/host/tools-rpc.ts").matchAll(/kind: "plugin",\s+class: "[a-z]+",\s+name: "([a-z_]+)"/g)].map(m => m[1]!))
    for (const name of ["list_files", "get_file", "get_note", "get_transcript", "get_current_user", "recent", "export"]) methods.add(name)
    const calls = [...text.matchAll(/opencode api post (\/api\/rpc\/[^\s\\]+)([^\n]*)/g)]
    expect(calls.length).toBeGreaterThan(0)
    for (const [, url, rest] of calls) {
      const method = url!.startsWith(prefix) ? url!.slice(prefix.length).split(/[?#]/)[0]! : (url ?? "")
      expect({ url, known: methods.has(method) || method === "describe" }).toEqual({ url, known: true })
      expect({ url, header: rest!.includes('-H "x-opencode-directory:$PWD"') }).toEqual({ url, header: true })
    }
    for (const match of text.matchAll(/-d '(\{"input":\{[\s\S]*?\}\})'/g)) {
      if (match[1]!.includes("…")) continue
      const body = JSON.parse(match[1]!) as { input: Record<string, unknown> }
      expect(Object.keys(body)).toEqual(["input"])
      const keys = Object.keys(body.input)
      expect(keys.filter(key => !["sessionID", "account", "input"].includes(key))).toEqual([])
      // `describe` takes nothing or a session; a method call needs the session and its input.
      if (keys.length === 0) continue
      expect(typeof body.input["sessionID"]).toBe("string")
    }
  })
})
