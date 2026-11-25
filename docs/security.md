# Security

## What leaves the machine

The plugin talks to Plaud's hosted MCP endpoint (`https://mcp.plaud.ai/mcp`, or `options.url`), and OpenCode owns that
connection and its OAuth. A read asks Plaud's own MCP tools; the plugin sends the recording id, a date window and a page,
and nothing else. An audio export downloads the signed link Plaud answers, following redirects by hand: every hop must be
https (plain http only on localhost) with no user name or password, and a local address may not be reached through a link
that was not local.

Nothing else leaves the machine. There is no telemetry and no second service.

## Credentials

Plaud's MCP server holds the credentials. OpenCode adds one MCP server per alias and keys the OAuth per server, so the
plugin never sees a token, a refresh token or a password. The plugin stores no credential and prints none. A signed
audio link is a credential: no error message names it, and the plugin never logs it.

## Scopes

The plugin requests no OpenCode scope of its own. Plaud's MCP sign-in scopes are the provider's, and its server does not
expose them to a caller, so `probe` reports the owner and no scope list rather than inventing one.

## Untrusted data

Every answer is marked `trust: "untrusted"`. A recording's title is data: the plugin never follows it, never puts it in
`status`, and never uses it to choose a tool or a recipient. Every page passes its events through the contract's
`screenEvents`, which refuses an item that holds a secret (`refused[]`, reason `secret`). A refused item is never
delivered, and the cursor moves past it. `recent` leaves out a title that holds a secret.

## Redaction

`status` reasons and the next step go through the contract's `redactReason`: query values, bearer credentials, JWTs and
token-shaped words are replaced, and the line is cut to 160 characters. A failure the register maps is redacted the same
way. Status and logs never carry a URL query string, a token or a credential.

## The export's local write

The export writes only inside `exportRoots`. The destination is resolved through its longest existing ancestor before it
is checked, so a symlink cannot lead the write out of a root, and each folder is created 0700 and re-checked after it is
created. The file is staged 0600 beside the destination and published atomically; a refused or failed export leaves no file
behind.

Outside the session's and the project's directory, the caller's agent and session `external_directory` rules must
**allow** the target folder. The plugin evaluates them with OpenCode's own matcher (`src/export/matcher.ts`, compared
with the host's in `test/matcher.test.ts`), in the host's order, last match wins. An `ask` is a refusal: nobody may be
present to answer it, in an automation or a script. Two rules the host adds at call time are not visible to a plugin and
are therefore **not** consulted:

- a saved "Always allow" approval from an earlier prompt;
- a policy plugin's `permission.evaluate` hook.

Add the rule to the agent's permissions, or keep the export inside the project, when either matters. A session on a
workspace refuses the export with `UNAVAILABLE`: its files are on the workspace machine.

## Confirmation

`plaud.export` is a local action: contract §8 asks for no confirmation of a `local` effect, because nothing reaches
another person and nothing spends money. The action still follows the contract's two-step form: `plan_export` names the
exact file and writes nothing, and `export` takes only the plan id. The person's `access` level and the OpenCode
permission rules are the gate. A non-read method over RPC that has neither an answered ask nor a valid action grant is
refused with `PERMISSION_DENIED`, as the contract requires.

## Reporting

Report a vulnerability through GitHub's private vulnerability reporting on this repository. Do not open a public issue
with a credential, a token or a person's data in it.
