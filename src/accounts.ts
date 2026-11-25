/**
 * The account wiring for the `mcp` mechanism, through the contract's `accounts` module.
 *
 * Plaud's hosted MCP server holds the credentials, and OpenCode keys the OAuth per server. One server per alias, named
 * `plaud` for `default` and `plaud-<alias>` otherwise, all on the one endpoint in `src/provider/`.
 */
import type { Plugin } from "@opencode/plugin"
import { registerAccounts, type AccountSignal, type AccountsRegistration } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { serverName } from "./provider/client.js"

/** The context part registration needs: the two transforms a plugin's setup context has. */
export type AccountsContext = Pick<Plugin.Context, "integration" | "mcp">

/** Register one Plaud MCP server per alias, with any problem recorded for `status`. */
export function registerPlaudAccounts(context: AccountsContext, manifest: Manifest, options: Readonly<Record<string, unknown>>, url: string): Promise<AccountsRegistration> {
  return registerAccounts(context, {
    manifest,
    options,
    server: () => ({ type: "remote", url }),
  })
}

/** One server in OpenCode's own MCP list, as `ctx.mcp.list()` answers it. */
export interface McpServerInfo {
  readonly name: string
  readonly status: { readonly status: string; readonly error?: string | undefined }
}

/**
 * One alias's state from OpenCode's MCP list: connected is ready, a sign-in is needed, a failed server is an error with
 * its reason, and a server OpenCode has not listed yet is a sign-in that has not happened. A disabled server is an
 * error: the person turned it off, which is not something signing in fixes.
 */
export function signalFor(alias: string, servers: readonly McpServerInfo[]): AccountSignal {
  const server = servers.find((entry) => entry.name === serverName(alias))
  if (server === undefined) return { state: "needs_sign_in", reason: "OpenCode has not listed this account's server yet." }
  switch (server.status.status) {
    case "connected":
      return { state: "ready" }
    case "needs_auth":
      return { state: "needs_sign_in", reason: "Sign in to this account's server in OpenCode." }
    case "pending":
      return { state: "ready" }
    case "failed":
      return { state: "error", reason: server.status.error ?? "OpenCode could not connect this account's server." }
    case "disabled":
      return { state: "error", reason: "This account's server is disabled in OpenCode." }
    default:
      return { state: "error", reason: `OpenCode reports the server state "${server.status.status}".` }
  }
}
