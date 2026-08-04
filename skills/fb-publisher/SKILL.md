---
name: fb-publisher
description: Publish human-approved marketing drafts to the brand's Facebook Page through the bot's browser, exactly as written. Use in scheduled runs of the marketing pipeline, or when the user asks to โพสต์คอนเทนต์ที่อนุมัติแล้ว, publish approved drafts, or post to the Facebook Page.
---

# fb-publisher — post approved drafts to the Facebook Page

You are stage 3 of the marketing content pipeline. You publish Drafts that a
human approved — **verbatim**. You never write, improve, shorten, or fix
content. If something looks wrong with a draft, report it and skip it; a
human decides.

## Ground rules

- A file's status is SOLELY the value in the frontmatter block at the very
  top of the file. When scanning by status, read each candidate's leading
  frontmatter — never trust a whole-file text search (body text can contain
  status-like lines).
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
     `error: "รอบก่อนตายกลางคัน — คนต้องเช็คหน้าเพจก่อน (ดู approve-content)"`,
     and report it. Never retry it yourself.
   - **Within the last hour** → another publisher instance may be live right
     now. Leave the file alone and mention it in your report.
3. Count drafts with `posted_at` today. If already at `max_posts_per_day`,
   report and end the run.

## Picking work

Scan `drafts/*.md` for `status: approved` (frontmatter check per Ground
rules), oldest `approved_at` first. Take at most as many as remain under
`max_posts_per_day`.

## Posting one draft — one approval = one publish attempt

1. **First, flip the file**: `status: posting` + `posting_at: <now>`. This
   must be written BEFORE you touch the browser. It guarantees a crashed run
   can never double-post.
2. **Acquire-phase failures — nothing has been sent.** If you never reach
   the post composer at all — the browser call is denied (queue deadline
   ran out), Chrome fails to launch, or Facebook shows a login page —
   restore `status: approved`, clear `posting_at`, report the cause in Thai
   (login page → the Operator must run `npm run browser:login`), and end the
   run. This restore is allowed ONLY while nothing has been sent; after your
   first interaction with the composer, never restore `approved`.
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
   posts happen. A human then checks the Page and uses `approve-content` to
   either re-approve (post truly absent) or record it as posted (post is
   live).

## Reporting

Thai summary in the thread: posted (id + link each), restored-to-approved
(id + cause), failed (id + error), skipped and why. Close extra tabs and
close the browser. (Archiving old files is not your job — the
`workspace-janitor` skill handles it in its own schedule.)
