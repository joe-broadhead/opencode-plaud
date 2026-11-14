import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * The declaration against Plaud's own tool list, captured live (`test/fixtures/live-tools.json`). The release kit's drift
 * check (`scripts/check-drift.mjs`: the kit tests run it in `npm run check`, and the release build runs it as a gate)
 * checks the declaration, the registry and `provenance.json` against the capture: every served tool declared with its
 * readOnlyHint or a recorded override, nothing declared that is not served unless own or gated, own tools off the
 * server's list, no stale registry entry, every tool allow, every permission in the namespace, and a per-account pattern
 * sharing its default tool's permission and readOnly. Kept here: the capture is a live one of Plaud's own server, and the
 * per-account rules the kit check does not make, that each served tool is declared under its own name and that a
 * pattern stands only beside its default tool.
 */

const NAMESPACE = "plaud"

type Tool = { name: string; permission: string; effect: string; readOnly?: boolean; note?: string }
type Served = { name: string; readOnlyHint: boolean | null }

const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8")) as T
const declared = read<{ jelly: { tools: Tool[] } }>("package.json").jelly.tools
const capture = read<{ evidence: string; listedAt: string; server: string; count: number; tools: Served[] }>("test/fixtures/live-tools.json")

const short = (permission: string) => permission.slice(NAMESPACE.length + 1)
const served = new Map(capture.tools.map((tool) => [tool.name, tool]))

describe("the declaration against the live tool list", () => {
  it("is a live capture of this plugin's own server, never a names-only one", () => {
    expect(capture.evidence).toBe("live-observed")
    expect(capture.server).toBe(NAMESPACE)
  })

  it("declares every tool the server serves under its own name, which a per-account pattern does not stand in for", () => {
    const names = new Set(declared.map((tool) => tool.name))
    expect([...served.keys()].filter((name) => !names.has(`${NAMESPACE}.${name}`))).toEqual([])
  })

  it("declares a per-account pattern only beside the default account's tool of the same permission and readOnly", () => {
    for (const tool of declared.filter((each) => each.name.includes("*"))) {
      const twin = declared.find((each) => each.name === `${NAMESPACE}.${short(tool.permission)}`)
      expect({ pattern: tool.name, twin: twin && { permission: twin.permission, readOnly: twin.readOnly } }).toEqual({ pattern: tool.name, twin: { permission: tool.permission, readOnly: tool.readOnly } })
    }
  })
})
