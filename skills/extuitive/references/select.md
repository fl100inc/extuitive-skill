# `/extuitive select` — choose which ad account to work in

An Extuitive workspace is one Facebook ads account. This picks the one the rest of the
conversation uses, so the person is not asked again on every upload and every status check.

Anything they typed after the command — a name, a slug, an ad account id — arrives in
`$ARGUMENTS`.

**The choice lasts this conversation and nothing longer.** Nothing is written to disk, and no
tool remembers it. A new session starts with none, which is worth saying once when they choose
so that it is not a surprise tomorrow.

If the Extuitive tools are missing from this session, read `init.md` instead. There is nothing
to select from until they are there.

## 1. List what they can actually reach

Call `list_workspaces`. It takes no arguments.

An **empty list** means they have no workspace, not that they lack access to one. Read
`connect.md`; there is nothing to select yet.

**Exactly one** is not a question. Say which workspace you are using and move on — a menu of
one spends a turn to tell them something they cannot change.

## 2. Show every row, ranked by nothing

Give them each workspace with the three fields that actually tell one from another:

| Show | From | Why |
| --- | --- | --- |
| Name | `name` | The only part they will recognise |
| Ad account | `facebookAdAccountId`, or say it has none when `null` | What they think of as the account |
| Connection | `metaConnection.status`, when it is not `healthy` | A stale workspace is still selectable, and they should know that before choosing it |

**Do not order or recommend by `role` or `isOwner`.** Those govern who may reconnect Meta and
say nothing about uploading — a workspace where they are `viewer` may take files that the one
where they are `owner` refuses. Presenting one as the right one to work in is a claim you
cannot make yet.

**Two rows can carry the same `facebookAdAccountId`.** They are two separate workspaces with
separate content, not one workspace listed twice. Show both, say they point at the same ad
account, and let them pick. The ad account id does not identify a workspace, and collapsing
the two loses the distinction that decides where their files end up.

## 3. Match what they said, or ask

When `$ARGUMENTS` names something, match it against `name`, `slug`, and
`facebookAdAccountId`, ignoring case.

- **One match.** Take it, and confirm which one by name.
- **Several.** Ask which, showing what differs between them. A shared ad account id lands
  here, and it is the case where a guess costs the most.
- **None.** Say so and list what they do have, rather than matching loosely onto whichever
  name looks closest.

With no argument, ask.

## 4. Say what you selected

Confirm the workspace by **name**, not by id. The id is for the tools; the name is the part
they can check. Mention its ad account when it has one.

Then hold that `workspaceId` and pass it to every workspace-scoped call for the rest of the
conversation. Not asking again is the entire point of having asked once.

## Selecting is not access

**A selected workspace can still refuse a call.** Membership is re-checked on every single
call, so `workspace_access_denied` can come back from a `workspaceId` that `list_workspaces`
returned a moment earlier.

When it does, the selection is wrong rather than the call. Say plainly which one was refused,
select another, and carry on in that one — correcting yourself in the same breath if you had
already told them their files were going somewhere else. Retrying the refused id will not
change it, and neither `role` nor `isOwner` explains it.

## Switching later

People change their mind mid-conversation. Run this again and replace the selection.

Two things do not follow the switch. A `batchId` belongs to the workspace it was created in,
so checking on an older batch needs the workspace it was made in, not the current one. And
files already uploaded stay where they were sent — selecting elsewhere moves nothing.

## Choosing without the command

Naming a workspace in passing — "upload these to Acme" — is a selection. Take it, say which
workspace you understood that to mean, and do not ask again in the same breath.
