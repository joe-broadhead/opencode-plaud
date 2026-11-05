# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Status names a skill that shadows one of the plugin's. OpenCode keeps one skill per id, and a skill of your own or a project's wins, so a file such as `~/.config/opencode/skills/opencode-plaud/SKILL.md` stops the plugin's skill from loading. The `Skills` row names it and its path, the next step says to move or rename it, and the status RPC lists it in the new field `shadowedSkills`, as `{ id, path }`.

### Changed

- The fix for agents without the default rules is one sentence, the same in every plugin of this family: "Put the default rules shown by /plaud-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Plaud tools." It is the `Next step` row, the status RPC's `nextStep` and the dialog's. The `Agents without default rules` row lists only the agents' names, followed by the rules to copy. Why the rules go in each agent's own permissions is in the configuration docs.
- A transcript export reads 500 segments a page, Plaud's maximum, instead of Plaud's default of 50, so a long transcript takes a few reads instead of dozens.
- Four error next steps now lead to the right call. `EXPORT_EXISTS` says to ask the user before passing `overwrite: true`. `EXPORT_TOO_LARGE` and `EXPORT_TIMEOUT` say to ask the user to raise `maxAudioBytes` or `exportTimeoutMs`, which only the user can change. `PLAUD_READ_FAILED` gives one step: retry once, then run `/plaud-status` and follow its next step. `PLAUD_UNREADABLE` has one next step everywhere: update the plugin and retry later, then report it.
- Tool text the model always sees. Code Mode's `plaud` namespace says not to call `get_file`, which returns 150 to 320 KB, mostly the raw transcript and the notes again, and to call `export` for audio, even for a download link. It also says that times such as `start_at` are UTC without a `Z`. `plaud_export` says that each export first asks the user and shows the account, kind, recording and destination, that nothing is written if they decline, and that another folder must be added to `exportRoots`; its `destination` says that `~` is not expanded. `plaud_recent` says that each item's `id` is the recording's `file_id`, and to use `list_files` for more than 20 recordings, a date range or a name search.
- The tools RPC uses the shared module v4. When a deny rule refuses a script's call, `PERMISSION_DENIED` names the denied action, such as `plaud_list_files` under `recent`, and its next step says to remove or narrow that deny rule, add a later allow rule for it to the session, or use a session whose agent allows it. A refused ask keeps its next step.

### Removed

- The `maxTextBytes` option. A transcript or note export is now held to a fixed 25 MiB, about 50 times the longest transcript seen, so there is nothing to tune. Remove `maxTextBytes` from the plugin's options: OpenCode refuses to start the plugin with an unknown option (`OPTIONS_INVALID`). `maxAudioBytes` stays.

### Fixed

- `plaud_recent` shows each recording's start time in UTC, as Plaud recorded it. Plaud sends its times as UTC with no zone, and the plugin read them as the machine's local time, so every time was off by the machine's offset from UTC. An export's frontmatter `date` is now the recording's local calendar date on your machine, as documented; before, it was the UTC date.

## [0.0.4] - 2026-11-04

### Added

- Jelly shows the plugin's one-line summary and icon: `jelly.summary`, and `jelly.icon`, shipped as `assets/icon.svg`.
- Scripts can call `plaud_recent` through the tools RPC, as the method `recent`. Its input is `{ "limit"?: 1 to 20 }`; the account is the envelope's `account`, as for the five reads, and an account the options don't name is `ACCOUNT_UNKNOWN`. It runs under the same rules as for the model: `plaud_recent`, then the account's `list_files`, and a refused read is `PERMISSION_DENIED` naming that read. An input it does not take, such as `account`, is the new code `INPUT_INVALID`. `describe` lists it.

## [0.0.3] - 2026-11-04

### Added

