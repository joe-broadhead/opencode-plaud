# Contributing

This repository is an OpenCode plugin on [plugin-contract](https://github.com/we-the-rebel-alliance/plugin-contract) v0.
The contract is [docs/contract.md](https://github.com/we-the-rebel-alliance/plugin-contract/blob/master/docs/contract.md),
the bar for every plugin repository is
[docs/plugin-standard.md](https://github.com/we-the-rebel-alliance/plugin-contract/blob/master/docs/plugin-standard.md),
and [AGENTS.md](AGENTS.md) is the working guide.

## Set up and check

You need Node 24.

```sh
npm ci --ignore-scripts
npm run check
```

`npm run check` runs the whole gate:

| Step | What it proves |
|---|---|
| `npm run typecheck` | the sources and tests typecheck under strict settings |
| `npm run build` | `dist/index.js` is built from `src/index.ts` with esbuild, and `NOTICE` matches the third-party code it inlines |
| `npm test` | the handlers, provider, settings, matcher and recorded fixture pass |
| `npm run test:host` | the built plugin loads in the embedded OpenCode 2.4.1 host and behaves |
| `npm run test:pack` | the packed tarball installs alone and loads |
| `plugin-kit check` | conformance T0 and T1, the doc file set, the forbidden patterns and no bundled kit |
| `plugin-kit docs --check` | every generated doc section matches the manifest |

CI runs the same steps in one job named `ci`. `dist/` is generated and is not committed, so CI builds it before
`plugin-kit check`.

## The contract pin

`package.json` pins the contract to `github:we-the-rebel-alliance/plugin-contract#v0.0.0`. The committed
`package-lock.json` records it over `git+https`, so a fresh `npm ci` needs no SSH key. Never copy a contract module into
this repository.

## Pull requests

One change per pull request, based on `master`, with a conventional commit (`feat:`, `fix:`, `docs:`, `chore:`). The
pull request says what changed and why, the contract section it implements, and the exact `npm run check` result.

A new method, source or action starts in `package.json` `capabilities`, then its handler in `src/handlers/`, then its
tests, then `npx plugin-kit docs`, then `npx plugin-kit check`. Every capability has tests, including its negative cases.

## Fixtures

`fixtures/conformance.json` is the plugin's evidence to the conformance kit. Its two accounts are synthetic: a
deterministic fake Plaud provider in `test/fixtures/plaud-provider.ts`, driven through the plugin's own handlers.
`test/fixture.test.ts` replays every recorded answer, so the fixture cannot drift. Rebuild it with `npm run fixtures`.

A plugin with real accounts records with `npx plugin-kit record --account <alias>` instead, which redacts credentials,
emails, phone numbers and home directories before it writes. This repository's fake accounts need no redaction.

## Releases

Releases are tags, not npm packages. A release is prepared in one pull request, `chore(release): prepare vX.Y.Z`: the
version in `package.json` and `package-lock.json`, the `CHANGELOG.md` section, and `npx plugin-kit docs` if the manifest
changed. The owner pushes the tag after `master`'s CI passed; the release workflow checks the tag, builds, and creates
the GitHub release with the packed tarball, the conformance report and `SHA256SUMS`.
