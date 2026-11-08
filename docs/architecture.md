# Architecture

The plugin is a thin layer over Plaud's hosted MCP server. OpenCode hosts the server, signs in and runs Plaud's read tools. The plugin adds the server definitions, default permission rules, an export tool, a read of the newest recordings, a hook that withholds the signed links, a status view, and a tools RPC for scripts.

```text
OpenCode 2.2.x server
 ├─ ctx.mcp.transform      server "plaud", plus "plaud-<alias>" per extra account: remote, https://mcp.plaud.ai/mcp
 │                         OpenCode connects, runs the OAuth sign-in, stores and refreshes the tokens
 ├─ ctx.integration           each server's /connect entry named "Plaud" or "Plaud (<alias>)",
 │                         and marked "Sign in required" while its account needs a new sign-in
 ├─ Plaud's tools          plaud_list_files, plaud_get_file, plaud_get_note, plaud_get_transcript, plaud_get_current_user (and plaud-<alias>_*)
 ├─ ctx.agent.transform    default rules right after each agent's base allow
 ├─ ctx.tool.transform     plaud_export and plaud_recent, in the Code Mode namespace "plaud", whose description names the five reads
 ├─ ctx.tool.hook          "execute.after": withholds presigned_url and data_link in plaud*_* results
 ├─ ctx.command.transform  /plaud-status
 ├─ ctx.skill.transform    opencode-plaud, opencode-plaud-export, opencode-plaud-digest
 ├─ ctx.rpc.register       RPC "plaud.recordings": status
 └─ tools RPC              "plaud.recordings.tools": describe, the five known reads and recent, for
                           scripts, with a permission evaluate hook for its own calls in flight
OpenCode TUI
 └─ plaud.recordings.tui   the "Plaud: Status" palette command (/plaud) and dialog, from the status RPC
```

The plugin id is `plaud.recordings`. It uses only the public `@opencode/plugin` API of OpenCode 2.2.3. It starts no process, bundles no runtime, has no Plaud API client of its own, and never sees a token.

## Package

| Export | File | Contents |
| --- | --- | --- |
| `.` | `dist/index.js` | The server part, bundled with zod. |
| `./tui` | `dist/tui.js` | The TUI part, compiled from `src/tui.tsx` to plain JavaScript. It bundles no third-party code. |

`dist/` holds only these two files. `scripts/build.mjs` bundles each with esbuild into one self-contained file, with no chunks and no relative imports; the RPC contract and the status words (`src/rpc.ts`) are inlined into both. The contract is plain JSON Schema with a plain TypeScript type beside it, so only the server part, whose tool and option schemas use zod, bundles zod. OpenCode reloads a plugin in place and keeps the modules it already loaded for unchanged paths, so a shared sibling module could be a stale copy after an update. Only `@opencode/plugin`, OpenTUI, Solid and Node built-ins stay imports.

The skills are read from the package's `skills/` folder at setup. OpenCode provides `@opencode/plugin`, OpenTUI and Solid to plugins, so they are not bundled and the package declares no dependencies or peers. `NOTICE` carries the licences of the bundled code, and the build fails when it no longer matches.

## Setup

`src/index.ts` runs these steps in order:

1. Validate the options (`src/domain/config.ts`). A problem stops setup with `OPTIONS_INVALID`.
2. Check the OpenCode version against `>=2.2.3 <2.3.0` (`src/version.ts`). Outside it, setup stops with `HOST_UNTESTED`, unless `allowUntestedHost` is set. A release inside it that is not in `TESTED_HOSTS` (the one list of tested releases, which the tests and CI read) starts with a warning.
3. Register one MCP server per account (`src/host/mcp.ts`), and name each one's `/connect` entry (`src/host/integration.ts`).
4. Insert the default permission rules (`src/host/permissions.ts`).
5. Add `plaud_export`, `plaud_recent` and the signed-link hook (`src/host/tools/`).
6. Add `/plaud-status` (`src/host/commands.ts`), the skills (`src/host/skills.ts`) and the status RPC (`src/host/rpc.ts`).
7. Add the tools RPC for scripts (`src/host/tools-rpc.ts`).

If a step fails, the steps before it are undone and the plugin does not start. `/plugins` then shows the error, and the TUI palette entry is not shown. On shutdown or reload, every registration is removed, newest first.

## Servers

Each account's server is `{ "type": "remote", "url": <url option> }`. The default account is `plaud`; an alias `work` is `plaud-work`. The transform is synchronous and replays on every config rebuild. If the user's config already defines a server with that name, the plugin leaves it alone and status marks the account `userServer`.

OpenCode makes each remote server an integration named after the server, which `/connect` lists. The plugin renames it "Plaud", or "Plaud (<alias>)", also for a server the user defined. OpenCode registers the integration again under the server name whenever the MCP config reloads, so `src/host/integration.ts` checks on `integration.updated` and `mcp.status.changed`, and polls for the first ten seconds, and registers the rename again when needed. When a signed-in account's server reports `needs_auth`, it sets the account's connection status with `ctx.integration.connection.status`, so `/connect` shows "Sign in required"; it clears the status once the server connects.

