# In Jelly

[Jelly](https://heyjelly.ai) runs OpenCode agents. It reads the `jelly` section of this
package's `package.json` as JSON, without loading the plugin, when a person reviews the exact
version, and uses it as follows.

Jelly names the plugin **Plaud** (`jelly.title`), with the package name and version beneath. Under
that name it shows the one line in `jelly.summary`, and beside it the mark in `jelly.icon`
(`assets/icon.svg`, shipped in the package): Jelly reads that file once, when it records the
plugin, and keeps it only if it is a clean SVG of drawing elements, with no script, style, link
or outside reference. A Jelly whose declaration schema lacks `summary` or `icon` refuses this
declaration, because that schema accepts no unknown keys.

## Tools and permissions

8 tools are declared (7 read-only). Jelly's agents have no base "allow everything"
rule, so this plugin's own default rules, which it puts after that rule, never reach them. Jelly
writes each declared `ask` or `deny` as that tool's default instead (the person's own choice
replaces it), and denies a read-only helper every tool not marked `readOnly`. A declared `allow`
changes nothing in Jelly.

- Ask: `plaud_export`.
- Off: none.
- Everything else runs, as the plugin's own rules let it: the five reads of Plaud's server,
  `plaud_recent`, the plugin's own read of the newest recordings, and `plaud_events_list`, the
  plugin's read for Memory's collector, which runs it unattended, so it never asks.

The reads are declared for the default account's server, `plaud`. Another account's reads,
`plaud-<alias>_<read>`, are not declared, because the accounts are a plugin option that Jelly
does not read. A tool the upstream server adds later is not declared either. In Jelly, a tool
that is not declared is not asked about by default. Keep `jelly.tools` in step with the known-tool list; `test/jelly.test.ts` checks
each declared effect against the plugin's own default rules.

## Skills

Declared: `opencode-plaud`, `opencode-plaud-export`, `opencode-plaud-digest`. Jelly refuses an install whose
skill ids collide with another plugin's or the agent's own.

## Views

The plugin declares no views. It offers one Home feed preset:

- **Recent Plaud recordings**: `plaud.recent` (the plugin's own read, which calls Plaud's
  `list_files` through the host) answers in Home's `list` shape, one line per recording, every
  30 minutes.

## Signing in

`jelly.signIns` declares one sign-in, `plaud`, for the servers `plaud*`: `plaud` and every `plaud-<alias>`, so accounts fold into one row. Each signs in with OpenCode's MCP OAuth; Jelly finishes it through the loopback on the desktop, and from the address the browser landed on in a web tab. The sign-in declares its accounts (`account`): Jelly asks for another account's name and adds it to the `accounts` option. It is `required: false`, because the `default` account behind `plaud` needs no name, and `reserved: ["default"]`, so no account takes that name. A Jelly before 0.3.2 refuses this declaration's new key.

Jelly folds the declared sign-ins into this plugin's one card, which shows each as Connected, Not signed in or Sign in again (expired or revoked), and starts, renews and signs out of each. An agent's `jelly_connection_request`, or a tool result that names this plugin's "Run /connect and choose …" next step, opens the same card. The plugin still signs in through OpenCode, as it does without Jelly; the declaration only tells Jelly which of the engine's integrations and servers are this plugin's.

## Versions

Jelly's curated catalogue pins an exact version. Publish each release under a new version, so
that a review in Jelly can tell the two apart.

The declaration test runs the shared kit, `test/support/jelly-kit.ts`, which checks the declaration and this page against Jelly's plugin authors' standard. `scripts/check-copies.mjs` holds the kit, the shared part of the tools RPC (`src/host/tools-rpc.ts`) and the events_list source contract (`src/host/events-list.ts`) equal to the copies every plugin carries.
