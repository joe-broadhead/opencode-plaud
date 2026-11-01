import { Plugin } from "@opencode/plugin"
import { loadConfig } from "./domain/config.js"
import { registerCommands } from "./host/commands.js"
import { nameIntegrations } from "./host/integration.js"
import { registerMcp } from "./host/mcp.js"
import { registerPermissions } from "./host/permissions.js"
import { registerRpc } from "./host/rpc.js"
import { registerSkills } from "./host/skills.js"
import { registerTools } from "./host/tools/index.js"
import { readStatus } from "./status.js"
import { checkHost, PLUGIN_ID } from "./version.js"

/**
 * Setup runs in order: options, the host check, one Plaud MCP server per
 * account and its `/connect` name, the default permission rules, the export tool, then
 * `/plaud-status`, the skills and the status RPC. The cleanup disposes every
 * registration, newest first.
 */
export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const options = loadConfig(ctx.options)
    const host = checkHost(ctx.app.version, options.allowUntestedHost)
    if (!host.tested) console.warn(`opencode-plaud: ${host.warning}`)

    const registrations: { dispose(): Promise<void> }[] = []
    const cleanup = async () => {
      for (const registration of registrations.splice(0).reverse()) await registration.dispose().catch(() => undefined)
    }
    try {
      const servers = await registerMcp(ctx, options)
      registrations.push(servers)
      registrations.push(nameIntegrations(ctx, servers.list))
      registrations.push(await registerPermissions(ctx))
      registrations.push(await registerTools(ctx, options))
      const status = () => readStatus(ctx, { host, servers, exportRoots: options.exportRoots })
      registrations.push(await registerCommands(ctx, status))
      // `../skills/` is the package's skills folder from both src/ and the bundled dist/.
      registrations.push(await registerSkills(ctx, new URL("../skills/", import.meta.url)))
      registrations.push(await registerRpc(ctx, status))
    } catch (error) {
      await cleanup()
      throw error
    }
    return cleanup
  },
})
