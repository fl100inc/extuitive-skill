# Extuitive MCP tools

Every tool the Extuitive MCP server exposes, with its arguments and what it gives back. Read
this when you need a schema or an error meaning; the reference for each job carries the
procedure.

Server endpoint is `https://www.extuitive.com/mcp`. Forty tools in six groups: workspaces,
Meta connection, uploads, one-time upload links, library, and Meta objects. Every tool except
`list_workspaces` and `get_meta_setup_status` takes a `workspaceId`, and membership is
re-checked on every single call — a token issued before someone left a workspace does not
still reach it.

The server also publishes three MCP **prompts** — `bulk_upload_creative`,
`collect_creative_via_link`, `build_meta_campaign` — for hosts that read prompts and not
skills. They describe the same procedures as `upload.md`, `collect.md` and `build.md`. If a
host offers both, follow the skill; the two must not disagree, and if they do, say so.

## Read this first: ten things that cause wrong answers

1. **`role` and `isOwner` say nothing about uploading.** They decide who may call the
   owner-only tools — `create_meta_reconnect_link`, `create_upload_share_link`,
   `revoke_upload_share_link`, `send_upload_share_link_email` — and nothing else. Nothing in a
   `list_workspaces` row predicts which workspaces the upload tools will accept, so never
   present one as the right one for uploads — ask, or try and report what happened.
2. **`count` is not the batch size.** In `get_upload_batch_content`, `count` describes only
   the rows returned after filtering. `statusCounts`, `pending`, `settled`,
   `metaPublishCounts` and `metaPublishPending` always describe the whole batch. Filtering to
   `["READY"]` and reading `count` makes an unfinished upload look complete. In
   `list_upload_content` every count describes the filtered result, so that tool cannot
   answer "has this batch settled".
3. **`complete_upload` uses S3's capitalisation.** `PartNumber` and `ETag`, not `partNumber`
   and `eTag`. They are the only non-camelCase fields outside `params` and `config` on the
   Meta object tools, which are Meta's own snake_case.
4. **`sign_upload_part` does not give you the checksum.** You compute
   `x-amz-checksum-crc32c` yourself over the exact bytes of that part and send it as a header.
   The signature covers that header, so S3 rejects the part when it is missing or wrong. The
   bundled `scripts/upload.mjs` does this for you.
5. **No tool is annotated.** None declares `readOnlyHint`, `destructiveHint`, or an output
   schema, so nothing can be inferred about safety from the listing. `abort_upload` discards
   data; `revoke_upload_share_link` is irreversible; `publish_upload_content_to_meta` puts
   files into someone's ad account; `send_upload_share_link_email` sends mail to a stranger;
   the four `create_meta_*` tools create real objects in a real ad account. Every one of those
   is a confirm-first call. The four library tools and every `list_*` / `get_*` are read-only.
6. **`not_indexed_yet` is not an error, and neither is `annotated: false`.** `describe_content`
   says the first for every file the index has not read yet, which on a fresh upload is most of
   them, and the second for a file it has read but not yet described — for video, the minute
   after `indexed`. Report both and move on; neither is a reason to poll.
7. **Meta is opt-in, twice over.** An upload does not touch the ad account unless
   `create_upload_batch` was given `publishToMeta: true` or `publish_upload_content_to_meta`
   is called later, and files that arrive through a one-time link are never published on
   their own. `metaPublishStatus` on a row is a separate lifecycle from `status`; `settled`
   says the upload finished and says nothing about Meta.
8. **A create returns before anything exists.** `create_meta_campaign` and its three siblings
   answer `APPROVED` with an `actionId`, which means queued. The Meta id arrives on a later
   `get_meta_action` as `createdId`, and the next create in the chain needs it. Nothing here
   is synchronous, and nothing created here is ever live — `status` is pinned to `PAUSED`.
9. **A share link's URL appears once.** In `create_upload_share_link`'s answer and in the
   email, and in no listing after that. If it is lost, make a new link.
10. **Meta object ids are bare digits.** `120330000000000`, never `act_…`. An `act_` id is an
    ad account, which the workspace resolves server-side and no tool here accepts.

Results always arrive as both a JSON text block and `structuredContent` with the same payload.

## Workspaces

### `list_workspaces`

No arguments. Start every session here.

Returns `{ workspaces: [...] }`, each with:

| Field | Meaning |
| --- | --- |
| `workspaceId` | Pass this to every other tool |
| `name`, `slug` | Display |
| `role` | This caller's role in the workspace. Governs the owner-only tools and nothing else |
| `facebookAdAccountId` | The Meta ads account, or `null`. Not unique across workspaces |
| `isOwner` | Whether this caller owns the workspace. Governs the owner-only tools and nothing else |
| `metaConnection.status` | `healthy`, `expiring`, `token_invalid`, `missing_scope`, `ad_account_permission` |
| `metaConnection.daysUntilExpiry` | Whole days, or `null` when Meta gave no expiry |
| `metaConnection.canReconnect` | Whether *this* caller can fix it |

