# `/extuitive build` — build a Meta campaign, ad set, creative and ad

Creates Meta objects in the workspace's connected ad account, one at a time, in order, and
reports the Meta id of each. Also covers looking up what is already there — campaigns, ad
sets, ads, pages, pixels — and copying an existing object.

A brief given with the command — objective, budget, audience, creative — arrives in
`$ARGUMENTS`.

## Read before starting

**This spends real money in a real ad account, later.** Nothing created here runs: every
campaign, ad set and ad is created `PAUSED`, the server pins that, and `ACTIVE` is refused.
But the moment the customer unpauses it in Ads Manager, the budget you set is what it spends
and the audience you set is who sees it. Do not guess at a budget, an audience, or a
destination URL. Ask.

**Every create is asynchronous.** `create_meta_campaign` returns `actionId` and
`status: "APPROVED"`, which means *queued*. The object does not exist yet. You poll
`get_meta_action` until `settled` is `true` and read `createdId` — that is the Meta id, and
the next step needs it. A model that treats a create as synchronous invents an id or carries
on without one and leaves half a campaign in someone's account.

**`params` is Meta's vocabulary, passed through untouched.** Snake_case Graph API fields,
nested values as real objects, budgets in minor units as strings (`"5000"` is $50.00). The
server checks almost nothing about them; Meta does, and a wrong guess costs a full
submit-and-poll cycle. `tools.md` lists what Meta requires per edge and the three things this
route does *not* fill in for you.

**Everything here is scoped to the workspace's one connected ad account.** No tool takes an
ad account. Every id you pass — `campaign_id`, `adset_id`, `page_id` — is bare digits, never
`act_…`.

## 1. Gather what only the customer can decide

Before any tool call, know:

- **Objective** — one of `OUTCOME_AWARENESS`, `OUTCOME_TRAFFIC`, `OUTCOME_ENGAGEMENT`,
  `OUTCOME_LEADS`, `OUTCOME_APP_PROMOTION`, `OUTCOME_SALES`.
- **Budget** — daily or lifetime, at the campaign or the ad set, and how much. A lifetime
  budget needs an end time.
- **Audience** — at minimum which countries; ages and placements if they care.
- **Destination URL** — where the ad sends people. A decision, not a lookup.
- **Copy** — primary text, headline, and whether there is a button.
- **Creative** — which uploaded images or videos. They must be `PUBLISHED` to Meta first;
  `publish.md`.
- **Special ad categories** — whether the ad concerns housing, employment, credit or
  politics. Declaring wrongly is a policy matter, so ask rather than assume `[]`.

Anything they do not say, ask for. Do not fill a budget in from a "reasonable default".

## 2. Look up what you can instead of asking

Use the workspace chosen earlier in the conversation, or `list_workspaces` and ask.

- **The Facebook page** the ad posts as: `list_meta_pages`. `page_id` is the one creative
  field you cannot get from anywhere else. If more than one comes back, **ask which** — it is
  the public identity on their ad. If the page they expect is missing, try
  `source: "ad_account"` (a different question, not a fresher answer); if it is under
  neither, they need to reconnect Meta and grant it — `connect.md`.
- **The pixel** an ad set optimises toward, for conversion objectives: `list_meta_pixels`.
  Read `lastFiredTime` before choosing; an account often has several with one still alive.
  If more than one is still firing, ask which conversion they mean.
- **An Instagram account**, only if they want the ad under their own handle on Instagram:
  `list_meta_instagram_accounts`. An empty list is a real answer — build with the page alone.
- **Existing campaigns, ad sets, ads**, when they want to build inside something they already
  have or copy it: `list_meta_campaigns`, `list_meta_adsets`, `list_meta_ads`. Live from Meta,
  so they see things built in Ads Manager. `name` is a substring filter Meta applies across
  the whole account.
- **The creative handles**: `get_upload_batch_content` with
  `metaPublishStatus: ["PUBLISHED"]`, and read `metaImageHash` or `metaVideoId` (and
  `metaVideoThumbUrl` for a thumbnail) off each row. If the files are not published yet, or a
  row says `FAILED`, that is `publish.md` first, and it needs the person's yes — a creative
  cannot be built without the handle, and nothing here uploads the asset for you.

Say what you found before you build, so a wrong page or a dead pixel is caught while it is
cheap.

## 3. Four cycles, each finished before the next begins

Each cycle is: call the create, poll `get_meta_action` with its `actionId` about every 5
seconds until `settled` is `true`, read `createdId`, carry it into the next. Give up on a
poll after about 5 minutes and say so.

Every create takes the same four fields beyond `params`:

- `summary` — one line for the customer's own account history, at most 140 characters:
  `"US prospecting ad set, $50/day"`.
- `rationale` — why, in a sentence or two. Say what the customer asked for.
- `clientToken` — a value **you invent, unique to this attempt**; a UUID is right. It is what
  makes a retry safe: the same token with the same `params` returns the action already
  created with `replayed: true` instead of creating a second one. Reuse it *only* to retry an
  identical request after an error or a dropped connection. A new object needs a new token,
  and a corrected `params` needs a new token.

### Cycle 1 — `create_meta_campaign`

`params`: `name`, `objective`, `special_ad_categories` (`[]` when none). Add `daily_budget`
or `lifetime_budget` and `bid_strategy` here if the budget lives at the campaign; otherwise
**set `is_adset_budget_sharing_enabled`**, or Meta refuses with subcode 4834011.

Poll. Keep `createdId` as the campaign id.

### Cycle 2 — `create_meta_adset`

