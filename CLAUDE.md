# CLAUDE.md

Discord bot ที่สั่งงาน Claude Agent SDK บนเครื่อง host โดยใช้ Claude subscription token (ไม่ใช่ API key)

## อ่านก่อนแตะโค้ด

- **[CONTEXT.md](./CONTEXT.md)** — glossary ของโปรเจกต์ (Host, Operator, Member, Task, Approval, Risky command, Workspace ฯลฯ) ใช้ศัพท์ตามนี้ทั้งในโค้ดและการคุยงาน อย่าตั้งคำใหม่ที่ความหมายทับกัน
- **[docs/adr/](./docs/adr/)** — การตัดสินใจที่ย้อนกลับยาก ก่อนเปลี่ยนอะไรในสองเรื่องนี้ให้อ่าน ADR ที่เกี่ยวก่อน:
  - [0001](./docs/adr/0001-agent-sdk-with-subscription-token.md) — ทำไมใช้ Agent SDK + subscription token
  - [0002](./docs/adr/0002-permission-model.md) — permission model (allowlist / Approval)
  - [0003](./docs/adr/0003-browser-via-playwright-mcp.md) — Browser ผ่าน Playwright MCP (headed + persistent profile)

## คำสั่ง

```sh
npm run dev        # รันบอทแบบ watch (tsx)
npm run build      # compile ลง dist/
npm run typecheck  # tsc --noEmit
npm test           # policy tests (src/policy.test.ts)
npm run doctor     # เช็ค env/config ว่าพร้อมรัน
npm run browser:login  # เปิด Chrome ด้วย profile ของบอท ให้ Operator ล็อกอินเว็บครั้งแรก
npm run test:browser   # เช็คว่า login ที่ทำผ่าน browser:login บอทอ่านเห็นจริง (ต้องมี Chrome)
```

## ข้อควรระวัง

- `src/policy.ts` คือหัวใจความปลอดภัย (allowlist คำสั่งอ่านล้วน + เกณฑ์ Risky command) — แก้เมื่อไรต้องรัน `npm test` เสมอ และถ้าเพิ่มคำสั่งเข้า allowlist ต้องแน่ใจว่ามันเขียน/รันโค้ดไม่ได้จริง ๆ (ดูเคสที่เคยปิดรูใน git log)
- config มาจาก `.env` (ห้าม commit) ผ่าน `src/config.ts` — เพิ่ม env ใหม่ให้ validate ด้วย zod ที่นั่น
- ทุกการเปิด browser ต้องผ่าน `src/browser.ts` ที่เดียว (ทั้งของ Agent และของ Operator ตอนล็อกอิน) — เปิด Chrome เองตรง ๆ จะได้ profile ที่ล็อกอินแล้วแต่บอทมองไม่เห็น ดูเหตุผลใน ADR 0003
- แก้พฤติกรรมที่กระทบสิทธิ์ผู้ใช้ (ใครสั่งอะไรได้ ต้อง Approval ไหม) = ต้องสอดคล้องกับ ADR 0002 หรือไม่ก็เขียน ADR ใหม่
