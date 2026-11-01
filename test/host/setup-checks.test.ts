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

it("refuses an untested OpenCode release before registering anything", async () => {
  const host = await startHost({ version: "2.3.0" })
  try {
    expect(host.plugin.state).toEqual({
      status: "failed",
      error: expect.stringMatching(/HOST_UNTESTED: opencode-plaud is tested on OpenCode >=2\.2\.3 <2\.3\.0, and this is OpenCode 2\.3\.0\..*"allowUntestedHost": true/),
    })
    expect(await registered(host)).toEqual([])
  } finally {
    await host.close()
  }
})

it("loads an untested release with allowUntestedHost, and status says so", async () => {
  const host = await startHost({ version: "2.3.0", options: { allowUntestedHost: true } })
  try {
    expect(host.plugin.state).toEqual({ status: "active" })
    // The untested-host step comes once nothing more urgent is left, so wait for the sign-in.
    const status = await host.until("the plaud server to sign in", async () => {
      const read = await host.opencode.rpc(Plaud).status({}, { location: host.location })
      return isStatus(read) && read.accounts[0]?.state === "signed_in" ? read : undefined
    })
    expect(status.host).toEqual({
      version: "2.3.0",
      tested: false,
      warning: expect.stringMatching(/this is OpenCode 2\.3\.0\. It was loaded because "allowUntestedHost" is set\.$/),
    })
    expect(status.nextStep).toBe("If Plaud misbehaves, install an OpenCode release in the tested range.")
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
