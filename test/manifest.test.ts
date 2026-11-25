/** The manifest and the handler table: one name, one declaration per callable, no stray key. */
import { readFileSync } from "node:fs"
import { checkManifest, methodAccounts } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { methodEntries } from "@we-the-rebel-alliance/plugin-contract/register"
import { describe, expect, it } from "vitest"
import { handlersFor } from "../src/handlers/index.js"
import { manifest, packageName, version } from "../src/manifest.js"
import { runtimeFor } from "./support/handlers.js"

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as Record<string, unknown> & { capabilities: unknown; devDependencies: Record<string, string> }

describe("the package", () => {
  it("is the org's plugin package at 0.0.0, with no runtime or peer dependency", () => {
    expect(packageName).toBe("@we-the-rebel-alliance/plaud-plugin")
    expect(version).toBe("0.0.0")
    expect(pkg).not.toHaveProperty("dependencies")
    expect(pkg).not.toHaveProperty("peerDependencies")
    // Only the package's own keys: the manifest is capabilities, and a legacy key is refused by the validator.
    expect(Object.keys(pkg).sort()).toEqual(
      ["bugs", "capabilities", "description", "devDependencies", "engines", "exports", "files", "homepage", "keywords", "license", "name", "repository", "scripts", "type", "version"].sort(),
    )
    expect(Object.keys(pkg).filter((key) => /^(pre|post)?(install|prepare|pack|publish)/.test(key))).toEqual([])
  })

  it("pins the contract and OpenCode 2.4.1 as dev dependencies", () => {
    expect(pkg.devDependencies["@we-the-rebel-alliance/plugin-contract"]).toBe("github:we-the-rebel-alliance/plugin-contract#v0.0.0")
    for (const name of ["@opencode/plugin", "@opencode/sdk", "@opencode/client"]) expect(pkg.devDependencies[name]).toBe("2.4.1")
  })

  it("validates, and names the plugin, the namespace line and the host range", () => {
    expect(checkManifest(pkg.capabilities).ok).toBe(true)
    expect(manifest.plugin.name).toBe("plaud")
    expect(manifest.plugin.vendor).toEqual({ id: "plaud", name: "Plaud", domain: "plaud.ai" })
    expect(manifest.plugin.host).toEqual({ opencode: ">=2.4.1 <2.5.0", tested: ["2.4.1"] })
    expect(manifest.plugin.summary.length).toBeLessThanOrEqual(400)
    expect(manifest.plugin.summary).not.toMatch(/[\r\n]/)
  })
})

describe("the methods table", () => {
  it("matches the handler table exactly, with no handler for a pass-through MCP tool", () => {
    const entries = methodEntries(manifest, handlersFor(runtimeFor()))
    expect(entries.map((entry) => entry.name).sort()).toEqual(["events_list", "export", "plan_export", "probe", "recent", "status"])
    for (const name of Object.keys(manifest.methods).filter((method) => method.startsWith("mcp:"))) {
      expect(handlersFor(runtimeFor())).not.toHaveProperty(name)
    }
  })

  it("declares Plaud's five tools as pass-through reads", () => {
    expect(Object.keys(manifest.methods).filter((method) => method.startsWith("mcp:")).sort()).toEqual([
      "mcp:get_current_user",
      "mcp:get_file",
      "mcp:get_note",
      "mcp:get_transcript",
      "mcp:list_files",
    ])
    for (const method of Object.keys(manifest.methods).filter((name) => name.startsWith("mcp:"))) expect(manifest.methods[method]!.class).toBe("read")
  })

  it("takes an account on every method that reads one, and none on status", () => {
    for (const [method, item] of Object.entries(manifest.methods)) {
      if (method === "status" || method.startsWith("mcp:")) continue
      expect(methodAccounts(item), method).toBe("optional")
    }
    expect(methodAccounts(manifest.methods["status"]!)).toBe("none")
  })

  it("plans the export through a read and commits it through a non-read", () => {
    expect(manifest.methods["plan_export"]).toMatchObject({ class: "read", plans: true })
    expect(manifest.methods["export"]).toMatchObject({ class: "export", commits: "plan_export" })
    expect(manifest.actions).toHaveLength(1)
    expect(manifest.actions[0]).toMatchObject({ id: "plaud.export", effect: "local", preview: "plan_export", commit: "export" })
  })

  it("declares no bus event, because Plaud has no write and the export is local", () => {
    expect(manifest.events).toEqual({})
  })
})

describe("the sources", () => {
  it("declares the recordings events source and the recent snapshot, both read by a read", () => {
    expect(manifest.sources.map((source) => [source.id, source.kind, source.method])).toEqual([
      ["plaud.recordings", "events", "events_list"],
      ["plaud.recent", "snapshot", "recent"],
    ])
    for (const source of manifest.sources) expect(manifest.methods[source.method]!.class).toBe("read")
  })

  it("keeps every source's operations inside its method's", () => {
    for (const source of manifest.sources) {
      const operations = manifest.methods[source.method]!.operations ?? []
      for (const operation of source.operations ?? []) expect(operations).toContain(operation)
    }
  })
})
