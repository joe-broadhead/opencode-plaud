import { Rpc } from "@opencode/plugin/rpc"

/**
 * The RPC contract. It has one read-only method, `status`, called with `{}`.
 * The build inlines it into both entries, `dist/index.js` and `dist/tui.js`.
 * It is plain JSON Schema with a plain TypeScript type beside it, so the TUI
 * bundle carries no schema library. It is not a package export.
 *
 * It also holds the words for each state (`statusLines`), which both
 * `/plaud-status` and the TUI dialog render, so the two views always agree.
 */

export const RPC_ID = "plaud.recordings"

export const ACCOUNT_STATES = ["signed_in", "sign_in_needed", "connecting", "failed", "disabled", "missing"] as const
export type AccountState = (typeof ACCOUNT_STATES)[number]

export interface Rule {
  readonly action: string
  readonly resource: string
  readonly effect: "allow" | "ask" | "deny"
}

export interface AccountStatus {
  /** Account name; "default" is the account behind the plaud server. */
  readonly account: string
  /** OpenCode MCP server name, such as plaud or plaud-work. */
  readonly server: string
  readonly state: AccountState
  /** OpenCode's reason for a failed connection, with links withheld. */
  readonly reason?: string
  /** Present and true when the user's OpenCode config defines this server, so the plugin left it as it is. */
  readonly userServer?: boolean
}

export interface Status {
  /** One entry per account, the default account first. */
  readonly accounts: readonly AccountStatus[]
  /** Absolute folders plaud_export may write in. */
  readonly exportRoots: readonly string[]
  readonly tools: {
    /** Plaud tools the plugin knows: the reads of every account, and plaud_export. */
    readonly visible: number
    /** Other tools of the Plaud servers; they ask before they run. */
    readonly unknown: number
    /** The unknown tools' names, without the server prefix. */
    readonly unknownNames: readonly string[]
  }
  readonly host: { readonly version: string; readonly tested: boolean; readonly warning?: string }
  /** Agents without the plugin's default permission rules; exports and other Plaud tools run there without asking. */
  readonly unguardedAgents: readonly string[]
  /** The default rules, to add to each unguarded agent's own permissions. */
  readonly permissionsBlock: readonly Rule[]
  /** The most urgent thing to do. */
  readonly nextStep: string
}

const text = { type: "string" } as const
const texts = { type: "array", items: text } as const
const integer = { type: "integer" } as const
const flag = { type: "boolean" } as const
const object = (properties: Record<string, object>, required: readonly string[]) =>
  ({ type: "object", properties, required, additionalProperties: false }) as const

const rule = object({ action: text, resource: text, effect: { enum: ["allow", "ask", "deny"] } }, ["action", "resource", "effect"])

const account = object(
  { account: text, server: text, state: { enum: [...ACCOUNT_STATES] }, reason: text, userServer: flag },
  ["account", "server", "state"],
)

/** The status as JSON Schema; `Status` is the same shape as a type. */
export const StatusSchema = object(
  {
    accounts: { type: "array", items: account },
    exportRoots: texts,
    tools: object({ visible: integer, unknown: integer, unknownNames: texts }, ["visible", "unknown", "unknownNames"]),
    host: object({ version: text, tested: flag, warning: text }, ["version", "tested"]),
    unguardedAgents: texts,
    permissionsBlock: { type: "array", items: rule },
    nextStep: text,
  },
  ["accounts", "exportRoots", "tools", "host", "unguardedAgents", "permissionsBlock", "nextStep"],
)

export const Plaud = Rpc.define({
  id: RPC_ID,
  methods: {
    status: {
      input: object({}, []),
      output: StatusSchema,
      errors: { unavailable: object({ nextStep: text }, ["nextStep"]) },
    },
  },
  events: {},
})

