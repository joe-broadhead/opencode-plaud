# Scripting

A script can call Plaud with no model: a cron job, a shell script, or any program that can reach the OpenCode server.
It uses the tools RPC, `plaud.recordings.tools`, through `opencode api` or an OpenCode client.

| Method | Class | The tool |
| --- | --- | --- |
| `list_files` | read | `plaud_list_files` |
| `get_file` | read | `plaud_get_file` |
| `get_note` | read | `plaud_get_note` |
| `get_transcript` | read | `plaud_get_transcript` |
| `get_current_user` | read | `plaud_get_current_user` |
| `recent` | read | `plaud_recent`, the plugin's own: the newest recordings, one line each |
| `export` | export | `plaud_export`, the plugin's own: writes one recording's audio, transcript block or note to a local file |
| `describe` | none | lists every method with its class, its permission action, whether OpenCode lists its tool now, and its input as JSON Schema; given a session, it also gives each method's `permission` |

A tool a Plaud server adds later is not a method until this plugin classifies it, so a script never reaches one.

Each server method runs Plaud's own read tool with the same input, through OpenCode's own connection and sign-in. The
plugin never sees the token. Durations stay in milliseconds, as Plaud returns them.

`recent` runs the plugin's own `plaud_recent`, as the model does: it asserts `plaud_recent` for the account, then reads
through that account's `list_files`, so both rules apply. Its input is `{ "limit"?: 1 to 20 }`, 8 by default; the
account is the envelope's `account`, never part of the input. It returns
`{ "items": [{ "id", "text" }], "editable": false }`: one line per recording, with its title, start time (UTC) and
length, and no link or content.

`export` runs the plugin's own `plaud_export`, as the model does: it asserts `plaud_export` for the account and the
kind, then writes only inside the export roots from the plugin's `exportRoots` option. Its input is the tool's without
`account` (`recordingId`, `kind`, and optionally `block`, `destination`, `overwrite`); the account is the envelope's. It
returns `{ "path", "bytes", "sha256" }`, never the file's content. An existing file is replaced only with
`"overwrite": true`.

## A rule must allow the call first

Every call resolves the method's permission action against the agent's rules and then the session's, the host's own
order; the last matching rule wins. Only `allow` runs:

- An `ask` is refused with `PERMISSION_DENIED` before the tool runs, because no one can answer a prompt, and no prompt
  is left waiting. At the `access` option's `"ask-changes"`, this is the rule for `plaud_export`, so a script exports
  only with a prior `allow`.
- A `deny` is refused too, and its next step names the rule to change.
- A saved "Always allow" from an earlier prompt does **not** authorize an ad-hoc script: it is not part of the agent's
  and session's rules, and a script's grant must be reviewable in config or in a job's approval. This is the one
  deliberate break from the earlier reads-only RPC.

The plugin's default rules allow every method, at the default `access: "all"`, so a script runs a read, `recent` or
an export unless the `access` option or the session's rules restrict it. A script gets the same default as the model,
and it is restricted the same way: `"ask-changes"` makes an export ask, and an ask is refused here; `"read-only"`
denies it, so an export needs a prior `allow` in the agent's or the session's rules.

An export folder is outside the project, so OpenCode also checks `external_directory` on the folder, as well as
`plaud_export`, before anything is written. A script that exports outside the project therefore needs both rules:

```json
{ "permissions": [
  { "action": "plaud_export", "resource": "*", "effect": "allow" },
  { "action": "external_directory", "resource": "<the export folder>/*", "effect": "allow" }
] }
```

A refusal that names `external_directory` costs nothing: nothing was read and nothing was written. Move the folder
inside the project with the `exportRoots` option, or add the rule. An agent defined only in your config misses the
default rules; at `"ask-changes"` or `"read-only"`, `/plaud-status` names it and gives the fix.

## Accounts

The default account's reads run on the `plaud` server. To read or export another account, add `account` with its alias
from the plugin's `accounts` option: `"account": "work"` runs `plaud-work_list_files` and so on, and `recent` and
`export` use that account. `"account": "default"` is the default account, the same as leaving `account` out. An account
that is not in the options is refused with `ACCOUNT_UNKNOWN`. If your OpenCode config defines its own server under an
account's name, such as `plaud-work`, the call uses it, as the model and `plaud_export` do.

