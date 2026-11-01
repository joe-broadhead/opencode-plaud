import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { checkHost, isTestedHost, TESTED_HOST } from "../src/version.js"

describe("host check", () => {
  it("states the same range as package.json", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { opencode: { host: string } }
    expect(manifest.opencode.host).toBe(TESTED_HOST)
  })

  it.each(["2.2.3", "2.2.4", "2.2.10"])("treats %s as tested", (version) => {
    expect(isTestedHost(version)).toBe(true)
    expect(checkHost(version, false)).toEqual({ version, tested: true })
  })

  it.each(["2.2.2", "2.3.0", "3.0.0", "1.18.30", "2.2.4-beta.1", "2.2.3+build.5", "0.0.0-dev-202610301200", "unknown", ""])(
    "refuses untested %j unless allowUntestedHost is set",
    (version) => {
      expect(isTestedHost(version)).toBe(false)
      expect(() => checkHost(version, false)).toThrow(/^HOST_UNTESTED: .*allowUntestedHost/)
      const allowed = checkHost(version, true)
      expect(allowed).toMatchObject({ version, tested: false })
      expect(allowed.tested === false && allowed.warning).toContain(`tested on OpenCode ${TESTED_HOST}`)
    },
  )
})
