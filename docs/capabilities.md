# Capabilities

Every method, source, action and bus event the manifest declares.

<!-- generated:capabilities -->
### Methods

| Method | Class | Accounts | Operations |
|---|---|---|---|
| `status` | read | none | — |
| `probe` | read | optional | `get_current_user` |
| `events_list` | read | optional | `list_files` |
| `recent` | read | optional | `list_files` |
| `plan_export` | read | optional | — |
| `export` | export | optional | `get_file`, `get_note`, `get_transcript` |
| `mcp:get_current_user` | read | none | — |
| `mcp:get_file` | read | none | — |
| `mcp:get_note` | read | none | — |
| `mcp:get_transcript` | read | none | — |
| `mcp:list_files` | read | none | — |

### Sources

| Source | Kind | Reads or output | Method | Cost |
|---|---|---|---|---|
| `plaud.recordings` | events | `meeting` | `events_list` | free |
| `plaud.recent` | snapshot | `list` | `recent` | free |

### Actions

| Action | Effect | Preview | Commit |
|---|---|---|---|
| `plaud.export` | local | `plan_export` | `export` |

### Bus events

None.
<!-- /generated:capabilities -->

## Notes

- **`status`** reads no account. It reports the plugin's version, the OpenCode host range, one entry per alias, the
  agents whose rules lack the generated access rules, and one next step. It carries no recording and no credential.
- **`probe`** reads one account's owner from Plaud's `get_current_user`, under the `plaud:` scheme. It reads no
  recording. The owner is kept per account, so `status` and every page name the same one.
- **`events_list`** reads `plaud.recordings` for one account, oldest first: one event per recording, kind `meeting`,
  with its title, start (UTC) and length. A recording is listed once it started six hours ago, and a page reads two
  weeks back for recordings that reached Plaud after the cursor passed their start. A recording whose title holds a
  secret is refused for good (`refused[]`), and the cursor moves past it. A recording that reached Plaud later than the
  lookback answers `gap: { reason: "expired", since }` once.
- **`recent`** reads `plaud.recent`, a `list` snapshot: the newest recordings of one account, newest first, one line
  each, at most 20. A title that holds a secret is left out. It is the read a Home tile or a quick glance uses.
- **`plan_export`** previews the `plaud.export` action and writes nothing. It names the exact file the commit writes:
  `recordingId`, `kind`, the block for a transcript, the path and whether it overwrites.
- **`export`** commits that plan. It takes only `{ planId }`, re-checks the destination's `external_directory` gate, and
  writes the file inside an export root: audio as the recording's MP3, a transcript block or the note tabs as Markdown.
  It answers the path, size and SHA-256, never the content, and a failed read leaves no file behind.
- **The pass-through `mcp:<tool>` rows** are Plaud's own MCP tools, declared so a consumer knows they are reads and the
  access rules cover them per alias. The vendor's server owns them; this plugin registers no handler and no proxy for
  any of them.
- **`plaud.recordings`** is an events source of `meeting` events, private and free, at most 256 KB per page. It has no
  scope: Plaud lists every recording of the account, and the plugin never narrows that by a filter of its own.
- **`plaud.recent`** is a snapshot source with output `list`; it reads the last 40 days.
- **One action, effect `local`:** `plaud.export`, previewed by `plan_export` and committed by `export`. Nothing leaves
  the provider's account: the bytes are written to the person's own disk.
- **No bus events.** Plaud's server has no write tool, so the plugin never learns that a source changed, and its only
  write is the local export, which changes no source. `events` is therefore empty; there is no `changed` nudge to send.
