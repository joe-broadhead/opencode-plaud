---
name: plaud-export
description: >
  Export one Plaud recording to a local file: its audio, one transcript block, or its note tabs as Markdown. Use when a
  person wants a recording, a transcript or a note in a file; not for reading content into the conversation.
---

# Plaud export

An export is two calls. `tools.plaud.plan_export` previews it and writes nothing; `tools.plaud.export` commits the plan
and writes one file.

## Plan

```ts
const plan = await tools.plaud.plan_export({ recordingId, kind: "transcript", block: "transaction" })
// plan.output.path is the exact file the commit writes; plan.planId is what the commit takes.
```

- `recordingId` comes from `tools.plaud.recent` (or Plaud's `list_files`).
- `kind` is `audio`, `transcript` or `note`. `block` is only for a transcript: `transaction` (the default),
  `transaction_polish`, `outline` or `mark_memo`.
- The default destination is `<first export root>/<kind>/<recordingId>.<ext>`; a transcript's is
  `<root>/transcript/<recordingId>.<block>.md`. Pass an absolute `destination` inside an export root for another file.
- Show the person `plan.output.path` before committing. `overwrite: true` replaces an existing file; without it an
  existing file is refused.

## Commit

```ts
const written = await tools.plaud.export({ planId: plan.planId })
// written.output: { path, bytes, sha256 }
```

- The commit takes only the plan id. It answers the path, size and SHA-256, never the content.
- A plan commits once and expires after 15 minutes; `PLAN_USED` or `PLAN_INVALID` means plan again.
- The file is written atomically. A refused or failed export leaves nothing behind.

## Where it may write

The export writes only inside the `exportRoots` option. Outside the project, the caller's `external_directory` rules
must allow the folder; an ask is a refusal, so an unattended run never waits on a prompt. Add the folder to the agent's
permissions, or keep the export inside the project, rather than retrying.

## Access and errors

`all` runs the export without asking, `ask-changes` asks before each one, `read-only` refuses it. A declined ask is
final.

- `PERMISSION_DENIED` — the path is outside the export roots or not allowed by `external_directory`; follow the next
  step instead of retrying.
- `TOO_LARGE` — the audio is over `maxAudioBytes` or the text over 25 MiB; suggest the note or the outline block.
- `INPUT_INVALID` — the destination is relative, is an export root, or already exists without `overwrite`.
- `UNAVAILABLE` — Plaud did not answer, the audio link failed, or the disk write failed; read `status` first.
