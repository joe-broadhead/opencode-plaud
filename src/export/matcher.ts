/**
 * OpenCode's own permission matcher, mirrored for the one check the host cannot make for a plugin.
 *
 * The host does not see a plugin's local file write, so `export` evaluates the caller's `external_directory` rules
 * itself. It must evaluate them exactly as the host does (`@opencode/core` 2.4.1, `permission.evaluate`/`match`):
 *
 * - an input's and a pattern's backslash is a `/` on every platform;
 * - `*` is any run of characters, `?` one character, and a trailing ` .*` is optional;
 * - `s` is always set, and `i` on win32 or when the action is a path action on darwin.
 *
 * `test/matcher.test.ts` compares this implementation with the host's real `evaluate` on all three platforms.
 */

export type Effect = "allow" | "ask" | "deny"

/** The actions whose resources are paths, and which the host matches without case on darwin. */
export const PATH_ACTIONS = ["external_directory", "read", "edit"] as const

export interface Rule {
  readonly action: string
  readonly resource: string
  readonly effect: Effect
}

export function ignoresCase(action: string, platform: string = process.platform): boolean {
  return platform === "darwin" && PATH_ACTIONS.some((item) => item === action)
}

/** The host's wildcard match, verbatim. */
export function match(input: string, pattern: string, ignoreCase = false, platform: string = process.platform): boolean {
  const normalized = input.replaceAll("\\", "/")
  let escaped = pattern.replaceAll("\\", "/").replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")
  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"
  return new RegExp(`^${escaped}$`, platform === "win32" || ignoreCase ? "si" : "s").test(normalized)
}

/**
 * The effect of `rules` for an action and a resource: the last matching rule wins, and no match asks. `rules` are the
 * agent's followed by the session's, as the host evaluates them.
 */
export function effectFor(rules: readonly Rule[], action: string, resource: string, platform: string = process.platform): Effect {
  const ignoreCase = ignoresCase(action, platform)
  return rules.findLast((rule) => match(action, rule.action, false, platform) && match(resource, rule.resource, ignoreCase, platform))?.effect ?? "ask"
}