OpenCode names the server's tools `<server>_<tool>` and puts them in Code Mode. Plaud maintains them; the plugin knows only which five are harmless reads (`KNOWN_READS` in `src/host/mcp.ts`).

## Permissions

The default rules use no permission hook. `ctx.agent.transform` inserts the block right after each agent's base `* * allow` rule: `plaud*_*` asks, the five known reads of each configured account's server (`plaud_<tool>`, `plaud-<alias>_<tool>`) are allowed again by exact name, `plaud_export` asks, and `plaud_recent` is allowed by its exact name. Everything later in the agent's list, and saved approvals, still win. Agents without a base allow are left alone. The rules are in [configuration](configuration.md#the-default-rules).

OpenCode creates agents defined only in the user's config after plugins run, so they miss the rules. Status finds those that need a fix, `unguardedAgents()`: agents with a base allow, without the block anywhere after it, whose own rules would let an unknown Plaud tool run without asking (`evaluate()`: the last matching rule wins). An agent whose rules already ask for or deny Plaud's tools is not listed. It names them and gives the per-agent fix.

## Export

`plaud_export` (`src/host/tools/export.ts`) runs in one step:

1. **Validate.** The input is `{ account?, recordingId, kind, block?, destination?, overwrite? }` (`src/domain/contract/index.ts`). A `destination` must be absolute and inside an export root, or the export stops before the prompt. Without one, the file is `<first root>/<kind>/<recordingId>.<ext>`; a transcript's is `<first root>/transcript/<recordingId>.<block>.md`, so each block has its own file.
2. **Ask.** One `ctx.permission.assert` with action `plaud_export`, resource and save `<account>:<kind>`, and a preview: the account, kind, recording id, block, destination and `overwrite`. A decline or a deny is passed to OpenCode unchanged.
3. **Start the budget.** `exportTimeoutMs` starts after approval and also ends on the call's own cancellation.
4. **Read.** The export calls the host's executor for `<server>_get_file`, `_get_transcript` or `_get_note` from `ctx.tool.list()`, with its own tool context, so the read tools' permission rules apply. Host hooks do not run on these calls, so the export sees the signed links. If the tool is missing, the account is not signed in: `AUTH_REQUIRED`. Plaud returns each result as JSON text inside an untrusted-data envelope (`<untrusted-user-data-<hex> source="plaud-recording">`); `src/domain/normalize.ts` takes the JSON out.
5. **Fetch or render.** Audio is downloaded from the signed link, within `maxAudioBytes`, with progress reports. The link and every redirect hop (at most 5) must be https with no user name or password, and a hop from another machine may not lead to this one; the export follows redirects itself to check each hop. No error names a link. A transcript is read page by page through Plaud's cursor, 500 segments a page (Plaud's maximum; its default is 50), and rendered to Markdown, as is a note. Text is held to 25 MiB.
6. **Write.** Missing folders below the root are created one at a time (mode 0700), and a symbolic link that leads outside the roots is refused. The content goes to a private staging file, `.plaud-export-<random>.partial` (mode 0600), beside the destination. It is hashed and synced to disk.
7. **Publish.** A hard link puts the file in place, so an existing file is never replaced unless `overwrite` is true; then a rename replaces it. On a filesystem without hard links, the export checks that the name is free, then renames. The staging file is always removed.
8. **Return** `{ path, bytes, sha256 }`.

## Recent recordings

`plaud_recent` (`src/host/tools/recent.ts`) takes `{ account?, limit? }`, `limit` 1 to 20 and 8 by default. It asserts `plaud_recent` with the account as resource and save, then calls the host's executor for the account's `<server>_list_files`, as the export reads, so that read's own rule applies too. Plaud's server refuses a `page_size` below 10, so it asks for at least 10 and keeps the first `limit`. It returns a Home `list`, `{ items: [{ id, text }], editable: false }`: one line per recording, the title on one line, the start time in UTC and the length, at most 200 characters. It returns no link and no content. Jelly's Home feed preset calls it. The tools RPC runs the same spec as the method `recent`, with `{ limit? }` as input and the envelope's `account`; there a refused `list_files` reaches the module untouched, so a script reads `PERMISSION_DENIED`.

## Events list

`plaud_events_list` (`src/host/tools/events.ts`) is Plaud's side of Memory's sources funnel, over the shared
`events_list` contract (`src/host/events-list.ts`, a copy every source plugin carries unchanged). It asserts
`plaud_events_list` with the account as resource and save, then reads through the host's executors for the account's
`get_current_user` (the owner) and `list_files`, one week at a time from the cursor's position to 6 hours ago. Each
week asks for a day more on each side, reads every page until one is shorter than 20, and keeps the recordings that
started within it; they are sorted by (start, id), and the cursor holds the last one listed with the account and a
digest of the owner. The tools RPC runs the same spec as the method `events_list`, with the envelope's account.

## Signed links

Plaud's results carry signed links: `presigned_url` (the audio, valid for about 24 hours) in `get_file`, and `data_link` (a transcript or note) in each item of `get_file`'s `source_list` and `note_list` and in each `get_note` tab. An `execute.after` hook rewrites every result of a tool whose name matches `plaud*_*`, always:

