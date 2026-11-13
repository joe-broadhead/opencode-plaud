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
| `OPENCODE_BIN_2_2_3`, `OPENCODE_BIN_2_2_4`, `OPENCODE_BIN_2_2_5`, `OPENCODE_BIN_2_2_6` | `test:pack` | Paths to stock `opencode` binaries. Without one, the pack test installs that `@opencode/cli` release from npm, once per run, into its own folder under `/tmp`, so its first run needs the registry. |
| `PACK_TARBALL` | `test:pack` | Test this tarball instead of packing one, such as the tarball a release publishes. |

The tested releases are listed once, in `TESTED_HOSTS` (`src/version.ts`); the host and pack stages, CI and a unit test read it. To test another release, add it there. Do not add another SDK release to a lockfile.

Every isolated host runs in a folder under `/tmp`, never below your home folder, where OpenCode's upward search would read your own `.opencode` folders and `opencode.json`; a test folder with one of those above it is refused. Each stock `opencode serve` gets its own free port, and its root pins that port for any CLI call, so no test reaches your own OpenCode service.

## Check Plaud's tools (maintainers)

`npm run check:upstream` compares the live Plaud MCP server's tool list with the five tools the plugin treats as known reads, and each read's parameters with the ones the plugin and its skills pass (`PARAMETERS` in the script). It only warns. A new upstream tool follows `access`: it runs at the default `"all"`, and it is not a script method until the plugin adds it. A known read or parameter that disappears needs a plugin change.

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

Each release is the GitHub tag `v<version>`, where `<version>` is the `version` in `package.json`, and users install from
that tag. The release is one commit on top of a `master` head that CI passed, and the tag points at it. The release
workflow makes both, in GitHub Actions: nobody builds, commits or tags a release on their own machine, and no personal
key signs it.

While changes land, their notes go under `## [Unreleased]` at the top of `CHANGELOG.md`. Each earlier GitHub release is
a `## [x.y.z] - YYYY-MM-DD` heading below it, newest first, and the npm history stays last, under
`## Earlier releases on npm`.

1. On `master`, set `version` in `package.json` to the new version, and change every install spec in the README,
   `CONTRIBUTING.md` and `docs/` to `#v<version>` (`test/docs.test.ts` fails until they match). Then run
   `node scripts/changelog.mjs release`: it turns `## [Unreleased]` into `## [<version>] - <today>`, above the earlier
   releases, and refuses a CHANGELOG it cannot shape. Run `npm run check`.
2. Push that commit to `master`, and wait for CI to pass on it.
3. Start the release with that commit's full sha:
   `gh workflow run release.yml --ref master -f sha=<full sha>`, or from Actions → release →
   Run workflow, on `master`.
4. Read the run's summary, then approve the `release` environment. The summary is on the run page, under the `stage`
   job: the tag, the parent and its CI run, the release commit and its tree, the sha256 of `SHA256SUMS` and the staged
   artifact's id, `SHA256SUMS` itself, and the notes. Open the release commit on `release/v<version>` and read them
   before approving: the approval releases exactly those bytes. Only the owner approves a release. Agents never approve
   one, never call the deployment-approval API, and never bypass a ruleset or the environment; the kit's scripts make
   only their own GitHub calls and refuse every other.
5. Check the published Release: not a draft, its notes, and every asset against `SHA256SUMS`.

Before the approval, the workflow:
- **plans:** refuses a run that is not on `master`, a sha that is not `master`'s head, a sha without a successful `ci.yml`
  push run, a version that is not `x.y.z`, a CHANGELOG whose newest release is not this version, a release that does not
  move forward from the last published Release, a leftover `release/v<version>` branch, a native run that did not build
  this sha on `master`, by hand, with success, and a missing `native_run` (or one given to a plugin that is not native);
- **builds** `dist/` with `npm ci --ignore-scripts` and `npm run build`, with a read-only token, and writes the release
  files: `dist/`, `package.json` without its lifecycle scripts, and the vetted native manifest;
- **commits** them on a temporary branch `release/v<version>` at the parent, through GitHub's API with the workflow's token,
  so GitHub signs the commit (author `github-actions[bot]`, committer GitHub). This job runs no npm. It refuses a commit
  that GitHub does not verify, or whose parent or tree is not the one the files give;
- **verifies** on a fresh runner: the commit's identity, one parent on `master`, `package.json` exactly the parent's
  without the lifecycle scripts, only regular files in the allowed paths, no `package.json` under `dist/`, and a second,
  independent build of the parent (its own job) equal to the committed `dist/` byte for byte;
