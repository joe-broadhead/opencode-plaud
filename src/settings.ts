/**
 * The plugin's options, validated and defaulted. The defaults are also the manifest's, so a person reading
 * `docs/configuration.md` sees what a zero-config install uses.
 */
import { homedir } from "node:os"
import { isAbsolute, resolve } from "node:path"
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"
import { onThisMachine } from "./export/files.js"
import { MCP_URL } from "./provider/client.js"

export const DEFAULT_EXPORT_ROOT = "~/Plaud"
export const DEFAULT_MAX_AUDIO_BYTES = 2 * 1024 ** 3
export const DEFAULT_EXPORT_TIMEOUT_MS = 30 * 60_000
export const MAX_AUDIO_BYTES = 64 * 1024 ** 3
export const MAX_EXPORT_TIMEOUT_MS = 24 * 3_600_000
export const ACCESS_LEVELS = ["all", "ask-changes", "read-only"] as const
export type Access = (typeof ACCESS_LEVELS)[number]

export interface Settings {
  readonly access: Access
  /** The aliases the options declare, in their order. Empty: one `default` account. */
  readonly accounts: Readonly<Record<string, unknown>>
  readonly allowUntestedHost: boolean
  /** The one Plaud MCP endpoint every account's server uses. */
  readonly url: string
  /** The folders an export may write in, absolute, expanded and de-duplicated; the first holds defaults. */
  readonly exportRoots: readonly string[]
  readonly maxAudioBytes: number
  readonly exportTimeoutMs: number
}

/** https, or plain http on this machine only. */
export function secureUrl(url: URL): boolean {
  return url.protocol === "https:" || (url.protocol === "http:" && onThisMachine(url))
}

const KEYS = ["access", "accounts", "allowUntestedHost", "url", "exportRoots", "maxAudioBytes", "exportTimeoutMs"] as const

function invalid(what: string, next: string): never {
  throw new SourceError({ code: "OPTIONS_INVALID", what, next })
}

/** The options, checked and defaulted. One refusal names every problem it finds. */
export function loadSettings(raw: unknown): Settings {
  const value = raw ?? {}
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("the plugin's options are not an object", "Fix the plugin's options in opencode.json: they are one object.")
  const options = value as Record<string, unknown>
  const problems: string[] = []
  for (const key of Object.keys(options)) if (!(KEYS as readonly string[]).includes(key)) problems.push(`${key} is not an option`)
  const access = options["access"] ?? "all"
  if (typeof access !== "string" || !(ACCESS_LEVELS as readonly string[]).includes(access)) problems.push("access must be all, ask-changes or read-only")
  const accounts = options["accounts"] ?? {}
  if (typeof accounts !== "object" || accounts === null || Array.isArray(accounts)) problems.push("accounts must be a map of alias to profile")
  const allowUntestedHost = options["allowUntestedHost"] ?? false
  if (typeof allowUntestedHost !== "boolean") problems.push("allowUntestedHost must be true or false")
  const url = options["url"] ?? MCP_URL
  if (typeof url !== "string") problems.push("url must be a string")
  else {
    const parsed = URL.parse(url)
    if (parsed === null || !secureUrl(parsed)) problems.push("url must be an https URL (plain http only on localhost)")
    else if (parsed.username !== "" || parsed.password !== "") problems.push("url must not carry a user name or password")
  }
  const roots = options["exportRoots"] ?? [DEFAULT_EXPORT_ROOT]
  const expanded: string[] = []
  if (!Array.isArray(roots) || roots.length === 0) problems.push("exportRoots must be a list with at least one folder")
  else {
    for (const root of roots) {
      if (typeof root !== "string" || root.trim() === "") {
        problems.push("exportRoots must name folders as strings")
        continue
      }
      if (!(root === "~" || root.startsWith("~/") || isAbsolute(root))) {
        problems.push(`exportRoots: ${root} must be an absolute path or start with ~/`)
        continue
      }
      expanded.push(root === "~" || root.startsWith("~/") ? resolve(homedir(), root.slice(2)) : resolve(root))
    }
  }
  const maxAudioBytes = options["maxAudioBytes"] ?? DEFAULT_MAX_AUDIO_BYTES
  if (typeof maxAudioBytes !== "number" || !Number.isSafeInteger(maxAudioBytes) || maxAudioBytes < 1 || maxAudioBytes > MAX_AUDIO_BYTES) {
    problems.push(`maxAudioBytes must be a whole number from 1 to ${MAX_AUDIO_BYTES}`)
  }
  const exportTimeoutMs = options["exportTimeoutMs"] ?? DEFAULT_EXPORT_TIMEOUT_MS
  if (typeof exportTimeoutMs !== "number" || !Number.isSafeInteger(exportTimeoutMs) || exportTimeoutMs < 1_000 || exportTimeoutMs > MAX_EXPORT_TIMEOUT_MS) {
    problems.push(`exportTimeoutMs must be a whole number from 1000 to ${MAX_EXPORT_TIMEOUT_MS}`)
  }
  if (problems.length > 0) invalid(`the plugin's options are invalid: ${problems.join("; ")}`, "Fix them in this plugin's options in opencode.json.")
  return {
    access: access as Access,
    accounts: accounts as Readonly<Record<string, unknown>>,
    allowUntestedHost: allowUntestedHost as boolean,
    url: url as string,
    exportRoots: [...new Set(expanded)],
    maxAudioBytes: maxAudioBytes as number,
    exportTimeoutMs: exportTimeoutMs as number,
  }
}