- `plaud_recent` (`tools.plaud.recent` in Code Mode): the newest recordings, one line each, with the title, the start time in UTC and the length. It takes an optional `account` and `limit` (1 to 20, 8 by default), and reads through the account's own `list_files`. It runs without asking: the default rules allow `plaud_recent` by its exact name, and a rule for the account's `list_files` applies to it too. Because it is one tool for every account, a rule can name the account as its resource, such as `{ "action": "plaud_recent", "resource": "work", "effect": "deny" }`. It is not a tools RPC method; a script reads `list_files`.
- `/plaud-status` counts `plaud_recent` as one of the plugin's own tools, not as an unknown Plaud tool. The block it shows for agents defined in your config has the `plaud_recent` rule; copy it again into those agents.
- A `jelly` section in `package.json`, for [Jelly](https://heyjelly.ai): the plugin's title, each tool with its permission, its default effect and whether it only reads, the skills, the `plaud*` sign-in, which folds every account into one row, and a Home feed preset, "Recent Plaud recordings", that shows `plaud_recent` every 30 minutes. Jelly reads it without loading the plugin. `docs/jelly.md` explains it.

## [0.0.2] - 2026-11-04

### Added

- OpenCode 2.2.5 is a tested release, next to 2.2.3 and 2.2.4.
- The status RPC (`plaud.recordings` `status`) has `version`, the plugin's version, and `state`, the most urgent account's state in the shared form: `connected`, `sign_in_required`, `connecting`, `failed`, `disabled` or `not_configured`.

### Changed

- The status RPC uses the field names every plugin of this family shares. Scripts that read it need these changes:
  - `host` is now `{ version, range, tested }`: `host.warning` is gone, `host.range` is the supported range `>=2.2.3 <2.3.0`, `host.tested` is true only for 2.2.3, 2.2.4 and 2.2.5 (before, for any release in the range), and `host.version` is `null` when OpenCode reports no version;
  - `unguardedAgents` lists only agents whose own rules would let Plaud's tools run without asking (see Fixed);
  - `permissionsBlock` is the block for your accounts (see below).
- The default rules allow each account's five reads by exact name, `plaud_get_file` and `plaud-<alias>_get_file`, instead of the patterns `plaud*_get_file`. A later Plaud tool whose name only ends like a read, such as `plaud_bulk_get_file`, and the tools of a server you named `plaud…` yourself, now ask. If you copied the block into an agent's own rules, copy it again from `/plaud-status`.
- On a release inside `>=2.2.3 <2.3.0` other than 2.2.3, 2.2.4 and 2.2.5, Plaud sets up normally and prints a warning; status calls the release untested, and its state and next step are what they would be on a tested release. The `OpenCode` row reads, for example, `2.2.5 (tested; supported range >=2.2.3 <2.3.0)`. `HOST_UNTESTED` now says "supports" for the range.
- The tools RPC uses the shared module of 2026-11-04. An envelope that is not an object is refused with `the envelope must be an object, such as {…}` (was `Expected an object`), and `describe` given any input with `describe takes no input` (was `Expected never at ["sessionID"]`); `docs/scripting.md` lists every envelope message. A refusal names the action whose check was refused. A server that reconnected during a call answers `CONNECTING`, not `CONNECTION_FAILED`.
- `/plaud-status` has the dialog's title, `Plaud status`, and always shows the `Agents without default rules` row, with `none` when no agent needs the fix.
- Code Mode's description of the `plaud` namespace names all five reads, `get_current_user` included, and sends the model to `get_note` or `get_transcript` before `get_file`. `get_file` can be over 100 KB for one recording: it repeats what `list_files` and `get_note` return, and adds only `source_list` and the withheld audio link. The `opencode-plaud` skill says the same, and the export skill and `plaud_export`'s `recordingId` description find recording ids with `list_files`.

### Fixed

- Status listed every agent without the default rules, also those whose own rules already ask for every tool, so it could name dozens of agents that need no fix. It now lists an agent only when its own rules would let an unknown Plaud tool run without asking.
- The README's Uninstall now signs out of every account while the plugin is still installed, checks with `opencode auth list`, and only then removes the plugin; once it is removed, OpenCode can no longer remove the sign-ins. If a sign-out answers `MCP server not found` while the plugin is installed, OpenCode is still loading the plugin for that folder: wait a few seconds and run it again.
- The README now says what to do after `opencode plugin add` (run `opencode reload`, then `/plaud-status`) and how to update the plugin.
- `docs/scripting.md` said `opencode api` runs in the directory you call it from. It runs in the OpenCode service's default location, your home directory; the doc now says how to target a project. It also says that `opencode api` exits with status 1 for an RPC error, and that a result with only text has that text as its `output`.
- A failed Plaud call's error text now has every URL withheld before the model sees it, as completed results already did. Plaud's server puts no link in its errors today; this keeps it so.
- An audio export whose link Plaud sent in a form that does not parse failed with a bare `TypeError` and no next step. It now fails with `PLAUD_UNREADABLE` and a next step, and the error never holds the link.
- An audio export followed redirects without checking them, so a redirect could lead to plain http. The export now follows redirects itself, at most 5: each one must be https with no user name or password, and one from another machine may not lead to this one. Otherwise it stops with `PLAUD_UNREADABLE` before fetching, and the error names no link. A link with a user name or password is refused the same way.

## [0.0.1] - 2026-11-03

### Added

- The tools RPC, `plaud.recordings.tools`: a script can call Plaud's five read tools with no model, through `opencode api`, as a session and its agent, and with an optional `account` for another account. It gets exactly the access that agent's model has: a tool its rules hide is refused, OpenCode checks each call against the agent's and the session's rules, and an ask is refused at once because no one is there to answer it. Every signed link is withheld, as for the model. `describe` lists the methods with each tool's live input schema. `plaud_export` and any other Plaud tool are never methods. `docs/scripting.md` explains it.

## [0.0.0] - 2026-11-01

### Added

- Connects OpenCode to Plaud's hosted MCP server, `https://mcp.plaud.ai/mcp`, as the server `plaud`, listed in `/connect` as **Plaud**. Sign in from `/connect` (press `o` or Enter to open the browser) or with `opencode mcp auth plaud`, which opens it itself; OpenCode stores and refreshes the tokens. `/connect` marks an account that needs a new sign-in **Sign in required**.
- Plaud's own read tools: `plaud_list_files`, `plaud_get_file`, `plaud_get_transcript`, `plaud_get_note` and `plaud_get_current_user`.
- `plaud_export` saves a recording's audio, one transcript block or its notes as a local file, inside your export folders (`~/Plaud` by default). It returns the path, size and SHA-256, and never replaces a file unless asked.
- Default permission rules: the read tools run without a prompt; exports and any other Plaud tool ask. "Always allow" on an export remembers that account and kind only. Your own `permissions` rules win.
- Every signed link is withheld from Plaud tool results, with no option to show it: `presigned_url` (the audio) and `data_link` (transcripts and notes), also inside the untrusted-data tags (`<untrusted-user-data-…>`) around Plaud's results.
- `/plaud-status`, and the **Plaud: Status** dialog in the command palette (`/plaud` in the prompt).
- Three skills: `opencode-plaud`, `opencode-plaud-export` and `opencode-plaud-digest`.
- More accounts with the `accounts` option, each as a server `plaud-<alias>`, listed in `/connect` as **Plaud (<alias>)**.
- Options: `accounts`, `url`, `exportRoots`, `maxAudioBytes`, `maxTextBytes`, `exportTimeoutMs` and `allowUntestedHost`.
- Requires OpenCode `>=2.2.3 <2.3.0`; tested on 2.2.3 and 2.2.4.
