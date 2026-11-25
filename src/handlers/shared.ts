/** The shapes and refusals the handlers share. */
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"
import type { JsonSchema } from "@we-the-rebel-alliance/plugin-contract/manifest"

/** A method that takes no input. */
export const EMPTY: JsonSchema = { type: "object", properties: {}, additionalProperties: false }

/** A method whose answer the contract's own checks describe, rather than a second copy of them. */
export const OBJECT: JsonSchema = { type: "object", additionalProperties: true }

/** Refuse an input the contract's parser rejected, in the contract's one form. */
export function refuseInput(problems: readonly string[]): never {
  throw new SourceError({ code: "INPUT_INVALID", what: problems.join("; "), next: "Pass only the input the method's schema describes." })
}

/** Refuse a source this plugin does not have. */
export function refuseSource(source: string): never {
  throw new SourceError({ code: "SOURCE_UNKNOWN", what: `${source} is not a source of plaud`, next: "Read the recordings source, or omit source." })
}
