# Contributing

Read [AGENTS.md](AGENTS.md) first: it has the rules every change follows. [docs/architecture.md](docs/architecture.md) describes the code.

## Setup

You need:

- Node 24 or later, with npm. The embedded OpenCode host in the host tests needs Node 24.
- [Bun](https://bun.sh) on `PATH`, for the TUI render test and the pack test. CI uses Bun 1.4.4, the Bun inside the stock OpenCode releases in `TESTED_HOSTS` (`src/version.ts`).
- macOS or Linux.

```sh
npm ci --ignore-scripts
npm run check
```

Install scripts stay off, as when OpenCode installs a plugin; nothing needs them.

## Load a local build

To try your changes in OpenCode, build, then add the checkout's folder to `plugins` in a test config, and restart OpenCode:

```sh
npm run build
```

```json
{ "plugins": ["<absolute path to your checkout>"] }
```

## `npm run check`

One command runs every check, in this order. Each stage is also a script of its own.

| Stage | Script | What it checks |
| --- | --- | --- |
| typecheck | `npm run typecheck` | `src/`, the TUI part and `test/`, with TypeScript. |
| lint | `npm run lint` | Import boundaries in `src/`, and the forbidden host APIs in `src/`, `test/` and `scripts/` (see [AGENTS.md](AGENTS.md#forbidden)), with the tools RPC's counted exceptions. |
| build | `npm run build` | Cleans `dist/`, then bundles `dist/index.js` (the server part) and `dist/tui.js` (the TUI part, after Solid's JSX transform), each one self-contained file with the RPC contract inlined and no relative imports; zod goes into the server part only. It checks that `NOTICE` covers exactly the packages each bundle contains (`node scripts/build.mjs --notice` rewrites it). The build fails if an output imports a module that is neither bundled nor provided by OpenCode. |
| unit | `npm test` | The plugin's modules against narrow fakes, `scripts/check-upstream.mjs` against a fake server, and a render of the built `dist/tui.js` under Bun. |
| host | `npm run test:host` | The built plugin in an embedded OpenCode host (`@opencode/sdk`), once per release in `TESTED_HOSTS` (`src/version.ts`), on a loopback fake Plaud server, with the network blocked and every OpenCode path inside a temporary folder: registration, the default rules, user rules, saved approvals, exports, the signed links (in Code Mode and in direct calls by a scripted loopback model), the tools RPC for scripts, setup refusals and the status views. |
| pack | `npm run test:pack` | Packs the tarball, installs it alone with scripts off, and loads it in each tested stock OpenCode release (`opencode serve`, on its own port), where it also calls the tools RPC as a script. It also checks the file list, that `dist/` holds only the two self-contained entries with no relative, dynamic or required module, that `dist/tui.js` has no zod and stays under 30 KB, the size, the missing dependencies and peers, and the built `dist/` for forbidden APIs, and imports each export under Bun. |

### Environment variables

| Variable | Used by | Effect |
| --- | --- | --- |
| `VITEST_MAX_WORKERS` | every stage that runs Vitest | Limits parallel test workers, for example `VITEST_MAX_WORKERS=2` on a busy machine. |
| `HOST_SDK_DIR_2_2_4`, `HOST_SDK_DIR_2_2_5` | `test:host` | A folder whose `node_modules` holds that `@opencode/sdk` release. Without one, `scripts/host-tests.mjs` installs it from npm, with scripts off, into a folder under `/tmp` that it removes afterwards. 2.2.3 is the lockfile's. |
| `HOST_SDK_DIR` | `test:host` | A folder with an `@opencode/sdk` installed: the host tests run once, on that release only. |
| `OPENCODE_BIN_2_2_3`, `OPENCODE_BIN_2_2_4`, `OPENCODE_BIN_2_2_5` | `test:pack` | Paths to stock `opencode` binaries. Without one, the pack test installs that `@opencode/cli` release from npm, once per run, into its own folder under `/tmp`, so its first run needs the registry. |
| `PACK_TARBALL` | `test:pack` | Test this tarball instead of packing one, such as the tarball a release publishes. |

The tested releases are listed once, in `TESTED_HOSTS` (`src/version.ts`); the host and pack stages, CI and a unit test read it. To test another release, add it there. Do not add another SDK release to a lockfile.

Every isolated host runs in a folder under `/tmp`, never below your home folder, where OpenCode's upward search would read your own `.opencode` folders and `opencode.json`; a test folder with one of those above it is refused. Each stock `opencode serve` gets its own free port, and its root pins that port for any CLI call, so no test reaches your own OpenCode service.

## Check Plaud's tools (maintainers)

`npm run check:upstream` compares the live Plaud MCP server's tool list with the five tools the plugin treats as known reads. It only warns: a new upstream tool already asks by default, and a known read that disappears needs a plugin change.

```sh
PLAUD_MCP_TOKEN=<access token> npm run check:upstream
PLAUD_MCP_TOKEN=<access token> npm run check:upstream -- --url <server URL>
```

- `PLAUD_MCP_TOKEN` is an OAuth access token for the server, such as the one OpenCode stores after `opencode mcp auth plaud`. Never commit it or paste it into an issue.
- `--url` checks another server; the default is `https://mcp.plaud.ai/mcp`.
- It reads the default URL and the list of known reads from `src/`, bundled in memory with esbuild, so it needs `npm ci` first.
- It prints the required arguments of each known read, then a warning for each known read that is gone and each tool that is not a known read.
- Exit code 0 means it checked, with or without warnings. Exit code 2 means it could not check: no token, or the server could not be read.

It needs the network and a signed-in Plaud account, so it is not part of `npm run check`.

## Where things are

| Change | Files |
| --- | --- |
| Options | `src/domain/config.ts`, `src/domain/types.ts` |
| Server registration and the known reads | `src/host/mcp.ts` |
| The `/connect` names | `src/host/integration.ts` |
| Default permission rules | `src/host/permissions.ts` |
| `plaud_export` | `src/domain/contract/index.ts`, `src/host/tools/export.ts`, `src/domain/export.ts`, `src/domain/normalize.ts` |
| `plaud_recent` | `src/domain/contract/index.ts`, `src/host/tools/recent.ts`, `src/domain/normalize.ts` |
| The Jelly declaration | the `jelly` section of `package.json`, `docs/jelly.md` |
| Signed-link withholding | `src/domain/redact.ts`, `src/host/tools/index.ts`, and `shapeResult` in `src/host/tools-rpc.ts` |
| Status, `/plaud-status`, the RPC and the TUI | `src/status.ts`, `src/rpc.ts`, `src/host/commands.ts`, `src/host/rpc.ts`, `src/tui.tsx` |
| The tools RPC for scripts | `src/host/tools-rpc.ts` (only its `PLUGIN-SPECIFIC` block is Plaud's), `docs/scripting.md` |
| Skills | `skills/<name>/SKILL.md` |

Plaud's result shapes are read only in `src/domain/normalize.ts`. If Plaud changes a tool's arguments or results, that is the file to change.

## Pull requests

- Run `npm run check`, and say which Node and Bun you used.
- Public tool, option or status changes need a test and a docs update.
- Use the commit format `type(scope): summary`.
- Never include tokens, signed links or recording content in a PR, an issue or a test fixture.

## Releasing

1. In one release commit on `master`, date the version's `CHANGELOG.md` entry and remove `"private": true` from `package.json`. Nothing else changes, and `npm run check` passes.
2. Tag that commit `vX.Y.Z`, matching `version` in `package.json`, and push the tag.
3. A reviewer of the `release` environment approves the run.
4. `.github/workflows/release.yml` checks that the package is not private and that the tag matches the version, runs `npm run check`, packs the tarball, runs the pack test on exactly that tarball (`PACK_TARBALL`), and publishes it with npm trusted publishing and provenance. A version that is already on npm is skipped, so a rerun is safe. A version with a `-`, such as `1.0.0-rc.1`, gets the npm tag `next`; others get `latest`.
