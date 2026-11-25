/**
 * The `external_directory` gate for the export's local write.
 *
 * The host checks a tool call, not a file a plugin writes, so the export carries this gate itself: outside the
 * session's and the project's directory, the caller's agent and session rules must *allow* the target folder. An ask is
 * a refusal, because nobody may be present to answer it (an automation, a script); a deny is a refusal. Rules the host
 * adds at call time are not visible to a plugin: a saved "Always allow" and a policy plugin's `permission.evaluate`
 * hook are not consulted, and `docs/security.md` says so.
 */
import { join, parse, resolve } from "node:path"
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"
import { effectFor, type Rule } from "./matcher.js"
import { realFolder, underRoot } from "./files.js"

/** Where the plugin runs: the session's directory, its project, and whether it is a workspace. */
export interface ExportLocation {
  readonly directory: string
  readonly workspaceID?: string | undefined
  readonly project: { readonly directory: string }
}

/** The rules the host would evaluate: the agent's, then the session's. */
export interface RuleSource {
  agentRules(agent: string): Promise<readonly Rule[]>
  sessionRules(sessionID: string): Promise<readonly Rule[]>
}

/** True when a folder is outside the session's directory and the project's directory. */
function outsideProject(location: ExportLocation, path: string): boolean {
  const project = location.project.directory
  return !underRoot(path, location.directory) && (project === parse(project).root || !underRoot(path, project))
}

/**
 * Refuse an export whose target folder the caller may not write, before anything is created. `target` is the folder
 * the file lands in, or the file itself; the rule is evaluated for the folder's `*`, as the host does for a write.
 */
export async function assertExternal(target: string, call: { readonly agent: string; readonly sessionID: string }, location: ExportLocation, rules: RuleSource): Promise<void> {
  if (location.workspaceID !== undefined) {
    throw new SourceError({
      code: "UNAVAILABLE",
      what: "the export runs in a workspace session, whose files are on the workspace machine, not this one",
      next: "Run the export in a session whose location is on this machine.",
    })
  }
  const real = await realFolder(target)
  if (!outsideProject(location, real)) return
  const evaluated = [...(await rules.agentRules(call.agent)), ...(await rules.sessionRules(call.sessionID))]
  const resource = join(real, "*").replaceAll("\\", "/")
  if (effectFor(evaluated, "external_directory", resource) === "allow") return
  throw new SourceError({
    code: "PERMISSION_DENIED",
    what: `the export folder is outside the project, and the external_directory rules do not allow it: ${resolve(real)}`,
    next: `Add { "action": "external_directory", "resource": "${resource}", "effect": "allow" } to the agent or session rules, or set exportRoots inside the project.`,
  })
}