`params`: `name`, `campaign_id` (from cycle 1, or `list_meta_campaigns`),
`optimization_goal`, `billing_event`, `targeting`, and the budget unless the campaign carries
it. `targeting` needs `geo_locations.countries` at minimum, **and
`targeting_automation: { "advantage_audience": 1 }`** (or `0` to hold the audience exactly),
or Meta refuses with subcode 1870227. `lifetime_budget` needs `end_time`. Conversion goals
need `promoted_object.pixel_id` and `custom_event_type`.

Poll. Keep `createdId` as the ad set id.

### Cycle 3 — `create_meta_adcreative`

`params`: `name`, `object_story_spec` with `page_id` and exactly one of:

- `link_data` for an image — `image_hash`, `link`, `message` (primary text), `name`
  (headline), `description`, and `call_to_action: { "type": "SHOP_NOW", "value": { "link":
  "..." } }` or no `call_to_action` at all for no button.
- `video_data` for a video — `video_id`, `image_url` (the thumbnail; `metaVideoThumbUrl`),
  `message`, `title` (headline — `title` here, not `name`), `call_to_action`.

Add `contextual_multi_ads: { "enroll_status": "OPT_OUT" }` unless they want multi-advertiser
ads; nothing opts out for you here. `instagram_user_id` in `object_story_spec` only if they
asked for Instagram under their own handle.

Poll. Keep `createdId` as the creative id. A creative has no status; it costs nothing until an
ad references it.

### Cycle 4 — `create_meta_ad`

`params`: `name`, `adset_id` (from cycle 2), `creative: { "creative_id": "<cycle 3 id>" }`.
An object, not a bare id.

Poll. Done.

## 4. Read `get_meta_action` correctly

| You see | Means | Do |
| --- | --- | --- |
| `status: APPROVED`, `settled: false` | In flight | Wait 5 seconds, poll again |
| `APPROVED` with `rateLimitedUntil` | The ad account is in a Meta cool-off; this action is queued behind it | Keep waiting until that time. **Never resubmit** — it deepens the throttle |
| `EXECUTED`, `createdId` | Meta created it | Carry `createdId` forward |
| `FAILED`, `errorPayload` | Meta refused | Read Meta's own message, tell the customer what it said, fix `params`, resubmit with a **new** `clientToken` |
| `REJECTED` | Refused before reaching Meta | Read the message; usually a shape rule |
| `replayed: true` on a create | Your earlier attempt had already landed | Fine. Poll that `actionId`; do not submit again |

Never invent an id, and never move to the next cycle without one.

## Copying something that exists

Read it with `get_meta_campaign`, `get_meta_adset`, or `get_meta_ad`, and submit its
`cloneParams` as your `params`, changing only what should differ. **Use `cloneParams`, not
`config`** — `config` is Meta's record and carries fields Meta computed (`id`, `account_id`,
`created_time`, and so on) that a create refuses; `account_id` in particular is reserved, so
submitting `config` is rejected before it reaches Meta.

Two things `cloneParams` leaves for you to decide: change `campaign_id` or `adset_id` when
the copy belongs somewhere else, and on an ad replace `creative`, because a read gives you
`{ "id": "..." }` and a create takes `{ "creative_id": "..." }`.

`get_meta_adset` is the one to read before copying an ad set; its `targeting` is why it is
not on the list.

## 5. Report

When the chain is done, say what was created with the Meta id of each object, say plainly
that **everything is paused**, and that they turn it on in Ads Manager when they are ready.
Then stop. Do not offer to unpause it; you cannot, and the tools refuse `ACTIVE` even if
asked.

`list_meta_actions` shows everything built through these tools, newest first, with each
action's `status`, `settled`, and `createdId` — for recovering a lost `actionId` or showing
the customer what has been built.

## What can go wrong

| You see | It means | Do |
| --- | --- | --- |
| `invalid_request` naming `status` | You sent something other than `PAUSED` | Omit `status`; it is filled in |
| `invalid_request` naming `account_id` | You submitted `config` instead of `cloneParams`, or added the account yourself | Use `cloneParams`; never pass an account |
| `invalid_request` about an id | An `act_` prefix or a non-numeric id | Bare digits |
| `client_token_conflict` with an `actionId` | That token already submitted different `params` | Poll that action to see what it made, then use a new token |
| `meta_rejected` with `metaResponse` | Meta refused the create synchronously | Read it; fix `params`; new token |
| `meta_rate_limited` with `retryAfterSeconds` | Cool-off | Wait that long. Do not resubmit |
| `not_entitled` | No connected ad account, or the subscription lapsed | Terminal. Say so |
| `workspace_has_multiple_ad_accounts` | The workspace has more than one ad account; these tools refuse to guess | Terminal here. The person fixes it in Extuitive |
| `meta_not_connected` | No Meta credential | `connect.md` |
| `meta_object_not_found` | No such object in **this** ad account — whether it does not exist or belongs to another account is deliberately not told apart | Check the id; it is final |
| `scope_lookup_unavailable`, `agent_session_upstream_unavailable` | Retryable outage | Wait a minute, try once more |
| Subcode 1870227 in `errorPayload` | Missing `targeting_automation.advantage_audience` | Add it |
| Subcode 4834011 in `errorPayload` | Campaign with no budget and no `is_adset_budget_sharing_enabled` | Add it |
| Subcode 1815199 in `errorPayload` | Stale `instagram_user_id` | `list_meta_instagram_accounts` again, or drop it |

## More detail

`tools.md` has every argument, the per-edge `params` table, the action lifecycle, and the
full error vocabulary.
