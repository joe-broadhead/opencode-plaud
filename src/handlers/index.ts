/**
 * The handler table: one entry per method the manifest declares, by the method's name.
 *
 * A handler says what one method looks like and does the work; `register` adds the account selector, the doors, the
 * permission assertions and the answer checks. The provider is the only layer that talks to Plaud.
 */
import type { HandlerTable } from "@we-the-rebel-alliance/plugin-contract/register"
import { eventsListHandler } from "./events-list.js"
import { exportHandler } from "./export.js"
import { planExportHandler } from "./plan-export.js"
import { probeHandler } from "./probe.js"
import { recentHandler } from "./recent.js"
import { statusHandler } from "./status.js"
import type { HandlerRuntime } from "./runtime.js"

export type { HandlerRuntime } from "./runtime.js"
export { owners } from "./runtime.js"

/** Every method's handler. Pass-through MCP tools have none: Plaud's server owns them. */
export function handlersFor(runtime: HandlerRuntime): HandlerTable {
  return {
    status: statusHandler(runtime),
    probe: probeHandler(runtime),
    events_list: eventsListHandler(runtime),
    recent: recentHandler(runtime),
    plan_export: planExportHandler(runtime),
    export: exportHandler(runtime),
  }
}
