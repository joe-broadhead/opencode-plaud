/** Shared domain types. Host-agnostic: nothing here knows about OpenCode. */

export const EXPORT_KINDS = ["audio", "transcript", "note"] as const
export const TRANSCRIPT_BLOCKS = ["transaction", "transaction_polish", "outline", "mark_memo"] as const

export type TranscriptBlock = (typeof TRANSCRIPT_BLOCKS)[number]

/** How much the generated default rules allow. `all` is the default; the other two are how a user restricts the plugin. */
export const ACCESS_VALUES = ["all", "ask-changes", "read-only"] as const
export type Access = (typeof ACCESS_VALUES)[number]

/** Validated plugin options with every default applied (`loadConfig`). */
export interface PluginConfig {
  /** Extra account aliases. The default account always exists and is not listed. */
  readonly accounts: readonly string[]
  /** Plaud's MCP endpoint. */
  readonly url: string
  /** Absolute, normalized directories exports may write under; never empty. */
  readonly exportRoots: readonly string[]
  readonly maxAudioBytes: number
  /** Whole-export budget, independent of OpenCode's tool budget. */
  readonly exportTimeoutMs: number
  /** Load on an OpenCode release outside the tested range, with a warning. */
  readonly allowUntestedHost: boolean
  /** What the generated default rules allow: everything, exports ask, or read-only. */
  readonly access: Access
}