An empty list means no workspace, not no access. When it is empty the answer also carries
`setup` — the same payload `get_meta_setup_status` returns, with the `url` and `nextStep` to
hand over — or, if that could not be read, a `nextStep` telling you to call
`get_meta_setup_status` yourself. Either way the person has a link to follow before anything
else will work.

Two rows can carry the same `facebookAdAccountId`. They are still two separate workspaces
with separate content, not one workspace listed twice, so do not merge them or pick between
them on the person's behalf. Whichever they choose is the one their files will be in.

A row in this list is also not a guarantee that every tool will accept its `workspaceId`; see
`workspace_access_denied` below.

## Meta connection

### `get_meta_setup_status`

No arguments. The right follow-up to an empty `list_workspaces` when its `setup` was absent.

Returns `stage` (`not_connected`, `no_ad_accounts_selected`, `no_ad_accounts_available`,
`ready`), `connected`, `discoveredAdAccountCount`, `connectedAdAccountCount`, `action`, `url`
(absent only when `stage` is `ready`), and `nextStep`. Relay `nextStep` rather than writing
your own wording — it differs per stage so that someone already connected is not told to
connect again.

### `create_meta_reconnect_link`

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId` | yes | Caller must **own** it, not merely belong to it |

Returns `workspaceId`, `status`, `action`, `url`, `nextStep`. Check
`metaConnection.canReconnect` first; a non-owner gets `not_workspace_owner` and the right
answer is to ask the owner instead.

## Uploads

Bytes never pass through any of these. `create_upload_batch` mints presigned storage URLs and
the caller sends bytes to them directly.

### `get_upload_limits`

| Argument | Required |
| --- | --- |
| `workspaceId` | yes |

Returns `multipartThresholdBytes`, `recommendedPartBytes`, `maxParts`, `maxFiles`, and
`media.image` / `media.video`, each with `maxBytes` and `contentTypes`. Image and video
ceilings differ by orders of magnitude. Never hardcode any of these.

### `create_upload_batch`

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId` | yes | |
| `files` | yes | 1 to `maxFiles` entries (250 when the server does not say) |
| `files[].fileName` | yes | Including extension |
| `files[].contentType` | yes | Must be an allowed type |
| `files[].bytes` | yes | Whole number, the real size |
| `publishToMeta` | no | Default `false`. `true` registers every file with the ad account once it is `READY`. Only when the person asked for that |
| `name` | no | 3 to 80 characters, a label for the batch in history |

Returns `batchId`, `metaAdAccountId`, `createdAt`, `fileCount`, and `files` — one destination
per file, in the order sent. A destination is one of:

- **PUT** — `method`, `fileName`, `contentId`, `url`, `fields`, `headers`, `expiresIn` (1800).
  Send the whole file to `url` with `headers` verbatim.
- **MULTIPART** — `method`, `fileName`, `contentId`, `uploadId`, `key`, `partBytes`. Needs
  `sign_upload_part` per part, then `complete_upload`.

### `resign_upload`

| Argument | Required |
| --- | --- |
| `workspaceId`, `contentId` | yes |

A fresh presigned PUT for one file. Every URL in a batch is signed at the same instant and
lasts 1800 seconds, so late files in a large batch can expire while early ones are still
transferring. Call on a 403, or when most of `expiresIn` has passed.

### `sign_upload_part`

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId`, `uploadId` | yes | |
| `partNumber` | yes | 1 to 10000 |

Returns `{ url, headers, expiresIn }`. Takes no bytes and no checksum, so all parts can be
signed up front before any transfer starts. Part count is `ceil(bytes / partBytes)`.

### `list_upload_parts`

| Argument | Required |
| --- | --- |
| `workspaceId`, `uploadId` | yes |

Returns a **bare array** of `{ PartNumber, Size, ETag }` — what storage already holds. Use it
to resume without re-sending parts that landed.

### `complete_upload`

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId`, `uploadId` | yes | |
| `parts` | yes | `{ PartNumber, ETag }[]`, capitalised exactly so |

Assembles the object. Returns `VALIDATING` — this does **not** mean accepted. Safe to retry.

### `abort_upload`

| Argument | Required |
| --- | --- |
| `workspaceId`, `uploadId` | yes |

Discards a multipart upload and its stored parts. Destructive, and not marked as such.

