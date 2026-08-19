# CLAUDE.md

Discord bot ที่สั่งงาน Claude Agent SDK บนเครื่อง host โดยใช้ Claude subscription token (ไม่ใช่ API key)

## อ่านก่อนแตะโค้ด

- **[CONTEXT.md](./CONTEXT.md)** — glossary ของโปรเจกต์ (Host, Operator, Member, Task, Approval, Risky command, Workspace ฯลฯ) ใช้ศัพท์ตามนี้ทั้งในโค้ดและการคุยงาน อย่าตั้งคำใหม่ที่ความหมายทับกัน
- **[docs/adr/](./docs/adr/)** — การตัดสินใจที่ย้อนกลับยาก ก่อนเปลี่ยนอะไรในสองเรื่องนี้ให้อ่าน ADR ที่เกี่ยวก่อน:
  - [0001](./docs/adr/0001-agent-sdk-with-subscription-token.md) — ทำไมใช้ Agent SDK + subscription token
  - [0002](./docs/adr/0002-permission-model.md) — permission model (allowlist / Approval)
  - [0003](./docs/adr/0003-browser-via-playwright-mcp.md) — Browser ผ่าน Playwright MCP (headed + persistent profile)
  - [0004](./docs/adr/0004-scheduled-runs-use-grants.md) — Scheduled Run ใช้ Grant ตอนสร้างแทน Approval ตอนรัน
  - [0005](./docs/adr/0005-skills-central-folder-via-plugin.md) — Skill โหลดจากโฟลเดอร์กลางระดับบอท ผ่าน plugin ของ SDK
  - [0006](./docs/adr/0006-browser-queue.md) — Browser เข้าคิวรอ (FIFO) แทนการปฏิเสธเมื่อไม่ว่าง
  - [0007](./docs/adr/0007-content-pipeline-md-handoff.md) — Content pipeline ส่งงานข้าม Schedule ด้วยไฟล์ md + คนอนุมัติก่อนโพสต์
  - [0008](./docs/adr/0008-operator-preapproved-browser.md) — Operator ปิด Approval ครั้งแรกของ browser ใน Task ได้ผ่าน config (BROWSER_AUTO_APPROVE)
  - [0009](./docs/adr/0009-office-ui-scope-closed.md) — Office UI ปิดขอบเขตแล้ว: รับเฉพาะบั๊กกับการตามสถานะใหม่ของบอท งานปรับความสวยไม่รับ
  - [0010](./docs/adr/0010-yolo-mode-delete-is-the-only-gate.md) — YOLO_MODE: อนุมัติทุกอย่างยกเว้นคำสั่งลบ (และ Scheduled Run ลบไม่ได้เลย)
  - [0011](./docs/adr/0011-content-calendar-time-driven-publishing.md) — Content Calendar: ขั้นสุดท้ายของ pipeline อิงเวลาที่คนวางไว้ (แก้ ADR 0007 บางส่วน)
  - [0012](./docs/adr/0012-scheduled-runs-always-have-browser.md) — เลิก browser grant: Scheduled Run ใช้ browser ได้เสมอ (แก้ ADR 0004 บางส่วน)

## คำสั่ง

```sh
npm run dev        # รันบอทแบบ watch (tsx)
npm run build      # compile ลง dist/
npm run typecheck  # tsc --noEmit
npm test           # unit tests (policy, browser-queue, session-registry, recurrence, scheduler, skills, store, agent-session, bot, orphan-sweep, render, status-reconcile, src/office/feed.test.ts, src/office/snapshot.test.ts, src/office/server.test.ts, office/app/layout.test.js, office/app/state.test.js)
npm run doctor     # เช็ค env/config ว่าพร้อมรัน
npm run browser:login  # เปิด Chrome ด้วย profile ของบอท ให้ Operator ล็อกอินเว็บครั้งแรก
npm run workspace:init # สร้าง workspace ของ content pipeline ที่ DEFAULT_WORKSPACE (ADR 0007)
npm run test:browser   # เช็คว่า login ที่ทำผ่าน browser:login บอทอ่านเห็นจริง (ต้องมี Chrome)
```

## ข้อควรระวัง

- `src/policy.ts` คือหัวใจความปลอดภัย (allowlist คำสั่งอ่านล้วน + เกณฑ์ Risky command) — แก้เมื่อไรต้องรัน `npm test` เสมอ และถ้าเพิ่มคำสั่งเข้า allowlist ต้องแน่ใจว่ามันเขียน/รันโค้ดไม่ได้จริง ๆ (ดูเคสที่เคยปิดรูใน git log)
- config มาจาก `.env` (ห้าม commit) ผ่าน `src/config.ts` — เพิ่ม env ใหม่ให้ validate ผ่าน helper ที่มีอยู่ที่นั่น (`required`/`positiveInt`/`list`) และอย่าลืมเพิ่มลง `.env.example` กับตารางใน README ด้วย
- ทุกการเปิด browser ต้องผ่าน `src/browser.ts` ที่เดียว (ทั้งของ Agent และของ Operator ตอนล็อกอิน) — เปิด Chrome เองตรง ๆ จะได้ profile ที่ล็อกอินแล้วแต่บอทมองไม่เห็น ดูเหตุผลใน ADR 0003
- แก้พฤติกรรมที่กระทบสิทธิ์ผู้ใช้ (ใครสั่งอะไรได้ ต้อง Approval ไหม) = ต้องสอดคล้องกับ ADR 0002 หรือไม่ก็เขียน ADR ใหม่
- โฟลเดอร์ `skills/` คือ instruction ที่ฉีดเข้า Agent ทุก session โดยไม่มีใครรีวิวซ้ำ (ADR 0005) — Operator เท่านั้นที่วางไฟล์ได้ อย่าเพิ่มช่องทางติดตั้ง skill ผ่าน Discord โดยไม่เขียน ADR ใหม่
- Office UI เป็น read-only ตาม ADR 0002 — ห้ามเพิ่ม endpoint ที่สั่งงานหรือเปลี่ยน bind address โดยไม่เขียน ADR ใหม่ (และอัปเดตรายชื่อ test ในบล็อกคำสั่ง `npm test`)
