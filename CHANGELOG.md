# Changelog

## 0.0.0 (2026-11-25)

The first release, on plugin-contract v0.

- One `register` call wires every door; handlers live in `src/handlers/` and Plaud's endpoint and tool names in
  `src/provider/`.
- The `capabilities` manifest: `status`, `probe`, `events_list`, `recent`, `plan_export` and `export`, Plaud's five MCP
  tools as pass-through reads (`mcp:<tool>`), the `plaud.recordings` events source, the `plaud.recent` list snapshot and
  the `plaud.export` local action. No bus events are declared: Plaud has no write tool, and the only write is the local
  export, which changes no source.
- Accounts through the contract's `accounts` module: one Plaud MCP server per alias, `plaud` and `plaud-<alias>`, each
  with its own sign-in; `account` on every method that takes one, `ACCOUNT_REQUIRED` and `ACCOUNT_UNKNOWN` included.
- Access through the contract's `access` module: every read runs at every level, the export asks at `ask-changes` and is
  refused at `read-only`.
- The export is a local action: `plan_export` names the exact file and writes nothing, `export` takes only `{ planId }`
  and writes atomically inside an export root, re-checking the destination's `external_directory` gate with the host's
  own matcher (macOS case-folding and Windows backslash normalisation included).
- The events cursor is a total order `(timestamp, external_id)`, so two recordings that share a start are each listed
  once across a page boundary; the lookback for recordings that reach Plaud late and the cursor's size bound are kept.
- Docs, skills and `AGENTS.md` for this plugin; generated sections from the manifest, and `plugin-kit check` and
  `plugin-kit docs --check` in `npm run check`.
- Tests: unit, the synthetic two-account conformance fixture, the real OpenCode 2.4.1 host and the packed tarball.

### Removed since v0.0.9

- **The three skill ids.** They lost their old vendor prefix and are `plaud`, `plaud-export` and `plaud-digest`:
  contract §3 gives a plugin one name, and a skill is `<name>` or `<name>-<topic>`. The folders and bodies are the
  same, now registered with their YAML descriptions.
- **The snapshot source `plaud.recordings.list`.** It is `plaud.recent`, named after the method it reads (`recent`) and
  part of the Recordings service, as contract §7 asks; the old id named the events source instead.
- **The RPC ids `plaud.recordings`, `plaud.recordings.tools` and `plaud.recordings.tui`.** One RPC id, `plaud`, carries
  every method (contract §3); a script that called the tools RPC uses the agent tool or
  `POST /api/rpc/plaud/<method>`.
- **The `/plaud-status` command.** The contract's `status` method (an agent tool and the RPC method `plaud.status`) is
  the one status answer; its `unguardedAgents` value exists only inside a handler call, and a command cannot produce it.
  Standard §2 makes a status command optional.
- **The `/plaud` TUI view.** Optional per standard §2; it rendered the old status shape, which v0 does not have. The
  status method and its RPC answer replace it for any client.
- **The `/connect` display labels "Plaud" and "Plaud (alias)", and the "needs a new sign-in" status line.** The servers
  and their sign-ins are unchanged (`plaud` and `plaud-<alias>`); OpenCode now shows the server name, and the contract's
  `accounts` module registers servers without a label hook.
