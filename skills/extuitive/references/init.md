# `/extuitive init` — set Extuitive up

Gets a person from nothing to a working connection. Run only when asked, or when the
Extuitive tools are missing from the session.

Work through the obstacles in order. Each has to be true before the next can be.

## 1. Is this host connected to the Extuitive MCP server?

If the Extuitive tools are not available in this session, the connection is not set up. Tell
the person to run:

```bash
npx github:fl100inc/extuitive-skill doctor
```

That checks the endpoint, whether this host has the server registered, and whether sign-in
has been completed, and it prints the exact next command for their host.

**Do not invent setup commands.** They differ per host, they change between versions, and
`doctor` reads the current ones. A stale command sends someone down a dead end that looks
like the product is broken.

Two things worth saying plainly while they do this:

- **Signing in happens in a browser and only they can do it.** It opens a page, they approve
  access, and the token goes into their host's credential store. You never see it.
- **Some hosts read skills and servers only at startup.** If `doctor` says everything is fine
  but the tools still are not here, restarting the host is the fix.

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
