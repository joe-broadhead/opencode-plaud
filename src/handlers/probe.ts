/** `probe`: whose an account is. It reads the account, never any recording. */
import { parseProbeInput, probeResult, PROBE_SCHEMA, SourceError } from "@we-the-rebel-alliance/plugin-contract/events"
import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import { TOOLS } from "../provider/client.js"
import { ownerOf } from "../provider/owner.js"
import { refuseInput, refuseSource } from "./shared.js"
import { RECORDINGS, type HandlerRuntime } from "./runtime.js"

/** `probe`: the owner of one account, from Plaud's `get_current_user`. */
export function probeHandler(runtime: HandlerRuntime): MethodHandler {
  return {
    description: "Read the signed-in owner of one Plaud account. It reads the account's identity, never a recording.",
    input: {
      type: "object",
      properties: { source: { type: "string", description: "The source to probe; only recordings." } },
      additionalProperties: false,
    },
    output: PROBE_SCHEMA,
    async run(input, call) {
      const parsed = parseProbeInput(input)
      if (!parsed.ok) refuseInput(parsed.problems)
      if (parsed.value.source !== undefined && parsed.value.source !== RECORDINGS) refuseSource(parsed.value.source)
      const owner = ownerOf(await runtime.provider.read(call.account, TOOLS.user, {}, call))
      if (owner === undefined) {
        throw new SourceError({
          code: "UNAVAILABLE",
          what: `Plaud did not name the signed-in user of the account "${call.account}"`,
          next: "Read status, and sign in to this account again if it shows a problem.",
        })
      }
      runtime.owners.set(call.account, owner)
      return probeResult({ source: RECORDINGS, account: call.account, owner })
    },
  }
}
