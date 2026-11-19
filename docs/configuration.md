# Configuration

The plugin works with no options. You configure it in two places:

- the plugin's `options`, in its `plugins` entry;
- OpenCode's `permissions` rules, which decide which Plaud tools ask, run or are blocked.

Both go in your OpenCode config: `~/.config/opencode/opencode.json` for every project, or `opencode.json` in one project. Restart OpenCode, or run `opencode reload`, after you change them.

## Options

Give options with the object form of the plugin entry:

```jsonc
{
  "plugins": [
    {
      "package": "github:joe-broadhead/opencode-plaud#v0.0.7",
      "options": {
        "accounts": ["work"],
        "exportRoots": ["~/Plaud"],
        "maxAudioBytes": 2147483648,
        "exportTimeoutMs": 1800000,
        "url": "https://mcp.plaud.ai/mcp",
        "allowUntestedHost": false
      }
    }
  ]
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `accounts` | `[]` | Extra Plaud accounts. Each alias gets its own server, `plaud-<alias>`. The default account, server `plaud`, always exists. |
| `url` | `https://mcp.plaud.ai/mcp` | Plaud's MCP server, for every account. |
| `exportRoots` | `["~/Plaud"]` | The folders `plaud_export` may write in. The first one holds default destinations: `<kind>/<recordingId>.<ext>`, and `transcript/<recordingId>.<block>.md` for a transcript. |
| `maxAudioBytes` | `2147483648` (2 GiB) | The largest audio file an export writes. A transcript or note file is held to a fixed 25 MiB. |
| `exportTimeoutMs` | `1800000` (30 minutes) | How long one export may take, in milliseconds. |
| `allowUntestedHost` | `false` | Start on an OpenCode release outside the supported range, with a warning. |
| `access` | `"all"` | What the generated default rules allow: `"all"`, `"ask-changes"` (the export asks) or `"read-only"` (the export is denied). See [Permissions](#permissions). |

Rules for the values:

- **`accounts`**: each alias uses lowercase letters, digits and `-`, starts with a letter or digit, and has at most 32 characters. Aliases are unique, and `default` is reserved for the `plaud` server's account.
- **`url`**: an `https` URL. Plain `http` is accepted only for `localhost`, `127.0.0.1` and `[::1]`. Change it only if Plaud gives you another address, for example for another region.
- **`exportRoots`**: at least one folder. Each is an absolute path, `~`, or a path that starts with `~/`. The plugin expands `~` to your home folder, normalizes the paths and drops duplicates. A folder is created (mode 0700) the first time an export needs it.
- **`maxAudioBytes`**: a whole number from 1 to 64 GiB.
- **`exportTimeoutMs`**: a whole number from 1000 (1 second) to 86400000 (24 hours). The time starts after you approve the export, so time spent on the prompt does not count. It is separate from OpenCode's own tool time limits.
- **`allowUntestedHost`**: the plugin supports OpenCode `>=2.2.3 <2.4.0` and is tested on 2.2.3, 2.2.4, 2.2.5, 2.2.6, 2.2.7, 2.3.0, 2.3.1 and 2.3.2. Inside the range it always starts; on a release there that is not tested, it prints a warning and `/plaud-status` calls it untested. Outside the range, which includes prereleases and development builds, it does not start, unless this option is set: then it starts, prints a warning, and `/plaud-status` calls the release untested.
- **`access`**: one of the three values above, and nothing else. It changes only the rules the plugin inserts; your own rules still come later and win.

An unknown key or a wrong value stops the plugin from starting. The error names every problem at once:

```text
OPTIONS_INVALID: opencode-plaud has invalid options: accounts.0: use lowercase letters, digits and '-', at most 32 characters. Next step: Fix them in this plugin's "options" in your OpenCode config.
```

## Accounts and servers

To add a second Plaud account, give it an alias in `accounts`. Each account has its own server, and signs in on its own:

| Account | Server | In `/connect` | Export `account` | On the command line |
| --- | --- | --- | --- | --- |
| The default account | `plaud` | **Plaud** | `default`, or leave it out | `opencode mcp auth plaud` |
| An alias, such as `work` | `plaud-work` | **Plaud (work)** | `work` | `opencode mcp auth plaud-work` |

Sign in from `/connect`: choose the account's entry, then press `o` or Enter to open the sign-in page in your browser. On the command line, `opencode mcp auth <server>` opens the browser itself. `/mcps` offers the same sign-in.

If your config already defines an MCP server with one of these names in `mcp.servers`, the plugin leaves your definition as it is. `/plaud-status` then says "from your OpenCode config" for that account.

## Permissions

**Every tool is allowed by default.** An agent can read your recordings, save an export to a file, and run any tool Plaud adds later, without asking. Three ways to restrict it:

1. **The `access` option**, below.
2. **An agent that is read-only or asks**, with rules of its own, later than the plugin's.
3. **A rule per tool**, with the names in [Permission names](#permission-names).

### The `access` option

`access` drives the rules the plugin inserts into each agent's permissions, directly after the agent's base `* * allow` rule. The block is generated from the tool classes: the five reads of each account's server and `plaud_recent` are reads, and `plaud_export` is the one tool that writes a file.

| Value | What runs | What asks |
| --- | --- | --- |
| `"all"` (the default) | every tool, and one Plaud adds later | nothing |
| `"ask-changes"` | the reads, `plaud_recent` and one Plaud adds later | `plaud_export` |
| `"read-only"` | the reads | nothing: exports and new tools are **denied** |

```json
{ "plugins": [{ "package": "github:joe-broadhead/opencode-plaud#v0.0.7", "options": { "access": "ask-changes" } }] }
```

`/plaud-status` shows the value and the block it inserts. The default block, for the default account's `plaud` server, generated from `defaultRules(servers, access)` in `src/host/permissions.ts`:

<!-- generated:rules-all -->

`access: "all"`

| Action | Resource | Effect |
| --- | --- | --- |
| `plaud*_*` | `*` | `allow` |
| `plaud_list_files` | `*` | `allow` |
| `plaud_get_file` | `*` | `allow` |
| `plaud_get_note` | `*` | `allow` |
| `plaud_get_transcript` | `*` | `allow` |
| `plaud_get_current_user` | `*` | `allow` |
| `plaud_export` | `*` | `allow` |
| `plaud_recent` | `*` | `allow` |
| `plaud_events_list` | `*` | `allow` |
| `plaud_probe` | `*` | `allow` |

<!-- /generated:rules-all -->

Each account in `accounts` adds the same five allow rules for its own server, such as `plaud-work_list_files` to `plaud-work_get_current_user`, before the export's rule. The [README](https://github.com/joe-broadhead/opencode-plaud/blob/HEAD/README.md#permissions) prints the block for all three values.

So, in each case:

- the five read tools of each account's server (`list_files`, `get_file`, `get_note`, `get_transcript` and `get_current_user`) always run, also in `opencode run`. They are allowed by exact name, so a later Plaud tool whose name only ends like a read, such as `plaud_bulk_get_file`, follows the `access` value, as do the tools of a server you named `plaud…` yourself;
- `plaud_recent`, the plugin's own read of the newest recordings, always runs for every account. It is allowed by its exact name, and it reads through the account's own `list_files`, so a rule for that read applies to it too. So do `plaud_events_list` and `plaud_probe`, the source contract's listing and probe ([Events list](#events-list));
- `plaud_export` asks at `"ask-changes"` and is denied at `"read-only"`;
- any other tool on a Plaud server follows the same rule, so `"all"` runs a tool Plaud adds later, and `"read-only"` denies it.

All values still leave the host's own path rules in place: an export writes outside the project, so OpenCode also checks `external_directory` on the export folder, as well as the export's own action. A refusal that names `external_directory` costs nothing, since nothing was read or written; allow it with `{ "action": "external_directory", "resource": "<the export folder>/*", "effect": "allow" }`, or move the folder inside the project with `exportRoots`.

OpenCode uses the last rule that matches. Everything after the base allow comes later and wins over these rules:

- the agent's own stricter rules, such as Plan's and Explore's (Explore denies every Plaud tool);
- your top-level `permissions` rules;
- saved "Always allow" approvals.

An agent without a base `* * allow` rule gets no Plaud rules.

### Permission names

| Tool | Action | Resource | "Always allow" saves |
| --- | --- | --- | --- |
| A Plaud server tool | `<server>_<tool>`, such as `plaud_get_file` or `plaud-work_list_files` | `*` | `<server>_<tool>` for `*` |
| `plaud_recent` | `plaud_recent`, then the account's `<server>_list_files` | the account, such as `default` or `work`; `*` for the read | that account only |
| `plaud_export` | `plaud_export` | `<account>:<kind>`, such as `default:audio` or `work:transcript` | that account and kind only |

The kinds are `audio`, `transcript` and `note`. Patterns can use `*`. Note that `plaud*_*` also matches `plaud_export` and `plaud_recent`, and the tools of any other MCP server whose name starts with `plaud`. A rule such as `{ "action": "plaud*_*", "resource": "*", "effect": "allow" }` therefore allows every export too.

### Change the defaults

Add rules to `permissions` in your config. They come after the plugin's rules, so they win.

Make the export ask while everything else runs:

```json
{ "permissions": [{ "action": "plaud_export", "resource": "*", "effect": "ask" }] }
```

Export transcripts of the default account without a prompt, at `"ask-changes"`:

```json
{ "permissions": [{ "action": "plaud_export", "resource": "default:transcript", "effect": "allow" }] }
```

Block audio exports from the `work` account. A `deny` wins over a saved approval too:

```json
{ "permissions": [{ "action": "plaud_export", "resource": "work:audio", "effect": "deny" }] }
```

Block exports completely. A `deny` on the resource `*` also hides the tool from the model:

```json
{ "permissions": [{ "action": "plaud_export", "resource": "*", "effect": "deny" }] }
```

To set rules for one agent only, put them in that agent's own `permissions` instead.

### Saved approvals

When a prompt offers "Always allow", OpenCode saves the approval for the whole project. It then applies to every agent in that project, Plan included. A `deny` rule still wins over it. Read [SECURITY.md](../SECURITY.md#permissions) before you save approvals for exports.

### Runs that cannot ask

`opencode run` and other unattended runs cannot answer a prompt. There, a tool whose rule asks, or the export folder's `external_directory` rule, fails with `Permission … needs approval` unless a rule allows it. At the default `"all"` nothing in the plugin asks.

### Agents defined in your config

OpenCode creates agents that you define only in your config after plugins load, so those agents do not get the default rules. At `"all"` nothing is held back, so there is nothing to fix and `/plaud-status` names no agent. At `"ask-changes"` or `"read-only"`, an agent whose own rules would run a Plaud tool without asking is named under **Agents without default rules**, with the block to copy. An agent whose own rules already ask for or deny every Plaud tool, such as one ending with `{ "action": "*", "resource": "*", "effect": "ask" }`, is not listed: it needs no fix.

The fix: put the default rules first in **that agent's own** `permissions`, then repeat any rules for Plaud tools from your top-level `permissions`, so yours keep winning. For an agent `reviewer` at `"ask-changes"`, with the top-level rule from the first example above:

```jsonc
{
  "permissions": [
    { "action": "plaud_export", "resource": "default:transcript", "effect": "allow" }
  ],
  "agents": {
    "reviewer": {
      "description": "Reviews meeting notes",
      "mode": "subagent",
      "permissions": [
        { "action": "plaud*_*", "resource": "*", "effect": "ask" },
        { "action": "plaud_list_files", "resource": "*", "effect": "allow" },
        { "action": "plaud_get_file", "resource": "*", "effect": "allow" },
        { "action": "plaud_get_note", "resource": "*", "effect": "allow" },
        { "action": "plaud_get_transcript", "resource": "*", "effect": "allow" },
        { "action": "plaud_get_current_user", "resource": "*", "effect": "allow" },
        { "action": "plaud_export", "resource": "*", "effect": "ask" },
        { "action": "plaud_recent", "resource": "*", "effect": "allow" },
        // Repeated from the top-level permissions, so it still wins in this agent:
        { "action": "plaud_export", "resource": "default:transcript", "effect": "allow" }
      ]
    }
  }
}
```

With other accounts, copy the block `/plaud-status` shows: it has their reads too. For an agent defined in a Markdown file, put the same rules in the `permissions` of its frontmatter.

Do not add the default rules to the top-level `permissions`. Top-level rules come after every agent's own base rules, so they would loosen stricter agents: in Explore, denied Plaud reads would run and denied exports would ask.

## Events list

`plaud_events_list` (`tools.plaud.events_list` in Code Mode, and the tools RPC method `events_list`) is Plaud's side of
the source contract, [`@we-the-rebel-alliance/source-contract`](https://github.com/we-the-rebel-alliance/source-contract)
`v0.2.0`, which Memory and other consumers read. It lists one account's recordings since a cursor, as normalised events,
oldest first. It only reads, never asks and calls no model, so a consumer can run it unattended. It serves two sources:

- `recordings`, the declared source `plaud.recordings` (package.json's `sources`), for consumers of the source
  contract. `plaud.recordings.list` is the same `list_files` read as the contract's `list` output (`events_list` with
  `{ "source": "recordings", "list": "recordings" }`), so an app can render titles without knowing Plaud. It is not a
  rename of `plaud.recordings`, and it declares no write.
- `plaud`, the default, the listing scripts and Memory's collector read before the source contract, with the same
  answers as before.

```
events_list({ since?, cursor?, limit?, account?, source? })
  → { source, account, owner: { id, label }, events, cursor, more, plugin?, refused?, gap?, trust: "untrusted" }
```

| Input | Meaning |
| --- | --- |
| `since` | Where to start without a cursor: an ISO date (a UTC day) or date-time with `Z` or an offset. Default: 24 hours ago. |
| `cursor` | The previous result's cursor, for the same account and source. It wins over `since`. |
| `limit` | Most events, 1 to 500; 100 by default. A `recordings` page also stops before 262,144 bytes of JSON, and a `plaud` page before 900,000. |
| `account` | `default` or an alias from `accounts`; `default` when left out. Through the tools RPC, the envelope's `account` names it too. A `recordings` listing with a cursor must name it. |
| `source` | `recordings`, or `plaud` (the default). |

It asserts `plaud_events_list` with the account as the resource, then reads through that account's server, so the rules
of its `list_files` (and, for `plaud`, its `get_current_user`) apply too. `list_files` lists one week at a time, every
page of it (`page_size` 20; a shorter page is the last, since Plaud says nothing about more). Plaud's docs say it
ignores `page` under a date filter. A page that is not empty and repeats the one before, whatever its length, may or
may not hold every recording of those days, so it is never taken as complete: the week is listed again one UTC day at
a time (each query asks for that day and one either side, since Plaud's days are its own), and a day whose query still
repeats fails with `PLAUD_READ_FAILED`, the cursor unmoved: no recording is ever skipped silently. An empty page ends
the window. Its `date_from` and `date_to`
are whole days whose boundaries Plaud draws, so each week asks for one more day on each side and keeps the recordings
that started within the week, by `start_at` (UTC without a `Z`, which the plugin adds).

Each event is one recording: kind `meeting`, the recording's id (`file_id` for `get_note` and `get_transcript`),
its start, its name as the title, and its length as the text. Its notes and transcript are not read: that would take a
call per recording. A recording is listed once it started 6 hours ago, because a device can upload it hours after it
ends. On a `recordings` page, one uploaded later than that, after the cursor has passed its start, is listed too, if
it started within the 14 days before the cursor (below); with `plaud`, it is not listed. The cursor's position is the
(start, id) of the last recording listed: calling again with it lists what follows, and an older cursor lists the same
recordings again.

### The `recordings` source and `probe`

`probe` is a tools RPC method, not a tool: `probe({ source?, account? })` answers
`{ source: "recordings", account, owner: { id, label }, trust: "untrusted" }`, whose sign-in an account is, and reads no
recording. It asserts `plaud_probe` with the account as the resource, then reads only that account's
`get_current_user`. The owner is `mailto:` and the email when Plaud gives one, or `plaud:` and the user's id, labelled
with the user's nickname or name.

A `recordings` page never reads `get_current_user`: that is the probe's, as the source contract asks. The plugin keeps
each account's owner from its last probe, apart from every other account's, and a page names it, with the same id and
label the probe gave. So:

- every listing of an account, with a cursor or without, needs a probe of that account since OpenCode started, or it
  is refused with `UNAVAILABLE`, before any read: a page's owner is only ever one a probe read from Plaud, never a
  cursor's, which anyone holding it could change; a consumer probes when it binds the source, and again after a
  restart;
- the cursor is the source contract's version 2, bound to (`plaud`, `recordings`, the account), and holds the owner's
  id, so a listing reads only `list_files`;
- a listing with a cursor names its account (`INPUT_INVALID` otherwise), another account's cursor is
  `ACCOUNT_MISMATCH`, and a cursor of another source, of another plugin, or from before this release (contract 1's) is
  `CURSOR_INVALID`, all before any read: start again with `since`;
- a cursor whose owner is not the one the account's last probe named is `CURSOR_INVALID`: the account was signed in to
  another Plaud user since;
- a recording whose title holds a secret, such as a password or a key, is left out for good: it is listed in `refused`
  with the reason `secret`, and the cursor moves past it;
- a recording that reaches Plaud after the cursor passed its start is listed by the next page, if it started within the
  14 days before the cursor: a device keeps its recordings until the Plaud app connects to it, so an upload can come
  days late. Each page reads those 14 days again, and the cursor remembers which recordings it listed there (with more
  than its 1,024 characters hold, fewer days), so none is listed twice. These recordings come first on the page, older
  than the cursor's position;
- a recording that reached Plaud later than that, found in the 7 days before those 14 with a `created_at` after the
  last page was read, makes the page answer `gap: { reason: "expired", since }`, once per read: list again from
  `since` to find it. Plaud documents `created_at` only as the creation time; the plugin reads it as when the recording
  reached Plaud. A recording that started before those 7 days is not seen at all;
- a recording deleted before a listing reaches it is not listed: it no longer exists, so nothing is lost. Once Memory
  and Jelly read source-contract `v0.2.0`, a recording deleted after it was listed will be announced in `removals[]`.

### The `plaud` source

`plaud`, the default, answers as before the source contract: it reads `get_current_user` itself for the owner, its
cursor holds the account and a digest of the owner (another account's, or one from before a sign-in to another Plaud
user, is `EVENTS_CURSOR_INVALID`), and its page has no `plugin` or `refused`.

## Code Mode

OpenCode puts MCP tools in Code Mode by default. The model then calls the read tools as `tools.plaud.list_files(input)`, and an extra account's tools as `tools["plaud-work"].list_files(input)`. `plaud_export` is `tools.plaud.export(input)` and `plaud_recent` is `tools.plaud.recent(input)`. Neither is pinned; Code Mode search finds their signatures. The permission rules are the same in Code Mode.

## Errors

Plugin errors read `CODE: what happened. Next step: What to do.`

| Code | Where | Meaning |
| --- | --- | --- |
| `OPTIONS_INVALID` | setup | An option is unknown or has a wrong value. |
| `HOST_UNTESTED` | setup | OpenCode is outside `>=2.2.3 <2.4.0` and `allowUntestedHost` is not set. |
| `SKILLS_INVALID` | setup | The package's `skills/` folder is missing or a skill file is malformed. Reinstall the plugin. |
| `STATUS_UNAVAILABLE` | status views | The status could not be read. |
| `INPUT_INVALID` | the tools RPC's `recent`, events list, probe | `recent`'s input is not `{}` or `{ "limit": 1 to 20 }`; the account goes in the envelope. An events list's or probe's input breaks the contract, or names a different account from the envelope's; a `plaud` listing names an account the plugin does not have; a `recordings` listing with a cursor names no account. |
| `SOURCE_UNKNOWN` | events list, probe | The call names a source the plugin does not have: an events list takes `recordings` or `plaud`, and probe `recordings`. |
| `ACCOUNT_MISMATCH` | events list, probe | A `recordings` listing or a probe names an account the plugin does not have, or a `recordings` listing passes another account's cursor. |
| `CURSOR_INVALID` | events list | A `recordings` cursor is not one it issued for this account, or the account's last probe named another user. Start again with `since`, without a cursor. |
| `UNAVAILABLE` | events list | A `recordings` listing came before any probe of the account since OpenCode started. Call `probe` for it, then list again. |
| `EVENTS_CURSOR_INVALID` | events list | A `plaud` cursor was not issued by `events_list` for this account and its signed-in user. Pass a cursor from a previous result of the same account, or start again with `since`. |
| `EVENTS_OWNER_UNKNOWN` | events list, probe | Plaud's `get_current_user` named no email or id for the account. |
| `AUTH_REQUIRED` | export, recent, events list, probe | The account's server is not connected or not signed in. |
| `PLAUD_READ_FAILED` | export, recent, events list | A Plaud read failed or was denied, or one week held more recordings than an events list reads. |
| `PLAUD_UNREADABLE` | export, recent, events list | Plaud returned something the plugin cannot use, such as an audio link that is not a valid https URL, an audio download that redirects to one or more than 5 times, a transcript that never ends, or a recording list that is not a list. |
| `CONTENT_UNAVAILABLE` | export | The recording has no audio yet, or no such transcript block. |
| `EXPORT_OUTSIDE_ROOTS` | export | The destination is outside the export roots. |
| `EXPORT_PATH_NOT_PERMITTED` | export | The export folder is outside the project and the `external_directory` rule refused the write. |
| `EXPORT_BAD_DESTINATION` | export | The destination is a folder or a root, or the recording id cannot be a file name. |
| `EXPORT_EXISTS` | export | A file exists and `overwrite` is not true. |
| `EXPORT_TOO_LARGE` | export | The audio is over `maxAudioBytes`, or a transcript or note is over 25 MiB. |
| `EXPORT_TIMEOUT` | export | The export took longer than `exportTimeoutMs`. |
| `EXPORT_FAILED` | export | The download or the local write failed. |

OpenCode itself reports a blocked call as `Permission denied: <action>`, and an ask in a run that cannot answer as `Permission <action> needs approval`.

Scripts that use the tools RPC get their own error codes; see [Scripting](scripting.md#errors).
