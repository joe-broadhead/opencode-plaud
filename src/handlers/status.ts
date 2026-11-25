/**
 * `status`: what a person and an app read before anything else. It carries no content and no credential.
 *
 * The answer is the contract's `statusAnswer`, built from the manifest, the versions, one entry per alias, the problems
 * setup recorded and what `call.unguardedAgents()` answered. Every value comes from the call or from setup: nothing is
 * written after `register` returns.
 */
import { accountStatuses, statusAnswer, STATUS_SCHEMA, type AccountSignal } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import { EMPTY } from "./shared.js"
import type { HandlerRuntime } from "./runtime.js"

/** `status`: name, version, host, state, one entry per alias, unguarded agents and a next step. */
export function statusHandler(runtime: HandlerRuntime): MethodHandler {
  return {
    description: "Read the plugin's version, its OpenCode host range, every account alias and any next step.",
    input: EMPTY,
    output: STATUS_SCHEMA,
    async run(_input, call) {
      const signals: Record<string, AccountSignal> = {}
      for (const account of runtime.accounts) {
        const signal = await runtime.accountSignal(account.alias)
        const owner = runtime.owners.get(account.alias)
        signals[account.alias] = { ...signal, ...(owner === undefined ? {} : { owner }) }
      }
      return statusAnswer({
        manifest: runtime.manifest,
        version: runtime.version,
        hostVersion: runtime.hostVersion,
        accounts: accountStatuses(runtime.accounts, signals),
        problems: runtime.accountProblems,
        // A failed agent list is unknown, never zero: statusAnswer turns `{ ok: false, error }` into a problem.
        unguardedAgents: await call.unguardedAgents(),
      })
    },
  }
}
