import type { Status } from "../rpc.js"
import { formatStatus, statusUnavailable, summarizeStatus } from "../status.js"
import type { PluginContext, Registration } from "./context.js"

/**
 * `/plaud-status` posts the status as a synthetic message with
 * `resume: false`, so the user sees it and no model turn is spent.
 */

export const STATUS_COMMAND = {
  name: "plaud-status",
  description: "Plaud: show each account's sign-in state, the export folders and the next step",
} as const

export type CommandsHost = {
  readonly command: Pick<PluginContext["command"], "transform">
  readonly session: Pick<PluginContext["session"], "synthetic">
}

export function registerCommands(ctx: CommandsHost, read: () => Promise<Status>): Promise<Registration> {
  return ctx.command.transform((editor) => {
    editor.add({
      ...STATUS_COMMAND,
      execute: async ({ sessionID, delivery }) => {
        const { text, description } = await read().then(
          (status) => ({ text: formatStatus(status), description: summarizeStatus(status) }),
          (error: unknown) => {
            const { message, nextStep } = statusUnavailable(error)
            return { text: `${message} Next step: ${nextStep}`, description: "Plaud: status unavailable" }
          },
        )
        await ctx.session.synthetic({
          sessionID,
          text,
          description,
          metadata: { source: "opencode-plaud", command: STATUS_COMMAND.name },
          delivery,
          resume: false,
        })
      },
    })
  })
}
