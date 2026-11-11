---
name: opencode-plaud-export
description: Save a Plaud recording's audio, transcript, outline or notes as a local file with plaud_export. Use when the user asks to download, export, save or keep a Plaud recording or its audio, asks for a download link to it, or wants to know how such an export works.
---

If Plaud's tools are absent, run `/connect` and choose Plaud (or Plaud (<alias>) for another account), or on Jelly call jelly_connection_request.

# Export a Plaud recording

`plaud_export` (`tools.plaud.export(input)` in Code Mode) writes one recording's audio, one transcript block or its
note tabs to a local file in one call. Text is written as Markdown.

## Input

| Field | Required | Meaning |
| --- | --- | --- |
| `recordingId` | yes | The recording's id: `plaud_recent`'s or `list_files`' `id`. |
| `kind` | yes | `audio`, `transcript` or `note`. |
| `account` | no | Omit it for the default account; another is the alias the user configured, such as `work`. |
| `block` | no | Only with `kind: "transcript"`: `transaction` (raw, with speakers; the default), `transaction_polish` (cleaned up), `outline` (topics) or `mark_memo` (moments flagged on the device). |
| `destination` | no | An absolute file path inside an export root; `~` is not expanded. The default is `<first export root>/<kind>/<recordingId>.<ext>`, and `<first export root>/transcript/<recordingId>.<block>.md` for a transcript. |
| `overwrite` | no | `true` replaces an existing file. Off by default. |

It returns `{ path, bytes, sha256 }`, never the content.

## Decide

1. **Find the id** with `plaud_recent` for the newest (`tools.plaud.recent({ limit: 1 })` in Code Mode, a plain
   object), or `list_files` for a date or a name:
   `tools.plaud.list_files({ date_from: "YYYY-MM-DD", date_to: "YYYY-MM-DD", page_size: 50 })`, both dates inclusive;
   for a name, add `query: "name"` or drop the dates. Its `start_at` is UTC without a `Z`. These Code Mode calls are exact, so
   no catalogue search is needed. If several recordings match, such as two on one day, list them with their title,
   start time and length, and ask which one. Export only after the user answers: if you can't ask, end your answer
   with the question, and never export a guess or every match instead.
2. **Pick the kind.** Asked to save or download the audio: `kind: "audio"`, at once. The export reads `get_file`
   itself, so don't call `get_file` first. Asked only for a link: say Plaud's links are withheld and offer to save
   the audio, and export when they agree. Summary or action items: `kind: "note"`. A transcript: omit `block` for the raw one,
   pass `transaction_polish` for "cleaned up", `outline` for "the outline" or topics, `mark_memo` for flagged moments.
3. **Leave out `destination`** unless the user named a file. `plaud_export`'s description lists the export roots
   (`~/Plaud` by default). For a folder outside them, such as Documents, never copy, move or write the file there
   with another tool, because the roots are the user's limit. Offer the default file, or tell the user how to add
   the folder: in the plugin's entry in `opencode.json`, then `opencode reload`.
   ~~~json
   { "plugins": [{ "package": "github:joe-broadhead/opencode-plaud#v0.0.0", "options": { "exportRoots": ["~/Plaud", "~/Documents"] } }] }
   ~~~
4. **Pass `overwrite: true`** only when the user asked to replace that file. The export itself refuses an existing
   file with `EXPORT_EXISTS`, so don't list the folder first.

## The ask

When the user asks for an export, make the call: the ask is the preview. Every tool runs by default; with the
plugin's `access` option at `"ask-changes"`, each export asks the user first, showing
the account, kind, recording and destination. "Always allow" remembers only that account and kind, such as
`default:transcript`. If the user declines, nothing was written: say so, and don't retry or try another way.

Runs where nobody can answer, such as `opencode run`, refuse an export that is not allowed, so set `ask-changes` and
allow what a scheduled export needs, such as `{ "action": "plaud_export", "resource": "*", "effect": "allow" }` or a
narrower resource like `default:transcript`. Mention this only for unattended exports.

Audio can take minutes; the limit is the `exportTimeoutMs` option, 30 minutes by default. When it is done, report the
path, the size and the SHA-256.

## Errors

Errors read `CODE: what happened. Next step: What to do.` Tell the user and follow the next step; don't retry the same
call unchanged.

| Code | Do |
| --- | --- |
| `AUTH_REQUIRED` | The account is not signed in: see Sign-in in `opencode-plaud`. |
| `PLAUD_READ_FAILED` | Plaud's server refused or failed a read. Report the message. |
| `PLAUD_UNREADABLE` | Plaud sent something the plugin cannot read. Report it. |
| `CONTENT_UNAVAILABLE` | No audio yet, or no such transcript block. Offer another block or the note. |
| `EXPORT_OUTSIDE_ROOTS` | Omit `destination`, or pick a file inside an export root. |
| `EXPORT_PATH_NOT_PERMITTED` | The export folder is outside the project, so the user's `external_directory` rule decides. Give the rule from the message and let the user add it; don't retry. |
| `EXPORT_BAD_DESTINATION` | Pass a file path, not a folder or a root, or omit `destination`. |
| `EXPORT_EXISTS` | Ask the user whether to replace the file or choose another path. |
| `EXPORT_TOO_LARGE` | Report the size and the limit (`maxAudioBytes`, or 25 MiB for text). Don't split or retry. |
| `EXPORT_TIMEOUT` | Report it; the user can raise `exportTimeoutMs`. |
| `EXPORT_FAILED` | The download or the local write failed. Follow the next step. |

~~~js
return await tools.plaud.export({ recordingId: "RECORDING_ID", kind: "transcript", block: "transaction_polish" })
~~~
