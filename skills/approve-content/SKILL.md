---
name: approve-content
description: Review, edit, approve, or reject pending marketing content drafts in the marketing workspace. Use when the user wants to อนุมัติคอนเทนต์, ตีกลับ/reject a draft, แก้ draft, approve a post for publishing, confirm a failed post actually went live, or list drafts waiting for review.
---

# approve-content — the human review gate

You act on behalf of a human reviewer inside a `/task`. Your job is to read,
edit, and re-stamp Draft files in `drafts/` — **never** post to any social
platform from here. fb-publisher's scheduled run picks up `approved` drafts;
posting sooner is possible with `/schedule run <id>`, which works only for
the schedule's owner or the Operator — anyone else asks them or waits.

A draft's status is solely the value in its frontmatter; when listing by
status, read each file's leading frontmatter, not a whole-file text search.

## Finding drafts

- The user names a draft (full id or a fragment like "fb-01") → match it in
  `drafts/*.md`. Ambiguous fragment → list the matches and ask.
- The user asks "มีอะไรรออนุมัติ" → list all `status: pending-review` drafts:
  id, one-line gist, whether it has an image.
- Only `pending-review` (or `post-failed`, see below) can be approved.
  Anything else: explain its current state instead.

## Edits before approving

If the user asks for changes ("ให้สั้นลง", "เปลี่ยน CTA"): edit the draft
body directly — the body is the exact text that will be posted. Follow the
voice file in `brand/voice/` for that platform. Show the revised full text
in the thread before stamping anything.

Regenerating the image is possible via the `image-gen` skill (browser use in
a task triggers the bot's normal approval button — tell the user to expect
it). Save the new file over `drafts/assets/<draft-id>.png`.

## Approving

1. Know who is approving: use the name the user stated (e.g. "อนุมัติ fb-01
   — โต้"). If no name was given, ask once in the thread and wait.
2. Update frontmatter: `status: approved`, `approved_by: <name>`,
   `approved_at: <now>`. Do not touch the body during the stamp itself.
3. Confirm in Thai: what was approved and that fb-publisher's next scheduled
   run will post it (mention the `/schedule run` option and its
   owner/Operator restriction).

## Rejecting

`status: rejected` + `reject_reason: "<คำติของคน>"` + `rejected_at: <now>`
in frontmatter. Rejected drafts are terminal — content-maker does not rework
them; the human's reason stays on file as guidance for future drafts.

## Resolving a failed post (`status: post-failed`)

The failure may have happened before OR after the post went live, so the
human must check the Facebook Page first. Ask explicitly which case it is:

- **Post is NOT on the Page** → re-approve: clear `error:`, then stamp
  `status: approved` + `approved_by`/`approved_at` as above. fb-publisher
  will make a fresh attempt.
- **Post IS on the Page** → record the truth: `status: posted`,
  `posted_at:` (the actual post time if the user knows it, otherwise now),
  `post_url:` (paste from the user; leave empty with a note in `error:` if
  unavailable), and clear the rest of `error:`. Never re-approve a draft
  whose post is already live — that is how double posts happen.
