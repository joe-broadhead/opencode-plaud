import { Plaud, type Status } from "../rpc.js"
import { statusUnavailable } from "../status.js"
import type { PluginContext, Registration } from "./context.js"

/**
 * The `plaud.recordings` RPC: `status` only, the same model `/plaud-status`
 * shows. It reads nothing from Plaud and changes nothing. The TUI refreshes
 * on OpenCode's own MCP, integration and agent events, so there is no
 * plugin event.
 */
export function registerRpc(ctx: { readonly rpc: Pick<PluginContext["rpc"], "register"> }, read: () => Promise<Status>): Promise<Registration> {
  return ctx.rpc.register(Plaud, {
    status: (_input, { error }) =>
      read().catch((cause: unknown) => {
        const { message, nextStep } = statusUnavailable(cause)
        return error("unavailable", message, { nextStep })
      }),
  })
}