### `list_upload_batches`

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId` | yes | |
| `source` | no | `web`, `mcp`, or `share_link` — only batches from that channel |
| `shareLinkId` | no | Only the batch a given one-time link produced |

Batches newest first, each with `batchId`, `createdAt`, `fileCount`, `pending`,
`statusCounts`, `publishToMeta`, and when present `name`, `source`, and `shareLinkId`. No
file rows. The cheap way to check on an upload, and the way to find a batch someone created
through a browser link or a one-time link. May return `truncated: true` at 1000 items, with
no cursor beyond that.

### `get_upload_batch_content`

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId`, `batchId` | yes | |
| `status` | no | Array of upload statuses; omit for all |
| `metaPublishStatus` | no | Array of `PENDING`, `PUBLISHING`, `PUBLISHED`, `FAILED`. Rows never queued for Meta have no value and match no filter |
| `mediaKind` | no | `image` or `video`; omit for both |

Returns `content`, `count`, `statusCounts`, `pending`, `settled`, `metaPublishCounts`,
`metaPublishPending`, `batchId`. Each content row: `contentId`, `status`, and optionally
`rejectionReason`, `batchId`, `fileName`, `mediaKind`, `bytes`, `contentType`, `format`,
`createdAt`, `updatedAt`, `url` on a `READY` image, and the Meta publish fields:
`metaPublishStatus`, `metaPublishError` on `FAILED`, and on `PUBLISHED` `metaImageHash` for an
image or `metaVideoId` and `metaVideoThumbUrl` for a video.

Remember that filtering narrows `content` and `count` only.

### `get_upload_content`

| Argument | Required |
| --- | --- |
| `workspaceId`, `contentId` | yes |

One row, same shape as above. For a file uploaded on its own, which has no `batchId`.

### `list_upload_content`

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId` | yes | |
| `batchId` | no | One batch |
| `shareLinkId` | no | Files that arrived through one one-time link |
| `status` | no | Array of upload statuses |
| `metaPublishStatus` | no | Array of the four publish states **or `"NONE"`**, which means never queued for Meta |
| `mediaKind` | no | `image` or `video` |
| `source` | no | `web`, `mcp`, or `share_link` |
| `limit` | no | 1 to 100, default 100 |
| `cursor` | no | `nextCursor` from the previous page |

The workspace-wide query. Returns the same summary shape as `get_upload_batch_content` —
`content`, `count`, `statusCounts`, `pending`, `settled`, `metaPublishCounts`,
`metaPublishPending` — **describing the filtered page, not a batch**, plus `nextCursor` when
there is another page. `status: ["READY"], metaPublishStatus: ["NONE"]` is exactly the set
`publish_upload_content_to_meta` would act on.

### `publish_upload_content_to_meta`

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId` | yes | |
| `batchId` | one of | Queue every `READY`, not-yet-published file in the batch |
| `contentIds` | one of | 1 to 250 specific files. Not both |

Registers files already in Extuitive with the workspace's ad account. Only queues: returns
`queued[]` (content ids) and `skipped[]` of `{ contentId, reason }` with reason
`already_published`, `already_publishing`, `not_ready`, or `not_found`. None of those is an
error to stop on. Progress and the resulting handle appear on the rows' `metaPublishStatus`.
**Confirm with the person before calling this** — it is the step that puts their files into
their ad account.

### `create_browser_upload_link`

| Argument | Required |
| --- | --- |
| `workspaceId` | yes |

Returns `{ workspaceId, url }` — a page where the person uploads from their browser. Use it
whenever you cannot make HTTP requests, and for very large video where signing every part
would take too many calls. The page requires them to be signed in, so the link grants nothing
on its own. For someone *without* an Extuitive login, this is the wrong tool; see the
one-time upload links below.

## One-time upload links

For getting files from someone who has no Extuitive account — a client, a photographer. The
owner mints a link, hands it over or has it emailed, and the recipient uploads one batch
through it. Nothing that arrives this way is sent to Meta unless the owner later asks.

A link is for **one person and one batch**. The first person to confirm their files claims
it; anyone else who opens it afterwards is told it has already been used; it closes for good
when that batch finishes. An unused link stays open `expiresInHours` (default 72, maximum
168); once claimed, the recipient has 24 hours to finish.