/** JSON Schema outputs reach clients typed as unknown, so readers confirm the fields they use. */
export function isStatus(value: unknown): value is Status {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Record<string, unknown>
  const tools = candidate.tools as Record<string, unknown> | undefined
  const host = candidate.host as Record<string, unknown> | undefined
  return Array.isArray(candidate.accounts) && Array.isArray(candidate.exportRoots) && Array.isArray(candidate.unguardedAgents)
    && Array.isArray(candidate.permissionsBlock) && typeof candidate.nextStep === "string"
    && typeof tools?.visible === "number" && typeof tools.unknown === "number" && Array.isArray(tools.unknownNames)
    && typeof host?.version === "string" && typeof host.tested === "boolean"
}

export type Tone = "ok" | "info" | "warning" | "error"

/** The words for each account state, shared by every plugin's status. */
export const STATE_TEXT: Record<AccountState, string> = {
  signed_in: "connected",
  sign_in_needed: "sign-in required",
  connecting: "connecting",
  failed: "failed",
  disabled: "disabled",
  missing: "not configured",
}

const STATE_TONE: Record<AccountState, Tone> = {
  signed_in: "ok",
  sign_in_needed: "warning",
  connecting: "info",
  failed: "error",
  disabled: "warning",
  missing: "error",
}

/** Most urgent first. */
const URGENCY: readonly AccountState[] = ["sign_in_needed", "failed", "missing", "disabled", "connecting", "signed_in"]

/** The most urgent state of all accounts, for the summary line. */
export function overallState(status: Status): AccountState {
  const states = new Set(status.accounts.map((account) => account.state))
  return URGENCY.find((state) => states.has(state)) ?? "signed_in"
}

export interface StatusLine {
  readonly label: string
  readonly value: string
  readonly tone: Tone
  /** Text to copy, shown under the line. */
  readonly block?: string
}

/** The next step when nothing needs doing. */
export const READY_STEP = "Nothing to do."

/**
 * The status as labelled lines, in the order every view shows them:
 * Connection, Account, Access, Tools, Agents without default rules (with
 * the rules to copy), OpenCode, then one Next step.
 */
export function statusLines(status: Status): StatusLine[] {
  const several = status.accounts.length > 1
  const connection = status.accounts.map((account) =>
    [`${several ? `${account.account}: ` : ""}${STATE_TEXT[account.state]}`, ...(account.reason === undefined ? [] : [` (${account.reason})`])].join(""),
  )
  const lines: StatusLine[] = [
    { label: "Connection", value: connection.join("; "), tone: STATE_TONE[overallState(status)] },
    {
      label: "Account",
      value: status.accounts
        .map((account) => `${account.account} (server ${account.server}${account.userServer ? ", from your OpenCode config" : ""})`)
        .join(", "),
      tone: "info",
    },
    { label: "Access", value: `Reads run without asking. Exports ask, and write only in ${status.exportRoots.join(", ")}.`, tone: "info" },
  ]
  const { visible, unknown, unknownNames } = status.tools
  lines.push({
    label: "Tools",
    value: `${visible} available${unknown === 0 ? "" : `, ${unknown} unknown${unknownNames.length === 0 ? "" : `: ${unknownNames.join(", ")}`} (they ask before running)`}`,
    tone: "info",
  })
  const block = rulesBlock(status)
  if (block !== undefined) {
    lines.push({
      label: "Agents without default rules",
      value: `${status.unguardedAgents.join(", ")}. Exports and other Plaud tools run there without asking. The rules:`,
      tone: "warning",
      block,
    })
  }
  lines.push({
    label: "OpenCode",
    value: status.host.tested ? `${status.host.version} (tested)` : `${status.host.version} (host untested)${status.host.warning ? `: ${status.host.warning}` : ""}`,
    tone: status.host.tested ? "info" : "warning",
  })
  lines.push({ label: "Next step", value: status.nextStep, tone: "info" })
  return lines
}

/** The rules to copy, as JSON with one rule per line, only while some agent misses them. */
export function rulesBlock(status: Status): string | undefined {
  if (status.unguardedAgents.length === 0) return undefined
  return `[\n${status.permissionsBlock.map((rule) => `  ${JSON.stringify(rule)}`).join(",\n")}\n]`
}
