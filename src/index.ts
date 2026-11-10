import { Plugin } from "@opencode/plugin"
import { DEFAULT_ACCOUNT, loadConfig } from "./domain/config.js"
import { registerCommands } from "./host/commands.js"
import { nameIntegrations } from "./host/integration.js"
import { accountServer, registerMcp } from "./host/mcp.js"
import { defaultRules, registerPermissions } from "./host/permissions.js"
import { registerRpc } from "./host/rpc.js"
import { loadSkills, registerSkills } from "./host/skills.js"
import { registerTools } from "./host/tools/index.js"
import { eventsMethod } from "./host/tools/events.js"
import { recentMethod } from "./host/tools/recent.js"
import { METHODS, registerToolsRpc } from "./host/tools-rpc.js"
import { readStatus } from "./status.js"
import { checkHost, hostWarning, PLUGIN_ID } from "./version.js"

/**
 * Setup runs in order: options, the host check, one Plaud MCP server per
 * account and its `/connect` name, the default permission rules, plaud_export, plaud_recent and plaud_events_list, then
 * `/plaud-status`, the skills, the status RPC and the tools RPC for scripts (the five reads, `recent` and `events_list`).
 * The cleanup disposes every registration, newest first.
 */
export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const options = loadConfig(ctx.options)
    const host = checkHost(ctx.app.version, options.allowUntestedHost)
    const warning = hostWarning(host)
    if (warning !== undefined) console.warn(`opencode-plaud: ${warning}`)

    const registrations: { dispose(): Promise<void> }[] = []
    const cleanup = async () => {
      for (const registration of registrations.splice(0).reverse()) await registration.dispose().catch(() => undefined)
    }
    try {
      const servers = await registerMcp(ctx, options)
      registrations.push(servers)
      registrations.push(nameIntegrations(ctx, servers.list))
      registrations.push(await registerPermissions(ctx, defaultRules(servers.list.map((server) => server.name), options.access)))
      registrations.push(await registerTools(ctx, options))
      // `../skills/` is the package's skills folder from both src/ and the bundled dist/.
      const skills = await loadSkills(new URL("../skills/", import.meta.url))
      const status = () => readStatus(ctx, { host, servers, exportRoots: options.exportRoots, skills, access: options.access })
      registrations.push(await registerCommands(ctx, status))
      registrations.push(await registerSkills(ctx, skills))
      registrations.push(await registerRpc(ctx, status))
      // Scripts call the five reads, recent and export with no model. Every account's server is the plugin's to use,
      // even one the user defined under that name, as for the model and plaud_export; so there is no SERVER_CONFLICT.
      // The envelope's account picks the server, and the own methods get it as call.account.
      const accounts: [string, ...string[]] = [DEFAULT_ACCOUNT, ...options.accounts]
      const stopTools = await registerToolsRpc(ctx, {
        methods: [...METHODS, recentMethod(ctx, accounts), eventsMethod(ctx, accounts)],
        mcp: { server: accountServer(options.accounts), managed: () => true },
      })
      registrations.push({ dispose: stopTools })
    } catch (error) {
      await cleanup()
      throw error
    }
    return cleanup
  },
})