### `create_upload_share_link`

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId` | yes | Caller must **own** the workspace |
| `name` | yes | 3 to 80 characters. What the upload is for, in words the recipient will recognise. Ask; do not invent |
| `expiresInHours` | no | 1 to 168, default 72. Raise it only if asked |

Returns the link record plus `url` — **the only time the URL is ever returned**. Record
fields: `shareLinkId`, `workspaceId`, `status`, `name`, `createdAt`, `expiresAt`.

### `get_upload_share_link`

| Argument | Required |
| --- | --- |
| `workspaceId`, `shareLinkId` | yes |

The poll target. Returns the record, plus `terminal`, `suggestedPollSeconds`, and where there
is a batch behind it, `batch` or `batchUnavailable`.

| Field | Meaning |
| --- | --- |
| `status` | `active`, `uploading`, `completed`, `abandoned`, `expired`, `revoked` — see the lifecycle below |
| `terminal` | `true` on the last four. Stop polling |
| `suggestedPollSeconds` | How long to wait before asking again; `0` when terminal. Server-derived and it changes with what is happening, so use it rather than a fixed cadence |
| `outcome` | On `completed` and `abandoned`: `all_ready`, `partial`, `none_ready` |
| `consumedAt`, `uploadDeadlineAt` | Set once claimed |
| `completedAt`, `revokedAt` | Set on those statuses |
| `batchId` | Set once claimed. Reads with `get_upload_batch_content` like any batch |
| `email` | `{ sentTo, sentAt, sendCount }` once emailed |
| `batch` | While `uploading` and at the end: `batchId`, `count`, `statusCounts`, `pending`, `settled`, `neverArrived` (declared but bytes never came), `rejected[]` of `{ contentId, fileName, rejectionReason }`, `metaPublishCounts`, `metaPublishPending` |
| `batchUnavailable` | The batch could not be read this time; `status` is still right. Not a problem with the link |

Never carries the URL.

### `list_upload_share_links`

| Argument | Required |
| --- | --- |
| `workspaceId` | yes |

`{ links: [...] }`, newest first, each in the shape above but **without** a live `batch`
read — it does not touch the batches, so it is cheap. For a live count on one link, call
`get_upload_share_link`. Never carries URLs. Any member may call it.

### `revoke_upload_share_link`

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId`, `shareLinkId` | yes | Caller must **own** the workspace |

Kills a link at any stage: unused, it stops opening; mid-upload, it stops accepting bytes and
files that already finished stay in the workspace. Returns the record, now `revoked`, with a
`batch` where there was one so you can say what landed. **Irreversible. Confirm first.**

### `send_upload_share_link_email`

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId`, `shareLinkId` | yes | Caller must **own** the workspace |
| `recipientEmail` | yes | Read it back to the person letter for letter first |
| `recipientEmailConfirmed` | yes | Must be `true`. Your attestation that they confirmed the spelling. Refused with `recipient_email_unconfirmed` otherwise |
| `recipientName` | no | For the greeting |
| `note` | no | Up to 500 characters of plain text from the person, shown above the instructions |

Emails the link with instructions, from Extuitive. Only an `active` link can be emailed, at
most 3 times. Returns `shareLinkId`, `sentTo`, `sentAt`, `sendCount`, `expiresAt`. The URL is
not returned. Do not send one link to two people — make a second link.

### Share link lifecycle

| Status | Means | Terminal |
| --- | --- | --- |
| `active` | Minted, nobody has confirmed, before `expiresAt` | no |
| `uploading` | Someone confirmed; files are arriving, inside the 24-hour window | no |
| `completed` | Every file in the batch reached a final status. Only a settled batch produces this, never a clock | yes |
| `abandoned` | Claimed, but the window closed with files unfinished. Whatever reached `READY` is in the workspace | yes |
| `expired` | Never used before `expiresAt` | yes |
| `revoked` | The owner cancelled it | yes |

## Library

What the creative index knows about a workspace's bulk-uploaded files. Four read-only tools,
one corpus: files that arrived through an upload on **this** workspace. The server sets that
scope from the workspace itself and no argument widens it; there is no parameter for an ad
account, a tenant, or "include everything". Results never include ad ids or Meta handles.

Indexing is asynchronous and in two steps. A file is *indexed* shortly after it reaches
`READY` — its type, size and duration are known — and *described* a little later, when the
tags, prose and transcript land; for video that second step is tens of seconds after the
first. A fresh upload is normally part-indexed and part-described, and that is what the three
states of `describe_content` and its `annotated` flag are for.

### `describe_content`

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId` | yes | |
| `contentIds` | yes | 1 to 50 `contentId`s, returned in the same order |
| `fields` | no | Replaces the default field set; unknown names are refused with the allowed list |

Returns `count`, `indexed`, `awaitingAnnotation`, `notIndexedYet`, `unknown`, `fields`, and
`results` — one per id:

| State | Also carries | Meaning |
| --- | --- | --- |
| `indexed` | `asset`, `annotated` | The index has read it. `annotated: false` means the description pass is still running: the tags, prose and video fields are absent, not empty |
| `not_indexed_yet` | `uploadStatus` | This workspace's file; the index has not caught up. `REJECTED` / `ABORTED` / `EXPIRED` here means it never will |
| `unknown` | — | Not an upload in this workspace |

Default `asset` fields: `media_type`, `on_screen_text`, `visual_tags`, `holistic_description`,
and on video `duration_seconds`, `transcript_hook`, `hook_holistic_description`,
`hook_on_screen_text`, `audio_type` (`speech` / `music` / `mixed` / `silent`), `has_speech`.
Always present: `asset_sha256`, `content_ids`, `batch_ids`, `uploaded_at`, and the stamps
`annotated` is read from (`annotated_at` on an image, `video_annotated_at` on a video). On
request via `fields`: `transcript`, `foreground_description`, `background_description`,
`hook_visual_tags`, `audio_description`, `spoken_language`, `width`, `height`,
`aspect_bucket`, `file_names`.