- **installs** the release commit with `plugin add` on each stock OpenCode host (2.2.3 to 2.2.6);
- **packs** the commit before installing anything and keeps that tarball, then runs the pack stage against a copy;
- **stages** the Release: verifies the attested native files, writes `SHA256SUMS` and the notes (the version's CHANGELOG
  section), and shows them all in the run summary with the sha256 of `SHA256SUMS`.

A job either runs repository or dependency code (`npm ci`, the build, the pack stage, a host install) and has no write
token, or uses the API and runs only the kit's scripts on a fresh checkout, after checking that the release commit's
`scripts/` and `.github/` are the parent's. The first kind is not token-free: `actions/checkout` fetches with the job's
read-only (`contents: read`) token, and its post step and the artifact uploads run after repository code on the same
runner, so that code could reach a read-only token for this public repository and the runner's artifact token. Jobs
pass files as artifacts downloaded by the id the uploading job gave, and each is checked again on arrival.

After the approval, it downloads the staged artifact by the id the summary names, and refuses unless `SHA256SUMS` has
the sha256 the summary shows and every staged file matches it, and every native file is the one the release commit's
`manifest/native.json` pins, size and sha256, with each gzip holding the pinned executable. Then it checks everything again, creates the annotated tag
`v<version>` on the release commit (tagger `github-actions[bot]`, unsigned), checks the tag, creates the Release with the
notes, the tarball, the native files and `SHA256SUMS`, and deletes `release/v<version>`. The tag keeps the commit.

GitHub's signature and the bot identity show only that GitHub made the commit through its API for the workflow; anyone
with write access can make such a commit. What ties the release to `master` is its content: one parent CI passed, the
exact `package.json`, the allowed paths and the byte-for-byte rebuild. Never relax those because the commit is signed.

**A rejected, expired or failed run** leaves nothing behind: the `cleanup` job deletes `release/v<version>` when it points
at the parent or at that run's commit, and never touches another branch. No tag exists before the approval, so the
version is not burned: fix `master` and start again. If `cleanup` itself failed, the next run refuses until the branch
is deleted: `gh api -X DELETE repos/joe-broadhead/opencode-plaud/git/refs/heads/release/v<version>`.

**Resume.** If the run fails after creating the tag and before the Release is complete, start it again with the same `sha`. The plan finds the kit's tag on a release commit on that sha with no published Release, and resumes:
it makes no new commit, checks and installs the tagged commit, stages the files, and after a new approval reuses the tag
and adds what the Release lacks. Delete a draft Release a failed upload left first: the publish step refuses a draft.
Any other existing tag is refused: release the next version.

The repository's tag ruleset keeps a `v*` tag from being moved or deleted. A stray `v*` tag, one that never became a
Release, does not block later releases: only published Releases count, and drafts do not. Its version cannot be
released, so release the next one. To remove the tag anyway, an admin disables the `release tags` ruleset, deletes the
tag, and restores the ruleset exactly as it was.

**Known limit: a `v*` tag pushed by hand.** No ruleset limits who creates a `v*` tag, so anyone with write access can
push one by hand, pointing at any commit. Such a tag has no published Release, the forward-only check ignores it, and
Jelly installs only a published Release whose `SHA256SUMS` it verifies. But a user who installs
`github:joe-broadhead/opencode-plaud#v<x>` directly gets whatever that tag points at. Only the release workflow makes
release tags; never push one by hand.

The release kit is these files, the same in every plugin: `scripts/release-rules.mjs`, `scripts/release-commit.mjs`,
`scripts/release-github.mjs`, `scripts/check-release-shape.mjs`, `scripts/changelog.mjs`, `scripts/release-version.mjs`,
`scripts/release-pack.mjs`, `scripts/publish-release.mjs`, `scripts/attach-native.mjs`, `scripts/native-manifest.mjs`,
`scripts/tested-hosts.mjs`, `scripts/check-release-plugin-add.sh`, `scripts/release-kit.test.mjs` and
`.github/workflows/release.yml`. Do not re-run the older `apply-release-kit.mjs`: it writes back the kit that could
release only `v0.0.0`.

Each release has its own tag, and a Git install does not update by itself. To move to a newer release, remove the old entry with `opencode plugin remove github:joe-broadhead/opencode-plaud#v<old version>`, then add the new tag with `opencode plugin add github:joe-broadhead/opencode-plaud#v<version>`.

Or add the plugin to `opencode.json` instead, with the same spec:

```json
{ "plugins": [{ "package": "github:joe-broadhead/opencode-plaud#v0.0.1" }] }
```
