/**
 * The Plaud MCP client: the one place the Plaud endpoint and its tool names live.
 *
 * Plaud hosts an MCP server, and OpenCode owns the connection and the OAuth sign-in. The plugin reads through the
 * host's own executors, `<server>_<tool>` (for example `plaud-work_list_files`), with the caller's tool context, so the
 * host's permission rules for those reads still apply. Nothing here holds a token, a refresh token or a URL query.
 */
import { accountName } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"

/** Plaud's hosted MCP endpoint, the one its accounts share; `options.url` replaces it. */
export const MCP_URL = "https://mcp.plaud.ai/mcp"

/** The plugin's name, which derives every account's server name. */
export const PLUGIN = "plaud"

/** Plaud's tool names, as its server lists them. */
export const TOOLS = {
  list: "list_files",
  file: "get_file",
  note: "get_note",
  transcript: "get_transcript",
  user: "get_current_user",
} as const

export type ToolName = (typeof TOOLS)[keyof typeof TOOLS]

/** The MCP server one alias signs in to: `plaud` for `default`, `plaud-<alias>` otherwise. */
export function serverName(alias: string): string {
  return accountName(PLUGIN, alias)
}

/** What one provider read needs from the handler call: the host's tool context fields, and the signal. */
export interface ProviderCall {
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  readonly signal: AbortSignal
  progress(update?: Readonly<Record<string, unknown>>): Promise<void>
}

/** Reads Plaud's payloads for one account, through the host's executors. */
export interface Provider {
  read(account: string, tool: ToolName, args: Readonly<Record<string, unknown>>, call: ProviderCall): Promise<unknown>
}

/** One host tool executor, as `ctx.tool.list()` answers it. */
export interface ToolExecutor {
  readonly id: string
  execute(args: never, context: never): Promise<unknown>
}

/**
 * The provider over OpenCode's own MCP executors. `tools` reads the host's current list on every call, so a server
 * that connects or reconnects is picked up without a restart.
 */
export function createProvider(tools: () => Promise<readonly ToolExecutor[]>): Provider {
  return {
    async read(account, tool, args, call) {
      const server = serverName(account)
      const id = `${server}_${tool}`
      const executor = (await tools()).find((item) => item.id === id)
      if (executor === undefined) {
        throw new SourceError({
          code: "NEEDS_SIGN_IN",
          what: `The ${server} server is not connected or not signed in, so ${id} is unavailable`,
          next: `Sign in to ${server} in OpenCode, then retry.`,
        })
      }
      try {
        return resultData((await executor.execute(args as never, call as never)) as { readonly output?: unknown; readonly content?: unknown })
      } catch (error) {
        if (error instanceof SourceError) throw error
        const message = error instanceof Error ? error.message : String(error)
        const reason = message.split("\n", 1)[0] ?? message
        if (/^Permission denied/i.test(reason)) {
          throw new SourceError({
            code: "PERMISSION_DENIED",
            what: `${id} was refused: ${reason}`,
            next: "Ask the person to allow this read, or use a session whose agent allows it.",
          })
        }
        throw new SourceError({
          code: "UNAVAILABLE",
          what: `${id} failed: ${reason}`,
          next: "Retry once; if it keeps failing, read status and follow its next step.",
        })
      }
    },
  }
}

/**
 * Plaud wraps recording data in an envelope: a sentence that names a random tag, then
 * `<untrusted-user-data-<hex> source="plaud-recording">`, the payload, the closing tag, and sometimes a note. Only the
 * tag with attributes opens the payload; the sentence names it bare.
 */
const ENVELOPE = /<(untrusted-user-data-[0-9a-z]+)\s[^>]*>\n?([\s\S]*?)\n?<\/\1>/

/** The payload inside Plaud's envelope, or the text itself when it has none. */
export function unwrap(text: string): string {
  return ENVELOPE.exec(text)?.[2] ?? text
}

/**
 * The data of a host MCP tool result. The host parses JSON text into `output` when the server declares no output
 * schema; anything still a string is taken out of its envelope and parsed here when it looks like JSON.
 */
export function resultData(result: { readonly output?: unknown; readonly content?: unknown }): unknown {
  const value = result.output ?? contentText(result.content)
  if (typeof value !== "string") return value
  const inner = unwrap(value)
  const text = inner.trim()
  if (!text.startsWith("{") && !text.startsWith("[")) return inner
  try {
    return JSON.parse(text) as unknown
  } catch {
    return inner
  }
}

function contentText(content: unknown): string | undefined {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return undefined
  return content.flatMap((part) => (isRecord(part) && typeof part["text"] === "string" ? [part["text"]] : [])).join("\n")
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

/** A payload the plugin cannot read at all: refused rather than exported as an empty file. */
export function unreadable(what: string): never {
  throw new SourceError({
    code: "UNAVAILABLE",
    what: `Plaud returned ${what}, and the plugin cannot read it`,
    next: "Retry once; if it keeps failing, report it to the plugin's maintainers.",
  })
}
