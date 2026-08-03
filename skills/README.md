# Skills

โฟลเดอร์กลางของ Skill (ADR 0005) — วางโฟลเดอร์สกิลตามมาตรฐาน Claude Code แล้ว
Task/Run ถัดไปเห็นทันที ไม่ต้อง restart บอท

```
skills/
└── make-image/
    ├── SKILL.md      # บังคับ — frontmatter ต้องมี name + description
    └── template.md   # ไฟล์ประกอบอื่น ๆ วางได้ตามต้องการ
```

ตัวอย่าง `SKILL.md`:

```markdown
---
name: make-image
description: สร้างรูปภาพผ่านเว็บ image generation ที่ล็อกอินไว้ ใช้เมื่อผู้ใช้ขอสร้าง/วาดรูป
---

ขั้นตอน...
```

- `description` สำคัญที่สุด — Agent ใช้มันตัดสินใจว่าจะหยิบสกิลนี้เมื่อไร
- สกิลจาก Claude Code / ecosystem อื่น copy มาวางได้ทั้งโฟลเดอร์
- ผู้ใช้เลือกสกิลได้จากช่อง `skill` ใน `/task`, `/ask`, `/schedule create`
  หรือปล่อยให้ Agent เลือกเองตามงาน
- ไฟล์ในนี้คือ instruction ที่เข้า Agent ทุก session — เท่ากับโค้ดบอท
  รีวิวก่อนวางเสมอ (Operator วางได้คนเดียว)