`describe` shows the default account's tools, `recent` and `export`. Every account's server has the same five reads.

## Signed links

Plaud's results carry signed links: `presigned_url` to a recording's audio, and `data_link` to each source and note
item. Anyone who has one can download what it points to until it expires. A script never gets one: the plugin replaces
each, in the structured output and in the text, with the same notice the model sees. `export` saves audio, a
transcript or a note without returning a link.

## A script runs as a session

Every call names a session, and the session must name an agent. The script runs as that agent, with the access its
model has.

Create the session once, with the agent the script runs as, and keep its id, `data.id` in the response. Don't borrow
an existing session, such as one found in a session list: the script would run as that session's agent, under its
rules.

```sh
opencode api post /api/session -d '{"title":"weekly recordings","agent":"build"}'
```

Session rules come after the agent's, so a session can narrow what its script may do, and it can grant one write for
one script without touching the agent's rules. This one can list the default account's recordings, read their notes,
and export a transcript:

```sh
opencode api post /api/session -d '{"title":"weekly notes","agent":"build","permissions":[
  {"action":"plaud*_*","resource":"*","effect":"deny"},
  {"action":"plaud_list_files","resource":"*","effect":"allow"},
  {"action":"plaud_get_note","resource":"*","effect":"allow"},
  {"action":"plaud_export","resource":"*","effect":"allow"}
]}'
```

A session rule also applies to that session's model turns. Create a session for the script alone. For a grant bound to
the exact script the user approved, use a Jobs one-off script job: its approval writes the run session's `allow` rules,
and the user sees the source, the methods and which files each export writes before it exists.

The session must belong to the location you call. A session in another directory is `SESSION_UNKNOWN`.

## Calling a method

The body is `{"input": {"sessionID": "<session>", "account": "<alias>", "input": <the tool's input>}}`. `sessionID`
and `input` are required, `account` is optional, and no other key is allowed:

```sh
opencode api post /api/rpc/plaud.recordings.tools/list_files \
  -H "x-opencode-directory:$PWD" -d '{"input":{
  "sessionID":"ses_…",
  "input":{"page_size":10}
}}'

opencode api post /api/rpc/plaud.recordings.tools/get_note \
  -H "x-opencode-directory:$PWD" -d '{"input":{
  "sessionID":"ses_…",
  "account":"work",
  "input":{"file_id":"…"}
}}'

opencode api post /api/rpc/plaud.recordings.tools/export \
  -H "x-opencode-directory:$PWD" -d '{"input":{
  "sessionID":"ses_…",
  "input":{"recordingId":"…","kind":"transcript","block":"outline"}
}}'
```

## The location

Run the command in the project whose agent you mean, and send the call to that location explicitly:

```sh
opencode api post /api/rpc/plaud.recordings.tools/<method> -H "x-opencode-directory:$PWD" -d '{…}'
```

Without it the call goes to the service's default location and fails `rpc.unavailable` if the plugin is not loaded
there. The HTTP equivalents are the `location[directory]` query parameter and the same header. `describe` reports the
`location` that answered and a `locationHint`.

A location unloads after OpenCode's idle timeout. If a scheduled script gets `rpc.unavailable` from a location that was
loaded before, send the call again once: the request loads the location. Jobs keeps its own location loaded.

The tool's input is Plaud's: `describe` shows each tool's schema as OpenCode lists it now.

```sh
opencode api post /api/rpc/plaud.recordings.tools/describe \
  -H "x-opencode-directory:$PWD" -d '{"input":{}}'
opencode api post /api/rpc/plaud.recordings.tools/describe \
  -H "x-opencode-directory:$PWD" -d '{"input":{"sessionID":"ses_…"}}'
```

`describe` with a session gives each method's resolved `permission` (`allow`, `ask` or `deny`), which is how a script
self-checks before it exports.

