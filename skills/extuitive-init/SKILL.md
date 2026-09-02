---
name: extuitive-init
description: Set up Extuitive from scratch — create an account, connect this host to the Extuitive MCP server, and confirm the connection works. Run this when Extuitive is not set up yet or its tools are not responding.
disable-model-invocation: true
---

# Set up Extuitive

Gets a person from nothing to a working Extuitive connection. Run only when asked — this
covers setup, not day-to-day work.

Work through the obstacles in this order. Each one has to be true before the next one can be.

## 1. Do they have an account?

If they have never used Extuitive, send them to **https://go.extuitive.com** to sign up or
sign in.

Do not walk them through the signup steps. The sign-in flow already handles account creation,
and it prompts for connecting Meta and choosing ad accounts at the right moments. Anything you
add here is a second, worse copy of a flow that already works.

## 2. Is this host connected to the Extuitive MCP server?

If the Extuitive tools are not available in this session, the connection is not set up.

Tell the person to run:

```bash
npx extuitive-skill doctor
```

That checks the endpoint, whether this host has the server registered, and whether the sign-in
has been completed, and it prints the exact next command for their host.

**Do not invent setup commands.** They are different for each host, they change between
versions, and `doctor` reads the current ones. Naming a stale command sends someone down a
dead end that looks like the tool is broken.

Two things worth saying plainly while they do this:

- **Signing in happens in a browser and only they can do it.** It opens a page, they approve
  access, and the token goes into their host's own credential store. You never see it and you
  cannot do this step for them.
- **Some hosts only read skills and servers at startup.** If `doctor` reports everything is
  fine but the tools still are not here, restarting the host is the fix.

## 3. Does it work?

Once the tools are available, call `list_workspaces`.

- **It returns workspaces.** Setup is done. Say which workspaces they have and stop.
- **It returns an empty list.** They are signed in but have no ads account connected yet. Call
  `get_meta_setup_status`, give them the `url`, and relay its `nextStep` — it is worded for
  whichever stage they are actually at. The `extuitive-workspace-setup` skill covers this in
  full.
- **It refuses.** They are not signed in. Back to step 2.

## What "done" means

They have at least one workspace from `list_workspaces`. Until then, do not start on anything
else they asked for — uploads and reporting both need a `workspaceId`, and every one of those
tools will refuse without it.
