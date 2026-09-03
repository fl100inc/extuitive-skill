# `/extuitive connect` — connect or repair Meta

Each Extuitive workspace is one Facebook ads account. When something is wrong with that
connection, the tools tell you what and where to send the person — your job is to route to the
right one and relay what it says.

The reverse does not hold: two workspaces can point at the same ads account, each with its own
connection and its own `canReconnect`. Repairing one does not repair the other, so check the
`metaConnection` on the workspace you are actually being asked about.

## Two different problems

They look similar and have different fixes, so identify which one you have before acting.

- **No workspaces at all.** `list_workspaces` returns an empty list. This is a setup problem,
  and it belongs to the person themselves. Use `get_meta_setup_status`.
- **A workspace exists but its data has gone stale.** `list_workspaces` returns a workspace
  whose `metaConnection.status` is not `healthy`. This is a repair problem, and it may belong
  to someone else. Use `create_meta_reconnect_link`.

Do not guess between them. Sending someone who already finished Meta OAuth back through it
achieves nothing and wastes their time.

## No workspaces yet

Call `get_meta_setup_status`. It takes no arguments and answers the question an empty
`list_workspaces` cannot: whether they never connected Meta, or connected it but never chose
ad accounts, or connected it and Meta returned no ad accounts.

It gives you back:

- `stage` — which of those situations this is
- `url` — the page that completes this particular stage
- `nextStep` — what to tell them, already worded for the stage

**Relay `nextStep` rather than writing your own.** It is phrased per stage precisely so that
someone who is already connected is not told to connect again.

Give them the `url`. It requires them to be signed in, so it grants nothing on its own — it is
an ordinary link to a page, not a credential. Then ask them to call you back and run
`list_workspaces` again.

## A workspace whose connection is broken

`list_workspaces` reports `metaConnection` on every workspace:

| `status` | Means |
| --- | --- |
| `healthy` | Working. Nothing to do. |
| `expiring` | The token will expire soon; `daysUntilExpiry` says when. |
| `token_invalid` | The token stopped working. Ads data is stale until it is renewed. |
| `missing_scope` | Meta stopped granting the ads permissions this workspace needs. |
| `ad_account_permission` | Their Meta user has no role on this ad account. |

**Check `metaConnection.canReconnect` before calling `create_meta_reconnect_link`.** Only the
workspace owner can reconnect, because the Meta account is theirs. When `canReconnect` is
`false`, tell the person to ask the workspace owner — do not call the tool to find out, it
will refuse with `not_workspace_owner`.

`canReconnect` is also `false` for `ad_account_permission` even when the person *is* the
owner, because reconnecting cannot grant a Business Manager role. That one is fixed in Meta's
own settings, not in Extuitive.

When `canReconnect` is `true`, call `create_meta_reconnect_link` with the `workspaceId`. It
returns a `url` and a `nextStep`. Same rule as above: relay the `nextStep`, hand over the
`url`, and note that the page requires sign-in.

## What not to do

Do not report numbers from a workspace whose connection is broken without saying so. A
`token_invalid` workspace still has data, but it stopped updating on the day the token died,
and presenting it as current is worse than reporting nothing.

Do not treat any of these URLs as secret. They all point at pages that require the person to
be signed in.
