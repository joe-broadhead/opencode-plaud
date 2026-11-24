/**
 * The tools RPC, version 2.3: every known Plaud read, and the plugin's own methods, as RPC methods, so a script can call
 * them with no model.
 *
 *   POST /api/rpc/plaud.recordings.tools/<method>
 *   { "input": { "sessionID": "<session>", "account": "<account>", "input": <the tool's input> } }
 *
 * The transport is source-contract's `tools-rpc` module (pinned in package.json and bundled into dist/index.js): the
 * version 2 rules (resolve before dispatch, only `allow` runs, the one `evaluate` hook that turns an inner ask of this
 * RPC's own calls into a deny), `describe`, the envelope with its per-account servers, and the per-method resource
 * resolver, which no Plaud method uses. This module is Plaud's part of it, one `ToolsRpcPlugin` value: the plugin's id,
 * its method table, its shapers, its next steps and its own error mapping. It was the PLUGIN-SPECIFIC block of the
 * shared copy every plugin carried.
 *
 * Setup registers the plugin's own methods beside the five reads: `recent` (`plaud_recent`), `events_list`
 * (`plaud_events_list`) and `probe` (`plaud_probe`), each class `read`. `plaud_export`, a local-file write, never is a
 * method.
 */
import {
  registerToolsRpc as register,
  toolsRpcId,
  type Failure,
  type McpResult,
  type MethodSpec,
  type NextSteps,
  type ShapeCall,
  type ToolsRpcContext,
  type ToolsRpcOptions as PackageOptions,
  type ToolsRpcPlugin,
} from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { PlaudError } from "../domain/errors.js"
import { withholdSignedLinksInOutput, withholdSignedLinksInText } from "../domain/redact.js"
import { PLUGIN_ID as PLAUD_ID } from "../version.js"
import { KNOWN_READS as PLAUD_READS } from "./mcp.js"

export { CLASSES, LOCATION_HEADER, LOCATION_HINT, evaluate, hidden, upstreamText } from "@we-the-rebel-alliance/source-contract/tools-rpc"
export type {
  Failure,
  JsonSchema,
  McpMethod,
  McpResult,
  MethodClass,
  MethodSpec,
  NextSteps,
  OwnedMethod,
  PluginMethod,
  Rule,
  ShapeCall,
  ToolCall,
  ToolsRpcContext,
  ToolsRpcPlugin,
} from "@we-the-rebel-alliance/source-contract/tools-rpc"

/** The plugin's id. The RPC id is `<PLUGIN_ID>.tools`. */
export const PLUGIN_ID = PLAUD_ID

/**
 * Every known Plaud tool that OpenCode's server lists, by its upstream name and with its class: the five reads. The
 * class is what `describe` reports and what an approval shows; the rules, not the class, decide whether a call runs.
 * A tool Plaud adds later is not a method, and `plaud_export`, a local-file write, never is. The plugin's own `recent`,
 * `events_list` and `probe` are `kind: "plugin"` methods, built in setup where they have a context.
 */
export const METHODS: readonly MethodSpec[] = PLAUD_READS.map((name): MethodSpec => ({ kind: "mcp", name, class: "read" }))

/** The MCP call's arguments are passed as they are: the plugin adds nothing. */
export function shapeInput(_method: string, input: unknown, _call: ShapeCall): unknown {
  return input
}

/**
 * Every signed link (`presigned_url`, `data_link`) is withheld from a script's result, which never gets one. The
 * plugin's own methods return no link at all: they answer titles, ids, times and owners.
 */
export function shapeResult(_method: string, result: McpResult, _call: ShapeCall): McpResult {
  const text = withholdSignedLinksInText(result.text)
  return result.output === undefined ? { text } : { output: withholdSignedLinksInOutput(result.output), text }
}

/** The next step for each code. Each is one sentence that ends with a full stop. */
export const NEXT_STEPS: NextSteps = {
  SESSION_UNKNOWN: `Create a session in the location you mean, such as POST /api/session with {"agent":"build"} sent with the header "x-opencode-directory: <dir>" or the location[directory] query, and pass its id.`,
  SESSION_AGENT_REQUIRED: `Create a session that names an agent this project has, with its project as the location, such as POST /api/session with {"agent":"build","location":{"directory":"/path/to/project"}}, and pass its id.`,
  PERMISSION_DENIED: "Add an allow rule for the tool to the session's agent or to the session, or use a session whose agent allows it.",
  AUTH_REQUIRED: "Run /connect and choose Plaud, or Plaud (<alias>) for another account, then press o or Enter to open the sign-in page.",
  CONNECTING: "Wait a few seconds while OpenCode connects to the account's server, then call the method again.",
  CONNECTION_FAILED: "Run /plaud-status and follow its next step.",
  DISABLED: "Enable the account's server, plaud or plaud-<alias>, in /mcps.",
  NOT_REGISTERED: "Run /plaud-status and follow its next step.",
  TOOL_UNAVAILABLE: "Call describe to see which methods OpenCode lists now, and run /plaud-status.",
  UPSTREAM_ERROR: "Check the input against the method's schema from describe, and run /plaud-status if it keeps failing.",
  CANCELLED: "Call the method again if you still need the result.",
  ACCOUNT_UNKNOWN: `Leave "account" out for the default account, or pass "default" or an alias from the plugin's accounts option, as /plaud-status lists them.`,
}

/** The plugin's own errors, thrown by its methods' specs, as a code, what happened and the next step. */
export function pluginError(error: unknown): Failure | undefined {
  return error instanceof PlaudError ? { code: error.code, what: error.detail, next: error.nextStep } : undefined
}

/** Plaud's part of the tools RPC, as the package's one value. No method has a resource resolver. */
export const PLAUD: ToolsRpcPlugin = { id: PLUGIN_ID, nextSteps: NEXT_STEPS, shapeInput, shapeResult, pluginError }

/** `plaud.recordings.tools`, the id package.json's `sources.rpc` names. */
export const TOOLS_RPC_ID = toolsRpcId(PLUGIN_ID)

/** Everything setup and the tests pass: the table, its shapers and the MCP options, which Plaud's value completes. */
export type ToolsRpcOptions = Omit<PackageOptions, "plugin">

/** The package's `registerToolsRpc` with Plaud's value, so a caller passes only the table and the MCP options. */
export function registerToolsRpc(ctx: ToolsRpcContext, options: ToolsRpcOptions): Promise<() => Promise<void>> {
  return register(ctx, { ...options, plugin: PLAUD })
}
