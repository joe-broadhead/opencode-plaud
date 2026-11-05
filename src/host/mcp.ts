import { DEFAULT_ACCOUNT } from "../domain/config.js"
import type { McpEditor, PluginContext } from "./context.js"

/**
 * How the Plaud MCP server is hosted: Plaud's remote server, registered with
 * OpenCode. OpenCode connects to it, runs the OAuth sign-in
 * (`/connect`, or `opencode mcp auth plaud`), stores and refreshes the tokens,
 * and exposes its tools as `plaud_<tool>`.
 */

/** Server name of the default account. An extra account `<alias>` is the server `plaud-<alias>`. */
const SERVER = "plaud"

/**
 * Upstream tools known to be harmless reads, so they run without a prompt:
 * the recordings and the signed-in account's own details. Every other
 * upstream tool asks.
 */
export const KNOWN_READS = ["list_files", "get_file", "get_note", "get_transcript", "get_current_user"] as const

export interface McpServer {
  readonly account: string
  readonly name: string
}

interface McpOptions {
  /** Extra account aliases; the default account always exists. */
  readonly accounts: readonly string[]
  readonly url: string
}

export interface PlaudServers {
  /** One server per account, the default account first. */
  readonly list: readonly McpServer[]
  /** Server names another definition, such as the user's own config, held on the last replay; those are left alone. */
  inUse(): readonly string[]
  dispose(): Promise<void>
}

export function serverName(account: string): string {
  return account === DEFAULT_ACCOUNT ? SERVER : `${SERVER}-${account}`
}

/**
 * The tools RPC's account choice: none or "default" is the plaud server, an alias from the options its
 * plaud-<alias> server, and anything else no server (ACCOUNT_UNKNOWN). A server the user's config defines under one
 * of these names is still that account's server, as it is for the model and for plaud_export.
 */
export function accountServer(aliases: readonly string[]): (account: string | undefined) => string | undefined {
  return (account) => (account === undefined || account === DEFAULT_ACCOUNT || aliases.includes(account) ? serverName(account ?? DEFAULT_ACCOUNT) : undefined)
}

export function mcpServers(accounts: readonly string[]): McpServer[] {
  return [DEFAULT_ACCOUNT, ...accounts].map((account) => ({ account, name: serverName(account) }))
}

/**
 * Sets each account's server unless the name is already defined. The
 * transform is synchronous and replays from scratch on every rebuild.
 */
function setServers(editor: McpEditor, servers: readonly McpServer[], url: string): string[] {
  const inUse: string[] = []
  for (const server of servers) {
    if (editor.get(server.name) !== undefined) inUse.push(server.name)
    else editor.set(server.name, { type: "remote", url })
  }
  return inUse
}

export async function registerMcp(ctx: Pick<PluginContext, "mcp">, options: McpOptions): Promise<PlaudServers> {
  const list = mcpServers(options.accounts)
  let inUse: readonly string[] = []
  const registration = await ctx.mcp.transform((editor) => {
    inUse = setServers(editor, list, options.url)
  })
  return { list, inUse: () => inUse, dispose: () => registration.dispose() }
}
