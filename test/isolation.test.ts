import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { TESTED_HOSTS } from "../src/version.js"
import { tempDir } from "./temp-dirs.js"

/**
 * QA X1 and X7: the tested OpenCode releases are listed once, and isolated hosts never start below a folder that
 * holds OpenCode config, which OpenCode's upward search would read.
 */

const REPO = realpathSync(fileURLToPath(new URL("..", import.meta.url)))
const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("tempDir", () => {
  it("makes folders under /tmp, whatever TMPDIR says", () => {
    const dir = tempDir("plaud-isolation-")
    made.push(dir)
    expect(dir.startsWith(`${realpathSync("/tmp")}/plaud-isolation-`)).toBe(true)
    expect(statSync(dir).isDirectory()).toBe(true)
  })

  it.each([".opencode", "opencode.json"])("refuses a folder with %s above it, and leaves nothing behind", (name) => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "plaud-isolation-base-")))
    made.push(base)
    mkdirSync(join(base, "below"))
    if (name === ".opencode") mkdirSync(join(base, name))
    else writeFileSync(join(base, name), "{}")
    expect(() => tempDir("x-", join(base, "below"))).toThrow(`${join(base, name)} is above the test folder`)
    expect(readdirSync(join(base, "below"))).toEqual([])
  })
})

describe("the tested releases", () => {
  it("are listed once, in src/version.ts, and named in the README, SECURITY and the options", () => {
    const files = ["src", "scripts", "test", ".github"].flatMap((dir) =>
      (readdirSync(join(REPO, dir), { recursive: true }) as string[]).map((file) => join(dir, file)).filter((file) => /\.(ts|tsx|mjs|yml)$/.test(file)),
    )
    const lists = files.filter((file) => /\[\s*"2\.2\.\d+"\s*,\s*"2\.2\.\d+"/.test(readFileSync(join(REPO, file), "utf8")))
    expect(lists.sort()).toEqual(["src/version.ts", "test/version.test.ts"])
    const words = `${TESTED_HOSTS.slice(0, -1).join(", ")} and ${TESTED_HOSTS.at(-1)}`
    for (const doc of ["README.md", "SECURITY.md", "docs/configuration.md"]) expect(readFileSync(join(REPO, doc), "utf8"), doc).toContain(`tested on ${words}`)
  })
})
