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

Rules for the values:

- **`accounts`**: each alias uses lowercase letters, digits and `-`, starts with a letter or digit, and has at most 32 characters. Aliases are unique, and `default` is reserved for the `plaud` server's account.
- **`url`**: an `https` URL. Plain `http` is accepted only for `localhost`, `127.0.0.1` and `[::1]`. Change it only if Plaud gives you another address, for example for another region.
- **`exportRoots`**: at least one folder. Each is an absolute path, `~`, or a path that starts with `~/`. The plugin expands `~` to your home folder, normalizes the paths and drops duplicates. A folder is created (mode 0700) the first time an export needs it.
- **`maxAudioBytes`**: a whole number from 1 to 64 GiB.
- **`exportTimeoutMs`**: a whole number from 1000 (1 second) to 86400000 (24 hours). The time starts after you approve the export, so time spent on the prompt does not count. It is separate from OpenCode's own tool time limits.
- **`allowUntestedHost`**: the plugin supports OpenCode `>=2.2.3 <2.3.0` and is tested on 2.2.3, 2.2.4 and 2.2.5. Inside the range it always starts; on a release there that is not tested, it prints a warning and `/plaud-status` calls it untested. Outside the range, which includes prereleases and development builds, it does not start, unless this option is set: then it starts, prints a warning, and `/plaud-status` calls the release untested.

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

### The default rules

The plugin inserts these rules into each agent's permissions, right after the agent's base `* * allow` rule:

```json
[
  { "action": "plaud*_*", "resource": "*", "effect": "ask" },
  { "action": "plaud_list_files", "resource": "*", "effect": "allow" },
  { "action": "plaud_get_file", "resource": "*", "effect": "allow" },
  { "action": "plaud_get_note", "resource": "*", "effect": "allow" },
  { "action": "plaud_get_transcript", "resource": "*", "effect": "allow" },
  { "action": "plaud_get_current_user", "resource": "*", "effect": "allow" },
  { "action": "plaud_export", "resource": "*", "effect": "ask" },
  { "action": "plaud_recent", "resource": "*", "effect": "allow" }
]
```

Each account in `accounts` adds the same five allow rules for its own server, before `plaud_export`: for `work`, `plaud-work_list_files` to `plaud-work_get_current_user`. `/plaud-status` shows the exact block for your accounts.

So, by default:

- the five read tools of each account's server (`list_files`, `get_file`, `get_note`, `get_transcript` and `get_current_user`) run without a prompt, also in `opencode run`. They are allowed by exact name, so a later Plaud tool whose name only ends like a read, such as `plaud_bulk_get_file`, asks, as do the tools of a server you named `plaud…` yourself;
- `plaud_recent`, the plugin's own read of the newest recordings, runs without a prompt for every account. It is allowed by its exact name, and it reads through the account's own `list_files`, so a rule for that read applies to it too;
- `plaud_export` asks;
- any other tool on a Plaud server asks, including a tool Plaud adds later.

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

The kinds are `audio`, `transcript` and `note`. Patterns can use `*`. Note that `plaud*_*` also matches `plaud_export` and `plaud_recent`, and the tools of any other MCP server whose name starts with `plaud`. A rule such as `{ "action": "plaud*_*", "resource": "*", "effect": "allow" }` therefore also allows every export.

### Change the defaults

Add rules to `permissions` in your config. They come after the plugin's rules, so they win.

Export transcripts of the default account without a prompt:

```json
{ "permissions": [{ "action": "plaud_export", "resource": "default:transcript", "effect": "allow" }] }
```

Export everything without a prompt, for example for `opencode run`:

```json
{ "permissions": [{ "action": "plaud_export", "resource": "*", "effect": "allow" }] }
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

`opencode run` and other unattended runs cannot answer a prompt. There, an export or an unknown Plaud tool fails with `Permission plaud_export needs approval` (or the tool's own action), unless a rule allows it.

### Agents defined in your config

OpenCode creates agents that you define only in your config after plugins load, so those agents do not get the default rules. Unless their own rules ask for or deny Plaud's tools, their Plaud exports and other Plaud tools then run without a prompt. `/plaud-status` and the status dialog name such agents, under **Agents without default rules**, and show the rules to copy. An agent whose own rules already ask for or deny every Plaud tool, such as one ending with `{ "action": "*", "resource": "*", "effect": "ask" }`, is not listed: it needs no fix.

The fix: put the default rules first in **that agent's own** `permissions`, then repeat any rules for Plaud tools from your top-level `permissions`, so yours keep winning. For an agent `reviewer`, with the top-level rule from the first example above:

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

OpenCode puts MCP tools in Code Mode by default. The model then calls the read tools as `tools.plaud.list_files(input)`, and an extra account's tools as `tools["plaud-work"].list_files(input)`. `plaud_export` is `tools.plaud.export(input)`. It is pinned, so the model sees it in the Code Mode catalog without a search. `plaud_recent` is `tools.plaud.recent(input)`; it is not pinned, and the Plaud namespace's description names it. The permission rules are the same in Code Mode.

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
| `EXPORT_BAD_DESTINATION` | export | The destination is a folder or a root, or the recording id cannot be a file name. |
| `EXPORT_EXISTS` | export | A file exists and `overwrite` is not true. |
| `EXPORT_TOO_LARGE` | export | The audio is over `maxAudioBytes`, or a transcript or note is over 25 MiB. |
| `EXPORT_TIMEOUT` | export | The export took longer than `exportTimeoutMs`. |
| `EXPORT_FAILED` | export | The download or the local write failed. |

OpenCode itself reports a blocked call as `Permission denied: <action>`, and an ask in a run that cannot answer as `Permission <action> needs approval`.

Scripts that use the tools RPC get their own error codes; see [Scripting](scripting.md#errors).