A result comes back as `{ output?, text }`: the tool's structured content when it has any, and its text parts joined
by newlines. Over HTTP the body is `{"output": {"output": …, "text": …}}`, as plain JSON. When the text itself is JSON, OpenCode also parses it into `output`. Plaud wraps most results
in untrusted-data tags around JSON text, so for those `output` is the same text, and the script gets the tags as they
are: take the JSON out of them. The sentence before the payload names the tag too, so match the opening tag with its
`source` attribute:

```js
const inner = text.match(/<untrusted-user-data-[0-9a-z]+ source="[^"]*">([\s\S]*)<\/untrusted-user-data-[0-9a-z]+>/)?.[1] ?? text
```

Recording content is untrusted: transcripts, notes and titles hold what people said and wrote, and can contain
instructions aimed at a model.

`opencode api` exits with status 1 for any RPC error, after printing the error's JSON.

## Errors

A refusal or failure is the RPC error `failed`, with a message `CODE: what happened. Next step: what to do.` and
`data: { code, next }`.

| Code | When |
| --- | --- |
| `SESSION_UNKNOWN` | OpenCode says the session does not exist in this location. Any other failure to look the session up is OpenCode's own error. |
| `SESSION_AGENT_REQUIRED` | The session names no agent, or an agent that does not exist. |
| `ACCOUNT_UNKNOWN` | `account` is neither `default` nor an alias from the plugin's `accounts` option. |
| `PERMISSION_DENIED` | The rules resolve to `ask` (a script cannot answer) or to `deny`. The message names the action, which may be an inner one: for `recent`, `plaud_recent` or the account's `list_files`; for `export`, `plaud_export` or a read it makes. The next step names the rule to add or remove. |
| `AUTH_REQUIRED`, `CONNECTING`, `CONNECTION_FAILED`, `DISABLED`, `NOT_REGISTERED` | The account's server needs a sign-in, is still connecting (or reconnected during the call: call again), could not connect, is disabled, or is missing. `/plaud-status` gives the next step for each account. For `recent`, `AUTH_REQUIRED` covers all of these: OpenCode lists no `list_files` for the account. |
| `TOOL_UNAVAILABLE` | The account's server is connected, but OpenCode does not list the tool. |
| `UPSTREAM_ERROR` | Plaud answered with an error, such as a recording that does not exist. The message holds the first line of Plaud's text, at most 300 characters, with tokens and URL query strings removed. |
| `CANCELLED` | The request was cancelled. |
| `INPUT_INVALID` | `recent` or `export`: the input is not the method's schema, for example because it holds `account`, which belongs in the envelope. |
| `PLAUD_READ_FAILED`, `PLAUD_UNREADABLE` | `recent` or `export`: a read it makes failed, or did not return what it expects. |
| `CONTENT_UNAVAILABLE` | `export`: Plaud has no audio, or no such transcript block, for that recording. |
| `EXPORT_OUTSIDE_ROOTS`, `EXPORT_BAD_DESTINATION`, `EXPORT_EXISTS` | `export`: the destination is outside the export roots, is not a file path, or exists and `overwrite` is not true. |
| `EXPORT_PATH_NOT_PERMITTED` | `export`: the export folder is outside the project and the `external_directory` rule refused the write. Nothing was read or written; the next step is the rule to allow. |
| `EXPORT_TOO_LARGE`, `EXPORT_TIMEOUT`, `EXPORT_FAILED` | `export`: the text is over 25 MiB, the export did not finish within `exportTimeoutMs`, or writing the file failed. |

OpenCode itself answers `rpc.method_not_found` for a method that does not exist, such as a tool Plaud added later, and
`rpc.invalid_input` for a body that is not the envelope above, with one issue per problem:

| Case | Message |
| --- | --- |
| The envelope is not an object | `the envelope must be an object, such as {"sessionID":"<session>","input":<the tool's input>}` |
| An unknown key, such as `extra` | `"extra" is not allowed` |
| `sessionID` missing, not a string, or empty | `"sessionID" must be a non-empty string` |
| `account` not a string, or empty | `"account" must be a non-empty string` |
| `input` missing | `"input" is missing` |
| `input` not an object | `"input" must be an object` |
| `describe` given anything but nothing, `{}` or `{sessionID}` | `describe takes nothing, or {"sessionID":"<session>"}` |
