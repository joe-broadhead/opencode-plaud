/** What every handler may read: setup's values, the provider, the clock, and the accounts' owners. */
import type { AccountProfile, AccountSignal } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { Manifest, Owner } from "@we-the-rebel-alliance/plugin-contract/manifest"
import type { ExportLocation } from "../export/gate.js"
import type { Provider } from "../provider/client.js"

/** The declared events source's name: `plaud.recordings`' `input.source`. */
export const RECORDINGS = "recordings"

/** The declared snapshot source's name. */
export const RECENT = "recent"

/**
 * Each account's owner, as its last probe named it: one entry per account, never shared between them. Status and the
 * recordings pages name the same owner until a probe names another.
 */
export interface Owners {
  get(account: string): Owner | undefined
  set(account: string, owner: Owner): void
}

/** A fresh, empty record of owners: one per plugin instance. */
export function owners(): Owners {
  const kept = new Map<string, Owner>()
  return { get: (account) => kept.get(account), set: (account, owner) => void kept.set(account, owner) }
}

/** The export settings an export runs under. */
export interface ExportSettings {
  readonly exportRoots: readonly string[]
  readonly maxAudioBytes: number
  readonly exportTimeoutMs: number
}

/** Where the plugin runs, as `ctx.location` gave it at setup. */
export type { ExportLocation }

/** The plugin state the handlers may read, built once in `setup`. */
export interface HandlerRuntime {
  /** The installed package name, which a page states. */
  readonly packageName: string
  /** The validated manifest. */
  readonly manifest: Manifest
  /** The package version, which `status` reports. */
  readonly version: string
  /** The OpenCode release the plugin runs on. */
  readonly hostVersion: string
  /** The accounts the options declare, in their order. */
  readonly accounts: readonly AccountProfile[]
  /** What registering the accounts could not do, for `status`. */
  readonly accountProblems: readonly string[]
  /** One alias's state, from OpenCode's MCP server list. */
  accountSignal(alias: string): Promise<AccountSignal>
  readonly provider: Provider
  readonly clock: () => number
  readonly settings: ExportSettings
  readonly location: ExportLocation
  /** The rules the host would evaluate for one call. */
  agentRules(agent: string): Promise<readonly import("../export/matcher.js").Rule[]>
  sessionRules(sessionID: string): Promise<readonly import("../export/matcher.js").Rule[]>
  readonly owners: Owners
}
