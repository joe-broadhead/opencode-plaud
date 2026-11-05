import { homedir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { loadConfig } from "../src/domain/config.js"

describe("plugin options", () => {
  it.each([undefined, null, {}])("works with zero config (%j)", (raw) => {
    expect(loadConfig(raw)).toEqual({
      accounts: [],
      url: "https://mcp.plaud.ai/mcp",
      exportRoots: [join(homedir(), "Plaud")],
      maxAudioBytes: 2_147_483_648,
      exportTimeoutMs: 1_800_000,
      allowUntestedHost: false,
    })
  })

  it("does not share default lists between loads", () => {
    const first = loadConfig({})
    ;(first.accounts as string[]).push("work")
    ;(first.exportRoots as string[]).push("/tmp/elsewhere")
    expect(loadConfig({}).accounts).toEqual([])
    expect(loadConfig({}).exportRoots).toEqual([join(homedir(), "Plaud")])
  })

  it("accepts every documented option", () => {
    const options = {
      accounts: ["work", "team-2"],
      url: "https://mcp.eu.example.test/mcp",
      exportRoots: ["/srv/plaud"],
      maxAudioBytes: 1_000,
      exportTimeoutMs: 60_000,
      allowUntestedHost: true,
    }
    expect(loadConfig(options)).toEqual(options)
  })

  it("expands ~ and normalizes and de-duplicates export roots", () => {
    expect(loadConfig({ exportRoots: ["~", "~/Plaud/", "/srv/plaud/../exports", "/srv/exports", "~/Plaud"] }).exportRoots).toEqual([
      homedir(),
      join(homedir(), "Plaud"),
      "/srv/exports",
    ])
  })

  it("accepts plain http only on localhost", () => {
    for (const url of ["http://127.0.0.1:4010/mcp", "http://localhost/mcp", "http://[::1]:4010/mcp"]) {
      expect(loadConfig({ url }).url).toBe(url)
    }
  })

  it.each([
    [{ acounts: ["work"] }, '(options): Unrecognized key: "acounts"'],
    [{ stateDir: "/tmp/state", policy: {} }, '(options): Unrecognized keys: "stateDir", "policy"'],
    ["work", "(options): Invalid input: expected object, received string"],
    [{ accounts: ["Work"] }, "accounts.0: use lowercase letters, digits and '-', at most 32 characters"],
    [{ accounts: ["a".repeat(33)] }, "accounts.0: use lowercase letters, digits and '-', at most 32 characters"],
    [{ accounts: ["-work"] }, "accounts.0: use lowercase letters"],
    [{ accounts: ["default"] }, 'accounts.0: "default" names the plaud server\'s account'],
    [{ accounts: ["work", "work"] }, "accounts: aliases must be unique"],
    [{ accounts: { work: {} } }, "accounts: Invalid input: expected array"],
    [{ url: "http://mcp.plaud.ai/mcp" }, "url: must be an https URL (plain http only on localhost)"],
    [{ url: "mcp.plaud.ai" }, /url: Invalid URL\. Next step/],
    [{ url: "ftp://mcp.plaud.ai/mcp" }, "url: must be an https URL"],
    [{ exportRoots: [] }, "exportRoots: list at least one directory"],
    [{ exportRoots: ["Plaud"] }, "exportRoots.0: must be an absolute path, ~ or a path starting with ~/"],
    [{ exportRoots: ["~someone/Plaud"] }, "exportRoots.0: must be an absolute path"],
    [{ maxAudioBytes: 0 }, "maxAudioBytes: Too small"],
    [{ maxAudioBytes: 64 * 1024 ** 3 + 1 }, "maxAudioBytes: Too big"],
    // Removed in 0.0.5: a text export's cap is fixed at 25 MiB.
    [{ maxTextBytes: 26_214_400 }, '(options): Unrecognized key: "maxTextBytes"'],
    [{ exportTimeoutMs: 999 }, "exportTimeoutMs: Too small"],
    [{ exportTimeoutMs: 24 * 3_600_000 + 1 }, "exportTimeoutMs: Too big"],
    [{ allowUntestedHost: "yes" }, "allowUntestedHost: Invalid input: expected boolean"],
  ])("refuses %j with one coded message and the next step", (raw, issue) => {
    expect(() => loadConfig(raw)).toThrow(/^OPTIONS_INVALID: opencode-plaud has invalid options: /)
    expect(() => loadConfig(raw)).toThrow(issue)
    expect(() => loadConfig(raw)).toThrow(/\. Next step: Fix them in this plugin's "options" in your OpenCode config\.$/)
  })

  it("names every problem in the same message", () => {
    expect(() => loadConfig({ accounts: ["Work"], exportTimeoutMs: 1, extra: true })).toThrow(
      /^OPTIONS_INVALID: opencode-plaud has invalid options: (?=.*\(options\): Unrecognized key: "extra")(?=.*accounts\.0: )(?=.*exportTimeoutMs: Too small).*; .*; /,
    )
  })
})
