/**
 * The plugin's one entry: `Plugin.define({ id, setup })`, the host gate, the accounts, and one `register` call.
 *
 * `register` wires doors 1–3 from `handlers`, resolves accounts, generates the access rules and builds the bus.
 * This file never calls `ctx.tool`, `ctx.rpc` or `ctx.permission` itself; the provider reads Plaud through the host's
 * own MCP executors, and the one local write is the export.
 */
import { Plugin } from "@opencode/plugin"
import { accountsOf, type AccountSignal } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { assertHost, register } from "@we-the-rebel-alliance/plugin-contract/register"
import { registerPlaudAccounts, signalFor } from "./accounts.js"
import type { Rule } from "./export/matcher.js"
import { handlersFor, owners } from "./handlers/index.js"
import { manifest, packageName, version } from "./manifest.js"
import { createProvider, type ToolExecutor } from "./provider/client.js"
import { loadSettings } from "./settings.js"

export default Plugin.define({
  id: manifest.plugin.name,
  async setup(context) {
    assertHost(context, manifest)
    const options = (context.options ?? {}) as Readonly<Record<string, unknown>>
    const settings = loadSettings(options)

    const plan = accountsOf(manifest, options)
    if (!plan.ok) throw new Error(`OPTIONS_INVALID: ${plan.problems.join("; ")}. Next step: fix the plugin's accounts option.`)

    // Plaud's MCP server holds the credentials: one server per alias, named plaud or plaud-<alias>.
    const registered = await registerPlaudAccounts(context, manifest, options, settings.url)

    const handlers = handlersFor({
      packageName,
      manifest,
      version,
      hostVersion: context.app.version,
      accounts: plan.value.accounts,
      accountProblems: registered.problems,
      async accountSignal(alias: string): Promise<AccountSignal> {
        const servers = (await context.mcp.list()).data
        return signalFor(alias, servers)
      },
      provider: createProvider(async () => (await context.tool.list()) as unknown as readonly ToolExecutor[]),
      clock: Date.now,
      settings,
      location: {
        directory: context.location.directory,
        ...(context.location.workspaceID === undefined ? {} : { workspaceID: context.location.workspaceID }),
        project: { directory: context.location.project.directory },
      },
      agentRules: async (agent: string): Promise<readonly Rule[]> => {
        const found = await context.agent.get({ agentID: agent, location: { directory: context.location.directory } })
        return found.data.permissions as readonly Rule[]
      },
      sessionRules: async (sessionID: string): Promise<readonly Rule[]> => {
        const session = await context.session.get({ sessionID })
        return (session.permissions ?? []) as readonly Rule[]
      },
      owners: owners(),
    })

    const registration = await register(context, manifest, handlers)
    return () => registration.dispose()
  },
})
