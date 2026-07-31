# CONTEXT — Discord Agent Bot

Glossary ของโปรเจกต์ (ภาษากลางที่ใช้ตรงกันทั้งในโค้ดและการคุยงาน)

## Terms

- **Host** — เครื่องคอมพิวเตอร์ (macOS หรือ Linux) ที่บอทรันอยู่ และเป็นเครื่องที่ Agent ทำงานจริง (อ่าน/เขียนไฟล์, รันคำสั่ง) รันทีละ 1 เครื่องต่อ 1 Discord bot token
- **Operator** — เจ้าของ subscription และเครื่อง Host (ผู้ตั้งบอท) มีสิทธิ์สูงสุด
- **Member** — สมาชิกทีมภายในที่อยู่ใน allowlist (Discord user ID) สั่งงานบอทได้
- **Task** — งานหนึ่งชิ้นที่ Member สั่งผ่าน Discord แต่ละ Task ผูกกับ Discord thread หนึ่งอัน และ Agent Session หนึ่งอัน (1 Task = 1 Thread = 1 Session)
- **Agent Session** — บริบทการสนทนาต่อเนื่องของ Claude Agent SDK ที่จำประวัติภายใน Task เดียวกัน
- **Workspace** — directory บนเครื่อง Host ที่ Agent ใช้เป็น cwd ของ Task ระบุได้ตอนสั่งงาน ถ้าไม่ระบุใช้ workspace กลางจาก config
- **Approval** — การกดปุ่มใน Discord เพื่ออนุญาตคำสั่งเสี่ยงก่อน Agent ลงมือทำ (คำสั่งอ่าน/แก้ไฟล์ใน Workspace และ Bash ที่อยู่ใน allowlist ผ่านอัตโนมัติ)
- **Risky command** — การกระทำที่ต้องมี Approval: Bash นอก allowlist, การลบไฟล์, การแก้ config ระบบ, การ**เขียน**นอก Workspace (การอ่านนอก Workspace เช่น `cat /etc/hosts` หรือ `find ~/Downloads` ผ่านอัตโนมัติ เพราะอยู่ใน allowlist อ่านล้วน), การใช้ Browser ครั้งแรกใน Task, และ browser tool ที่แตะเครื่อง Host เอง — อัปโหลดไฟล์ขึ้นเว็บ / รันโค้ดอิสระ (ขอทุกครั้ง)
- **Browser** — browser จริง (เปิดหน้าต่างบนเครื่อง Host ไม่ใช่ headless) ที่ Agent ใช้ทำงานบนเว็บ มีตัวเดียวทั้งระบบและถูกถือได้ทีละหนึ่ง Task — Task อื่นที่ขอใช้ระหว่างนั้นถูกปฏิเสธพร้อมบอกว่า Task ไหนถืออยู่
- **Browser Profile** — สถานะล็อกอิน (cookie/session) ของ Browser ที่คงอยู่ข้าม Task บัญชีที่ล็อกอินค้างไว้เป็นของ Operator และ Member ทุกคนใช้ร่วมกันผ่านบอท
- **Q&A** — Task ที่ตอบคำถามอย่างเดียวโดยไม่แตะเครื่อง Host (เป็น Task ปกติที่ Agent ไม่เรียก tool ที่ต้อง Approval)
- **Schedule** — งานตั้งเวลาที่บอทรันซ้ำเองตามรอบโดยไม่มีคนสั่งต่อรอบ ไม่ใช่ Task (Task เกิดจากคนสั่งหนึ่งครั้ง) 1 Schedule ผูกกับ Discord thread ถาวรหนึ่งอัน ทุก Run โพสต์ต่อกันในนั้น
- **Run** — การทำงานหนึ่งรอบของ Schedule แต่ละ Run เริ่ม Agent Session ใหม่เสมอและไม่สืบความจำจากรอบก่อน (ความจำข้ามรอบเป็นหน้าที่ของ prompt กับไฟล์ใน Workspace)
- **Grant** — สิทธิ์ที่คนตั้ง Schedule มอบไว้ล่วงหน้าตอนสร้าง ใช้แทน Approval เพราะตอน Run ไม่มีคนเฝ้า: สิทธิ์พื้นฐานคืออ่าน/เขียนใน Workspace และ Bash ทุกคำสั่ง ส่วนการใช้ Browser ต้องเลือกมอบเพิ่มตอนสร้าง สิ่งที่ถูกปฏิเสธเสมอใน Run ไม่ว่ามอบสิทธิ์อะไรไว้: การเขียนไฟล์นอก Workspace และการรันโค้ดระดับ Host ผ่าน browser (ขอบเขตนี้บังคับได้เฉพาะ tool ที่บอทเห็นเป้าหมาย — สิ่งที่ Bash ทำเองอยู่นอกการบังคับ ดู ADR 0004)
