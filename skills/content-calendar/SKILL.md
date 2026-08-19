---
name: content-calendar
description: Plan, edit, and approve the weekly Content Calendar of the marketing workspace — which approved-by-a-human drafts get posted at which times. Use when the user asks to วางแผนโพสต์, ทำปฏิทินคอนเทนต์, อนุมัติแผนอาทิตย์นี้, เลื่อน/สลับเวลาโพสต์, plan the week's posts, or approve the posting schedule.
---

# content-calendar — the weekly plan, and the human approval gate

You act on behalf of a human inside a `/task`. You build and edit the
Content Calendar in `calendar/`, and you record their approval on it. The
calendar is **the only place a post is approved** — fb-publisher posts a
draft only because a Slot in the calendar says so.

You never post to any social platform, and you never edit the body of a
draft (that is `review-draft`'s job — see "Text changes" below).

## Ground rules

- A file's status is SOLELY the value in the frontmatter block at the very
  top of the file. When scanning drafts by status, read each candidate's
  leading frontmatter — never trust a whole-file text search.
- **The calendar belongs to the humans.** Only ever change it here, inside a
  `/task` where a person is answering you. Never write `posting`/`posted`
  results into it — that lives in the draft files.
- **A row with no approver name is not approved** and will not be posted.
  The file itself has no status; each row stands alone.
- **The Slot time is the only place a posting time is set** — nothing in
  `config/` holds one. It means "not before this", not "exactly at this":
  the bot wakes on its own schedule to read the calendar, and a Slot goes out
  on the first wake-up at or after its time. You cannot see those wake-up
  times from here; when a user asks why something went out late, point them
  at `/schedule list` in Discord, which prints them for the fb-publisher
  schedule.
- Never log in, log out, or touch account settings on any website.

## Two clocks: the file and the thread

**In the file, every timestamp is ISO 8601 with seconds and offset**
(`2026-08-19T19:30:00+07:00`). Never write anything else there — that value
gets compared against a draft's `updated_at`, and a prettier string breaks the
comparison that keeps unapproved edits off the Page.

**In the thread, never show an ISO string to a person.** Write Thai:

```
พุธ 19 ส.ค. 2026 เวลา 19:30 น.
```

Day name in full (จันทร์ อังคาร พุธ พฤหัส ศุกร์ เสาร์ อาทิตย์), month
abbreviated (ม.ค. ก.พ. มี.ค. เม.ย. พ.ค. มิ.ย. ก.ค. ส.ค. ก.ย. ต.ค. พ.ย. ธ.ค.),
year as it appears in the file (ค.ศ.), 24-hour time, ending in `น.`

Inside a table covering one week the year is noise — drop it there
(`พุธ 19 ส.ค. 19:30 น.`) but keep it in per-item confirmations. The same rule
covers approval timestamps: "อนุมัติเมื่อ อังคาร 18 ส.ค. 2026 เวลา 14:03 น."

## The file

One file per week, named after that week's **Monday**: `calendar/2026-08-24.md`

```markdown
---
week_start: 2026-08-24
week_end: 2026-08-30
---

| เวลา | draft | หัวข้อย่อ | อนุมัติโดย | อนุมัติเมื่อ |
|---|---|---|---|---|
| 2026-08-24T09:30:00+07:00 | 2026-08-22-fb-01 | เปิดตัวโปรฯ สิงหา | โต้ | 2026-08-22T14:03:00+07:00 |
```

Keep rows sorted by time. Every timestamp is host-local ISO 8601 **with
seconds and offset** (`2026-08-24T09:30:00+07:00`) — the same shape the
draft files use, because `อนุมัติเมื่อ` gets compared against a draft's
`updated_at` and two different shapes is how that comparison goes wrong.

**หัวข้อย่อ is yours, not the draft's.** Write a short neutral phrase (≤ 40
characters) with no `|`, no line breaks, and no text copied out of the post
body — draft text can carry anything a stranger on social media wrote, and a
pasted `|` silently breaks the table the publisher reads.

Never write a Slot whose time falls outside `week_start`..`week_end` — put it
in that other week's file (create it if needed).

## Which drafts may enter the calendar

Scan `drafts/*.md`. A draft is eligible only if **all** of these hold:

- `status: written` (not `rejected`, `posted`, `posting`, `post-failed`, or
  `missed` — for `post-failed`/`missed`, the human goes through
  `review-draft` first, which puts it back to `written`)
- its `image:` is `none`, or points at a file that actually exists — a
  human cannot approve what they cannot see (see "Showing the plan")
