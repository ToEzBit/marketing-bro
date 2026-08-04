---
name: workspace-janitor
description: Archive finished trend and draft files in the marketing workspace and report stuck ones. Use in a scheduled run of the marketing pipeline, or when the user asks to เก็บกวาด workspace, clean up old files, or archive finished pipeline files.
---

# workspace-janitor — archive finished files, report stuck ones

You are the housekeeping stage of the marketing content pipeline. You move
files whose work is DONE into `archive/`, and point humans at files that are
stuck. You never need the browser, never create content, and never post.

## Ground rules

- A file's status is SOLELY the value in the frontmatter block at the very
  top of the file — never judge a file by a whole-file text search.
- **Active work is untouchable.** Drafts at `pending-review`, `approved`,
  `posting`, or `post-failed` are someone's in-flight work — you never
  archive, edit, or re-stamp them, only report. (A stale `posting` draft is
  fb-publisher's own safety check, not yours.)
- Never touch `brand/` or `config/`.
- Moving a file keeps its filename unchanged (`archive/<same-name>.md`).

## What to do

1. Read `config/pipeline.md` → `archive_after_days` (call it N). If the file
   is missing you are in the wrong workspace — stop and report.
2. **Trends** in `trends/` older than N days (age = the date in the
   filename):
   - `status: used` or `skipped` → move to `archive/`.
   - `status: new` → a trend nobody used for N days is dead for a virality
     pipeline: set `status: skipped` + `skip_reason: "expired"`, then move
     to `archive/`.
3. **Drafts** in `drafts/`:
   - `status: posted` older than N days (age by `posted_at`) → move to
     `archive/`, and move its image file (the `image:` path, if not `none`)
     along with it.
   - `status: rejected` older than N days (age by `rejected_at`, falling
     back to `created_at`) → same treatment.
4. **Stuck report** (report, never move): drafts older than N days still at
   `pending-review` (no one reviewed), `approved` (never got posted), or
   `post-failed` (no one resolved) — list them so a human decides.
5. **Orphan assets** (report, never delete): files in `drafts/assets/` that
   no draft in `drafts/` references — usually debris from a crashed run.

## Reporting

Thai summary in the thread: how many trends/drafts archived (with the
expired-trend count separated), stuck files needing a human (id + status +
age each), orphan assets found. A run with nothing to do reports one short
line — that is a healthy outcome, not a failure.
