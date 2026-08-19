---
name: evergreen-maker
description: Write evergreen (non-trend) marketing drafts from a human brief — product posts, promotions, how-tos, reviews — into the marketing workspace, ready to be scheduled. Use when the user asks to ทำคอนเทนต์เรื่อง…, เขียนโพสต์แนะนำสินค้า, ทำโพสต์โปรโมชัน, or write posts that are not tied to a trend.
---

# evergreen-maker — drafts from a brief, not from a trend

You work inside a `/task` with a person answering you. You turn what they
ask for into Draft files in `drafts/`, in exactly the same format
`content-maker` uses — so they flow through the rest of the pipeline
unchanged. You never post to social media, and you never schedule anything:
a human puts drafts into the Content Calendar with `content-calendar`.

The difference from `content-maker`: your input is a **brief from a person**,
not a Trend file. Your output does not go stale, so it can sit in the pool
until someone picks it.

## Ground rules

- A file's status is SOLELY the value in the frontmatter block at the very
  top of the file.
- **Never overwrite an existing draft file** — number NN onward from the
  highest one for that date and platform.
- Never invent brand facts. If the brief needs a detail you cannot find in
  `brand/`, ask the person rather than guessing — a confident wrong claim
  about a product is worse than a question.
- Never log in, log out, or touch account settings on any website.

## Preconditions — check first, stop politely if not met

Read `config/pipeline.md`, `brand/brand.md`, `brand/products.md`, and
`brand/voice/<platform>.md` for the platform you are writing for. If any of
those is `status: unfilled` or missing: stop and report in Thai which files
need filling.

## Getting the brief

Use what the person said. If it is vague ("ทำคอนเทนต์หน่อย"), ask once for
the angle and how many pieces — and offer concrete options drawn from
`brand/products.md` and the ข้อห้าม in `brand/brand.md`, so they can just
pick. Do not start writing until you know the topic and the count.

Each piece needs one idea. Three posts about the same product should differ
in angle (problem → solution, customer proof, how-to), not in wording.

## Writing a draft

One file per piece, same as content-maker:
`drafts/<YYYY-MM-DD>-<platform-short>-<NN>.md` (`fb`, `x`, `tt`; the
filename without `.md` is the draft id). **The entire body after the
frontmatter is the exact post text**, published verbatim — meta notes live
in frontmatter.

```markdown
---
id: 2026-08-19-fb-03
created_at: 2026-08-19T15:40:00+07:00
updated_at: 2026-08-19T15:40:00+07:00   # bump this on EVERY later edit to the body
platform: facebook
trend: none                 # evergreen — this is what marks it as not perishable
brief: "<what the person asked for, in one line>"
status: written
image: drafts/assets/2026-08-19-fb-03.png   # workspace-relative, or: none
image_prompt: "<the prompt used to generate the image>"
rationale: "<one line: the angle you took and why>"
posting_at:
posted_at:
post_url:
error:
---
<ตัวข้อความโพสต์จริงทั้งหมด — เขียนตามเสียงแบรนด์ใน brand/voice/ ของแพลตฟอร์มนั้น>
```

## Images

Follow the same rules `content-maker` uses: build the prompt from the
finished post (one concrete scene showing its key message), apply
`brand/visual.md`, write the prompt in English, no text inside the image,
and record it in `image_prompt`.

Generate with the `image-gen` skill — **in a `/task` the first browser use
pops the bot's approval button, so tell the person to expect it** and that
the browser may queue behind a scheduled run. Copy the exact downloaded file
path for THIS image to `drafts/assets/<draft-id>.png` before generating the
next one; never pick from `.browser-output/` by newest-first. If generation
fails, still save the draft with `image: none` and say so.

More than ~4 images in one task means holding the browser a long time —
offer to do the rest in a second task instead of queueing them all.

## Preview — mandatory for every draft

For each draft: the id, the **full post text** (not a summary), and the
image via `mcp__discord__send_file`. Then say what happens next: nothing is
posted until a human gives it a Slot with
`/task skill:content-calendar prompt:"…"` — and that command must be typed
in a main channel.

## Reporting

Thai summary: drafts created (id + one-line gist each), anything you had to
ask about and how it was resolved, images that failed. Close the browser if
you opened it.
