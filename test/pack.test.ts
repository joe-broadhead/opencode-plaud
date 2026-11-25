/**
 * The packed tarball: what a release publishes installs alone and loads.
 *
 * `npm pack` writes the tarball, its file list is the package's public surface, and the extracted package's
 * `dist/index.js` imports only `@opencode/plugin` and Node built-ins. The tarball is then installed into an empty
 * project, with the host package the way stock OpenCode provides it, and its server entry loads there.
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { checkManifest, readInstalledManifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { manifest, packageName, version } from "../src/manifest.js"

const REPO = new URL("..", import.meta.url).pathname
const work = mkdtempSync(join(tmpdir(), "plaud-pack-"))
let tarball: string
let extracted: string
const SKILLS = ["plaud", "plaud-digest", "plaud-export"]

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status}):\n${result.stderr}\n${result.stdout}`)
  return result.stdout
}

beforeAll(() => {
  const packed = join(work, "packed")
  mkdirSync(packed)
  const from = process.env["PACK_TARBALL"]
  if (from !== undefined) {
    tarball = from
  } else {
    run("npm", ["pack", "--ignore-scripts", "--pack-destination", packed], REPO)
    tarball = join(packed, readdirSync(packed).find((file) => file.endsWith(".tgz"))!)
  }
  extracted = join(work, "package")
  mkdirSync(extracted)
  run("tar", ["-xzf", tarball, "-C", extracted, "--strip-components=1"], work)
})

afterAll(() => {
  rmSync(work, { recursive: true, force: true })
})

describe("the tarball", () => {
  it("carries the built entry, the skills, the icons and the licence files, and no source or test", () => {
    const files = run("tar", ["-tzf", tarball], work)
      .split("\n")
      .map((line) => line.replace(/^package\//, ""))
      .filter((line) => line !== "" && !line.endsWith("/"))
    expect(files).toEqual(expect.arrayContaining(["package.json", "dist/index.js", "README.md", "LICENSE", "NOTICE", "assets/icon.svg"]))
    for (const skill of SKILLS) expect(files).toContain(`skills/${skill}/SKILL.md`)
    expect(files.filter((file) => /^(src|test|docs|scripts|node_modules)\//.test(file))).toEqual([])
  })

  it("has no runtime dependency, and the manifest the installed package carries validates", () => {
    const pkg = JSON.parse(readFileSync(join(extracted, "package.json"), "utf8")) as Record<string, unknown>
    expect(pkg["name"]).toBe(packageName)
    expect(pkg["version"]).toBe(version)
    expect(pkg).not.toHaveProperty("dependencies")
    expect(pkg).not.toHaveProperty("peerDependencies")
    expect(checkManifest(pkg["capabilities"]).ok).toBe(true)
    const installed = readInstalledManifest(extracted, { version })
    expect(installed.ok).toBe(true)
    if (installed.ok) expect(installed.value.package).toBe(packageName)
  })
})

describe("the installed package", () => {
  it("installs alone into an empty project and its server entry loads with the host's plugin module", async () => {
    const project = join(work, "project")
    mkdirSync(join(project, "node_modules", "@opencode"), { recursive: true })
    const installed = join(project, "node_modules", "@we-the-rebel-alliance", "plaud-plugin")
    mkdirSync(installed, { recursive: true })
    run("tar", ["-xzf", tarball, "-C", installed, "--strip-components=1"], work)
    // What a stock host provides: `@opencode/plugin` beside the installed plugin.
    symlinkSync(join(REPO, "node_modules", "@opencode", "plugin"), join(project, "node_modules", "@opencode", "plugin"), "dir")
    expect(existsSync(join(installed, "dist", "index.js"))).toBe(true)
    const loaded = (await import(pathToFileURL(join(installed, "dist", "index.js")).href)) as { default?: { id?: string; setup?: unknown } }
    expect(loaded.default?.id).toBe(manifest.plugin.name)
    expect(typeof loaded.default?.setup).toBe("function")
  })
})
