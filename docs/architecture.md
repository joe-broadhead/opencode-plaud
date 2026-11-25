# Architecture

## Layers

| Layer | Files | Does |
|---|---|---|
| Entry | `src/index.ts` | `Plugin.define({ id, setup })`, the host gate, the account wiring, the runtime and one `register` call |
| Accounts | `src/accounts.ts` | one Plaud MCP server per alias through the contract's `accounts` module, and each alias's state for `status` |
| Manifest | `src/manifest.ts` | reads `package.json` `capabilities` and checks it with the contract's validator |
| Settings | `src/settings.ts` | validates and defaults the options |
| Handlers | `src/handlers/` | one file per method: the description, the input and output schemas, and the work |
| Provider | `src/provider/` | Plaud's MCP tool names and endpoint, the host executor reads, and Plaud's payload shapes |
| Export | `src/export/` | file naming and Markdown, the atomic write, the download, and the `external_directory` gate |

The entry is deliberately thin. `register` from the contract wires doors 1–3: one agent tool per method in the `plaud`
namespace, the same tools in Code Mode, one RPC registration under `plaud`, the permission assertions on
`<alias>:<operation>`, the access rules inserted into every agent, and the bus writer. This repository never calls
`ctx.tool`, `ctx.rpc` or `ctx.permission` itself.

## The call path

1. OpenCode loads `dist/index.js` through the package's `./server` export and calls `setup(ctx)`.
2. `assertHost` refuses an OpenCode release outside `>=2.4.1 <2.5.0` with `HOST_UNTESTED`, unless
   `allowUntestedHost` is set.
3. `src/accounts.ts` adds one remote MCP server per alias through `ctx.mcp.transform`, named `plaud` or
   `plaud-<alias>`, all on the one endpoint.
4. `register` checks the handler table against `capabilities.methods`, resolves the accounts from the options,
   generates the access rules into every agent, builds the bus writer, and registers the tools and the one RPC id.
5. A call resolves the account, validates the input against the handler's schema, asserts the method's operations,
   runs the handler, checks the answer and maps a failure to the contract's error table.

## The provider

`src/provider/client.ts` is the only file that names Plaud's endpoint and tool names. A read goes through OpenCode's
own executor for `<server>_<tool>` with the caller's tool context, so the host's permission rules for that read still
apply. Nothing here fetches Plaud directly except the signed audio link an export downloads.

The payload readers (`recordings.ts`, `transcript.ts`, `note.ts`, `owner.ts`) are Plaud's wire shapes, written once and
shared by every method: `list_files`, `get_file`, `get_transcript`, `get_note` and `get_current_user`.

## The export

`plan_export` is a read: it validates the input and computes the exact destination, and writes nothing.
`export` is the commit: it re-checks the plan, re-checks the `external_directory` gate, then

1. reads the recording through Plaud's own `get_file`, `get_transcript` or `get_note`;
2. stages the bytes in a private file beside the destination, hashing as it writes;
3. fsyncs and publishes with a hard link, or a rename when overwriting, so the destination is never half-written;
4. answers the path, size and SHA-256.

The gate mirrors OpenCode's matcher exactly (`src/export/matcher.ts`): an input's and a pattern's backslash is a `/`,
`*` and `?` are wildcards, `s` is always set, and `i` is set on win32 or for a path action on darwin. The host cannot
check a plugin's own file write, so the plugin checks the rules the host would evaluate.

## OpenCode APIs

| API | Who calls it |
|---|---|
| `Plugin.define` | `src/index.ts` |
| `ctx.app.version`, `ctx.options`, `ctx.location` | `src/index.ts`, at setup |
| `ctx.mcp.transform` | `src/accounts.ts`, through `registerAccounts` |
| `ctx.mcp.list` | `status`, for each alias's state |
| `ctx.agent.get`, `ctx.session.get` | the export, for the rules the gate evaluates |
| `ctx.tool.list` | the provider, for the MCP executors of the account's server |
| `ctx.agent.transform`, `ctx.tool.transform`, `ctx.rpc.register`, `ctx.permission.assert` | `register` only |

## State and caching

The plugin keeps no content cache and no credential. A consumer keeps its cursor; the plugin binds it to the account and
refuses one another account presents. The only state the plugin keeps is each account's owner, as its last `probe` read
it, so `status` and the pages name the same owner.

## Build

`scripts/build.mjs` bundles `src/index.ts` into `dist/index.js` with esbuild. `@opencode/*` stays external; the contract's
runtime modules are inlined, and `NOTICE` lists their licences. `dist/` is generated and is not committed.
