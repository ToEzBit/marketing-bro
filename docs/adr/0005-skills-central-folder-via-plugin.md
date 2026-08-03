# 0005 — Skill โหลดจากโฟลเดอร์กลางระดับบอท ผ่านกลไก plugin ของ SDK

Status: accepted (2026-08-03)

## Context

อยากได้ประสบการณ์แบบ Claude Code: Operator วางโฟลเดอร์ skill (`SKILL.md` + ไฟล์ประกอบ)
แล้วบอท "มี skill ใหม่ให้ใช้เลย" โดยไม่ต้อง restart และไม่ต้องแก้โค้ด

จุดตัดสินใจมีสามเรื่องที่ผูกกัน: skill อยู่ที่ไหน (ผูก Workspace หรือกลางระดับบอท),
ใครติดตั้งได้, และโหลดเข้า Agent SDK ด้วยกลไกไหน (`settingSources` อ่าน
`<cwd>/.claude/skills/` ต่อ Workspace หรือ `plugins` ชี้โฟลเดอร์กลางจากที่ไหนก็ได้)

## Decision

- **โฟลเดอร์กลางระดับบอท** (`skills/` ที่ root ของ repo, override ได้ด้วย `SKILLS_DIR`)
  ทุก Task ทุก Workspace ทุก Run เห็น skill ชุดเดียวกัน — Workspace ของโปรเจกต์นี้
  เปลี่ยนได้ต่อ Task การผูก skill กับ Workspace จะทำให้ต้องวางซ้ำทุกที่
- **Operator ติดตั้งเท่านั้น** — วางโฟลเดอร์บนเครื่อง Host เอง ไม่มี UI ติดตั้งบน Discord
  เพราะ SKILL.md คือชุดคำสั่งที่ฉีดเข้า context ของ Agent ทุกคน: ใครเขียน skill ได้
  ก็ชี้นำพฤติกรรม Agent ของทั้งทีมได้ จึงสงวนไว้ที่คนที่คุมเครื่องอยู่แล้ว
- **format มาตรฐาน Claude Code** (`skills/<ชื่อ>/SKILL.md` + frontmatter `name`/`description`)
  — skill จาก ecosystem หยิบมาวางได้ทั้งโฟลเดอร์โดยไม่ต้องแปลง
- **โหลดผ่าน `plugins` ของ SDK ไม่ใช่ `settingSources`** — `settingSources: ["project"]`
  อ่านจาก cwd ซึ่งเป็น Workspace (ต่อ Task) ส่วน plugin ชี้พาธกลางที่เดียวได้
  SDK ต้องการโครง plugin (`.claude-plugin/plugin.json` + `skills/`) บอทจึง generate
  scaffold ไว้ใน `.state/skills-plugin/` แล้ว symlink `skills` → โฟลเดอร์ของ Operator
  เพื่อไม่บังคับให้ Operator รู้จักโครง plugin เลย
- **อ่านโฟลเดอร์ตอนเริ่มทุก Agent Session ใหม่** — วางไฟล์แล้ว Task/Run ถัดไปเห็นทันที
  ไม่ต้อง restart, session ที่เปิดค้างใช้ชุดเดิมจนจบ (พฤติกรรมกลาง Task ไม่เปลี่ยนใต้เท้า)
- **Skill ไม่เพิ่มสิทธิ์** — permission model ของ ADR 0002/0004 ไม่เปลี่ยนแม้แต่บรรทัดเดียว:
  tool `Skill` ถูก allow เพราะตัวมันแค่โหลดคำแนะนำเข้า context ส่วนการลงมือจริง
  (Bash, Write, Browser ฯลฯ) ยังผ่าน allowlist/Approval/Grant รายตัวเหมือนเดิม

## Considered Options

- **ผูกกับ Workspace (`<workspace>/.claude/skills/`)** — ทำงานได้วันนี้โดยไม่แก้โค้ด
  แต่ต้องวางซ้ำทุก Workspace และขัดกับภาพ "วางที่เดียวใช้ได้ทุกงาน"
- **Member ติดตั้งผ่าน Discord** — สะดวกแต่เปิดช่องให้ Member คนหนึ่งชี้นำ Agent
  ของทุกคน ยอมแลกความสะดวกกับความปลอดภัยไว้ก่อน ค่อยทบทวนเมื่อมี use case จริง
- **format แบนเอง (`skills/ชื่อ.md`)** — พิมพ์สั้นกว่านิดเดียว แต่เสีย compatibility
  กับ skill สำเร็จรูปทั้งหมด และแนบไฟล์ประกอบไม่ได้
- **slash command แยกต่อ skill** — เห็นชัดตอนพิมพ์ `/` แต่ต้อง sync command กับ Discord
  ทุกครั้งที่โฟลเดอร์เปลี่ยน ขัดกับ "วางแล้วใช้ได้เลย" จึงใช้ autocomplete บน option
  `skill` แทน (บอทตอบรายชื่อสด ๆ ตอนผู้ใช้พิมพ์ ไม่มีอะไรต้อง sync)

## Consequences

- skill ที่วางแล้วมีผลกับ **ทุก session รวมถึง Scheduled Run** — Operator ต้องถือว่า
  โฟลเดอร์ skill เป็นพื้นที่ trusted เท่ากับโค้ดบอทเอง (ไฟล์ในนั้นคือ instruction
  ที่รันโดยไม่มีใครรีวิวซ้ำ) ความเสี่ยง prompt injection ใน Run ตาม ADR 0004 ไม่ได้
  เพิ่มขึ้นจาก skill เพราะคนวางคือ Operator คนเดียวกับที่คุมเครื่อง
- ตำแหน่งโฟลเดอร์ + format กลายเป็นสัญญากับผู้ใช้ทันทีที่มี skill สะสม — ย้ายทีหลังแพง
- scaffold ใน `.state/skills-plugin/` เป็นของ generated ห้าม commit (อยู่ใต้ `.state`
  ที่ ignore อยู่แล้ว) และสร้างใหม่ได้เสมอ
- "session ที่เปิดค้างใช้ชุดเดิม" เป็นจริงเฉพาะ**รายชื่อ** skill — เนื้อ SKILL.md ถูกอ่าน
  ผ่าน symlink ตอน skill ถูกเรียกใช้จริง การแก้/ลบไฟล์ระหว่าง session เปิดอยู่จึงมีผล
  กับ session นั้นได้ ยอมรับไว้เพราะคนแก้คือ Operator คนเดียวกัน
