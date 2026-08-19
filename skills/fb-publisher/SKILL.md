---
name: fb-publisher
description: Publish the marketing drafts that the Content Calendar says are due to the brand's Facebook Page, exactly as written. Use in scheduled runs of the marketing pipeline, or when the user asks to โพสต์ตามปฏิทิน, publish what is due now, or post to the Facebook Page.
---

# fb-publisher — post what the calendar says is due

You are the publishing stage of the marketing content pipeline. You publish
Drafts that a human scheduled and approved in the Content Calendar —
**verbatim**. You never write, improve, shorten, or fix content, and you
never decide what goes out: the calendar decides. If something looks wrong,
report it and skip it; a human decides.

## Ground rules

- A file's status is SOLELY the value in the frontmatter block at the very
  top of the file. When scanning by status, read each candidate's leading
  frontmatter — never trust a whole-file text search.
- **Never write to `calendar/`.** Those files belong to the humans; your
  side of the world is `drafts/`. Everything you need to record has a home
  in the draft file.
- Never log in, log out, or touch account settings — the accounts in the
  browser profile belong to the Operator.
- Prefer scheduled runs. If asked to run inside a `/task` while the
  scheduled publisher might also fire, suggest `/schedule run <id>` instead
  (works for the schedule's owner or the Operator; others should ask them or
  wait) — two publishers at once is how double posts happen.

## Before you start

1. Read `config/pipeline.md`. If it is `status: unfilled` or `target_page`
   is empty: stop and report in Thai that the target Page must be filled in.
2. Housekeeping (no browser needed): a draft at `status: posting` — check
   its `posting_at`:
   - **Older than 1 hour** → that run died mid-post. Set
     `status: post-failed`,
     `error: "รอบก่อนตายกลางคัน — คนต้องเช็คหน้าเพจก่อน (ดู review-draft)"`,
     and report it. Never retry it yourself.
   - **Within the last hour** → another publisher instance may be live right
     now. Leave the file alone and mention it in your report.

## Reading the calendar

Open the week file covering **today** — `calendar/<that week's Monday>.md`
(e.g. today 2026-08-26 → `calendar/2026-08-24.md`). Also open the file
covering **yesterday** when that is a different file (i.e. today is Monday),
because yesterday's leftovers still need closing out.

**No file for this week → report it in Thai every round** ("ยังไม่มีปฏิทิน
ของสัปดาห์นี้ — สั่ง `/task skill:content-calendar` เพื่อวางแผน") and end the
round. **List the filenames that do exist in `calendar/` in that report**: if
you got the week's Monday wrong, that list is the only thing that will show
it — otherwise a date slip looks exactly like "nobody planned anything". Silence here is indistinguishable from "nothing planned", and that is
the failure this report exists to prevent.

## Picking work

From those rows, in time order, earliest first:

**Due now** — the row's time is **today** and is **at or before the current
time** (a row at 09:30 is due in the 09:30 round — do not make it wait for
the next one). Post it only if every one of these holds; otherwise skip it
and report the reason:

- the row has an approver name in `อนุมัติโดย` (empty = not approved)
- the draft file exists and is `status: written`
- the draft's `updated_at` is **not newer** than the row's `อนุมัติเมื่อ`
  (newer means the text changed after the human approved it — report it as
  "เนื้อหาถูกแก้หลังอนุมัติ ต้องให้คนอนุมัติแถวนั้นใหม่")
- if `image:` is set and not `none`, that file exists

**Missed** — the row's time is on an **earlier day** and its draft is still
`status: written`: the day is over, so it does not go out. Set the draft to
`status: missed` + `missed_at: <now>` and report it. Never post a Slot from a
previous day.

**Already handled** — the draft is `posted`, `rejected`, `missed`,
`post-failed`, or `posting`: leave it alone. Mention `rejected` and
`post-failed` rows in the report (a row still pointing at them means the
calendar and the drafts disagree, and a human should clean it up).

A row whose draft **file does not exist at all** has nowhere to be stamped —
report it every round until a human fixes the calendar.

There is no daily cap here. The calendar is the plan a human approved; if
they scheduled four posts today, four posts go out.

## Posting one draft — one approval = one publish attempt

1. **First, flip the file**: `status: posting` + `posting_at: <now>`. This
   must be written BEFORE you touch the browser. It guarantees a crashed run
   can never double-post.
2. **Acquire-phase failures — nothing has been sent.** If you never reach
   the post composer at all — the browser call is denied (queue deadline
   ran out), Chrome fails to launch, or Facebook shows a login page —
   restore `status: written`, clear `posting_at`, **leave the calendar row
   untouched** (it stays approved, so a later round today can pick it up
   again), report the cause in Thai (login page → the Operator must run
   `npm run browser:login`), and end the round. This restore is allowed ONLY
   while nothing has been sent; after your first interaction with the
   composer, never restore it.
3. Go to the Page named in `target_page` and make sure you are posting **as
   the Page**, not as the personal profile (the composer shows which
   identity is posting — switch if needed).
4. Create the post: paste the draft body **exactly, character for
   character**. If `image:` is set and is not `none`, attach the file at
   that workspace path (`drafts/assets/…`) via the file-upload browser tool.
   Publish.
5. Confirm the post is live on the Page and copy its permalink.
6. Update the draft file: `status: posted`, `posted_at`, `post_url`. If the
   post is confirmed live but the permalink cannot be captured (UI changed),
   still stamp `status: posted` with `post_url:` empty and note the missing
   link in `error:` — `post-failed` is only for uncertainty about whether
   the post exists.
7. If anything fails after reaching the composer and you are not certain the
   post is NOT live: `status: post-failed` + `error:` describing exactly
   where it stopped. Do not retry, do not refresh-and-resubmit —
   resubmitting when the first attempt actually went through is how double
   posts happen. A human then checks the Page and uses `review-draft` to
   either send it back for a new Slot (post truly absent) or record it as
   posted (post is live).

## Reporting

Write times for people in Thai, never as ISO strings —
`พุธ 19 ส.ค. 2026 เวลา 19:30 น.` (the ISO form belongs in the files, not in a
sentence someone reads).

Thai summary in the thread: posted (id + time slot + link each), restored
(id + cause), missed (id + which slot it lost), failed (id + error), skipped
and why, and calendar rows that point at nothing. Close extra tabs and close
the browser. (Archiving old files is not your job — the `workspace-janitor`
skill handles it in its own schedule.)
