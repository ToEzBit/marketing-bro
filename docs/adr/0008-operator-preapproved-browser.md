# 0008 — Operator ปิด Approval ครั้งแรกของ browser ใน Task ได้ผ่าน config

Status: accepted (2026-08-04)

## Context

หลังใช้ content pipeline (ADR 0007) จริง Operator พบ friction ซ้ำ ๆ ในการสั่งงานผ่าน `/task`: ทุก Task ที่แตะ browser ต้องกดปุ่ม Approval หนึ่งครั้ง (กติกา ADR 0003) และคำสั่งจัดการไฟล์อย่าง `cp` รูปจาก `.browser-output/` ต้องอนุมัติทุกครั้ง ทั้งที่ deployment ปัจจุบันเป็น **operator คนเดียว** (`ALLOWED_USER_IDS` ว่าง) — คนกดอนุมัติกับคนสั่งงานคือคนเดียวกัน การอนุมัติตัวเองจึงเป็น friction ล้วนไม่ใช่การควบคุม

## Decision

- เพิ่ม env `BROWSER_AUTO_APPROVE` (ค่าเริ่มต้น **ปิด**) — เมื่อเปิด Task ปกติจะข้าม Approval ครั้งแรกของ browser: ตัดสินเหมือน Task นั้นถูกอนุมัติ browser ไว้แล้ว จากนั้นเข้าคิว FIFO ตาม ADR 0006 ตามเดิม
- **สอง tool ที่ทะลุจาก browser มาแตะเครื่อง Host ยังขอ Approval ทุกครั้งเหมือนเดิมไม่ว่า flag จะเปิดหรือปิด**: `browser_file_upload` และ `browser_run_code_unsafe` (เหตุผลเดิมของ ADR 0003 ไม่เปลี่ยน)
- Scheduled Run ไม่เกี่ยวกับ flag นี้ — ใช้ Grant ตาม ADR 0004 เหมือนเดิม
- ฝั่งคำสั่งไฟล์ ไม่แก้ policy — ใช้กลไก `EXTRA_BASH_ALLOW` ที่มีอยู่ (Operator เติม `cp,mv,mkdir,date` เองใน `.env` ตามที่ยอมรับความเสี่ยงได้)

## Considered Options

- **แก้ default ใน policy เลย (ไม่มี flag)** — ถูกปัดตก: deployment อื่นที่มีหลาย Member ยังต้องการด่านนี้ ค่าเริ่มต้นต้องปลอดภัยไว้ก่อน
- **ใช้ปุ่ม "อนุมัติและจำไว้"** — มีอยู่แล้วแต่จำแค่ช่วงอายุ session (โดน idle reap ทุก 30 นาที) แก้ friction ไม่ขาด
- **สั่งงานผ่าน Schedule + `/schedule run` แทน /task** — ใช้ได้และไม่ต้องแก้อะไร แต่บังคับเปลี่ยนวิธีใช้เพื่อเลี่ยงข้อจำกัดของเครื่องมือ ถือว่าแก้ปลายเหตุ

## Consequences

- ⚠️ เมื่อเปิด flag: **ทุก Member ใน allowlist ใช้ browser (บัญชีที่ล็อกอินค้างของ Operator) ได้ทันทีโดยไม่มีด่านถาม** — วันนี้ไม่มีผลเพราะ operator คนเดียว แต่**ต้องทบทวน flag นี้ก่อนเพิ่มคนใน `ALLOWED_USER_IDS` ทุกครั้ง**
- `EXTRA_BASH_ALLOW` ที่เติม `cp`/`mv`/`mkdir` เจาะข้อ "เขียนนอก Workspace ต้องขออนุมัติ" ของ ADR 0002 ผ่านทาง Bash (Write/Edit ยังถูกกั้นตามเดิม) — Operator รับความเสี่ยงนี้โดยรู้ตัว บนหลักเดียวกับที่การอ่านไม่จำกัด path อยู่แล้ว
- README ส่วนความปลอดภัยอัปเดตให้สะท้อนทั้งสองข้อนี้แล้ว
