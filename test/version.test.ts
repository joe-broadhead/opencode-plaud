import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { checkHost, hostWarning, isSupportedHost, isTestedHost, PLUGIN_VERSION, SUPPORTED_HOSTS, TESTED_HOSTS } from "../src/version.js"

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string; opencode: { host: string } }

describe("host check", () => {
  it("states the same range as package.json, and the plugin's own version", () => {
    expect(manifest.opencode.host).toBe(SUPPORTED_HOSTS)
    expect(PLUGIN_VERSION).toBe(manifest.version)
  })

  it("lists the tested releases once: 2.2.3, 2.2.4 and 2.2.5", () => {
    expect(TESTED_HOSTS).toEqual(["2.2.3", "2.2.4", "2.2.5"])
  })

  it.each(["2.2.3", "2.2.4", "2.2.5"])("treats %s as tested, with no warning", (version) => {
    expect(isTestedHost(version)).toBe(true)
    const host = checkHost(version, false)
    expect(host).toEqual({ version, range: SUPPORTED_HOSTS, tested: true, inRange: true })
    expect(hostWarning(host)).toBeUndefined()
  })

  it.each(["2.2.6", "2.2.10"])("starts on %s, inside the range, and calls it untested", (version) => {
    expect(isSupportedHost(version)).toBe(true)
    expect(isTestedHost(version)).toBe(false)
    const host = checkHost(version, false)
    expect(host).toEqual({ version, range: SUPPORTED_HOSTS, tested: false, inRange: true })
    expect(hostWarning(host)).toBe(`opencode-plaud is tested on OpenCode 2.2.3, 2.2.4, 2.2.5, and this is OpenCode ${version}: inside the supported range >=2.2.3 <2.3.0, but untested.`)
  })

  it.each(["2.2.2", "2.3.0", "3.0.0", "1.18.30", "2.2.4-beta.1", "2.2.3+build.5", "0.0.0-dev-202610301200", "unknown", ""])(
    "refuses %j, outside the range, unless allowUntestedHost is set",
    (version) => {
      expect(isSupportedHost(version)).toBe(false)
      expect(isTestedHost(version)).toBe(false)
      expect(() => checkHost(version, false)).toThrow(/^HOST_UNTESTED: opencode-plaud supports OpenCode >=2\.2\.3 <2\.3\.0, .*allowUntestedHost/)
      const allowed = checkHost(version, true)
      expect(allowed).toEqual({ version, range: SUPPORTED_HOSTS, tested: false, inRange: false })
      expect(hostWarning(allowed)).toBe(`opencode-plaud supports OpenCode >=2.2.3 <2.3.0, and this is OpenCode ${version}. It was loaded because "allowUntestedHost" is set.`)
    },
  )
})
