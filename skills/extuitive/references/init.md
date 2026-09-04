# `/extuitive init` — set Extuitive up

Gets a person from nothing to a working connection. Run only when asked, or when the
Extuitive tools are missing from the session.

Work through the obstacles in order. Each has to be true before the next can be.

## 1. Is this host connected to the Extuitive MCP server?

If the Extuitive tools are not available in this session, the connection is not set up.

**Some hosts have no command line at all.** If this one is a desktop app where you reached the
person through a chat window rather than a terminal — Claude Desktop is the one to expect —
then the connection is a panel they click through, and telling them to run something would
send them looking for a terminal they may not have:

> Settings, then Connectors, then Add custom connector, and paste
> `https://go.extuitive.com/mcp` as the URL.

Everywhere else, tell them to run:

```bash
npx github:fl100inc/extuitive-skill doctor
```

That checks the endpoint, whether this host has the server registered, and whether sign-in
has been completed, and it prints the exact next command for their host.

**Do not invent setup commands.** They differ per host, they change between versions, and
`doctor` reads the current ones. A stale command sends someone down a dead end that looks
like the product is broken. The connector URL above is the one exception, and only because
it is a URL rather than a command — there is nothing about it to go stale but the address.

Relay what `doctor` prints, in the order it prints it. Three things are worth saying plainly
while they work through it:

- **Signing in happens in a browser and only they can do it.** It opens a page, they approve
  access, and the token goes into their host's credential store. You never see it.
- **Do not run the sign-in step yourself.** If `doctor` prints a slash command, it belongs to
  the person's session, not your shell; if it prints a shell command, it opens a browser and
  waits for a redirect your shell cannot receive. Either way, running it produces a failure
  that reads as a broken install. Print the step and stop.
- **The tools will not appear in this session.** Hosts connect MCP servers when a session
  starts, so nothing registered while you have been running is visible to you, and on some
  hosts skills are read once at startup too. Say so, and ask them to start a fresh session —
  a new chat, in a desktop app — before checking. Retrying the tools here will not make them
  exist.

## 2. Do they have an account?

They do not need one in advance, and you should not send them off to make one first.

The sign-in page in step 1 offers **Sign up** alongside **Log in**, both with a one-time
email code. Someone with no account creates it there, in the same browser step that grants
this host access. If they have no Meta connection yet, that same page then shows a panel
pointing at the right setup step and returns them to the consent screen afterwards.

So: let the flow do it. Do not narrate the signup steps or send them to a separate page —
anything you add is a second, worse copy of a flow that already handles this.

## 3. Does it work?

Once the tools are available, call `list_workspaces`.

- **It returns workspaces.** Setup is done. Say which ones they have and stop.
- **It returns an empty list.** They are signed in but have no ads account connected yet.
  Read `connect.md` — it covers exactly this.
- **It refuses.** They are not signed in. Back to step 1.

## What "done" means

At least one workspace from `list_workspaces`. Until then, do not start on anything else they
asked for: uploads and reporting both need a `workspaceId`, and every one of those tools will
refuse without it.

When setup started from a session with no Extuitive tools, that call belongs to the next
session, not this one. Finish by handing over the remaining steps and saying which one they
are on — not by declaring it working, and not by checking again for tools that cannot arrive
until they restart.