The same bytes uploaded twice are one index document with two `content_ids`; both ids get an
entry.

### `group_content_variants`

| Argument | Required |
| --- | --- |
| `workspaceId`, `batchId` | yes |

Returns `count`, `grouped`, `ungroupedNoDimensions`, `notEmbedded`, and `groups`. Each group:
`group_id`, `anchor` (the 1:1 member's hash), `members[]` with `asset_sha256`,
`aspect_bucket`, `file_name`, `is_anchor`, and a trimmed `asset`. A group never mixes a still
with a video. A member of a group of one is only a lone concept if it is *not* in
`notEmbedded`; on a batch uploaded in the last few minutes `notEmbedded` and
`ungroupedNoDimensions` mean the asset record has not caught up with the vector yet, so
group again a minute later.

### `find_similar_content`

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId`, `contentId` | yes | The query is always an upload you hold; never a raw image |
| `k` | no | 1 to 50, default 10 |
| `vectorKind` | no | `asset` (whole creative, default) or `hook` (a video's opening seconds) |
| `batchId` | no | Restrict neighbors to one batch |

Returns `contentId`, `vectorKind`, `count`, `results[]` nearest first with `assetSha256`,
`score`, `mediaType`, `fileName` and `aspectBucket` when the index has them, and `asset`.
The query itself is excluded; its own aspect-ratio siblings score highest.

### `search_content`

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId` | yes | Alone, it means "what have we uploaded", newest first |
| `text` | no | Overlay copy, descriptions, transcripts |
| `hookText` | no | Opening seconds of videos only |
| `tags` | no | `visual_tags` values, matched regardless of case; all must match unless `tagsMatch: "any"` |
| `mediaType` | no | `image` or `video` |
| `uploadedSince` | no | ISO timestamp or date math such as `now-7d` |
| `batchId` | no | One batch |
| `limit` | no | 1 to 100, default 25 |
| `fields` | no | Replaces the per-hit field set; same allowlist as `describe_content` |

Returns `total`, `count`, `sortedBy` (`recent` when there is no text, else `relevance`),
`fields`, `results[]`, and `topTags` — the fifteen most common tags across the matches, which
is the index's vocabulary for this account. Each hit carries the `describe_content` default
set plus `file_names` and `aspect_bucket`, the always-present ids and stamps, `annotated`,
and, under `relevance`, the index's `score`.

## Meta objects

Build and inspect campaigns in the workspace's **one** connected ad account. No tool here
takes an ad account: the workspace resolves to it server-side and every create reports which
one it was as `metaAdAccountId`. Any member may call these — approving a proposal already
releases spend for any member, so submitting one is the same bar.

Everything created here is `PAUSED`. `status` is pinned before the request leaves the server;
an explicit `ACTIVE` is refused with `invalid_request`, and an omitted status is sent as
`PAUSED`. Nothing runs until the customer turns it on in Ads Manager — say so every time.

`params` is Meta's own Graph vocabulary, snake_case, posted verbatim to
`act_<account>/campaigns`, `/adsets`, `/adcreatives`, `/ads` on Graph v26.0. The server checks
only that it is a non-empty object, that it does not carry `access_token` or `account_id`
(reserved; `invalid_request`), that it is under 32 KB (`params_too_large`), and `status`.
Meta validates everything else, so a wrong guess costs a full submit-poll cycle. Nested values
go as real JSON objects and arrays, not strings. Budgets are **minor units as strings**:
`"5000"` is $50.00.

**The direct path repairs nothing.** Three things Meta requires that other paths fill in for
you are yours to supply here:

- `targeting.targeting_automation.advantage_audience` (`1` or `0`) on every ad set, or Meta
  refuses with subcode 1870227.
- `is_adset_budget_sharing_enabled` on a campaign that carries no budget of its own, or
  subcode 4834011.
- `contextual_multi_ads: { "enroll_status": "OPT_OUT" }` on a creative, or Meta enrols it in
  multi-advertiser ads.

### The four creates

`create_meta_campaign`, `create_meta_adset`, `create_meta_adcreative`, `create_meta_ad`. All
take the same arguments beyond `params`:

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId` | yes | |
| `params` | yes | Meta Graph parameters for that edge; see below |
| `summary` | yes | One line, at most 140 characters, for the customer's account history — `"US prospecting ad set, $50/day"` |
| `rationale` | yes | Why, at most 4000 characters. Say what the customer asked for |
| `clientToken` | yes | A value unique to **this** attempt, at most 200 characters; a UUID is ideal. Resending the same token with the same params returns the action already created with `replayed: true`. The same token with different params is `client_token_conflict`. A new object needs a new token |

Each returns immediately with `actionId`, `status: "APPROVED"`, `metaAdAccountId`, and
`replayed` when it was. **`APPROVED` means queued, not created.** Poll `get_meta_action`
until `settled`, then read `createdId`. Do not call the next create until you hold it.

Required by Meta per edge (the schema's `required` means "Meta rejects without it", nothing
more; anything not listed is still passed through):

| Tool | Meta requires | Also worth knowing |
| --- | --- | --- |
| `create_meta_campaign` | `name`, `objective`, `special_ad_categories` (send `[]` when none) | `objective` is ODAX only: `OUTCOME_AWARENESS`, `OUTCOME_TRAFFIC`, `OUTCOME_ENGAGEMENT`, `OUTCOME_LEADS`, `OUTCOME_APP_PROMOTION`, `OUTCOME_SALES`. Legacy values are rejected. `daily_budget` / `lifetime_budget` here is CBO; omit to budget at the ad set, and then set `is_adset_budget_sharing_enabled`. `special_ad_categories` values include `HOUSING`, `EMPLOYMENT`, `FINANCIAL_PRODUCTS_SERVICES` — ask, since declaring wrongly is a policy matter |
| `create_meta_adset` | `name`, `campaign_id`, `optimization_goal`, `billing_event`, `targeting` | `targeting.geo_locations.countries` at minimum, plus `targeting_automation.advantage_audience`. Budget here unless the campaign carries it; `lifetime_budget` needs `end_time`. `bid_amount` is required by `LOWEST_COST_WITH_BID_CAP` and `COST_CAP`; `bid_constraints.roas_average_floor` (ROAS × 10000) only with `LOWEST_COST_WITH_MIN_ROAS` and `optimization_goal: VALUE`. `promoted_object.pixel_id` for conversion goals, from `list_meta_pixels` |
| `create_meta_adcreative` | `object_story_spec` | `object_story_spec.page_id` from `list_meta_pages`; exactly one of `link_data` (image: `image_hash`, `link`, `message`, `name` headline, `description`, `call_to_action`) or `video_data` (`video_id`, `image_url` thumbnail, `message`, `title` headline — note `title`, not `name`). `image_hash` is a `PUBLISHED` row's `metaImageHash`; `video_id` its `metaVideoId`; `image_url` can be `metaVideoThumbUrl`. Optional `instagram_user_id` from `list_meta_instagram_accounts`. For no button, omit `call_to_action` entirely — there is no `NO_BUTTON` value here. `url_tags` without a leading `?` |
| `create_meta_ad` | `name`, `adset_id`, `creative` | `creative` is an object, `{ "creative_id": "..." }`, using the creative's `createdId` |

### `get_meta_action`

| Argument | Required |
| --- | --- |
| `workspaceId`, `actionId` | yes |

The only way to learn whether a create worked. Returns the action row plus `settled`.

| Field | Meaning |
| --- | --- |
| `status` | `APPROVED` (in flight), `EXECUTED` (worked), `FAILED` (Meta refused), `REJECTED` |
| `settled` | `true` on the last three. Poll about every 5 seconds until then; give up after about 5 minutes |
| `createdId` | On `EXECUTED`: the new object's Meta id. What the next create needs |
| `executionResult` | On `EXECUTED`: Meta's full response |
| `errorPayload` | On `FAILED`: Meta's own message. Read it, fix `params`, resubmit with a **new** `clientToken` |
| `rateLimitedUntil` | With `APPROVED`: the ad account is in a Meta rate-limit cool-off and this action is waiting its turn. Keep waiting until then. Never resubmit — it deepens the throttle |

### `list_meta_actions`

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId` | yes | |
| `limit` | no | 1 to 100, default 25 |
| `cursor` | no | `nextCursor` from the previous page |

Everything created through these tools for the workspace, newest first, each row with
`status`, `settled`, and `createdId` where one was created. For recovering a lost `actionId`
or showing what has been built.

### `list_meta_campaigns`, `list_meta_adsets`, `list_meta_ads`

Read live from Meta, so they see objects built in Ads Manager too.

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId` | yes | |
| `name` | no | Substring match applied by Meta across the whole account, not one page |
| `campaignId` | no | On `list_meta_adsets` and `list_meta_ads`. Digits only |
| `adSetId` | no | On `list_meta_ads`. Narrows *together* with `campaignId` |
| `limit` | no | 1 to 100, default 25 |
| `cursor` | no | `nextCursor` from the previous page |

Rows are pickers: `id`, `name`, `status`, `effectiveStatus`, and on an ad `adSetId` and
`campaignId`. `nextCursor` is an empty string when there is no further page. An id from
another account yields an empty page, not that account's objects.

### `get_meta_campaign`, `get_meta_adset`, `get_meta_ad`

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId` | yes | |
| `campaignId` / `adSetId` / `adId` | yes | Digits only, no `act_` |

One object in full: the picker fields plus `config`, Meta's own record in Meta's own field
names, and `cloneParams` — the same object with the members Meta computes already removed
(`id`, `account_id`, `created_time`, `updated_time`, `budget_remaining`, `effective_status`).
To copy an object, submit `cloneParams` as `params`, changing what should differ. Submitting
`config` itself is rejected, because `account_id` is reserved. `cloneParams` deliberately
keeps `campaign_id`, `adset_id` and `creative` — those are yours to decide — and an ad's
`creative` reads as `{ "id": "..." }` where a create takes `{ "creative_id": "..." }`.

`get_meta_adset` is the one to read before copying an ad set; `targeting` alone is why it is
not a field on the list.

### `list_meta_pages`

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId` | yes | |
| `source` | no | `connection` (default) or `ad_account`. Two different questions, not two freshnesses |

The Facebook pages this workspace can run ads as — `object_story_spec.page_id`, the one
creative field you cannot get anywhere else. Returns `workspaceId`, `count`, `source`, and
`pages[]` of `pageId`, `name`, `category`, `verificationStatus`, `tasks` (running ads needs
`ADVERTISE`), and each row's own `source`.

`connection` is the pages captured when the customer connected Meta — the only source that
carries `category`, `verificationStatus` and `tasks`, and it makes no Meta call. When it is
empty the server asks the ad account instead and says so in `source`. `ad_account` asks Meta
which pages *this ad account* may advertise as; rows come back as `promotable`, `assigned`, or
`in-use` — an `in-use` row is an id lifted from a creative the account already runs, so it
has no name but Meta has already accepted it here. Neither source contains the other. If
more than one page comes back, ask which; it is the public identity on the ad. If the page
they expect is under neither, they need `create_meta_reconnect_link` and to grant it.

### `list_meta_pixels`

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId` | yes | |
| `limit`, `cursor` | no | Pages; `nextCursor` empty at the end |

Conversion pixels on the ad account, for `promoted_object.pixel_id`. Rows: `id`, `name`
(may be absent), `lastFiredTime`, `isUnavailable`. Read `lastFiredTime` before choosing — an
account often holds several with only one still receiving events, and an empty
`lastFiredTime` means it has never fired. If more than one is still firing, ask which
conversion they are optimising for.

### `list_meta_instagram_accounts`

| Argument | Required | Notes |
| --- | --- | --- |
| `workspaceId` | yes | |
| `limit`, `cursor` | no | |

Instagram accounts the ad account may advertise as, for `object_story_spec.instagram_user_id`.
Rows: `id`, `username`, `source` (`connected`, or `in-use` from a running creative, which
arrives without a username). Optional: a creative runs on Facebook with `page_id` alone. An
empty list is a real answer, not an error — build with the page alone.

### Action lifecycle

| Status | Means | Settled |
| --- | --- | --- |
| `APPROVED` | Queued or running; with `rateLimitedUntil`, waiting on a Meta cool-off | no |
| `EXECUTED` | Meta created it; `createdId` is the object | yes |
| `FAILED` | Meta refused; `errorPayload` says why | yes |
| `REJECTED` | Refused before reaching Meta | yes |

## Upload status lifecycle

| Status | Final | Counted in `pending` |
| --- | --- | --- |
| `CREATED` | no | yes |
| `UPLOADING` | no | yes |
| `VALIDATING` | no | yes |
| `READY` | **yes** | no |
| `REJECTED` | yes | no |
| `ABORTED` | yes | no |
| `EXPIRED` | no | yes |

`READY` is the only status that means a file uploaded successfully. Poll every 5 seconds, give
up after 5 minutes.

## Meta publish lifecycle

Separate from the upload status, on the same row, and only present on files that were queued
for Meta — by `publishToMeta: true` at batch creation or by `publish_upload_content_to_meta`.

| `metaPublishStatus` | Means | Counted in `metaPublishPending` |
| --- | --- | --- |
| absent | Never queued. `"NONE"` selects these in `list_upload_content` | no |
| `PENDING` | Queued, not started | yes |
| `PUBLISHING` | In progress | yes |
| `PUBLISHED` | Done. The row carries `metaImageHash`, or `metaVideoId` and `metaVideoThumbUrl` — what `create_meta_adcreative` takes | no |
| `FAILED` | Gave up; `metaPublishError` says why. Not terminal upstream — a later publish may still succeed — but nothing retries on its own | no |

`settled` says the upload is done and says nothing about this. Do not wait on
`metaPublishPending` to report an upload; report it separately when the person asked for
Meta. A `FAILED` or absent publish **does block ad creation**: `create_meta_adcreative` takes
`image_hash` or `video_id` from a `PUBLISHED` row and nothing uploads the asset for you, so a
file has to reach `PUBLISHED` — via `publish_upload_content_to_meta`, again for a `FAILED`
one — before it can go into a creative.

## Errors

Refusals come back as a result with `isError: true` and a payload of `{ error, message }`, so
they are yours to read and act on rather than hard failures. Some carry extra fields, noted
below.

### Everywhere

| `error` | Meaning |
| --- | --- |
| `invalid_arguments` | A required argument is missing, empty, or out of range |
| `missing_workspace_id` | `workspaceId` was blank |
| `workspace_access_denied` | Caller is not a member of that workspace |
| `not_workspace_owner` | Caller belongs to the workspace but does not own it. Reconnect and share-link creation, revocation and email are owner-only |
| `internal_error` | Server-side fault; the detail is logged, not returned |

### Uploads

| `error` | Meaning |
| --- | --- |
| `invalid_upload_body` | The `files` manifest was malformed |
| `upload_not_found` | No such content id |
| `upload_signing_unreachable` | Upstream signing service could not be reached |
| `upload_signing_timeout` | Upstream signing service timed out |
| `upload_signing_invalid_json` | Upstream returned something unparseable |
| `upload_signing_unconfigured` | Server is missing its upstream credentials |
| `upstream_{status}` | Upstream error with no more specific code |

### One-time upload links

| `error` | Meaning |
| --- | --- |
| `share_link_not_found` | No such link in this workspace |
| `share_link_name_invalid` | `name` missing, under 3 or over 80 characters |
| `recipient_email_unconfirmed` | `recipientEmailConfirmed` was not `true`. Read the address back and get a yes |
| `recipient_email_invalid` | Not an email address |
| `share_link_email_limit` | Already emailed 3 times. Make a new link |
| `email_send_failed` | The mail did not go, or this link's URL was not stored. Try again, or share the URL from creation directly |
| `share_link_consumed`, `share_link_completed`, `share_link_upload_window_closed`, `share_link_expired`, `share_link_revoked` | Tried to email a link that is no longer `active`; the code names its state |

### Library

| `error` | Meaning |
| --- | --- |
| `too_many_content_ids` | `describe_content` got more than 50 ids; page, do not drop |
| `content_not_indexed_yet` | `find_similar_content`'s query has no vector yet; same as `not_indexed_yet` |
| `workspace_has_no_ad_account` | No Meta ad account on the workspace, so no library to read |
| `library_unconfigured` | Server is not wired to the creative index in this environment |
| `library_unreachable`, `library_timeout`, `library_invalid_json` | The creative index could not be reached or answered badly |
| `library_upstream_error` | The index refused the query; `message` carries its reason, `status` its code |

### Meta objects

| `error` | Meaning | Do |
| --- | --- | --- |
| `invalid_request` | The submission broke a server rule: `params` not an object or empty, a reserved key (`access_token`, `account_id`), `status` other than `PAUSED`, an over-long `summary` / `rationale` / `clientToken`, or an id that is not bare digits | Fix and resubmit |
| `params_too_large` | Serialised `params` over 32 KB | Trim |
| `meta_rejected` | Meta refused the request; carries `metaResponse` | Read it, fix `params`, new `clientToken` |
| `meta_rate_limited` | The ad account is in a Meta cool-off; carries `retryAfterSeconds` | Wait that long. Do not resubmit |
| `client_token_conflict` | This `clientToken` already submitted something different; carries that `actionId` | Poll that action, or use a new token |
| `not_entitled` | No connected ad account, or the subscription lapsed | Terminal. Say so; nothing here will work |
| `workspace_has_multiple_ad_accounts` | The workspace has several ad accounts; carries `metaAdAccountIds` | Terminal here. The person fixes it in Extuitive |
| `meta_not_connected` | No Meta credential on the workspace | `connect` |
| `scope_lookup_unavailable` | The upstream could not read its own table; carries `retryable: true` | Retry in a minute |
| `action_not_found` | No such `actionId` in this workspace | Check `list_meta_actions` |
| `meta_object_not_found` | No such campaign / ad set / ad in **this** ad account. Deliberately does not distinguish "does not exist" from "belongs to another account" | Final. Check the id |
| `agent_session_upstream_unavailable` | Outage upstream or at Meta; carries `retryable: true` | Retry in a minute |

Genuine protocol faults — an unknown tool, malformed JSON-RPC — arrive as JSON-RPC errors
instead, and mean something is wrong with the call itself rather than its arguments.

### `workspace_access_denied` on an id from `list_workspaces`

This happens, and it is not something to solve by reasoning. Membership is re-checked on every
call against the tool being called, so a workspace can appear in the list and still refuse an
upload. Retrying will not change it, and neither `role` nor `isOwner` predicts it.

Say plainly which id was refused and which one worked, and carry on with the one that worked.
If you had already told the person to use the refused one, correct that in the same breath —
they are about to look for their files in a workspace that has none.
