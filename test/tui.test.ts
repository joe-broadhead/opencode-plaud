import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { unavailable } from "../src/tui.js"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

describe("unavailable", () => {
  it("uses the next step the RPC error declares", () => {
    expect(unavailable({ type: "unavailable", message: "STATUS_UNAVAILABLE: no", data: { nextStep: "Try again." } })).toEqual({
      state: "unavailable",
      message: "STATUS_UNAVAILABLE: no",
      nextStep: "Try again.",
    })
  })

  it("falls back to /plaud-status when the server part does not answer", () => {
    const view = unavailable(new Error("rpc.unavailable"))
    expect(view).toMatchObject({ state: "unavailable", message: "rpc.unavailable" })
    expect(view.state === "unavailable" && view.nextStep).toMatch(/^Run \/plaud-status in a session\./)
  })
})

describe("built TUI part", () => {
  it("is one plain JavaScript file that imports only host-provided modules", () => {
    const built = join(ROOT, "dist", "tui.js")
    expect(existsSync(built), "run `npm run build` first").toBe(true)
    expect(readdirSync(join(ROOT, "dist")).filter((file) => file.endsWith(".tsx"))).toEqual([])
    const code = readFileSync(built, "utf8")
    const imports = [...code.matchAll(/^import\b[^;]*?\bfrom\s*"([^"]+)"/gm)].map((match) => match[1])
    expect(new Set(imports)).toEqual(new Set(["@opentui/core", "@opentui/solid", "solid-js", "@opencode/plugin/rpc"]))
    // Node parses no JSX, so this fails if any is left.
    const syntax = spawnSync(process.execPath, ["--check", built], { encoding: "utf8" })
    expect(syntax.status, syntax.stderr).toBe(0)
  })

  it("renders on OpenTUI 0.8: palette command, dialog, refresh and cleanup", () => {
    const result = spawnSync("bun", ["--conditions=browser", "test/tui-renderer.mjs"], { cwd: ROOT, encoding: "utf8", timeout: 120_000 })
    expect(result.error, "Bun must be on PATH").toBeUndefined()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(result.stdout).toContain("PASS dist/tui.js renders")
  }, 150_000)
})
