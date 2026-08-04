---
name: image-gen
description: Generate an image with ChatGPT (chatgpt.com) through the bot's browser and send the image file back to Discord. Use this skill every time the user asks to create, draw, or generate an image, illustration, or thumbnail — in any language (Thai requests like "สร้างรูป", "วาดรูป", "gen รูป" count) and even when they never mention ChatGPT. The image prompt is whatever the user asked for.
---

# image-gen — generate images via ChatGPT in the browser

Generate an image using the bot's real browser (Chrome, with the Operator's
ChatGPT account already logged in): open chatgpt.com → request the image →
wait → download → send the file back into the thread.

**Input:** the image description from the user's task message. If it is short
or vague, you may expand it into a more detailed prompt as long as you stay
faithful to the original intent (never change the subject or style the user
specified). At the end, tell the user the final prompt you used.

## Steps

1. `mcp__browser__browser_navigate` to `https://chatgpt.com/`
   (the first browser use in a Task triggers an Approval prompt in Discord —
   that is normal, just wait for it).
2. `mcp__browser__browser_snapshot` and check the state:
   - Login page / "Log in" button visible → **stop immediately** and tell the
     user the Operator must run `npm run browser:login` and log in to
     chatgpt.com first. Never attempt to log in yourself.
   - Already logged in → for a **new** image, start a **New chat** (so
     leftover chat context cannot bleed into the image). For a revision of an
     image from this task, see "Revising an image" below instead.
3. Type the request into the chat box and send it — lead with an explicit
   image instruction, e.g. `Create an image: <image description>`.
4. Wait until generation truly finishes: use `mcp__browser__browser_wait_for`
   or re-snapshot every ~15 seconds. Generation can take 1–2 minutes — a
   blurry image or a progress indicator means it is still running. Do not
   download early and do not declare failure prematurely.
5. Download the image: hover/click the image and use ChatGPT's download
   button. The file is saved into `.browser-output/` inside the workspace
   automatically. Note the exact saved file path from the download result
   and state it in your report — anything that copies the file later must
   use that exact path, not "the newest file in the folder".
6. Send the image into the thread with `mcp__discord__send_file` (the path of
   the file you just downloaded), with a short caption stating the prompt it
   was generated from. Describing the image in text does not count as sending
   it — the user cannot see the file until you call send_file.
7. Close the browser window (`mcp__browser__browser_close`) once the image is
   downloaded and sent — the ChatGPT conversation is saved in the account, so
   nothing is lost, and revisions can reopen it later.

## Revising an image

When the user asks to change an image generated earlier in this task
("make the hair blue", "same but at night"), do not start a new chat — the
original conversation holds the image context ChatGPT needs:

1. Reopen `https://chatgpt.com/` if the browser was closed (no new approval
   is needed within the same task) and find the conversation — it is the one
   this task created, usually at the top of the sidebar history.
2. Send the change request as a follow-up message in that conversation, then
   wait / download / send the file back exactly as in steps 4–7 above.
3. If the conversation cannot be found, fall back to uploading the saved
   image file from the workspace (`mcp__browser__browser_file_upload` into a
   new chat) and asking for the edit there. Uploading a host file triggers an
   Approval prompt every time — that is by design; wait for it.

## When things go wrong

- **ChatGPT refuses (content policy)** — report the reason to the user
  honestly. Do not rewrite the prompt to evade the policy.
- **Rate limit / "please wait" / plan upgrade required** — relay the message
  the site shows to the user, then end the task.
- **Download button not found** — fallback: open the image full-size and use
  `mcp__browser__browser_take_screenshot` on the image element (lower quality
  than the real file — tell the user it is a screenshot).
- **Browser held by another Task** — your browser call is not stuck: it waits
  in a FIFO queue and proceeds automatically once it reaches the front of the
  line (each holder releases the browser when its turn ends; the thread status
  shows who holds it and your queue position). Keep waiting inside the call —
  never self-retry, never schedule wakeups, and never launch a browser
  yourself through Bash.
- Never log out and never change account settings — the profile and the
  account belong to the Operator.

## Use with Schedules

This skill needs the browser — a Schedule that invokes it must be created
with the browser grant (`/schedule create ... browser:true`), otherwise every
Run will be denied the moment it touches the browser.
