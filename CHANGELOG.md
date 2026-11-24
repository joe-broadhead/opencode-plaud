# Changelog

## 0.0.0 (unreleased)

- Renamed the package to `@we-the-rebel-alliance/plaud-plugin` and restarted the version at 0.0.0.
- Requires OpenCode 2.4.1: the supported range is `>=2.4.1 <2.5.0`, and 2.4.1 is the one tested release.
- Install instructions name a release tag only; the first release on plugin-contract is `v0.0.0` (phase 4b).
- Removed contract 1's `plaud` events source; `events_list` serves the declared `recordings` source only.
- Removed the pre-lookback cursor fallback; such a cursor is refused with `CURSOR_INVALID`.
- Removed the `execute.after` tool hook: Plaud's own read results pass through unchanged, while the plugin's own tools and the tools RPC never return a signed link.
- Removed the app-specific docs page and prose. The `jelly` declaration stays until the contract migration.
