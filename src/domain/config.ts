import { homedir } from "node:os"
import { isAbsolute, resolve } from "node:path"
import * as z from "zod"
import type { PluginConfig } from "./types.js"

/**
 * Plugin options. Every key is optional, so zero config works, and an unknown
 * key is refused, so a typo fails setup with one message instead of being
 * ignored.
 */

/** Plaud's hosted MCP endpoint, the `url` default. */
export const DEFAULT_URL = "https://mcp.plaud.ai/mcp"

/** The account behind the `plaud` server, used in export resources such as `default:audio`. No alias may reuse it. */
export const DEFAULT_ACCOUNT = "default"

const DEFAULT_EXPORT_ROOT = "~/Plaud"
const DEFAULT_MAX_AUDIO_BYTES = 2 * 1024 ** 3
const DEFAULT_MAX_TEXT_BYTES = 25 * 1024 ** 2
const DEFAULT_EXPORT_TIMEOUT_MS = 30 * 60_000

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"])

/** https, or plain http on this machine only. */
export function secureUrl(url: URL): boolean {
  return url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname))
}

const alias = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,31}$/, { message: "use lowercase letters, digits and '-', at most 32 characters" })
  .refine((value) => value !== DEFAULT_ACCOUNT, { message: `"${DEFAULT_ACCOUNT}" names the plaud server's account` })

// zod runs the refinement even when `z.url()` has already reported an unparsable value.
const serverUrl = z.url().refine((value) => {
  const url = URL.parse(value)
  return url === null || secureUrl(url)
}, { message: "must be an https URL (plain http only on localhost)" })

const root = z.string().refine((value) => value === "~" || value.startsWith("~/") || isAbsolute(value), {
  message: "must be an absolute path, ~ or a path starting with ~/",
})

const Options = z.strictObject({
  accounts: z
    .array(alias)
    .refine((list) => new Set(list).size === list.length, { message: "aliases must be unique" })
    .default(() => []),
  url: serverUrl.default(DEFAULT_URL),
  exportRoots: z.array(root).min(1, { message: "list at least one directory" }).default(() => [DEFAULT_EXPORT_ROOT]),
  maxAudioBytes: z.number().int().positive().max(64 * 1024 ** 3).default(DEFAULT_MAX_AUDIO_BYTES),
  maxTextBytes: z.number().int().positive().max(2 * 1024 ** 3).default(DEFAULT_MAX_TEXT_BYTES),
  // Milliseconds. The ceiling stays far below the 2^31 - 1 ms that timers can hold.
  exportTimeoutMs: z.number().int().min(1_000).max(24 * 3_600_000).default(DEFAULT_EXPORT_TIMEOUT_MS),
  allowUntestedHost: z.boolean().default(false),
})

/**
 * Validates the options and applies every default. Export roots come back
 * absolute, normalized and de-duplicated, with `~` expanded to the home
 * directory. Every problem is reported in one error.
 */
export function loadConfig(raw: unknown): PluginConfig {
  const parsed = Options.safeParse(raw ?? {})
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(options)"}: ${issue.message}`)
    throw new Error(
      `OPTIONS_INVALID: opencode-plaud has invalid options: ${issues.join("; ")}. Next step: Fix them in this plugin's "options" in your OpenCode config.`,
    )
  }
  const { exportRoots, ...options } = parsed.data
  return { ...options, exportRoots: [...new Set(exportRoots.map(expandRoot))] }
}

function expandRoot(value: string): string {
  return value === "~" || value.startsWith("~/") ? resolve(homedir(), value.slice(2)) : resolve(value)
}
