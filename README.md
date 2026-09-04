# extuitive-skill

An agent skill for [Extuitive](https://go.extuitive.com), plus an installer that connects
Claude Code, Codex, or Claude Desktop to the Extuitive MCP server.

An Extuitive workspace is one Facebook ads account. The skill lets an agent pick which account
to work in, upload creative into it, track how that upload is going, and repair a Meta
connection that has stopped delivering data.

Installed straight from this repository — there is no npm package:

```bash
npx github:fl100inc/extuitive-skill install
```

That puts the skill where your host looks for it, connects the MCP server, and tells you how
to sign in. Signing in happens in your browser; the installer never handles your credentials.

What "puts" and "connects" mean depends on the host. For Claude Code and Codex it is a
directory copy and a CLI command. For Claude Desktop, whose skills belong to your account
rather than to this machine, it is a `.zip` to upload and a connector to add — the command
builds the first and prints the steps for both.

**You do not need an Extuitive account first.** The sign-in page has a **Sign up** button
next to **Log in**, both using a one-time email code, so you can create the account in the
same browser step that grants your host access. If you have not connected Meta yet, that page
then points you at the right setup step and brings you back.

## What gets installed

One skill, `extuitive`, which takes a command:

| Command | What it does |
| --- | --- |
| `init` | Set up from scratch: connect, sign in, confirm it works |
| `select` | Choose which ad account the rest of the session works in |
| `upload` | Upload a folder of images or videos into a workspace |
| `upload-status` | Report how the current upload is going |
| `connect` | Connect Meta, or repair a workspace that has stopped updating |

**The prefix differs by host, and using the wrong one looks like a broken install.**

| Host | Invoke | Browse |
| --- | --- | --- |
| Claude Code | `/extuitive init` | `/skills` |
| Codex | `$extuitive init` | `/skills` |
| Claude Desktop | no prefix — just ask | Customize > Skills |

Codex reserves `/` for its own built-in commands, so `/extuitive` there returns
`Unrecognized command '/extuitive'` even when the skill is installed correctly. Claude Desktop
has no invocation syntax at all; it matches your request against the skill's description.

Arguments go after the command: `/extuitive upload ./creative` or
`$extuitive upload-status <batch id>`. Claude Code substitutes them into the skill; Codex
passes your wording through, which works because the command word is still sitting in the
prompt the model reads.

The CLI hosts take a skill's name from its directory, which is why there is one skill with
commands rather than five skills — `/extuitive-upload` would need a separate directory each
time, and the command form reads better and keeps one description in front of the model.

You usually will not type any of it. Asking for the underlying thing — "upload these ads to
Extuitive" — reaches the skill on its own.

## Install

Three hosts, and one of them is two things. Worth reading the table before picking, because
the Claude Desktop app appears twice and installing for one half of it does not reach the
other:

| `--host` | Covers | Skills live |
| --- | --- | --- |
| `claude` | The `claude` CLI, and the **Code tab** of the Claude Desktop app | `~/.claude/skills` |
| `codex` | The Codex CLI, the Codex desktop app, and the IDE extension | `~/.agents/skills` |
| `claude-desktop` | The **Chat and Cowork tabs** of the Claude Desktop app | your Anthropic account |

With no `--host`, the installer detects what is on the machine and asks. `--host all` takes
everything it can find. `--host both` still works and still means all of them.

### Claude Code

```bash
npx github:fl100inc/extuitive-skill install --host claude
```

Which does:

```bash
# skills → ~/.claude/skills/
claude mcp add --transport http extuitive https://go.extuitive.com/mcp --scope user
```

Then **start a new Claude Code session** — servers are connected at startup, so `extuitive`
is not in the session you installed from. In that new session run `/mcp`, choose `extuitive`,
and approve.

`/mcp` is the whole sign-in story on Claude Code. There is a `claude mcp login` on recent
versions, but it is left out on purpose: this output is usually read by an agent inside a
Claude Code session, and a shell command is the one thing an agent will run for you — from
the wrong session, possibly on a version without the subcommand, into a browser redirect its
shell cannot receive.

`--scope user` matters. The default is `local`, which ties the server to whichever directory
you ran the command in, while your skills are available everywhere. That combination works in
one project and looks broken in the next.

### Codex

```bash
npx github:fl100inc/extuitive-skill install --host codex --write-config
```

Which does:

```toml
# ~/.codex/config.toml — skills are behind an experimental flag
[features]
skills = true
```

```bash
# skills → ~/.agents/skills/
codex mcp add extuitive --url https://go.extuitive.com/mcp
```

Then `codex mcp login extuitive` to sign in, and **restart Codex** — it reads skills once at
startup, so new ones are invisible until you do.

**This is one install for three programs.** The Codex desktop app, the CLI and the IDE
extension share `~/.codex/config.toml` for MCP and all read user skills from
`~/.agents/skills`, so there is nothing extra to do for the app. If you prefer clicking, the
app has the same two things under Settings > MCP servers: **Add server**, choosing Streamable
HTTP, and **Authenticate**.

`--write-config` is what permits editing `~/.codex/config.toml`. Without it you are shown the
two lines to add yourself. Either way the file is backed up before it is touched.

### Claude Desktop

```bash
npx github:fl100inc/extuitive-skill install --host claude-desktop
```

Nothing is registered and nothing is copied into the app, because neither is possible here.
What the command does is build the archive the app asks for:

```
# bundle → ~/.extuitive-skill/bundles/extuitive.zip
```

Then, in the app:

1. **Settings > Capabilities** — turn on code execution and file creation. The Skills section
   does not appear until you do.
2. **Customize > Skills** — `+`, then Create skill, then Upload a skill, and choose the
   `extuitive.zip` the command printed.
3. **Settings > Connectors** — Add custom connector, and paste
   `https://go.extuitive.com/mcp` as the URL.
4. Approve access in the browser window that opens, then **start a new chat**.

Two things are different here and both are the app's design rather than a limitation of this
installer.

**Skills go to your account, not to this machine.** Chat-tab skills run in Anthropic's code
execution container, and the Customize panel uploads them to your account — which is why they
then work on claude.ai and on your other devices, and why an uninstall here deletes the
archive but not the skill. The Code tab is the exception: it reads `~/.claude/skills`, so
`--host claude` is what serves it.

**The connector cannot go in `claude_desktop_config.json`.** That file validates stdio servers
only, and an entry carrying a `url` is worse than ignored — Claude Desktop rewrites the file
on next launch with the whole `mcpServers` block removed, taking any servers you added by hand
with it ([anthropics/claude-code#37286](https://github.com/anthropics/claude-code/issues/37286)).
There is a way around it, wrapping the endpoint in an `npx mcp-remote` stdio bridge, and this
installer deliberately does not: it puts a second OAuth implementation and a background Node
process between the app and a server the app can talk to directly through Connectors.

**Uploading from a Chat-tab conversation will not work the way it does in a terminal.** The
container holds the skill but not your disk, so the skill hands you a browser upload link
instead. Cowork and the Code tab can reach your files normally.

### Options

| Flag | Default | Meaning |
| --- | --- | --- |
| `--host <name\|all>` | detected | `claude`, `codex`, `claude-desktop`, or `all`. Required without a TTY. |
| `--scope <user\|project>` | `user` | Every project, or only this one. Ignored by `claude-desktop`, where a skill belongs to an account rather than a directory. |
| `--dir <path>` | host default | Install skills, or write the bundle, somewhere else entirely. |
| `--endpoint <url>` | `https://go.extuitive.com/mcp` | Point at a different server. |
| `--write-config` | off | Allow editing the host's config file. |
| `--keep-server` | off | Uninstall only: leave the MCP server registered. |
| `--dry-run` | off | Report what would change, change nothing. |
| `--yes`, `-y` | off | Take defaults, never prompt. |

No client id, secret, or API key anywhere. The server supports Dynamic Client Registration, so
both hosts negotiate their own credentials from the URL alone.

## How uploading works

Worth reading before the tool list, because it explains the shape of everything else.

**The MCP tools never carry file bytes.** `create_upload_batch` returns presigned storage URLs
and whoever holds the files sends the bytes to those URLs directly. No tool accepts a file.

That single fact splits the behaviour in two:

- **A host that can read your files** — Claude Code, Codex, Cowork — uses the script bundled
  in `skills/extuitive/scripts/upload.mjs` to do the transfer, then reports the outcome
  through the tools.
- **A host that cannot** uses `create_browser_upload_link` and hands the person a link to
  upload from their browser.

The test is reading your files, not running code. A Claude Desktop chat has code execution —
skills require it — but the container it runs in holds the skill and not your disk, so it
takes the second path.

It also means a finished transfer is not an accepted file. Bytes landing in storage starts a
check that can still reject the file, so `READY` — not "upload complete" — is the only status
that means success. The upload and status flows are built around reporting that honestly.

The bundled script holds no credential and makes no MCP calls. It receives presigned URLs,
sends bytes, and reports ETags. Your access token stays in your host's credential store.

## Tools

Fourteen tools in three groups. Full schemas, the error vocabulary, and the status lifecycle
are in
[`skills/extuitive/references/tools.md`](skills/extuitive/references/tools.md).

**Workspaces**

- `list_workspaces` — every workspace you can reach, with the health of its Meta connection.
  Its `role` and `isOwner` decide who may reconnect Meta and nothing else, and two workspaces
  can point at the same ad account, so neither field tells you where to upload.

**Meta connection**

- `get_meta_setup_status` — why you have no workspaces, and the link that fixes it.
- `create_meta_reconnect_link` *(workspaceId)* — repair a workspace's Meta connection. Owner only.

**Uploads**

- `get_upload_limits` *(workspaceId)* — server-owned ceilings. Never hardcode them.
- `create_upload_batch` *(workspaceId, files)* — open a batch, get a destination per file.
- `resign_upload` *(workspaceId, contentId)* — a fresh URL when one expires.
- `sign_upload_part` *(workspaceId, uploadId, partNumber)* — presign one chunk of a large video.
- `list_upload_parts` *(workspaceId, uploadId)* — what storage already holds, for resuming.
- `complete_upload` *(workspaceId, uploadId, parts)* — assemble a multipart upload.
- `abort_upload` *(workspaceId, uploadId)* — abandon one.
- `list_upload_batches` *(workspaceId)* — batch history, newest first. The cheap progress check.
- `get_upload_batch_content` *(workspaceId, batchId)* — per-file rows and status for one batch.
- `get_upload_content` *(workspaceId, contentId)* — one file.
- `create_browser_upload_link` *(workspaceId)* — hand the transfer back to the browser.

## The MCP server

- **Endpoint** `https://go.extuitive.com/mcp`
- **Transport** stateless Streamable HTTP JSON-RPC over `POST`
- **Auth** OAuth 2.1, authorization code with PKCE `S256`, Dynamic Client Registration, scope `mcp`

Workspace membership is verified on every workspace-scoped call rather than once at sign-in,
so leaving a workspace takes effect immediately. It is checked per call, not per listing, so a
workspace can appear in `list_workspaces` and still answer `workspace_access_denied` to an
upload — the skill treats that as a fact to report and route around, not one to explain.

This package stores no credential of any kind. Your host holds the OAuth token; the upload
script only ever sees presigned URLs scoped to a single object, which expire.

## Troubleshooting

```bash
npx github:fl100inc/extuitive-skill doctor
```

It reports the endpoint, which skills are installed where, and what your host says about the
server — including the difference between "not registered" and "registered but not signed in",
which is not visible from the outside. Add `--json` for machine-readable output.

Common causes, in the order they usually happen:

- **Skills do not appear.** On Codex, either `[features] skills = true` is missing from
  `~/.codex/config.toml` or you have not restarted since installing. On both hosts, a skill
  whose frontmatter `name` differs from its directory name silently fails to load; `doctor`
  checks this.
- **A stale duplicate.** Codex still scans the legacy `~/.codex/skills` alongside
  `~/.agents/skills`, so an old copy can shadow a new one. `doctor` names any it finds.
- **The install said it worked and the tools are not there.** Every host connects MCP servers
  when a session starts, so a server registered from inside a running session — or by an
  agent in one — is invisible to it. Start a new session, or a new chat, before concluding
  anything.
- **Claude Desktop has the skill in one tab and not another.** Chat and Cowork read the copy
  uploaded to your account; the Code tab reads `~/.claude/skills`. They are different
  installs: `--host claude-desktop` and `--host claude` respectively.
- **Tools are listed but every call is refused.** Sign-in was never completed. Run `/mcp` in
  Claude Code, `codex mcp login extuitive` in a terminal, or click Connect next to `extuitive`
  in Claude Desktop's Settings > Connectors.
- **A `403` part-way through an upload.** Presigned URLs last 30 minutes and a whole batch is
  signed at once, so late files in a big batch can expire mid-transfer. The script reports
  these as `needsResign` and `needsPartResign`; the fix is `resign_upload` or
  `sign_upload_part` and a re-run for just those files.
- **A batch stuck at `CREATED`.** It was opened by a host that could not send the bytes. Use
  `create_browser_upload_link` instead.

## Local development

```bash
npx github:fl100inc/extuitive-skill install --endpoint http://localhost:3001/mcp
```

Port 3001 is what the lead-magnet app binds with `npm run dev`.

## Update

```bash
npx github:fl100inc/extuitive-skill update
```

Refreshes an install that is already here. It only touches hosts that already have the skill,
so running it will not quietly add Codex to a machine set up for Claude Code alone — pass
`--host` if that is what you want.

It rewrites skill files that changed, reports `unchanged` for those that did not, and prints
`Already up to date.` when there was nothing to do. It re-registers the MCP server only if
your host has lost the registration, and mentions signing in only if your host says it is not
signed in. The restart reminder appears only when something actually changed — files that
moved, or a registration it had to put back.

`install` does the same file work — it has always compared trees and backed up anything that
differed — so an update is safe to do either way. The difference is what gets printed: install
walks you through sign-in and shows you how to invoke the skill every time, which is the right
thing once and noise on the fifth run.

The package is fetched from this repository rather than a registry, so `npx` resolves the ref
on each run and an update picks up whatever is on `main`.

## Uninstall

```bash
npx github:fl100inc/extuitive-skill uninstall
```

Removes the skill directories, deletes any stale copy in Codex's legacy `~/.codex/skills`, and
unregisters the MCP server from your host. Pass `--keep-server` to drop the skills but keep the
tools registered.

On Claude Desktop it deletes the built archive and prints the two removals it cannot do for
you: the skill, in Customize > Skills, and the connector, in Settings > Connectors. Both live
on the other side of a browser session.

Two things are deliberately left behind.

**Your backups**, under `~/.extuitive-skill/backups/`. Each one exists because an install found
a skill that differed from the one it was about to write, so it may be the only copy of
something you wrote. The uninstall prints the path; deleting them is your call.

**Your sign-in.** The OAuth token lives in your host's own credential store, which is not ours
to read or clear. Revoke access from Extuitive if you want it gone.

Codex's `[features] skills = true` is a third case, handled conditionally. That flag is what
lets Codex load skills at all — not just ours — so turning it off on the way out would silently
disable every other skill you have. Uninstall offers to revert it only when nothing else is
left in your skills directory, and otherwise says which skills it left it on for.

Backups live outside the skills directories on purpose. Both hosts treat every directory in
their skills root as a skill, and Codex searches it recursively, so a backup kept next to the
skill it replaced would be loaded as a second, older copy of that skill.

## Repository layout

```
bin/cli.mjs                 install | update | uninstall | doctor
src/hosts.mjs               every per-host difference, as data
src/                        install, MCP setup, doctor, and a ZIP writer
skills/extuitive/
  SKILL.md                  routes a command to its reference
  references/               one file per command, plus the full tool reference
  scripts/upload.mjs        byte transfer only; no credentials, no MCP calls
```

`SKILL.md` stays short on purpose: it is loaded whenever the skill is considered, while a
`references/` file is read only once the agent knows which job it is doing. Putting all five
flows in the front page would spend context on four of them every time.

`README.md` lives here at the repo root and nowhere else. Skill directories deliberately do
not contain one — everything an agent reads belongs in `SKILL.md` or `references/`, and a
`README.md` inside a skill folder is dead weight in its context window.

Host-specific setup commands live only in `src/mcp-setup.mjs`, and every other per-host
difference is a field in `src/hosts.mjs`. Nothing else branches on a host id. Two of those
fields decide which code path a host takes rather than which words it prints: `skillDelivery`
(`copy` for a host that scans a directory, `bundle` for one that takes an upload) and
`mcpSetup` (`cli` for a host we can drive, `connector-ui` for one where the only supported
route is a panel).

The skill never names a setup command; it tells the agent to run `doctor` and relay what it
prints, so a change to a host's CLI is a fix in one file rather than four. The one exception
is the connector URL, which the skill does name, because a host with no command line cannot
be told to run `doctor` and a URL has nothing to go stale but its address.

That file also decides the order of the last two steps. Sign-in and restart are printed in
whichever order the host can actually do them: Claude Code signs in from inside a session, so
it has to restart first, while Codex and Claude Desktop sign in outside one and restart
afterwards to pick up the skills. Anything printed here should assume its reader is an agent, which will run a
shell command it is shown — so a sign-in step that cannot survive being run that way does not
belong in the output.

## Licence

MIT
