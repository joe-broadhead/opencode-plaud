/** The options: defaults, the two url schemes, roots, bounds and the one refusal form. */
import { homedir } from "node:os"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"
import { loadSettings, MAX_AUDIO_BYTES, MAX_EXPORT_TIMEOUT_MS } from "../src/settings.js"
import { MCP_URL } from "../src/provider/client.js"

function refusal(value: unknown): string {
  try {
    loadSettings(value)
  } catch (error) {
    if (error instanceof SourceError) return error.message
    throw error
  }
  throw new Error("expected a refusal")
}

describe("loadSettings", () => {
  it("defaults to every read, the Plaud endpoint and one export root under the home folder", () => {
    expect(loadSettings(undefined)).toEqual({
      access: "all",
      accounts: {},
      allowUntestedHost: false,
      url: MCP_URL,
      exportRoots: [resolve(homedir(), "Plaud")],
      maxAudioBytes: 2 * 1024 ** 3,
      exportTimeoutMs: 30 * 60_000,
    })
  })

  it("keeps the accounts map and expands, resolves and de-duplicates a root list", () => {
    const settings = loadSettings({ accounts: { work: {}, personal: {} }, exportRoots: ["~/Plaud", "/tmp/plaud", "~/Plaud"], access: "ask-changes" })
    expect(settings.accounts).toEqual({ work: {}, personal: {} })
    expect(settings.exportRoots).toEqual([resolve(homedir(), "Plaud"), resolve("/tmp/plaud")])
    expect(settings.access).toBe("ask-changes")
  })

  it("accepts plain http only on this machine", () => {
    expect(loadSettings({ url: "http://127.0.0.1:9/mcp" }).url).toBe("http://127.0.0.1:9/mcp")
    expect(refusal({ url: "http://mcp.plaud.ai/mcp" })).toMatch(/^OPTIONS_INVALID: .* url must be an https URL/)
    // An invented credential for the URL user-name/password refusal test, assembled so the file carries no credential shape.
    const withLogin = ["https://user", "pass@mcp.plaud.ai/mcp"].join(":")
    expect(refusal({ url: withLogin })).toMatch(/^OPTIONS_INVALID: .* user name or password/)
  })

  it.each([
    [{ access: "sometimes" }, "access must be all, ask-changes or read-only"],
    [{ accounts: [] }, "accounts must be a map of alias to profile"],
    [{ allowUntestedHost: "yes" }, "allowUntestedHost must be true or false"],
    [{ exportRoots: [] }, "exportRoots must be a list with at least one folder"],
    [{ exportRoots: ["relative"] }, "must be an absolute path or start with ~/"],
    [{ maxAudioBytes: 0 }, `maxAudioBytes must be a whole number from 1 to ${MAX_AUDIO_BYTES}`],
    [{ exportTimeoutMs: MAX_EXPORT_TIMEOUT_MS + 1 }, `exportTimeoutMs must be a whole number from 1000 to ${MAX_EXPORT_TIMEOUT_MS}`],
    [{ extra: true }, "extra is not an option"],
  ])("refuses %j", (value, message) => {
    expect(refusal(value)).toContain(message)
    expect(refusal(value)).toMatch(/Next step: /)
  })

  it("refuses options that are not an object", () => {
    expect(refusal("nope")).toMatch(/^OPTIONS_INVALID: the plugin's options are not an object/)
  })
})
