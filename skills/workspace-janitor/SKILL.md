---
name: workspace-janitor
description: Archive finished trend and draft files in the marketing workspace and report stuck ones. Use in a scheduled run of the marketing pipeline, or when the user asks to เก็บกวาด workspace, clean up old files, or archive finished pipeline files.
---

# workspace-janitor — archive finished files, report stuck ones

You are the housekeeping stage of the marketing content pipeline. You move
files whose work is DONE into `archive/`, and point humans at files that are
stuck. You never need the browser, never create content, and never post.

**You never edit `calendar/`.** Those files belong to the humans; a
scheduled run has no business rewriting a plan. The one thing you may do
there is move a week that is long over into `archive/` — see step 5.

## Ground rules

- A file's status is SOLELY the value in the frontmatter block at the very
  top of the file — never judge a file by a whole-file text search.
- **Active work is untouchable.** Drafts at `written`, `posting`, or
  `post-failed` are someone's in-flight work — you never archive, edit, or
  re-stamp them, only report. The single exception is the expiry rule in
  step 3: a trend-based draft nobody scheduled in time. (A stale `posting`
  draft is fb-publisher's own safety check, not yours.)
- Never touch `brand/` or `config/`.
- Moving a file keeps its filename unchanged (`archive/<same-name>.md`).

## What to do

1. Read `config/pipeline.md` → `archive_after_days` (call it **N**) and
   `draft_expire_days` (call it **E**). If the file is missing you are in
   the wrong workspace — stop and report.
2. **Trends** in `trends/` older than N days (age = the date in the
   filename):
   - `status: used` or `skipped` → move to `archive/`.
   - `status: new` → a trend nobody used for N days is dead for a virality
     pipeline: set `status: skipped` + `skip_reason: "expired"`, then move
     to `archive/`.
3. **Drafts** in `drafts/`:
   - `status: written` **and `trend:` is not `none`** and older than E days
     (age by `created_at`) → nobody put it in the calendar while it was
     still fresh, and a trend post does not get better with time: set
     `status: rejected`,
     `reject_reason: "expired — ไม่มีใครเลือกลงปฏิทินใน E วัน"` (write the
     actual number), `rejected_at: <now>`. Leave the file in `drafts/`; the
     rule below archives it in its own time. **Never expire a draft with
     `trend: none`** — evergreen content is written to wait — and treat a
     draft whose `trend:` field is missing or empty the same way: retiring
     content nobody meant to retire is the worse mistake, so when in doubt,
     leave it and report it.
   - `status: posted` older than N days (age by `posted_at`) → move to
     `archive/`, and move its image file (the `image:` path, if not `none`)
     along with it.
   - `status: rejected` older than N days (age by `rejected_at`, falling
     back to `created_at`) → same treatment.
   - `status: missed` older than N days (age by `missed_at`, falling back to
     `created_at`) → same treatment: nobody gave it a new Slot in a month,
     so it is over.
4. **Stuck report** (report, never move): drafts older than N days still at
   `post-failed` — nobody resolved them, and only a human can. List them.
   Report the **size of the waiting pool** as one number (`written` drafts
   not in any calendar Slot, evergreen counted apart) — a number, never a
   list: a pool is a healthy state, not a backlog. Also report calendar rows
   whose slot time has passed by more than a day while their draft is still
   `written` — the publisher never saw them, usually a slot written into the
   wrong week's file.
5. **Calendar weeks** in `calendar/`: a file whose `week_end` is older than
   N days → move it to `archive/` unchanged. **Move only — never edit a
   calendar file, and never move one whose week is not fully over.** If any
   draft it points at is still `written`, `posting`, or `post-failed`, leave
   the file where it is and report it instead: unfinished business is not
   archived.
6. **Next week's plan** — you are the only round that runs late every night,
   so you are the early warning. If today is **Friday, Saturday, or Sunday**,
   look for the file of the coming Monday in `calendar/`:
   - missing → report "อาทิตย์หน้ายังไม่มีปฏิทิน — สั่ง `/task
     skill:content-calendar` เพื่อวางแผน"
   - exists but no row has an approver name → report that it is drafted but
     nobody approved it yet, so nothing would go out.
   Never create or edit that file yourself — say it, do not fix it.
7. **Orphan assets** (report, never delete): files in `drafts/assets/` that
   no draft in `drafts/` references — usually debris from a crashed run.

## Reporting

Thai summary in the thread: how many trends/drafts/calendar weeks archived
(with the expired-trend count separated), stuck files needing a human (id +
status + age each), stale calendar rows, next week's plan warning (Fri–Sun),
orphan assets found. A run with
nothing to do reports one short line — that is a healthy outcome, not a
failure.
