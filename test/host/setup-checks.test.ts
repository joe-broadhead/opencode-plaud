import { expect, it } from "vitest"
import { Plaud, isStatus } from "../../src/rpc.js"
import { startHost, type Harness } from "./harness.js"

/** What setup refuses before it registers anything, and what the untested-host override shows. */


async function registered(host: Harness) {
  const [mcp, commands, skills] = await Promise.all([
    host.opencode.mcp.list({ location: host.location }),
    host.opencode.command.list({ location: host.location }),
    host.opencode.skill.list({ location: host.location }),
  ])
  return [...mcp.data.map((server) => server.name), ...commands.data.map((command) => command.name), ...skills.data.map((skill) => skill.id)].filter(
    (name) => name.includes("plaud"),
  )
}

it("refuses an OpenCode release outside the supported range before registering anything", async () => {
  const host = await startHost({ version: "2.3.0" })
  try {
    expect(host.plugin.state).toEqual({
      status: "failed",
      error: expect.stringMatching(/HOST_UNTESTED: opencode-plaud supports OpenCode >=2\.2\.3 <2\.3\.0, and this is OpenCode 2\.3\.0\..*"allowUntestedHost": true/),
    })
    expect(await registered(host)).toEqual([])
  } finally {
    await host.close()
  }
})

it.each([
  ["2.3.0", "outside the range, with allowUntestedHost", { allowUntestedHost: true }, "If Plaud misbehaves, use a tested OpenCode release: 2.2.3, 2.2.4, 2.2.5 or 2.2.6."],
  ["2.2.99", "inside the range but not tested", {}, "Nothing to do."],
])("loads %s, %s, and status calls it untested (INSTALL-4)", async (version, _why, options, nextStep) => {
  const host = await startHost({ version, options })
  try {
    expect(host.plugin.state).toEqual({ status: "active" })
    // The untested-host step comes once nothing more urgent is left, so wait for the sign-in.
    const status = await host.until("the plaud server to sign in", async () => {
      const read = await host.opencode.rpc(Plaud).status({}, { location: host.location })
      return isStatus(read) && read.accounts[0]?.state === "signed_in" ? read : undefined
    })
    expect(status.host).toEqual({ version, range: ">=2.2.3 <2.3.0", tested: false })
    expect(status.state).toBe("connected")
    expect(status.nextStep).toBe(nextStep)
  } finally {
    await host.close()
  }
})

it("refuses invalid options with one message naming each problem", async () => {
  const host = await startHost({ options: { acounts: ["work"], exportTimeoutMs: 5 } })
  try {
    expect(host.plugin.state).toEqual({
      status: "failed",
      error: expect.stringMatching(/OPTIONS_INVALID: opencode-plaud has invalid options: .*exportTimeoutMs.*Unrecognized key: "acounts"/),
    })
    expect(await registered(host)).toEqual([])
  } finally {
    await host.close()
  }
})
