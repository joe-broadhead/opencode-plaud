# Changelog

## 0.0.0 (unreleased)

The first release on plugin-contract v0.

- One `register` call wires every door; handlers live in `src/handlers/` and Plaud's endpoint and tool names in
  `src/provider/`.
- The `capabilities` manifest: `status`, `probe`, `events_list`, `recent`, `plan_export` and `export`, Plaud's five MCP
  tools as pass-through reads, the `plaud.recordings` events source, the `plaud.recent` list snapshot and the
  `plaud.export` local action. No bus events: Plaud has no write, and the only write is the local export.
- Accounts through the contract's `accounts` module: one Plaud MCP server per alias, `plaud` and `plaud-<alias>`, each
  with its own sign-in; `account` on every method that takes one.
- Access through the contract's `access` module: every read runs at every level, the export asks at `ask-changes` and is
  refused at `read-only`.
- The export is a local action: `plan_export` names the exact file and writes nothing, `export` takes only `{ planId }`
  and writes atomically inside an export root.
- The export's `external_directory` gate mirrors OpenCode's own matcher, tested against the host's on darwin, win32 and
  linux; the macOS case-different and Windows backslash shapes are covered.
- Docs, skills and `AGENTS.md` written fresh from the template; generated sections from the manifest.
- `plugin-kit` replaces the copied kit; `plugin-kit check` and `plugin-kit docs --check` are part of `npm run check`.
- Tests: unit, the synthetic two-account conformance fixture, the real OpenCode 2.4.1 host and the packed tarball.
