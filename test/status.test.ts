/** `status`: the contract's answer, the account states and the unguarded agents. */
import { STATUS_SCHEMA } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { checkManifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { describe, expect, it } from "vitest"
import { run, runtimeFor } from "./support/handlers.js"
import { signalFor } from "../src/accounts.js"
import { manifest, packageName, version } from "../src/manifest.js"

interface Status {
  name: string
  version: string
  host: { version: string; range: string; tested: string[] }
  state: string
  accounts: { alias: string; state: string; owner?: unknown; reason?: string }[]
  unguardedAgents: string[]
  nextStep: string | null
}

describe("status", () => {
  it("answers the manifest's name, the versions, one entry per alias and a next step of null", async () => {
    const runtime = runtimeFor()
    await run(runtime, "probe", { source: "recordings" }, "work")
    const status = (await run(runtime, "status", {})) as Status
    expect(status).toEqual({
      name: "plaud",
      version,
      host: { version: "2.4.1", range: ">=2.4.1 <2.5.0", tested: ["2.4.1"] },
      state: "ready",
      accounts: [
        { alias: "work", state: "ready", owner: { id: "plaud:user-work", label: "Ana" } },
        { alias: "personal", state: "ready" },
      ],
      unguardedAgents: [],
      nextStep: null,
    })
    expect(checkManifest(manifest).ok).toBe(true)
    expect(packageName).toBe("@we-the-rebel-alliance/plaud-plugin")
    expect(STATUS_SCHEMA).toBeDefined()
  })

  it("says needs_sign_in when an alias has not signed in", async () => {
    const runtime = runtimeFor({ accountSignal: async (alias) => (alias === "personal" ? { state: "needs_sign_in", reason: "Sign in to this account's server in OpenCode." } : { state: "ready" }) })
    const status = (await run(runtime, "status", {})) as Status
    expect(status.state).toBe("needs_sign_in")
    expect(status.accounts[1]).toEqual({ alias: "personal", state: "needs_sign_in", reason: "Sign in to this account's server in OpenCode." })
    expect(status.nextStep).toMatch(/^Sign in to the account that needs it/)
  })

  it("is an error when setup recorded a problem, with the redacted line as the next step", async () => {
    const runtime = runtimeFor()
    Object.defineProperty(runtime, "accountProblems", { value: ["the plaud-work server could not be added"] })
    const status = (await run(runtime, "status", {})) as Status
    expect(status.state).toBe("error")
    expect(status.nextStep).toBe("the plaud-work server could not be added")
  })

  it("names the unguarded agents the call answers", async () => {
    const runtime = runtimeFor()
    const answer = await run(runtime, "status", {})
    expect((answer as Status).unguardedAgents).toEqual([])
  })
})

describe("signalFor", () => {
  it.each([
    ["connected", { state: "ready" }],
    ["needs_auth", { state: "needs_sign_in", reason: "Sign in to this account's server in OpenCode." }],
    ["pending", { state: "ready" }],
    ["failed", { state: "error", reason: "the provider refused the token" }],
    ["disabled", { state: "error", reason: "This account's server is disabled in OpenCode." }],
  ])("maps %s", (state, expected) => {
    expect(signalFor("work", [{ name: "plaud-work", status: { status: state, error: "the provider refused the token" } }])).toEqual(expected)
  })

  it("treats a server OpenCode has not listed as a sign-in that has not happened", () => {
    expect(signalFor("work", [])).toEqual({ state: "needs_sign_in", reason: "OpenCode has not listed this account's server yet." })
  })
})