- in structured output, every `presigned_url` field with a value, at any depth, becomes `withheld: use plaud_export to download the audio`, and every `data_link` becomes `withheld: use plaud_export to save the transcript or note`;
- in text, including text `output`, which Code Mode programs receive, JSON is rewritten field by field, also inside Plaud's untrusted-data envelope, which stays in place; other text that names either field loses every URL;
- in the error text of a failed call, every URL is withheld. The hook rebuilds the error with its own class, cause and metadata, and leaves an error with no URL as it is, so a declined prompt still reaches OpenCode unchanged.

The hook runs on OpenCode's own tool path, for direct and Code Mode calls. Raw executors from `ctx.tool.list()`, such as the export's own reads and the tools RPC's calls, skip host hooks. The tools RPC therefore withholds the links itself, with the same functions (`withholdSignedLinksInOutput` and `withholdSignedLinksInText` in `src/domain/redact.ts`).

## Scripts

The tools RPC, `plaud.recordings.tools`, lets a script call Plaud's five known reads and `plaud_recent` (method `recent`) with no model ([Scripting](scripting.md)). `src/host/tools-rpc.ts` is a copy of a module shared by several plugins; only its marked block is Plaud's: the reads (`KNOWN_READS` in `src/host/mcp.ts`), the next steps, `shapeResult`, which withholds the signed links, and `pluginError`, which gives `recent`'s own errors their code and next step. Setup passes `recent` as an owned method (`recentMethod` in `src/host/tools/recent.ts`).

Each call names a session; the session's agent and rules decide, exactly as for the model. The RPC refuses a tool those rules hide, then calls the tool's executor from `ctx.tool.list()`, which checks the agent's rules, the session's rules and saved approvals. A permission `evaluate` hook turns an ask on one of the RPC's own calls in flight into a deny, since no one can answer it; it touches no other call.

The envelope's optional `account` picks the server: none or `default` is `plaud`, an alias from the options `plaud-<alias>` (`accountServer()` in `src/host/mcp.ts`), and anything else is `ACCOUNT_UNKNOWN`. A server the user's config defines under an account's name is used, as for the model and `plaud_export`, so the RPC never reports a server conflict.

## Status

`src/status.ts` builds one status from OpenCode's MCP server list, its tool list, the agents' rules, the host check and the options. It reads nothing from Plaud and never shows a token.

| OpenCode server state | Account state | Shown as |
| --- | --- | --- |
| `connected` | `signed_in` | connected |
| `needs_auth` | `sign_in_needed` | sign-in required |
| `pending` | `connecting` | connecting |
| `failed` | `failed` | failed, with OpenCode's reason (links withheld) |
| `disabled` | `disabled` | disabled |
| not listed | `missing` | not configured |

The summary line names the most urgent account state, in this order: sign-in required, failed, not configured, disabled, connecting, connected.

Every view shows the rows in one order: Connection (each account's state), Account (each account's server), Access (reads run, exports ask, and the export folders), Skills (only when a skill of the user's or a project's has one of the plugin's skill ids, so OpenCode loads it instead: its path), Tools, Agents without default rules (`none`, or the names with the rules to copy), OpenCode (the version, `tested` or `untested`, and the supported range), then one Next step: the most urgent, or `Nothing to do.`

Three views show it:

- `/plaud-status` posts it as a synthetic message with `resume: false`, so no model turn starts. When some agent misses the rules, it adds them as JSON to copy.
- The RPC `plaud.recordings` has one method, `status`, called with `{}`. It returns `{ version, state, accounts, exportRoots, tools, host, unguardedAgents, permissionsBlock, shadowedSkills, nextStep }`. `version`, `state`, `host` (`{ version, range, tested }`), `unguardedAgents` and `nextStep` are the fields every plugin of this family shares; `state` is the most urgent account's, as `connected`, `sign_in_required`, `connecting`, `failed`, `disabled` or `not_configured`; it is never `host_untested`, because outside the supported range the plugin either does not start or was told to with `allowUntestedHost`. An untested release inside the range changes only `host.tested` and the OpenCode row. `tools` counts the Plaud tools the plugin knows and the unknown ones, with up to ten unknown names. `shadowedSkills` lists, as `{ id, path }`, each skill in OpenCode's skill list (`ctx.skill.list()`) that has one of the plugin's skill ids but another path; its next step, after any sign-in or agent fix, is to move or rename that file. If the status cannot be read, it fails with the declared error `unavailable`, whose `data.nextStep` says what to do.
- The TUI part, `plaud.recordings.tui`, opens a dialog from the palette command **Plaud: Status**, or `/plaud` in the prompt. In the dialog, `r` refreshes and `Esc` closes. While the dialog is open, it reads the RPC again when the server reconnects, when a `plaud` or `plaud-<alias>` server changes state, and when an agent, an integration or a credential changes (`agent.updated`, `integration.updated`, `credential.updated`, `credential.switched`). The 2.2.x TUI receives no `mcp.tools.changed` event; `r` reads the tools again.