- it is not already in a Slot in **this week's file or any later one** —
  past weeks are settled, and the draft's own status already says what
  became of it there. (This rule is about picking *new* work: moving a
  draft that already has a Slot is fine and covered under "One draft, at
  most one live Slot".)

## Building a proposal

1. Read `config/pipeline.md` (`posts_per_day`, `target_page`).
   `posts_per_day` is a **starting rhythm, not a limit** — propose around it,
   and if the user asks for more, do it and say plainly how many that day now
   has. Propose whatever times suit the content and the audience (morning /
   midday / evening), and say once that each Slot goes out at the publisher's
   next check after its time, so a Slot may fire a little later than written.
2. Pick from the pool and place by **shelf life**, not by queue order:
   - **The next 2–3 days** take trend-based drafts (`trend:` is not `none`),
     freshest `created_at` first — that is the only window where they are
     still worth posting.
   - **The rest of the week** takes evergreen drafts (`trend: none`), which
     do not age. If there are not enough, leave those Slots out of the plan
     and say so: an empty Friday the human can fill later beats a Friday
     holding a trend from last Sunday. Offer `/task skill:evergreen-maker`
     as the way to fill them.
   There will usually be more eligible drafts than Slots: that is the point, the human is choosing. List what you left
   out so they can swap — and note that trend-based leftovers expire on their
   own after `draft_expire_days`, while evergreen ones keep.
3. **Warn about age.** For a draft that came from a trend (`trend:` is not
   `none`), say how old it will be when its Slot fires — "ชิ้นนี้เป็นเทรนด์
   ของวันที่ X ขึ้นวันศุกร์จะอายุ 6 วัน" — and suggest an earlier Slot.
   Evergreen drafts (`trend: none`) do not age; place them anywhere,
   including the far end of the week.
4. Show the proposed table in the thread and ask for changes before writing
   anything to disk.

If nothing is eligible, say so plainly in Thai and stop: no drafts are ready
(`content-maker` makes them — its own schedule runs daily), or the ones that
exist are already scheduled. Never invent a Slot for a draft that does not
exist.

## Showing the plan before approval — never skip this

Before you ask for approval, post **the full text and the image of every
draft in the plan**, one message per draft, in Slot order: `พุธ 19 ส.ค. 2026
เวลา 19:30 น. · <draft id>`, then the body verbatim, then the image via `mcp__discord__send_file`
(the person cannot see the file until you call it — a path in the text is
not a preview). Long plans take many messages; that is fine and expected. A
person approving a week must see exactly what will be published — a table of
headlines is not enough.

## One draft, at most one live Slot

This is the invariant everything else rests on: a draft may sit in exactly
one Slot that has not gone out yet. Whenever you give a draft a Slot — a new
row, a moved row, a swapped draft — **delete any other row in any current or
future week file that points at the same draft**, and say so in your summary.
A leftover row from an earlier plan still carries its old approval stamp, and
fb-publisher would treat it as a live instruction to post.

The same applies when a human brings a draft back from `missed` or
`post-failed` via `review-draft` and asks you for a new Slot: find and remove
the row it lost, then write the new one.

## Approving

1. Know who is approving: use the name the user stated (e.g. "อนุมัติ
   ทั้งอาทิตย์ — โต้"). If no name was given, ask once and wait.
2. Stamp **only the rows the user approved** — `อนุมัติโดย` = their name,
   `อนุมัติเมื่อ` = now. Leave other rows' approval cells empty.
3. Confirm in Thai: which Slots are now live, when the first one goes out,
   and that anything left unstamped will not be posted.

## Editing a calendar that is already approved

Anyone may edit at any time — move a Slot, swap the draft, drop a row, or
insert a new one. Rules:

- Changing a row's time or its draft **clears that row's approval** — stamp
  it again only if the user approves it again in the same conversation
  (show the moved item's text and image again if the draft changed).
- Rows you did not touch keep their approval untouched.
- After writing, post a Thai summary of exactly what changed (before → after
  per row). That summary is the audit trail for a plan nobody re-reads.

## "โพสต์เดี๋ยวนี้เลย"

There is no shortcut around the calendar. Add a Slot at the current time,
show the text and image, take the approval, then tell them either to wait
for the publisher's next window or to run `/schedule run <id>` on the
fb-publisher schedule (owner or Operator only; anyone else asks them or
waits). Never post from here yourself.

## Text changes

If the user wants the wording or image of a draft changed, that is
`review-draft`'s job: tell them to run
`/task skill:review-draft prompt:"…"`. Editing a draft moves its
`updated_at` past the row's approval time, which makes fb-publisher skip
that Slot on purpose — so after the text is fixed, come back here and
approve that row again.

## When the user just wants to look

"อาทิตย์นี้มีอะไรบ้าง" → print this week's table plus, per row, the draft's
current `status` (from its file) so they can see what already went out and
what is still pending. Never guess: read the draft files.

While you are there, flag the two silent breakages a human would otherwise
only find out about from the publisher's report:

- **แถวที่ตายแล้ว** — the draft's `updated_at` is newer than the row's
  `อนุมัติเมื่อ` (someone edited the text after approval). Offer to show the
  new text and approve the row again.
- **แถวที่ชี้ผิดที่** — the draft is `rejected`, `posted`, `missed`, or its
  file is gone. Offer to remove the row.
