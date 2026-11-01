import { describe, expect, it, vi } from "vitest"
import { SIGN_IN_AGAIN, nameIntegrations, type IntegrationHost } from "../src/host/integration.js"
import { mcpServers } from "../src/host/mcp.js"

type Editor = Parameters<Parameters<IntegrationHost["integration"]["transform"]>[0]>[0]

/** A host whose MCP servers each have an integration named after the server, as OpenCode registers them. */
function fakeHost(states: Record<string, string> = { plaud: "connected", "plaud-team": "needs_auth" }) {
  const names = new Map([
    ["mcp_plaud", "plaud"],
    ["mcp_team", "plaud-team"],
    ["mcp_other", "github"],
  ])
  const transforms: ((editor: Editor) => void)[] = []
  // The signed-in account of each integration, with the status the plugin reported on it.
  const reports = new Map<string, { message: string } | undefined>([["mcp_plaud", undefined], ["mcp_team", undefined]])
  const disposed = vi.fn()
  const replay = () => {
    const editor = {
      get: (id: string) => (names.has(id) ? { id, name: names.get(id)! } : undefined),
      update: (id: string, update: (integration: { id: string; name: string }) => void) => {
        const draft = { id, name: names.get(id)! }
        update(draft)
        names.set(id, draft.name)
      },
    } as unknown as Editor
    for (const transform of transforms) transform(editor)
  }
  const host: IntegrationHost = {
    mcp: {
      list: async () =>
        ({
          location: {},
          data: [
            { name: "plaud", status: { status: states["plaud"] }, integrationID: "mcp_plaud" },
            { name: "plaud-team", status: { status: states["plaud-team"] }, integrationID: "mcp_team" },
            { name: "github", status: { status: "connected" }, integrationID: "mcp_other" },
          ],
        }) as never,
    },
    integration: {
      get: (async ({ integrationID }: { integrationID: string }) => ({ data: { id: integrationID, name: names.get(integrationID) } })) as never,
      transform: (async (callback: (editor: Editor) => void) => {
        transforms.push(callback)
        replay()
        return {
          dispose: async () => {
            disposed()
            transforms.splice(transforms.indexOf(callback), 1)
          },
        }
      }) as never,
      connection: {
        active: (async (id: string) => (reports.has(id) ? { type: "credential", id: `cred-${id}`, status: reports.get(id) } : undefined)) as never,
        status: (async ({ integrationID, status }: { integrationID: string; status?: { message: string } }) => void reports.set(integrationID, status)) as never,
        resolve: (async () => undefined) as never,
      },
    },
    event: { subscribe: async function* () {} } as never,
  }
  /** The host registering its integrations again under the server names, as an MCP reload does. */
  const reload = () => {
    names.set("mcp_plaud", "plaud")
    names.set("mcp_team", "plaud-team")
  }
  return { host, names, disposed, reload, reports, states }
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((done) => setTimeout(done, 10))
  expect(check()).toBe(true)
}

describe("/connect entries", () => {
  it("rename each account's integration, again after the host names it back, and leave others alone", async () => {
    const { host, names, disposed, reload } = fakeHost()
    const registration = nameIntegrations(host, mcpServers(["team"]))
    await until(() => names.get("mcp_plaud") === "Plaud" && names.get("mcp_team") === "Plaud (team)")
    expect(names.get("mcp_other")).toBe("github")
    reload()
    await until(() => names.get("mcp_plaud") === "Plaud" && names.get("mcp_team") === "Plaud (team)")
    expect(disposed).toHaveBeenCalledOnce()
    await registration.dispose()
    expect(disposed).toHaveBeenCalledTimes(2)
  })

  it("mark a signed-in account that needs a new sign-in, and clear the mark once it connects", async () => {
    const { host, reports, states } = fakeHost()
    const registration = nameIntegrations(host, mcpServers(["team"]))
    await until(() => reports.get("mcp_team")?.message === SIGN_IN_AGAIN)
    expect(reports.get("mcp_plaud")).toBeUndefined()
    states["plaud-team"] = "connected"
    await until(() => reports.get("mcp_team") === undefined)
    await registration.dispose()
  })
})
