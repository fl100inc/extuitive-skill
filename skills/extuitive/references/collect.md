# `/extuitive collect` — get files from someone without an Extuitive login

Mints a one-time upload link the workspace owner can hand to a client, a photographer, or
anyone else holding the files, optionally emails it to them, and then watches until their
upload finishes and says what landed.

Anything typed after the command — what the upload is for, a recipient, an email address —
arrives in `$ARGUMENTS`.

## When this is the right job, and when it is not

The person with the files has **no Extuitive account** and is not going to make one. That is
the whole case. If the files are on the disk you can read, that is `upload.md`. If the person
you are talking to has the files but you cannot reach their disk, that is
`create_browser_upload_link` inside `upload.md` — a link for someone who *is* signed in.

A share link is a conversation before it is a tool call. The costly mistakes are
conversational: a link with a meaningless name, a link forwarded to three people, an email
address with a typo that hands a live upload link to a stranger. Do the steps in order and
talk to the person between them.

**Only the workspace owner can create, email, or revoke a link.** Check `isOwner` on the
workspace before starting; a non-owner gets `not_workspace_owner`, and the right answer is to
tell them to ask the owner.

## 1. Pick the workspace

Use the one chosen earlier in this conversation. Otherwise `list_workspaces`, and ask if there
is more than one — `select.md` has the rules. The files land in whichever workspace the link
was made in, and nothing moves them afterwards.

## 2. Ask what the upload is for

That becomes the link's `name`. The recipient sees it on the upload page and in the email, so
it should read the way the person would say it to them — "Spring lookbook photos", not
"batch-2024-09-A". **Ask; do not invent one.** It is 3 to 80 characters.

If it is not obvious, also ask how long the link should stay open. The default is 3 days
(`expiresInHours: 72`) and the maximum 7 (`168`). Only raise it when asked.

## 3. Create the link

Call `create_upload_share_link` with `workspaceId`, `name`, and `expiresInHours` if they
chose one.

The answer carries `shareLinkId` and `url`. **This is the only time the URL is returned.** No
listing, no later read, and no email confirmation will show it again; if it is lost, you make
a new link. Show it to the person exactly as returned.

Say three things plainly alongside it:

- The link works for **one person and one batch**. The first person to confirm their files
  claims it; anyone else who opens it afterwards is told it has already been used; it closes
  for good when that batch finishes.
- Once claimed, the recipient has **24 hours** to finish uploading.
- Nothing sent through it goes to Meta. Files arrive in Extuitive and stop there;
  `publish.md` is a separate, later step if they want it.

## 4. Offer to email it

Ask: do you want me to email this link to the recipient? If no, go to step 6.

If yes, ask for the recipient's email address, and optionally their name and a short note
from the person (up to 500 characters, plain text). Then **read the address back letter for
letter and ask them to confirm the spelling.** A typo sends a live upload link into a
stranger's inbox, and there is no undoing that short of revoking the link.

Only once they have said yes, call `send_upload_share_link_email` with `shareLinkId`,
`recipientEmail`, `recipientEmailConfirmed: true`, and `recipientName` / `note` if given.
The tool refuses without the confirmation flag; the flag is your attestation that the person
confirmed the address, so do not set it because the tool asked for it.

Tell them it was sent. The answer has `sentTo`, `sentAt`, `sendCount`, `expiresAt`, and not
the URL.

Do not offer to send the same link to a second person. A link is for one person; if they
want a second recipient, make a second link. A link can be emailed at most 3 times, for a
bounce or a resend; only an `active` link can be emailed at all.

## 5. Do not stop the conversation on a link

The person may go away for hours or days. That is fine. The link is theirs to check on later,
and `list_upload_share_links` finds it again — it lists every link the workspace has made,
newest first, with each one's current status and `shareLinkId`, without URLs.

## 6. Watch, at the cadence the server asks for

Call `get_upload_share_link` with the `shareLinkId`. It returns `status`, `terminal`, and
`suggestedPollSeconds`, plus `batch` once the recipient has confirmed.

**Wait `suggestedPollSeconds` between calls.** It is not a fixed number: a fresh `active` link
is worth checking every minute, an older one every five, an `uploading` link every 5 seconds
while bytes are moving and every 30 while the recipient is idle. `0` means terminal — stop.

| `status` | Say |
| --- | --- |
| `active` | Nobody has opened it and confirmed yet |
| `uploading` | They confirmed; `batch.statusCounts` says how far along. Report roughly every 15–30 seconds while it moves, the same way `upload-status.md` does |
| `completed` | Every file finished. Report the outcome, below |
| `abandoned` | They confirmed but the 24-hour window closed with files unfinished. Whatever reached `READY` is in the workspace; report that |
| `expired` | Nobody confirmed before `expiresAt`. Offer a new link |
| `revoked` | The owner cancelled it |

`batchUnavailable` on a response means the batch count could not be read this time; `status`
is still trustworthy. It is not a problem with the link. Poll again.

Do not sit in this loop while an `active` link ages. Check a couple of times if the person is
waiting with you; otherwise tell them how to ask you to check later.

## 7. Report the outcome, file by file

When `terminal` is `true`, stop polling and say what happened:

- The status by name.
- How many files reached `READY`, out of `batch.count`. `outcome` summarises it as
  `all_ready`, `partial`, or `none_ready`.
- Every file in `batch.rejected` by `fileName`, each with its `rejectionReason`.
- `batch.neverArrived` — files the recipient declared but whose bytes never came — when it
  is above zero.

**Never call it done while `batch.pending` is above zero.** A `completed` link has a settled
batch by definition; an `abandoned` one may not, and the numbers should say so.

The batch behind a link is an ordinary batch. `batchId` is on the link record, and
`get_upload_batch_content` reads it like any other; `list_upload_batches` with
`source: "share_link"` or `shareLinkId` finds it later. What is *in* the files is
`library.md`. Whether to register them with the ad account is `publish.md`, and only when
the person asks.

## Cancelling a link

`revoke_upload_share_link` kills a link at any stage — sent to the wrong person, no longer
needed, the person changed their mind. An unused link stops opening; a link mid-upload stops
accepting bytes, and the files that already finished stay in the workspace. The answer
carries a `batch` where there was one, so say how many landed.

**It is irreversible. Confirm with the person before calling it.**

## What can go wrong

| You see | It means | Do |
| --- | --- | --- |
| `not_workspace_owner` | The person is a member but not the owner | Tell them to ask the owner. Do not retry |
| `share_link_name_invalid` | `name` missing or the wrong length | Ask again; do not pad it out yourself |
| `recipient_email_unconfirmed` | You did not pass `recipientEmailConfirmed: true` | Read the address back, get a yes, then call again |
| `recipient_email_invalid` | Not an email address | Ask for it again |
| `share_link_email_limit` | Already emailed 3 times | Make a new link |
| `share_link_consumed`, `_completed`, `_expired`, `_revoked`, `_upload_window_closed` | The link is past `active`, so it cannot be emailed | Say which state it is in; offer a new link if they still need one |
| `email_send_failed` | The mail did not go, or this link's URL was not stored | Try once more, or hand over the URL from step 3 yourself |
| `share_link_not_found` | Wrong `shareLinkId`, or a link from another workspace | `list_upload_share_links` |
| `batchUnavailable` in a poll | Transient read failure on the batch | Poll again; the link is fine |

## More detail

`tools.md` has every argument, the share link lifecycle, and the full error vocabulary.
