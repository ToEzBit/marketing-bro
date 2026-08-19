---
name: review-draft
description: Review, edit, reject, or unblock individual marketing content drafts in the marketing workspace. Use when the user wants to แก้ draft, ตีกลับ/reject a draft, ดูว่ามี draft อะไรบ้าง, regenerate a draft's image, or resolve a draft whose post failed or missed its slot. Scheduling and approving posts is content-calendar's job, not this one.
---

# review-draft — the per-draft workbench

You act on behalf of a human inside a `/task`. You read, edit, and re-stamp
Draft files in `drafts/` — you **never** post to any social platform, and
you **never** decide when something goes out. Timing and approval live in
the Content Calendar (`/task skill:content-calendar`); a draft you fix here
still needs a Slot there before it can be published.

A draft's status is solely the value in its frontmatter; when listing by
status, read each file's leading frontmatter, not a whole-file text search.

## Finding drafts

- The user names a draft (full id or a fragment like "fb-01") → match it in
  `drafts/*.md`. Ambiguous fragment → list the matches and ask.
- "มี draft อะไรบ้าง" → list drafts at `status: written`: id, one-line gist,
  whether it has an image. Mention which of them already sit in a calendar
  Slot (check `calendar/*.md`) so the user does not double-book one.

## Editing a draft

The body is the exact text that will be posted. Follow the voice file in
`brand/voice/` for that platform, show the revised full text in the thread,
and then:

- Write the new body **and set `updated_at: <now>`** — always, every edit.
  This is what stops a version nobody read from going live: fb-publisher
  skips any Slot whose approval is older than the draft's `updated_at`.
- Tell the user plainly that the edit **unapproved** any Slot this draft is
  in, and that they need `content-calendar` to approve that row again.

Regenerating the image is possible via the `image-gen` skill (browser use in
a task triggers the bot's normal approval button — tell the user to expect
it). Save the new file over `drafts/assets/<draft-id>.png` and treat it as
an edit: bump `updated_at` and say the Slot needs re-approval.

## Rejecting

`status: rejected` + `reject_reason: "<คำติของคน>"` + `rejected_at: <now>`.
Rejected drafts are terminal — content-maker does not rework them; the
human's reason stays on file as guidance for future drafts. A draft whose
`reject_reason` starts with "expired" was retired by `workspace-janitor`,
not by a person: same rule, it is over. If the draft is
in a calendar Slot, say so: the row has to be removed with
`content-calendar`, or fb-publisher will report it as a broken Slot.

## Unblocking a draft that did not go out

**`status: missed`** — its Slot's day passed without the post going up. The
content is untouched and fine: set `status: written`, clear `missed_at`, and
leave `updated_at` alone (nothing about the text changed). Tell the user to
give it a new Slot with `content-calendar`, which also clears the row it
lost — a stale approved row pointing at a draft that is `written` again is
exactly how a post escapes its plan.

**`status: post-failed`** — the failure may have happened before OR after
the post went live, so the human must check the Facebook Page first. Ask
explicitly which case it is:

- **Post is NOT on the Page** → clear `error:`, set `status: written`, and
  send them to `content-calendar` for a fresh Slot.
- **Post IS on the Page** → record the truth: `status: posted`, `posted_at:`
  (the actual post time if the user knows it, otherwise now), `post_url:`
  (paste from the user; leave empty with a note in `error:` if unavailable),
  and clear the rest of `error:`. Never send a draft whose post is already
  live back for another attempt — that is how double posts happen.

**`status: posting` older than an hour** — a run died mid-post. Do not touch
it here; fb-publisher's own housekeeping flips it to `post-failed` on its
next round, and then the rule above applies.
