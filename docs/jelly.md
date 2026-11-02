# In Jelly

[Jelly](https://heyjelly.ai) runs OpenCode agents. It reads the `jelly` section of this
package's `package.json` as JSON, without loading the plugin, when a person reviews the exact
version, and uses it as follows.

Jelly names the plugin **Plaud** (`jelly.title`), with the package name and version beneath.

## Tools and permissions

7 tools are declared (6 read-only). Jelly's agents have no base "allow everything"
rule, so this plugin's own default rules, which it puts after that rule, never reach them. Jelly
writes each declared `ask` or `deny` as that tool's default instead (the person's own choice
replaces it), and denies a read-only helper every tool not marked `readOnly`. A declared `allow`
changes nothing in Jelly.

- Ask: `plaud_export`.
- Off: none.
- Everything else runs, as the plugin's own rules let it.

A tool the upstream server adds later is not declared, so in Jelly it is not asked about by
default. Keep `jelly.tools` in step with the known-tool list; `test/**/jelly.test.ts` checks
each declared effect against the plugin's own default rules.

## Skills

Declared: `opencode-plaud`, `opencode-plaud-export`, `opencode-plaud-digest`. Jelly refuses an install whose
skill ids collide with another plugin's or the agent's own.

## Views

- **Recent Plaud recordings**, a Home feed preset: `plaud.recent` (the plugin's own read, which
  calls Plaud's `list_files` through the host) answers in Home's `list` shape, one line per
  recording, every 30 minutes.

## Signing in

`jelly.signIns` declares one sign-in, `plaud`, for the servers `plaud*`: `plaud` and every `plaud-<alias>`, so accounts fold into one row. Each signs in with OpenCode's MCP OAuth; Jelly finishes it through the loopback on the desktop, and from the address the browser landed on in a web tab.

Jelly folds the declared sign-ins into this plugin's one card, which shows each as Connected, Not signed in or Sign in again (expired or revoked), and starts, renews and signs out of each. An agent's `jelly_connection_request`, or a tool result that names this plugin's "Run /connect and choose …" next step, opens the same card. The plugin still signs in through OpenCode, as it does without Jelly; the declaration only tells Jelly which of the engine's integrations and servers are this plugin's.

## Versions

Jelly's curated catalogue pins an exact version. `latest` is `0.0.0`; publish each release
under a new version so a review in Jelly can tell the two apart.
