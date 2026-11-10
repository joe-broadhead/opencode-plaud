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
      "package": "@joe-broadhead/opencode-plaud",
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
- **`allowUntestedHost`**: the plugin supports OpenCode `>=2.2.3 <2.3.0` and is tested on 2.2.3, 2.2.4, 2.2.5 and 2.2.6. Inside the range it always starts; on a release there that is not tested, it prints a warning and `/plaud-status` calls it untested. Outside the range, which includes prereleases and development builds, it does not start, unless this option is set: then it starts, prints a warning, and `/plaud-status` calls the release untested.
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
{ "plugins": [{ "package": "@joe-broadhead/opencode-plaud", "options": { "access": "ask-changes" } }] }
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

<!-- /generated:rules-all -->

Each account in `accounts` adds the same five allow rules for its own server, such as `plaud-work_list_files` to `plaud-work_get_current_user`, before the export's rule. The [README](https://github.com/joe-broadhead/opencode-plaud/blob/HEAD/README.md#permissions) prints the block for all three values.

So, in each case:

- the five read tools of each account's server (`list_files`, `get_file`, `get_note`, `get_transcript` and `get_current_user`) always run, also in `opencode run`. They are allowed by exact name, so a later Plaud tool whose name only ends like a read, such as `plaud_bulk_get_file`, follows the `access` value, as do the tools of a server you named `plaud…` yourself;
- `plaud_recent`, the plugin's own read of the newest recordings, always runs for every account. It is allowed by its exact name, and it reads through the account's own `list_files`, so a rule for that read applies to it too;
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

## Code Mode

OpenCode puts MCP tools in Code Mode by default. The model then calls the read tools as `tools.plaud.list_files(input)`, and an extra account's tools as `tools["plaud-work"].list_files(input)`. `plaud_export` is `tools.plaud.export(input)` and `plaud_recent` is `tools.plaud.recent(input)`. Neither is pinned; Code Mode search finds their signatures. The permission rules are the same in Code Mode.

## Errors

Plugin errors read `CODE: what happened. Next step: What to do.`

| Code | Where | Meaning |
| --- | --- | --- |
| `OPTIONS_INVALID` | setup | An option is unknown or has a wrong value. |
| `HOST_UNTESTED` | setup | OpenCode is outside `>=2.2.3 <2.3.0` and `allowUntestedHost` is not set. |
| `SKILLS_INVALID` | setup | The package's `skills/` folder is missing or a skill file is malformed. Reinstall the plugin. |
| `STATUS_UNAVAILABLE` | status views | The status could not be read. |
| `INPUT_INVALID` | the tools RPC's `recent` | Its input is not `{}` or `{ "limit": 1 to 20 }`; the account goes in the envelope. |
| `AUTH_REQUIRED` | export, recent | The account's server is not connected or not signed in. |
| `PLAUD_READ_FAILED` | export, recent | A Plaud read failed or was denied. |
| `PLAUD_UNREADABLE` | export, recent | Plaud returned something the plugin cannot use, such as an audio link that is not a valid https URL, an audio download that redirects to one or more than 5 times, a transcript that never ends, or a recording list that is not a list. |
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
