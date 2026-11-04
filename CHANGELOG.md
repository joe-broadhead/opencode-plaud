# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

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
