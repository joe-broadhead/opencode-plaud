# Changelog

## 0.0.0 (2026-11-25)

The release, on plugin-contract v0.

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
