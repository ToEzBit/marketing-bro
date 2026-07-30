# 0001 — ใช้ Claude Agent SDK + subscription OAuth token (ไม่ใช้ Claude API โดยตรง)

Status: accepted (2026-07-30)

## Context

บอทต้องสั่งงานคอมพิวเตอร์เครื่อง host ได้แบบ Claude Code และข้อบังคับสำคัญที่สุดคือต้องใช้ Claude subscription plan (Max) ไม่ใช่ API แบบจ่ายตามการใช้งาน ทางเลือกที่พิจารณา:

1. **Claude API + tool use (เขียน harness เอง)** — ยืดหยุ่นสุด แต่ใช้ subscription ไม่ได้ (ต้องใช้ API key จ่ายตามโทเค็น) และต้องสร้าง tools อ่าน/เขียนไฟล์/รัน shell เองทั้งหมด
2. **Managed Agents** — Anthropic รัน sandbox ให้ แต่รันบน cloud ไม่ใช่เครื่อง host ของเรา และใช้ subscription ไม่ได้
3. **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) — ได้ harness ของ Claude Code ครบ (Read/Write/Edit/Bash/Glob/Grep/WebSearch + permission system) รันบนเครื่องเราเอง และ auth ด้วย `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN` ซึ่งใช้โควต้า subscription ได้

## Decision

ใช้ **Claude Agent SDK (TypeScript)** + **`CLAUDE_CODE_OAUTH_TOKEN`** จาก `claude setup-token` (ต้องมี Pro/Max, token อายุ 1 ปี)

## Consequences

- ✅ ตอบโจทย์ subscription เป็นข้อบังคับหลัก และได้ tools + permission callback (`canUseTool`) ฟรี ไม่ต้องเขียน harness เอง
- ✅ Cross-platform: Claude Code รองรับ Windows native และ macOS
- ⚠️ ToS: ห้ามเปิดให้บุคคลภายนอกใช้ rate limit ของ subscription — ต้องมี allowlist ของ Discord user ID (ทีมภายในเท่านั้น) ห้ามเปิด public
- ⚠️ Token หมดอายุทุก 1 ปี ต้อง regenerate
- ⚠️ โควต้าเป็นของ subscription เดียว แชร์ทั้งทีม — default model เป็น Sonnet เพื่อประหยัดโควต้า
- ⚠️ ผูกกับ Claude Code harness: ควบคุม loop ละเอียดน้อยกว่าเขียน API เอง (ยอมรับได้ เพราะ use case คือ "Claude Code ใน Discord" ตรง ๆ)
