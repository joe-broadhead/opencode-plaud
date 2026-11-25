# Security

## Reporting a vulnerability

Report a vulnerability through GitHub's private vulnerability reporting on this repository. Do not open a public issue
with a credential, a token or a person's data in it.

## What this plugin holds

Nothing. Plaud's hosted MCP server holds the credentials, OpenCode owns sign-in and the plugin stores no token. The one
thing it writes is the local export, inside `exportRoots`.

## What it reads and where it sends it

It reads Plaud's own MCP tools through OpenCode's executors (`list_files`, `get_file`, `get_note`, `get_transcript`,
`get_current_user`) on the endpoint in `src/provider/client.ts`, or `options.url`. An audio export downloads Plaud's
signed link, https only, with no user name or password, following redirects by hand.

## The local export

The export writes only inside `exportRoots`; the destination is resolved through its longest existing ancestor, each
created folder is re-checked, and the file is staged privately and published atomically. Outside the project, the
caller's `external_directory` rules must allow the folder; an ask is a refusal. See [security](docs/security.md) for the
two rules OpenCode adds at call time that a plugin cannot see (a saved approval and a policy plugin's evaluate hook).

## Scopes

The plugin requests no OpenCode scope. Plaud's MCP sign-in scopes are the provider's, and its server does not expose them;
`probe` reports the owner and no scope list.
