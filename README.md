# extuitive-skill

An agent skill for [Extuitive](https://extuitive.com), plus an installer that connects
Claude Code, Codex, or Claude Desktop to the Extuitive MCP server.

An Extuitive workspace is one Facebook ads account. The skill lets an agent pick which account
to work in, upload creative into it or collect it from someone else through a one-time link,
track how that upload is going, read what the files contain, register them with the ad
account, build a paused campaign from them, and repair a Meta connection that has stopped
delivering data.

Install it from npm:

```bash
npx extuitive install
```

That puts the skill where your host looks for it, connects the MCP server, and tells you how
to sign in. Signing in happens in your browser; the installer never handles your credentials.

What "puts" and "connects" mean depends on the host. For Claude Code and Codex it is a
directory copy and a CLI command, and the installer is the way to do both. For the Chat and
Cowork tabs of Claude Desktop, whose skills belong to your account rather than to this
machine, it is a `.zip` to upload and a connector to add — both done by clicking, and the
`.zip` is [published for download](#claude-desktop), so that path needs no terminal at all.

**You do not need an Extuitive account first.** The sign-in page has a **Sign up** button
next to **Log in**, both using a one-time email code, so you can create the account in the
same browser step that grants your host access. If you have not connected Meta yet, that page
then points you at the right setup step and brings you back.

## Install with an agent

Paste this into Claude Code or Codex and it does the rest:

> Install the Extuitive skill: run
> **`npx extuitive install --host codex --yes`**
> (use `--host claude` in Claude Code, or `--host all`). Then tell me where the skill was
> installed, linking its name to the `SKILL.md` path the installer printed, relay the sign-in
> step exactly as printed without running it, and say when the skill and the Extuitive tools
> will be available.

That prompt is for the hosts an installer can reach. **In the Chat or Cowork tab of Claude
Desktop there is nothing to run**, so paste this instead:

> Install Extuitive. Read https://github.com/fl100inc/extuitive-skill#install-with-an-agent
> and give me the Claude Desktop steps.

If you are the agent reading this for that person, do not run the installer or tell them to.
Reply with the link and these steps, and stop:

> Download [`extuitive.zip`](https://github.com/fl100inc/extuitive-skill/releases/latest/download/extuitive.zip)
> (the [latest release](https://github.com/fl100inc/extuitive-skill/releases/latest)). Then, in Claude Desktop:
>
> 1. **Customize > Skills**, click **Add**, choose **Upload skill**, and upload that file.
> 2. **Customize > Connectors**, click **Add**, and enter `https://www.extuitive.com/mcp` as
>    the MCP server URL.
> 3. Approve access in the browser window that opens, then start a new chat and say
>    "Check my Extuitive connection".
>
> If Skills is not in the Customize menu, turn on code execution and file creation under
> Settings > Capabilities first.

Signing in happens in that browser window and only the person can do it. Both the skill and
the connector reach a chat when it starts, so the last words are "start a new chat", not "it
is ready". The same answer is right when someone in Claude Code or Codex asks you to set up
Claude Desktop's Chat tab: `--host claude-desktop` only builds the same zip locally, and a
person who has the download link does not need it. The rest of this section is about the
installer and does not apply to that tab.

The installer's output is built for that reader. It ends with one block per host:

```
Codex — the Codex CLI, the Codex desktop app, and the IDE extension
───────────────────────────────────────────────────────────────────
  Skill       installed      ~/.codex/skills/extuitive
                             /Users/you/.codex/skills/extuitive/SKILL.md
  MCP server  registered     codex mcp add extuitive --url https://www.extuitive.com/mcp
  Sign-in     connected      signed in during registration

  The skill is available on your next turn. You are signed in; the Extuitive tools appear
  in a new Codex session.
  Try: "Check my Extuitive connection"  ·  "Upload these images to Extuitive"
```

On Codex the sign-in is part of the `codex mcp add` step — it opens the person's browser and
the installer waits for them — so `Sign-in` usually reads `connected` by the time the block
prints. When the browser flow was closed or ran out of time it reads `needed` instead, with the
command that finishes it:

```
  Sign-in     needed         codex mcp login extuitive
                             codex opened a browser sign-in during registration, but it
                             was not completed within 10 minutes.
                             Opens a browser; only you can complete it.
```

Three facts on three lines, each with its own state, so the summary an agent gives back can be
short and still true:

> Installed [Extuitive](/Users/you/.codex/skills/extuitive/SKILL.md) in `~/.codex/skills/extuitive`.
> The skill will be available on your next turn.
> You are signed in; start a new session for the Extuitive tools.
> Try: "Check my Extuitive connection."

If you are the agent doing the install, four rules:

- **Link the skill name to the absolute `SKILL.md` path** on the second line of the block.
  The first line is the `~` form for display; the second exists for the link.
- **Report the `Sign-in` line as printed and never run it.** `codex mcp login` opens a browser
  and waits for a redirect your shell cannot receive; `/mcp` belongs to the person's session.
  When it reads `connected`, say so and skip the instruction.
- **On Codex, expect the install to wait for a browser sign-in.** `codex mcp add` opens the
  person's browser and does not return until they have signed in, and the installer waits up to
  ten minutes for that — so tell the person a browser tab is coming and do not kill the command
  for being slow. If it is cut off anyway, the server is still registered; run
  `npx extuitive doctor` to see where things stand rather than re-running `install`.
- **Say what is available when.** The skill is live now (Codex: next turn; Claude Code:
  immediately; Claude Desktop: once uploaded, in new chats). The Extuitive *tools* are not:
  every host connects MCP servers when a session starts, so they appear in a new session, and
  only after sign-in. Do not say "everything is ready" while the `Sign-in` line says `needed`.
- **Pass `--host` and `--yes`.** Without a TTY the installer refuses to guess which host, and
  without `--yes` it may wait on a prompt you cannot answer. Add `--json` if you would rather
  read structured output than the block.

## What gets installed

One skill, `extuitive`, which takes a command:

| Command | What it does |
| --- | --- |
| `init` | Set up from scratch: connect, sign in, confirm it works |
| `select` | Choose which ad account the rest of the session works in |
| `upload` | Upload a folder of images or videos into a workspace |
| `upload-status` | Report how the current upload is going |
| `library` | Say what uploaded files contain, group them into ads, find uploads like or about something |
| `collect` | Get files from someone without an Extuitive login, through a one-time upload link |
| `publish` | Register accepted uploads with the Meta ad account, so they have an image hash or video id |
| `build` | Create a campaign, ad set, creative and ad — paused — or copy and inspect ones that exist |
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
commands rather than nine skills — `/extuitive-upload` would need a separate directory each
time, and the command form reads better and keeps one description in front of the model.

You usually will not type any of it. Asking for the underlying thing — "upload these ads to
Extuitive", "check my Extuitive connection" — reaches the skill on its own. The second one
routes to `init`, which checks tools, sign-in, and workspaces in order and reports where it
stopped; it is the right first thing to say after installing.

## Install

Three hosts, and one of them is two things. Worth reading the table before picking, because
the Claude Desktop app appears twice and installing for one half of it does not reach the
other:

| `--host` | Covers | Skills live |
| --- | --- | --- |
| `claude` | The `claude` CLI, and the **Code tab** of the Claude Desktop app | `~/.claude/skills` |
| `codex` | The Codex CLI, the Codex desktop app, and the IDE extension | `~/.codex/skills` |
| `claude-desktop` | The **Chat and Cowork tabs** of the Claude Desktop app | your Anthropic account |

With no `--host`, the installer detects what is on the machine and asks. `--host all` takes
everything it can find. `--host both` still works and still means all of them.

The third row does not need the command at all — everything it does is a click in the app,
and the one file it would build is [published for download](#claude-desktop).

### Claude Code

```bash
npx extuitive install --host claude
```

Which does:

```bash
# skills → ~/.claude/skills/
claude mcp add --transport http extuitive https://www.extuitive.com/mcp --scope user
```

The skill is usable immediately. The server is not: **start a new Claude Code session** —
servers are connected at startup, so `extuitive` is not in the session you installed from. In
that new session run `/mcp`, choose `extuitive`, and approve.

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
npx extuitive install --host codex
```

Which does:

```bash
# skills → $CODEX_HOME/skills/   (~/.codex/skills/ unless CODEX_HOME is set)
codex mcp add extuitive --url https://www.extuitive.com/mcp
```

**The sign-in happens inside that `add`.** Codex writes the config, notices the endpoint
supports OAuth, and opens your browser on the spot — there is no flag to add without logging
in. The installer says so before it runs, echoes Codex's output as it goes (including the
authorize URL, in case no browser opens), and waits up to ten minutes for you to finish: long
enough to create an Extuitive account and connect Meta on the way. Once you are back in the
terminal the `Sign-in` line reads `connected`. If the browser flow was closed or timed out,
the server is still registered — the config was written in the first second — and the line
reads `needed` with `codex mcp login extuitive` to finish the sign-in on its own.

The skill itself is picked up on your next turn; the Extuitive **tools** appear in a new Codex
session, because MCP servers are connected when a session starts.

**This is one install for three programs.** The Codex desktop app, the CLI and the IDE
extension share `~/.codex/config.toml` for MCP and the same skills directories, so there is
nothing extra to do for the app. If you prefer clicking, the app has the same two things under
Settings > MCP servers: **Add server**, choosing Streamable HTTP, and **Authenticate**.

**Where the skill goes.** Codex scans two personal skill directories, `$CODEX_HOME/skills`
and `~/.agents/skills`, and loads from both. Codex's own bundled `$skill-installer` — and so
every "install this skill from a URL" done by an agent — writes to `$CODEX_HOME/skills`, so
that is where this installer puts Extuitive too, next to the rest of your skills. Earlier
versions used `~/.agents/skills`; `install` and `update` move a copy found there to the new
location (keeping a backup if it was edited), and `doctor` names it if one is still around.
`--dir` overrides all of this, and `--scope project` uses `./.agents/skills`, which is what
Codex reads for repository skills.

Codex no longer needs `[features] skills = true`; skills are on by default. `--write-config`,
which used to permit adding that line, is accepted and ignored.

**Codex app without the CLI on PATH.** The installer runs `codex --version` before trusting
what `which` found — an npm-installed `codex` whose vendored binary is missing fails with
`spawn … ENOENT` and would otherwise register nothing — and falls back to the binary inside
the Codex or ChatGPT desktop app on macOS. Point it somewhere else with `CODEX_CLI_PATH`.

### Claude Desktop

No terminal needed. Nothing can be registered or copied into the app from outside it, so the
install is one download and two things you do in the app:

1. **Download the skill** —
   [`extuitive.zip`](https://github.com/fl100inc/extuitive-skill/releases/latest/download/extuitive.zip),
   attached to this repository's
   [latest release](https://github.com/fl100inc/extuitive-skill/releases/latest).
2. **Customize > Skills** — click **Add**, choose **Upload skill**, and upload the
   `extuitive.zip` you just downloaded.
3. **Customize > Connectors** — click **Add**, and enter `https://www.extuitive.com/mcp` as
   the MCP server URL. Claude reads the URL and fills in the authentication settings it finds
   there.
4. Approve access in the browser window that opens, then **start a new chat**.

If Skills is not in the Customize menu, turn on code execution and file creation under
**Settings > Capabilities** first; the section appears once you do.

The same two uploads work on claude.ai in a browser, because both the skill and the
connector go to your account rather than to the app — which is also why a skill added here
is on your other devices the next time they sign in.

If an agent is walking you through this, those four steps are the whole instruction; see
[Install with an agent](#install-with-an-agent). There is no command for it to run first.

**From a terminal instead.** If you already have `npx` in front of you:

```bash
npx extuitive install --host claude-desktop
```

It builds the identical archive locally, at `~/.extuitive-skill/bundles/extuitive.zip`, and
prints the steps above with that path in place of the download link. The one thing this
buys you is `update` and `doctor`: they compare the local archive against the skill in the
latest package and tell you when it is time to upload again, which a downloaded file cannot.

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
| `--endpoint <url>` | `https://www.extuitive.com/mcp` | Point at a different server. |
| `--keep-server` | off | Uninstall only: leave the MCP server registered. |
| `--dry-run` | off | Report what would change, change nothing. |
| `--yes`, `-y` | off | Take defaults, never prompt. |
| `--json` | off | Structured output instead of the summary block. |

Environment: `CODEX_HOME` moves Codex's config and skills directory together; `CODEX_CLI_PATH`
and `CLAUDE_CLI_PATH` name the CLI binary when the one on PATH is wrong or missing.

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

Forty tools in six groups. Full schemas, the error vocabulary, and the three lifecycles —
upload status, Meta publish, Meta action — are in
[`skills/extuitive/references/tools.md`](skills/extuitive/references/tools.md).

**Workspaces**

- `list_workspaces` — every workspace you can reach, with the health of its Meta connection.
  Its `role` and `isOwner` decide who may call the owner-only tools (reconnect, one-time links)
  and nothing else, and two workspaces can point at the same ad account, so neither field
  tells you where to upload. When the list is empty it carries the setup link inline.

**Meta connection**

- `get_meta_setup_status` — why you have no workspaces, and the link that fixes it.
- `create_meta_reconnect_link` *(workspaceId)* — repair a workspace's Meta connection. Owner only.

**Uploads**

- `get_upload_limits` *(workspaceId)* — server-owned ceilings. Never hardcode them.
- `create_upload_batch` *(workspaceId, files, publishToMeta?, name?)* — open a batch, get a
  destination per file. Meta is opt-in; `publishToMeta` defaults to `false`.
- `resign_upload` *(workspaceId, contentId)* — a fresh URL when one expires.
- `sign_upload_part` *(workspaceId, uploadId, partNumber)* — presign one chunk of a large video.
- `list_upload_parts` *(workspaceId, uploadId)* — what storage already holds, for resuming.
- `complete_upload` *(workspaceId, uploadId, parts)* — assemble a multipart upload.
- `abort_upload` *(workspaceId, uploadId)* — abandon one.
- `list_upload_batches` *(workspaceId, source?, shareLinkId?)* — batch history, newest first.
  The cheap progress check.
- `get_upload_batch_content` *(workspaceId, batchId, filters)* — per-file rows and status for
  one batch, including each row's `metaPublishStatus`.
- `get_upload_content` *(workspaceId, contentId)* — one file.
- `list_upload_content` *(workspaceId, filters, paging)* — files across the workspace, by
  status, publish state, media kind, source, batch or link.
- `publish_upload_content_to_meta` *(workspaceId, batchId | contentIds)* — register accepted
  files with the ad account; the rows then gain `metaImageHash` or `metaVideoId`.
- `create_browser_upload_link` *(workspaceId)* — hand the transfer back to the browser.

**One-time upload links**

For files held by someone with no Extuitive login. A link is for one person and one batch;
its URL is returned once, at creation, and never listed again.

- `create_upload_share_link` *(workspaceId, name, expiresInHours?)* — mint one. Owner only.
- `get_upload_share_link` *(workspaceId, shareLinkId)* — poll it at `suggestedPollSeconds`
  until `terminal`; the outcome includes every rejected file by name.
- `list_upload_share_links` *(workspaceId)* — every link, newest first, without URLs.
- `send_upload_share_link_email` *(workspaceId, shareLinkId, recipientEmail,
  recipientEmailConfirmed)* — email it, after the address has been read back and confirmed.
- `revoke_upload_share_link` *(workspaceId, shareLinkId)* — kill it. Irreversible. Owner only.

**Library**

What the creative index knows about a workspace's uploads. Read-only, this workspace only.

- `describe_content` *(workspaceId, contentIds)* — overlay text, tags, description; for video
  the duration, opening line, transcript and audio type.
- `group_content_variants` *(workspaceId, batchId)* — which files are one ad at 1:1, 4:5, 9:16.
- `find_similar_content` *(workspaceId, contentId)* — uploads that look like, or open like, one.
- `search_content` *(workspaceId, text?, tags?, …)* — uploads matching a description, tags,
  type or time window.

**Meta objects**

Build and inspect campaigns in the workspace's connected ad account. Creates are submitted as
actions and settle asynchronously; `get_meta_action` is the only way to learn whether one worked.
Everything is created `PAUSED` — the server pins it and refuses `ACTIVE` — so nothing built
here spends until the customer turns it on in Ads Manager.

- `create_meta_campaign` *(workspaceId, params, summary, rationale, clientToken)* — step one of four.
- `create_meta_adset` *(workspaceId, params, …)* — step two; needs a `campaign_id`.
- `create_meta_adcreative` *(workspaceId, params, …)* — step three; needs a `page_id` from
  `list_meta_pages` and media already `PUBLISHED` through the upload tools.
- `create_meta_ad` *(workspaceId, params, …)* — step four; needs an `adset_id` and a `creative_id`.
- `get_meta_action` *(workspaceId, actionId)* — poll until `settled`; `EXECUTED` carries the new
  object's `createdId`, `FAILED` carries Meta's own error.
- `list_meta_actions` *(workspaceId)* — everything created through these tools, newest first.
- `list_meta_campaigns` / `list_meta_adsets` / `list_meta_ads` *(workspaceId, filters, paging)* —
  read live from Meta, for finding ids of objects that already exist.
- `get_meta_campaign` / `get_meta_adset` / `get_meta_ad` *(workspaceId, id)* — the full settings
  of one object, including ad set targeting.
- `list_meta_pages` *(workspaceId, source?)* — pages this workspace can run ads as, from the
  Meta connection or live from the ad account.
- `list_meta_pixels` *(workspaceId)* — conversion pixels, with `lastFiredTime` so you can avoid
  a dead one.
- `list_meta_instagram_accounts` *(workspaceId)* — Instagram accounts the ad account may
  advertise as. Optional; a creative runs on Facebook with a `page_id` alone.

## The MCP server

- **Endpoint** `https://www.extuitive.com/mcp`
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
npx extuitive doctor
```

It reports the endpoint, which skills are installed where, and what your host says about the
server — including the difference between "not registered" and "registered but not signed in",
which is not visible from the outside. Add `--json` for machine-readable output.

Common causes, in the order they usually happen:

- **The skill does not appear.** On Codex it appears on the next turn, not the current one;
  in a resumed thread, start a new one. On the CLI hosts, a skill whose frontmatter `name`
  differs from its directory name silently fails to load; `doctor` checks this. A skill can
  also be disabled without being deleted, via `[[skills.config]]` in `~/.codex/config.toml`.
- **The skill appears twice.** A copy is in both `~/.codex/skills` and `~/.agents/skills`,
  which Codex both scans. `update` moves the old one (backing it up if it differs); `doctor`
  names it.
- **`codex` is on PATH but nothing was registered.** An npm-installed `codex` whose vendored
  binary is missing dies with `spawn … ENOENT`. The installer falls back to the desktop app's
  binary on macOS; elsewhere, reinstall the CLI or set `CODEX_CLI_PATH`. `doctor` prints which
  binary it is using on the `CLI` line.
- **The install said it worked and the tools are not there.** Every host connects MCP servers
  when a session starts, so a server registered from inside a running session — or by an
  agent in one — is invisible to it. Start a new session, or a new chat, before concluding
  anything.
- **Claude Desktop has the skill in one tab and not another.** Chat and Cowork read the copy
  uploaded to your account; the Code tab reads `~/.claude/skills`. They are different
  installs: the [upload](#claude-desktop) for the first two, `--host claude` for the third.
- **Tools are listed but every call is refused.** Sign-in was never completed. Run `/mcp` in
  Claude Code, `codex mcp login extuitive` in a terminal, or click Connect next to `extuitive`
  in Claude Desktop's Customize > Connectors. `doctor` reads Codex's own answer
  (`codex mcp list --json` → `auth_status`), so `Sign-in connected` means a token is actually
  stored.
- **A `403` part-way through an upload.** Presigned URLs last 30 minutes and a whole batch is
  signed at once, so late files in a big batch can expire mid-transfer. The script reports
  these as `needsResign` and `needsPartResign`; the fix is `resign_upload` or
  `sign_upload_part` and a re-run for just those files.
- **A batch stuck at `CREATED`.** It was opened by a host that could not send the bytes. Use
  `create_browser_upload_link` instead.

## Local development

```bash
npx extuitive install --endpoint http://localhost:3001/mcp
```

Port 3001 is what the lead-magnet app binds with `npm run dev`.

Two packages are published from this repository. `@extuitive/skill`, the root, is the skill
and the installer. `extuitive`, in `packages/extuitive`, is the command: a `bin` that imports
the installer from `@extuitive/skill` and nothing else, so that what people type is
`npx extuitive`. Release the root first, then the launcher, since the launcher depends on it.
To run the checked-out code without publishing, use `node bin/cli.mjs <command>` from the
repository root.

The third artifact is the Claude Desktop bundle. Pushing a `vX.Y.Z` tag runs
[`.github/workflows/release.yml`](.github/workflows/release.yml), which builds it with
`npm run bundle` (the same code path as `install --host claude-desktop`, written to `dist/`)
and attaches it to a GitHub release as `extuitive.zip`, with release notes that repeat the
Claude Desktop steps and link to that release's own copy of the file. That is what the
download link in the [Claude Desktop](#claude-desktop) section serves, through GitHub's
`latest` redirect, so the npm publishes and the tag push are the whole release. The workflow
can also be run by hand from the Actions tab against an existing tag. The steps in the notes
are written in the workflow file; change them there when the section here changes.

## Update

```bash
npx extuitive update
```

Refreshes an install that is already here. It only touches hosts that already have the skill,
so running it will not quietly add Codex to a machine set up for Claude Code alone — pass
`--host` if that is what you want.

It rewrites skill files that changed, reports `up to date` for those that did not, and prints
`Already up to date.` when there was nothing to do. It re-registers the MCP server only if
your host has lost the registration, and reports sign-in from what your host says rather than
assuming. A copy at the previous Codex location (`~/.agents/skills`) counts as an install to
update, and is moved.

`install` does the same file work — it has always compared trees and backed up anything that
differed — so an update is safe to do either way. The difference is what gets printed: install
adds the sign-up note and the manual steps when a CLI could not be driven; update prints the
summary block and stops.

`npx` fetches the released version from npm, so an update picks up the latest published
release. To run whatever is on `main` instead, use the repository directly:

```bash
npx github:fl100inc/extuitive-skill update
```

Any command in this README works the same way with that prefix.

## Uninstall

```bash
npx extuitive uninstall
```

Removes the skill directories — from the current location and from Extuitive's previous Codex
location, `~/.agents/skills`, if a copy is there — and unregisters the MCP server from your
host. Pass `--keep-server` to drop the skills but keep the tools registered.

On Claude Desktop it deletes the built archive and prints the two removals it cannot do for
you: the skill, in Customize > Skills, and the connector, in Customize > Connectors. Both live
on the other side of a browser session.

Two things are deliberately left behind.

**Your backups**, under `~/.extuitive-skill/backups/`. Each one exists because an install found
a skill that differed from the one it was about to write, so it may be the only copy of
something you wrote. The uninstall prints the path; deleting them is your call.

**Your sign-in.** The OAuth token lives in your host's own credential store, which is not ours
to read or clear — on Codex that is the macOS keychain, keyed by server, so a reinstall later
finds it and reports `Sign-in connected` without asking you again. Revoke access from
Extuitive if you want it gone.

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
.github/workflows/
  release.yml               attaches the Claude Desktop bundle to each tagged release
```

`SKILL.md` stays short on purpose: it is loaded whenever the skill is considered, while a
`references/` file is read only once the agent knows which job it is doing. Putting all nine
flows in the front page would spend context on eight of them every time.

`README.md` lives here at the repo root and nowhere else. Skill directories deliberately do
not contain one — everything an agent reads belongs in `SKILL.md` or `references/`, and a
`README.md` inside a skill folder is dead weight in its context window.

Host-specific setup commands live only in `src/mcp-setup.mjs`, and every other per-host
difference — skills directory, previous skills directory, config file, which binary to run —
is a field in `src/hosts.mjs`. Nothing else branches on a host id. Two of those fields decide
which code path a host takes rather than which words it prints: `skillDelivery` (`copy` for a
host that scans a directory, `bundle` for one that takes an upload) and `mcpSetup` (`cli` for
a host we can drive, `connector-ui` for one where the only supported route is a panel).

The skill never names a setup command; it tells the agent to run `doctor` and relay what it
prints, so a change to a host's CLI is a fix in one file rather than four. The one exception
is the connector URL, which the skill does name, because a host with no command line cannot
be told to run `doctor` and a URL has nothing to go stale but its address.

`mcp-setup.mjs` also decides the order of the last two steps. Sign-in and new-session are
printed in whichever order the host can actually do them: Claude Code signs in from inside a
session, so the new session comes first, while Codex and Claude Desktop sign in outside one
and open a new session afterwards for the tools. Anything printed here should assume its
reader is an agent, which will run a shell command it is shown — so a sign-in step that cannot
survive being run that way does not belong in the output.

## Licence

MIT
