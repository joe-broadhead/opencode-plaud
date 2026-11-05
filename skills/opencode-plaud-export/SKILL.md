---
name: opencode-plaud-export
description: Save a Plaud recording's audio, transcript or note to a local file with plaud_export. Use when the user asks to download, export or save a Plaud recording, its audio, its transcript or its notes.
---

# Export a Plaud recording

`plaud_export` (`tools.plaud.export(input)` in Code Mode) writes one
recording's audio, one transcript block, or its note tabs to a local file in
a single call. Transcripts and notes are written as Markdown.

## Input

| Field | Required | Meaning |
| --- | --- | --- |
| `recordingId` | yes | The recording's id, from `list_files`. |
| `kind` | yes | `audio`, `transcript` or `note`. |
| `account` | no | The account; omit it for the default account. Another account is the name the user configured, such as `work`. |
| `block` | no | Only with `kind: "transcript"`: `transaction` (raw, the default), `transaction_polish` (cleaned up), `outline` or `mark_memo` (moments flagged on the device). |
| `destination` | no | An absolute file path inside an export root. The default is `<first export root>/<kind>/<recordingId>.<ext>`; for a transcript it is `<first export root>/transcript/<recordingId>.<block>.md`, so each block has its own file. |
| `overwrite` | no | `true` replaces an existing file. It is off by default. |

It returns `{ path, bytes, sha256 }`: the file's absolute path, its size in
bytes and its SHA-256. It never returns the content; read it with
`get_transcript` or `get_note` if the user wants to see it.

## Rules

1. **Find the id first** with `list_files`. Never guess one.
2. **Stay inside the export roots.** The default root is `~/Plaud`;
   `/plaud-status` lists the configured ones. Missing folders inside a root
   are created. Omit `destination` unless the user named a file.
3. **Never set `overwrite: true`** unless the user asked to replace that
   file.
4. **Each export asks the user**, showing the account, kind, recording and
   destination. "Always allow" remembers only that account and kind, such
   as `default:transcript`. If the user declines, stop: nothing was written.
   Do not retry or try another way.
5. **Runs where nobody can answer**, such as `opencode run`, cannot ask,
   so an export there is refused unless the user's OpenCode config
   allows it, for example `{ "action": "plaud_export", "resource": "*", "effect": "allow" }`
   in `permissions`, or a narrower resource such as `default:transcript`.
   Mention this only when the user wants unattended exports.
6. **Audio can take minutes.** The export reports progress, and its time
   limit is the `exportTimeoutMs` option (30 minutes by default).
7. **Report** the path, the size and the SHA-256 when it is done.

## Errors

Errors read `CODE: what happened. Next step: What to do.` Tell the user and follow the next
step; do not retry the same call unchanged.

| Code | Do |
| --- | --- |
| `AUTH_REQUIRED` | The account is not signed in. Tell the user to run `/connect` and choose Plaud (Plaud (<account>) for another account), then press `o` or Enter; or to run `opencode mcp auth plaud` (`plaud-<account>`), which opens the browser itself. |
| `PLAUD_READ_FAILED` | Plaud's server refused or failed the read. Report the message. |
| `PLAUD_UNREADABLE` | Plaud sent something the plugin cannot read. Report it; do not retry. |
| `CONTENT_UNAVAILABLE` | There is no audio yet, or no such transcript block. Offer another block or the note. |
| `EXPORT_OUTSIDE_ROOTS` | Choose a destination inside an export root, or omit `destination`. |
| `EXPORT_BAD_DESTINATION` | Pass a file path, not a folder or a root, or omit `destination`. |
| `EXPORT_EXISTS` | A file is already there. Ask the user before replacing it or choosing another path. |
| `EXPORT_TOO_LARGE` | Report the size and the limit (`maxAudioBytes`, or 25 MiB for text). Do not split or retry. |
| `EXPORT_TIMEOUT` | Report it. The user can raise `exportTimeoutMs`. |
| `EXPORT_FAILED` | The download or the local write failed. Report it and follow the next step. |

## Code Mode

~~~js
const file = await tools.plaud.export({ recordingId: "RECORDING_ID", kind: "transcript", block: "transaction_polish" })
return file // { path, bytes, sha256 }
~~~

Do not catch a declined export inside `execute` to retry it.
