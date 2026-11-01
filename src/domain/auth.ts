import { DEFAULT_ACCOUNT } from "./config.js"

/**
 * Sign-in is OpenCode's own MCP OAuth: OpenCode registers the client, runs
 * the browser sign-in, and stores and refreshes the tokens. The plugin never
 * sees a token, so an account that is not signed in has one remedy: sign in
 * from `/connect`, where each account's server is listed under its display
 * name. In the TUI the user presses `o` or Enter to open the sign-in page;
 * `opencode mcp auth <server>` on the command line opens it itself.
 */

export const DISPLAY_NAME = "Plaud"

/** The `/connect` name of an account: "Plaud", or "Plaud (<alias>)". */
export function displayName(account: string): string {
  return account === DEFAULT_ACCOUNT ? DISPLAY_NAME : `${DISPLAY_NAME} (${account})`
}

/** The next step for an account that is not signed in. */
export function signInStep(account: string): string {
  return `Run /connect and choose ${displayName(account)}, then press o or Enter to open the sign-in page.`
}
