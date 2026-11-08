import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The documented error tables match the codes the code raises, in both directions: every code the plugin raises is in
 * docs/configuration.md's Errors table, and every code there is raised; the same for scripts and docs/scripting.md.
 */

const root = new URL("..", import.meta.url).pathname
const read = (path: string) => readFileSync(join(root, path), "utf8")

function files(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name)
    return statSync(join(root, path)).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : []
  })
}

/** The codes in the first column of the table under `## Errors`; a cell may name several. */
function documented(doc: string): Set<string> {
  const section = read(doc).split(/^## Errors$/m)[1]!.split(/^## /m)[0]!
  const table = section.split("\n\n").find((block) => block.startsWith("| Code |"))!
  return new Set(table.split("\n").slice(2).flatMap((row) => [...row.split("|")[1]!.matchAll(/`([A-Z][A-Z_]+)`/g)].map((m) => m[1]!)))
}

/** The members of a string-literal union type. */
function union(source: string, name: string): string[] {
  const body = new RegExp(`type ${name} =([\\s\\S]*?)\\n\\n`).exec(source)![1]!
  return [...body.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]!)
}

const ERRORS = read("src/domain/errors.ts")
const PLAUD_CODES = union(ERRORS, "ErrorCode")
const RPC_MODULE = "src/host/tools-rpc.ts"

/** The plugin's codes: every PlaudError code, and each code a plain `CODE: …` message starts with. */
function raised(): Set<string> {
  const codes = new Set<string>()
  for (const file of files("src").filter((path) => path !== RPC_MODULE)) {
    const source = read(file)
    for (const m of source.matchAll(/\bfail\(\s*"([A-Z_]+)"/g)) codes.add(m[1]!)
    for (const m of source.matchAll(/new PlaudError\(\s*"([A-Z_]+)"/g)) codes.add(m[1]!)
    // `CODE: what happened` in a doc comment is the format, not a code.
    for (const m of source.matchAll(/[`"]([A-Z][A-Z_]+[A-Z]): /g)) if (m[1] !== "CODE") codes.add(m[1]!)
  }
  return codes
}

describe("documented errors", () => {
  it("lists every code the plugin raises in docs/configuration.md, and no other", () => {
    const codes = raised()
    // Every declared PlaudError code is raised somewhere.
    expect(PLAUD_CODES.filter((code) => !codes.has(code))).toEqual([])
    expect([...codes].sort()).toEqual([...documented("docs/configuration.md")].sort())
  })

  it("lists every code a script can get in docs/scripting.md, and no other", () => {
    // Plaud's servers are all the plugin's own (managed: () => true), so a script never gets SERVER_CONFLICT.
    const shared = union(read(RPC_MODULE), "Code").filter((code) => code !== "SERVER_CONFLICT")
    // The `recent` and `events_list` methods run their tools' own specs, so they can raise these PlaudErrors too.
    const recent = ["INPUT_INVALID", "AUTH_REQUIRED", "PLAUD_READ_FAILED", "PLAUD_UNREADABLE", "EVENTS_CURSOR_INVALID", "EVENTS_OWNER_UNKNOWN"]
    for (const code of recent) expect(read("src/host/tools/recent.ts") + read("src/host/tools/events.ts") + read("src/host/tools/export.ts") + read("src/domain/normalize.ts")).toContain(`"${code}"`)
    expect([...new Set([...shared, ...recent])].sort()).toEqual([...documented("docs/scripting.md")].sort())
  })
})
