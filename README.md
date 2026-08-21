# Discord Claude Agent Bot

Claude Code ที่สั่งงานผ่าน Discord ได้ — อ่าน/แก้ไฟล์ รันคำสั่ง ค้นเว็บ บนเครื่องที่บอทรันอยู่
ใช้โควต้าจาก **Claude subscription** (Pro/Max) ไม่ต้องใช้ API key แบบจ่ายตามโทเค็น

รองรับ macOS และ Linux (โค้ดชุดเดียว รันทีละเครื่อง)

> **สำหรับคนใช้งาน ไม่ใช่คนแก้โค้ด** — ส่งลิงก์นี้ให้ทีม: **[คู่มือบอทการตลาด](https://claude.ai/code/artifact/b043682a-b458-4e77-b229-b6389aeeab68)**
> — คู่มือภาษาคน ว่าสั่งงานยังไง อนุมัติปฏิทินยังไง และทำไมโพสต์ถึงไม่ขึ้น
>
> ต้นฉบับคือ `docs/manual.html` ในรีโปนี้ — แก้ไฟล์นั้นแล้ว publish ทับที่ URL เดิม (อย่า publish ใหม่ ไม่งั้นทีมถือลิงก์เก่าที่ไม่อัปเดต)

---

## ทำอะไรได้

- `/task prompt:… [path:…] [model:…] [skill:…]` — เปิด thread ใหม่ = 1 งาน = 1 agent session
  คุยต่อในเธรดได้เรื่อย ๆ agent จำบริบทได้ทั้งเธรด
- พิมพ์ในเธรดระหว่างที่ agent ทำงาน = แทรกคำสั่งเพิ่ม (steer) บอทจะติด 👀 ให้
- `/ask prompt:…` — ถามสั้น ๆ ตอบในห้องเดิม ไม่เปิดเธรด ไม่เก็บบริบท
  จำกัดเครื่องมือแค่อ่าน/ค้นหา/แนบไฟล์ (Read, Glob, Grep, WebSearch, WebFetch,
  send_file และเรียก Skill ได้) แก้ไขเครื่องไม่ได้
- `/schedule create prompt:… [every:…] [at:…] [days:…] [path:…] [model:…] [skill:…]` — งานตั้งเวลา
  รันซ้ำเองตามรอบโดยไม่ต้องมีคนสั่งต่อรอบ ทุกรอบโพสต์ต่อกันในเธรดถาวรของมัน
  (`at:` ใส่ได้หลายเวลาต่อวัน เช่น `at:09:00,13:00,19:00` — หนึ่ง Schedule หนึ่งเธรด ไม่ว่าจะกี่รอบต่อวัน)
  ใช้ **Grant** ที่มอบไว้ตอนสร้างแทนการขออนุมัติตอนรัน (ADR 0004) · จัดการด้วย
  `/schedule list | pause | resume | run | edit | delete` — pause กดได้ทุกคน (เบรกฉุกเฉิน)
  และล้มเหลวติดกัน 3 รอบบอทจะพักให้อัตโนมัติ
- `/schedule edit id:… [prompt:…] [every:…] [at:…] [days:…] [path:…] [model:…] [skill:…] [browser:…]`
  — แก้ schedule เดิมโดยไม่เสีย id และเธรดประวัติ (เจ้าของกับ Operator เท่านั้น)
  **ช่องที่ไม่ระบุคงค่าเดิมไว้เสมอ** ไม่ถูกรีเซ็ตเป็นค่า default เหมือนตอน create ·
  ระบุ `every`/`at`/`days` = เขียนรอบเวลาใหม่ทั้งชุดแล้วคำนวณรอบถัดไปให้ ·
  `skill:` เลือก `-` = เอาสกิลออก · แก้ตอน schedule หยุดอยู่ก็ยังหยุดอยู่เหมือนเดิม
  มีผลตั้งแต่รอบถัดไป (รอบที่กำลังรันใช้ค่าเดิมจนจบ) และบอทโพสต์สรุปสิ่งที่เปลี่ยนลงเธรดไว้เป็นหลักฐาน
- **ใช้ browser จริงได้** — Chrome เปิดหน้าต่างจริงบนเครื่อง host ด้วย profile ที่
  Operator ล็อกอินเว็บค้างไว้ (`npm run browser:login`) มีตัวเดียวทั้งระบบ
  หลายงานขอใช้พร้อมกันจะเข้าคิว FIFO รอกันเอง (ADR 0003, 0006)
- **Skill** — วางโฟลเดอร์ skill มาตรฐาน Claude Code ไว้ใน `skills/` แล้วงานถัดไป
  เห็นทันทีไม่ต้องรีสตาร์ต เลือกตอนสั่งด้วยตัวเลือก `skill` หรือปล่อยให้ agent
  เลือกเองตามงาน (ADR 0005)
- `/stop` — สั่งหยุดงานในเธรดนั้น
- `/status` — ดูงาน task ที่เปิดเซสชันอยู่ รอบ schedule ที่กำลังรัน และคิว browser
  (ใครถืออยู่ ใครรออยู่ลำดับไหน) — ตอบแม้ไม่มี task เปิดอยู่ เพราะ schedule
  อาจถือ browser ค้างอยู่โดยไม่มีเธรด task เลยก็ได้
- `/help` — สรุปวิธีใช้ทั้งหมดนี้ใน Discord เอง (ตอบแบบเห็นคนเดียว)
- คำสั่งเสี่ยงขึ้นปุ่ม **อนุมัติครั้งนี้ / อนุมัติและจำไว้ / ปฏิเสธ** ในเธรด
  (ปุ่ม "จำไว้" ขึ้นเฉพาะเมื่อ Claude Code เสนอ rule ให้จำได้ และจำแค่ช่วงอายุ session นั้น)
- **แสดงไฟล์จริงได้** — ขอให้เอารูป/PDF/กราฟมาดู บอทจะแนบไฟล์ลงเธรด (รูปแสดงในแชทเลย)
  ผ่าน tool `mcp__discord__send_file` ไม่ใช่แค่บรรยายเป็นข้อความ
- ไม่จำกัดจำนวนงานพร้อมกัน

---

## ติดตั้ง

### 1. ขอ token จาก subscription

```sh
claude setup-token
```

ต้องมีแผน Claude Pro หรือ Max · token อายุ 1 ปี · นี่คือสิ่งที่ทำให้บอทใช้โควต้า
subscription แทนการเรียกเก็บเงินแบบ API

> ถ้าเครื่องยังไม่มี Claude Code: `npm i -g @anthropic-ai/claude-code` แล้ว `claude` เพื่อ login ก่อน

### 2. สร้าง Discord application

1. เปิด https://discord.com/developers/applications → **New Application**
2. แท็บ **Bot** → **Reset Token** → คัดลอกไว้ (นี่คือ `DISCORD_TOKEN`)
3. แท็บ **Bot** → เปิด **MESSAGE CONTENT INTENT** ⚠️ **จำเป็น** — ไม่เปิดบอทจะอ่าน
   ข้อความที่คุณพิมพ์ในเธรดไม่ได้ (สั่งงานได้แต่คุยต่อไม่ได้)
4. แท็บ **General Information** → คัดลอก **Application ID** (`DISCORD_APP_ID`)
5. แท็บ **Installation** หรือ **OAuth2 → URL Generator** → scope `bot` +
   permission `View Channels`, `Send Messages`, `Create Public Threads`,
   `Send Messages in Threads`, `Read Message History`, `Embed Links`,
   `Attach Files`, `Add Reactions` → เปิดลิงก์เพื่อเชิญบอทเข้าเซิร์ฟเวอร์
   (`Embed Links` จำเป็น — ปุ่มขออนุมัติเป็น embed · เช็คสิทธิ์ทีหลังได้ด้วย `npm run whoami`)

### 3. หา Discord user ID ของตัวเอง

Discord → User Settings → Advanced → เปิด **Developer Mode**
แล้วคลิกขวาที่ชื่อตัวเอง → **Copy User ID**

### 4. ตั้งค่า

```sh
cp .env.example .env
# แก้ .env ให้ครบ
npm install
npm run doctor    # เช็คว่า auth + SDK ทำงานได้ ก่อนต่อ Discord
npm run dev
```

---

## ตั้งค่าใน `.env`

| ตัวแปร | จำเป็น | คำอธิบาย |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | Bot token |
| `DISCORD_APP_ID` | ✅ | Application ID |
| `DISCORD_GUILD_ID` | — | ใส่แล้ว slash command ขึ้นทันทีในเซิร์ฟเวอร์นั้น (ไม่ใส่ = global รอถึง 1 ชม.) |
| `CLAUDE_CODE_OAUTH_TOKEN` | ✅ | ผลจาก `claude setup-token` |
| `OPERATOR_USER_ID` | ✅ | Discord user ID ของคุณ อนุมัติได้ทุกงาน |
| `ALLOWED_USER_IDS` | — | user ID ทีมภายใน คั่นด้วยจุลภาค คนนอกรายการถูกปฏิเสธ (operator ถูกเพิ่มให้เสมอ — เว้นว่าง = ใช้ได้คนเดียว) |
| `DEFAULT_WORKSPACE` | — | โฟลเดอร์เริ่มต้นเมื่อ `/task`/`/schedule` ไม่ระบุ `path` และเป็นที่ที่ `workspace:init` สร้าง content pipeline (ADR 0007) — ต้องอยู่นอก repo |
| `DEFAULT_MODEL` | — | `sonnet` (ค่าเริ่มต้น) / `opus` / `haiku` |
| `BROWSER_AUTO_APPROVE` | — | `true` = Task ไม่ต้องขออนุมัติ browser ครั้งแรก (สอง tool อันตรายยังถามเสมอ) — ทบทวนก่อนเพิ่มคนใน allowlist (ADR 0008) |
| `APPROVAL_TIMEOUT_MS` | — | หมดเวลารออนุมัติ (ค่าเริ่มต้น 10 นาที = ปฏิเสธอัตโนมัติ) |
| `SESSION_IDLE_TIMEOUT_MS` | — | ปิด subprocess ของ session ที่ว่างเกินเวลานี้ (ค่าเริ่มต้น 30 นาที) บริบทเธรดไม่หาย |
| `SESSION_STATE_PATH` | — | ที่เก็บ mapping thread→session สำหรับ resume หลังรีสตาร์ต |
| `SCHEDULE_STATE_PATH` | — | ที่เก็บข้อมูล schedule ให้รอดข้ามรีสตาร์ต (ค่าเริ่มต้น `./.state/schedules.json`) |
| `SKILLS_DIR` | — | โฟลเดอร์ Skill กลาง (ค่าเริ่มต้น `./skills` — ADR 0005) |
| `BROWSER_PROFILE_DIR` | — | Chrome profile ของบอท เก็บ login ค้างไว้ — อย่าเอาเข้า git (ค่าเริ่มต้น `./.state/browser-profile`) |
| `OFFICE_UI_PORT` | — | เปิด Office UI ที่ `http://127.0.0.1:<port>` (ไม่ตั้ง = ปิด) — read-only ดูอย่างเดียว สั่งงานไม่ได้ |
| `YOLO_MODE` | `false` | ⚠️ อนุมัติทุก tool call ใน Task ให้อัตโนมัติ **ยกเว้นคำสั่งลบไฟล์/ล้างงานที่ยังไม่ commit** ที่ยังถาม · ครอบ `BROWSER_AUTO_APPROVE` ให้ในตัว · เป็นกันพลาด ไม่ใช่กำแพงกันภัย — อ่าน ADR 0010 ก่อนเปิด |
| `TZ` | เขตเวลาของเครื่อง | เขตเวลาที่ใช้ตีความเวลาของ Schedule (`at:09:00`) — บนเซิร์ฟเวอร์ที่เป็น UTC ต้องตั้งเป็น `Asia/Bangkok` ไม่งั้นรอบยิงคลาด 7 ชม. · Node อ่านตัวแปรนี้เอง ไม่ผ่าน `src/config.ts` · เปลี่ยนแล้วต้องรีสตาร์ตบอท (ดูหัวข้อ **เขตเวลา** ด้านล่าง) |

---

## เขตเวลา (มีผลกับ Schedule)

เวลาของ Schedule (`at:09:00`) ถูกตีความตาม **เขตเวลาของโปรเซสบอท** ไม่ใช่ของคนที่พิมพ์คำสั่ง — ตั้ง `TZ` ใน `.env` ให้ตรงกับเขตเวลาที่ทีมใช้คุยกันเสมอ โดยเฉพาะบนเซิร์ฟเวอร์ซึ่งค่าเริ่มต้นมักเป็น UTC

**อาการเมื่อตั้งผิด:** สั่ง `at:11:30` แล้วรอบจริงยิงตอน 18:30 (คลาด 7 ชม. บนเครื่อง UTC) และ Discord จะ**แสดงกลับมาว่า 11:30 เหมือนกัน** เพราะจัดรูปแบบด้วยเขตเวลาเดียวกัน ระบบจึงดูสอดคล้องกันเองทั้งชุด แต่คลาดจากนาฬิกาจริงของคนอ่าน — จับได้ยากจนกว่ารอบจะยิงผิดเวลาให้เห็น

- **ต้องรีสตาร์ตบอทหลังเปลี่ยน** — โปรเซสอ่านเขตเวลาตอนเริ่มทำงานครั้งเดียว การแก้ timezone ของเครื่อง (`timedatectl set-timezone`) ทีหลังไม่มีผลกับตัวที่รันค้างอยู่
- ตั้งที่ตัวจัดการโปรเซส (pm2/systemd) ก็ได้เหมือนกัน และค่าจากตรงนั้น**ชนะ** `.env` เพราะ dotenv ไม่เขียนทับตัวแปรที่มีอยู่แล้ว — วิธีนี้ทนกว่าเมื่อย้ายเครื่องหรือมีคนไปเปลี่ยน timezone ของ OS
- **Schedule ที่สร้างไว้ก่อนแก้จะยังผิดอยู่** เพราะ `nextRunAt` ถูกคำนวณและบันทึกลง state ไปแล้ว การแก้เขตเวลาไม่ย้อนไปแก้ให้ · เคาะใหม่ด้วย `/schedule pause` แล้ว `/schedule resume` ทีละตัว (resume คำนวณรอบถัดไปใหม่จากเวลาปัจจุบัน) — ใช้ `/schedule edit` ใส่เวลาเดิมไม่ได้ผล เพราะค่าไม่เปลี่ยนมันจึงไม่คำนวณใหม่
- เช็คว่าถูกแล้ว: `/schedule list` ต้องแสดง "ถัดไป" ตรงกับนาฬิกาจริง และดูค่าที่โปรเซสใช้ได้จาก log ของตัวจัดการโปรเซส

---

## ความปลอดภัย

**บอทนี้ให้สิทธิ์เท่ากับการนั่งอยู่หน้าเครื่อง host** ใครสั่งบอทได้ = ทำอะไรกับเครื่องก็ได้
เท่าที่ผู้ใช้ที่รันบอทมีสิทธิ์ ออกแบบไว้ 4 ชั้น:

1. **Allowlist** — เฉพาะ `ALLOWED_USER_IDS` สั่งงานได้ คนอื่นถูกปฏิเสธทันที
2. **ขอบเขตการเขียนไฟล์** — agent เริ่มที่ workspace ที่ระบุ การแก้ไฟล์ในนั้นผ่านเลย
   การ**เขียน**ไฟล์นอกขอบเขตขึ้นขออนุมัติ (ทดสอบยืนยันแล้ว: สั่งเขียนไฟล์นอก workspace
   ทำให้ขึ้นขออนุมัติจริง และเมื่อปฏิเสธไฟล์ไม่ถูกสร้าง)

   ⚠️ **การอ่านไม่ถูกจำกัดด้วยขอบเขตนี้** — `Read`/`Grep`/`Glob` ผ่านอัตโนมัติทุกพาธ
   รวมถึงนอก workspace เช่น `~/.ssh/id_rsa` หรือ `.env` ของโปรเจกต์อื่น และตอนนี้
   บอทแนบไฟล์ลงเธรดได้ด้วย ใครสั่งงานบอทได้จึงอ่านไฟล์อะไรก็ได้เท่าที่ผู้ใช้ที่รันบอทอ่านได้
   ถ้าต้องการปิดช่องนี้ ให้เอา `Read`, `Grep`, `Glob` ออกจาก `READ_ONLY_TOOLS`
   **และ**เอาคำสั่งอ่านไฟล์ (`cat`, `head`, `tail`, `grep`, `rg`, `find` ฯลฯ) ออกจาก
   `BASH_ALLOWLIST` ใน `src/policy.ts` ด้วย (จะขึ้นขออนุมัติบ่อยขึ้นมาก) หรือกำหนดให้
   ตรวจว่าพาธอยู่ใน workspace ก่อนอนุมัติ
3. **Allowlist คำสั่ง shell** — `git status`, `ls`, `npm test` ฯลฯ ผ่านอัตโนมัติ
   ส่วน `rm`, `npm install`, `git push`, `curl`, redirect (`>`), command substitution
   (`$(…)`, backtick) และคำสั่งที่ต่อกันแบบตรวจไม่ได้ → ต้องขออนุมัติ
   รวมถึงช่องทางที่ซ่อนใน flag ของคำสั่งที่อยู่ใน allowlist เอง เช่น `find -exec`,
   `find -delete`, `sort -o`, `git branch -D`, `git tag v1`, `git remote add`
   (ดู `src/policy.ts` · ทุกเกณฑ์มีเทสต์ประกบใน `npm test`)
4. **ผู้อนุมัติ** — กดปุ่มได้เฉพาะเจ้าของงานและ operator เท่านั้น

**ปุ่มขออนุมัติอ่านรู้เรื่องโดยไม่ต้องเป็น dev** — ทุกครั้งที่ขึ้นปุ่ม บอทจะแปลคำสั่งเป็นภาษาคน
ไว้บรรทัดบนสุด (เช่น `rm -rf build` → "ลบ `build` ทั้งโฟลเดอร์รวมทุกอย่างข้างใน — ไม่ได้เข้าถังขยะ
กู้คืนไม่ได้") พร้อมคำสั่งดิบไว้ข้างล่างให้ตรวจได้ · คำอธิบายนี้**บอทถอดจากตัวคำสั่งเอง ไม่ได้
เอาคำที่ agent เขียนมาแสดง** เพราะ agent คือฝ่ายที่กำลังขออนุญาต ถ้าให้มันเขียนคำอธิบายของ
คำขอตัวเอง `rm -rf ~` ก็ถูกอนุมัติได้ในชื่อ "ล้างไฟล์ชั่วคราว" · สิ่งที่ agent เขียนยังแสดงอยู่
แต่ติดป้ายว่า "agent อธิบายเองว่า" · คำสั่งที่บอทไม่รู้จักจะบอกตรง ๆ ว่าไม่รู้จัก แทนที่จะเดา

**Browser** — การใช้ browser ครั้งแรกในแต่ละงานขออนุมัติหนึ่งครั้งแล้วคลุมทั้งงาน
ยกเว้นการอัปโหลดไฟล์จากเครื่องขึ้นเว็บ (`browser_file_upload`) และการรันโค้ดผ่าน
browser (`browser_run_code_unsafe`) ที่ขอทุกครั้ง เพราะสองอย่างนี้ย้อนมาแตะเครื่อง
host ได้ (ADR 0003) · บัญชีที่ล็อกอินค้างไว้ใน profile เป็นของ Operator และสมาชิก
ทุกคนใช้ร่วมกันผ่านบอท · ตั้ง `BROWSER_AUTO_APPROVE=true` เพื่อข้ามการขออนุมัติ
ครั้งแรกได้ (เหมาะกับบอทที่ Operator ใช้คนเดียว — สอง tool อันตรายยังถามเสมอ
ดูเงื่อนไขและความเสี่ยงใน ADR 0008)

**YOLO_MODE** — ตั้ง `YOLO_MODE=true` แล้วทุก tool call ใน Task ผ่านหมดโดยไม่ถาม
**ยกเว้นคำสั่งที่ลบไฟล์หรือล้างงานที่ยังไม่ commit** (`rm`, `rmdir`, `unlink`, `shred`,
`truncate`, `git clean`, `git rm`, `git reset --hard`, `git checkout <path>`, `git restore`,
`git stash drop/clear`, `find -delete`/`-exec`, `rsync --delete`, `dd of=`) ที่ยังขึ้นปุ่มเสมอ
— รวมถึงตอนต่อท้ายคำสั่งอื่น (`npm test && rm -rf dist`) และผ่าน `sudo`/`xargs`
· การแก้ไฟล์ไม่ติดด่านนี้ (`Edit`/`Write`, `sed -i`, `>` และ `>>`)
· ⚠️ **เป็นกันพลาด ไม่ใช่กำแพงกันภัย** — การลบที่ซ่อนใน `$(...)`, `python -c`,
หรือสคริปต์ที่ agent เพิ่งเขียนเอง ผ่านฉลุย รายละเอียดและรูที่รู้ตัวอยู่ใน ADR 0010

**Schedule** — ตอนรันไม่มีคนเฝ้า จึงใช้ **Grant** ที่มอบตอนสร้างแทนปุ่มอนุมัติ:
พื้นฐานคืออ่าน/เขียนใน workspace + Bash ทุกคำสั่ง **ยกเว้นคำสั่งลบ ซึ่งถูกปฏิเสธเสมอ**
(ไม่มีคนให้กดปุ่ม — ADR 0010) ส่วน browser ต้องเลือกมอบเพิ่ม
ตอนสร้าง และไม่ว่ามอบอะไรไว้ การเขียนไฟล์นอก workspace กับ `browser_run_code_unsafe`
ถูกปฏิเสธเสมอ (ADR 0004)

⚠️ ข้อควรรู้: `npm test`, `pytest`, `go test`, `cargo test` ผ่านอัตโนมัติ ซึ่งหมายถึง
โค้ดในโปรเจกต์ (test script) ถูกรันได้โดยไม่ถาม — ตั้งใจให้เป็นเช่นนั้นเพื่อให้ใช้งานจริงได้
ถ้าไม่ต้องการ ให้ลบออกจาก `BASH_ALLOWLIST` ใน `src/policy.ts`

**ข้อจำกัดตาม ToS:** Anthropic ไม่อนุญาตให้เปิดให้บุคคลภายนอกใช้ rate limit ของ
subscription ผ่านผลิตภัณฑ์ของคุณ — บอทนี้จึงต้องใช้กับทีมภายในเท่านั้น อย่าเปิดเป็น
public bot ([Commercial Terms](https://www.anthropic.com/legal/commercial-terms))

**บอทไม่เคยใช้ `ANTHROPIC_API_KEY`** — โค้ดล้างตัวแปรนี้ออกจาก env ที่ส่งให้ agent
(`src/agent-session.ts`) เพราะ API key มีลำดับความสำคัญเหนือ OAuth token ถ้าไม่ล้าง
เครื่องที่ตั้ง `ANTHROPIC_API_KEY` ไว้จะถูกเรียกเก็บเงินแบบ API เงียบ ๆ
(ทดสอบยืนยันแล้วด้วยการตั้งคีย์ปลอมไว้: agent ยังทำงานได้ แสดงว่าคีย์ถูกลบออกจริง
ไม่ใช่แค่ส่งค่าว่างไป)

---

## Office UI

หน้าเว็บ **read-only** ที่บอทเสิร์ฟเองบน `127.0.0.1` ของเครื่อง Host — ดูได้อย่างเดียว
สั่งงานไม่ได้ การสั่งงานยังต้องผ่าน Discord ตาม ADR 0002 เท่านั้น

- **เปิดยังไง** — ตั้ง `OFFICE_UI_PORT=<port>` ใน `.env` แล้วรันบอทตามปกติ เปิดเบราว์เซอร์
  ไปที่ `http://127.0.0.1:<port>` (ไม่ตั้งค่า = ปิดสนิท ไม่มี server ไม่มี timer ใด ๆ)
  ผูกกับ `127.0.0.1` ตายตัวในโค้ด ไม่มี auth และไม่มี config ให้เปลี่ยน host —
  อย่า forward port นี้ออกนอกเครื่อง
- **เห็นอะไร** — ห้องออฟฟิศพิกเซล 1 ห้อง วาด Agent Session ของ Task และ Run ของ Schedule
  เป็นตัวละครที่ย้ายโซนตามสถานะจริงของบอท ณ ขณะนั้น (ภาพ "ตอนนี้" ล้วน ไม่มีประวัติย้อนหลัง)
  คลิกตัวละครดูรายละเอียดและลิงก์กลับไปเธรด Discord ได้ แต่ไม่มีปุ่มสั่งงานใด ๆ ในหน้านี้
- **6 โซน** — ว่าง (lounge), กำลังทำงาน (desks), รอ Approval (เด่นที่สุดในห้อง), รอคิว–ถือ
  Browser (ADR 0006), ล้มเหลว (bug), ถูกสั่งหยุด (stopped)
- **สลับ art** — วางชุด sprite/tile ของตัวเองใน `office/assets/custom/` (ไม่ commit ลง git)
  พร้อม `manifest.json` แล้ว refresh หน้าเว็บ ไม่มีชุด `custom/` จะ fallback ไปชุด
  `office/assets/default/` ที่มากับ repo โดยไม่ต้องแก้โค้ดเลย
- **ขอบเขตปิดแล้ว** — ฟีเจอร์นี้ถือว่าเสร็จตาม [ADR 0009](./docs/adr/0009-office-ui-scope-closed.md)
  รับเฉพาะบั๊กกับการตามสถานะใหม่ของบอท ส่วนข้อจำกัดด้านภาพที่ยอมรับแล้ว 4 ข้อ (ผู้ถือ Browser ยืน,
  คิวช่องที่ 2 ไม่มีเก้าอี้, stopped/bug ไม่ได้นั่งเก้าอี้, ที่นั่ง lounge ขนาบโซฟา) อยู่ใน ADR นั้นพร้อมเหตุผล

---

## โครงสร้างโค้ด

```
src/
  index.ts            จุดเริ่ม + แปล error ตอนสตาร์ตให้อ่านรู้เรื่อง
  bot.ts              ต่อ Discord กับ agent: คำสั่ง, เธรด, สิทธิ์, วงจรชีวิต session, คิว browser
  agent-session.ts    หุ้ม Agent SDK: streaming input, canUseTool, system prompt, hooks
  attachment-tool.ts  tool ให้ agent แนบไฟล์ลง Discord ได้
  policy.ts           ตัดสินว่า tool ไหนผ่านเลย tool ไหนต้องขออนุมัติ + กติกา Grant ตอนรัน schedule
  browser.ts          จุดเดียวที่เปิด Chrome profile ของบอท ทั้งฝั่ง agent และตอน login (ADR 0003)
  browser-queue.ts    คิว FIFO ของ browser ทั้งระบบ (ADR 0006)
  session-registry.ts ทะเบียน session ต่อเธรด — จอง slot แบบ single-flight กัน /task สร้าง session ซ้อน
  browser-login.ts    npm run browser:login — เปิดหน้าต่างให้ Operator ล็อกอินเว็บ
  scheduler.ts        วงจรทำงานของ schedule: ยิงตามรอบ, ข้ามรอบที่พลาด, พักอัตโนมัติเมื่อพังซ้ำ
  recurrence.ts       parse + คำนวณรอบเวลา (every / at / days)
  schedule-store.ts   เก็บ schedule ลงไฟล์ ให้รอดข้ามรีสตาร์ต + กติกาการแก้ record (/schedule edit)
  skills.ts           สแกนโฟลเดอร์ Skill กลาง + สร้าง plugin ให้ SDK โหลด (ADR 0005)
  store.ts            จำ thread→session id ไว้ resume หลังรีสตาร์ต
  config.ts           อ่าน/ตรวจ .env
  doctor.ts           เช็คสภาพก่อนใช้งาน (npm run doctor)
  whoami.ts           เช็คว่าบอทอยู่เซิร์ฟเวอร์ไหน + สิทธิ์ต่อห้อง (npm run whoami)
  *.test.ts           เทสต์ policy, browser-queue, session-registry, recurrence, scheduler, skills, store, agent-session, bot, orphan-sweep, render, status-reconcile (npm test)
  attachment.test.ts  เทสต์ว่า agent แนบไฟล์จริง (npm run test:agent — ใช้โควต้าเล็กน้อย)
  browser-profile.test.ts  เทสต์ว่า login ที่ทำไว้บอทเห็นจริง (npm run test:browser — ต้องมี Chrome)
  discord/
    commands.ts       นิยาม slash command + ลงทะเบียน
    render.ts         โพสต์ลงเธรด: ตัดข้อความ, แนบไฟล์, สถานะแบบแก้ข้อความเดิม
    approval.ts       ปุ่มอนุมัติ/ปฏิเสธ
skills/               โฟลเดอร์ Skill กลาง — Operator เท่านั้นที่วางไฟล์ได้ (ADR 0005)
office/               หน้าเว็บ Office UI (read-only, ADR 0002) — เสิร์ฟ static ตรง ๆ ไม่มี build step
                       ดูวิธีเปิดและใช้งานในหัวข้อ "Office UI" ด้านบน
```

## รายละเอียดที่ตั้งใจออกแบบไว้

- **แยก setting ออกจากเครื่อง** — `settingSources: ['project']` บอทอ่าน `.claude/`
  และ `CLAUDE.md` ของโปรเจกต์ แต่**ไม่**ดูด `~/.claude/settings.json` ส่วนตัวของคุณ
  เพื่อให้ tool set คาดเดาได้ ไม่ใช่ขึ้นอยู่กับว่าเครื่องนั้นติดตั้ง plugin/MCP อะไรไว้
- **system prompt บอกบริบท Discord** — agent รู้ว่าผู้ใช้เห็นแค่ข้อความที่มันเขียน
  จึงต้องเรียก `send_file` เมื่อถูกขอให้ "เอามาดู" และรู้ว่า Discord markdown
  ไม่รองรับหัวข้อ/ตาราง
- **ขนาดไฟล์** — จำกัด 10 MB ตามเพดานเซิร์ฟเวอร์ที่ไม่มี boost ถ้าเกิน tool จะ
  บอก agent ให้ย่อก่อน (แนะนำคำสั่ง `sips` บน macOS ให้ด้วย) แล้วส่งไฟล์ที่ย่อแล้ว
  เซิร์ฟเวอร์ที่มี boost รับได้มากกว่านี้ — แก้ค่าใน `src/attachment-tool.ts` ได้

`CONTEXT.md` = คำศัพท์ที่ใช้ตรงกันในโปรเจกต์ · `docs/adr/` = เหตุผลของการตัดสินใจสำคัญ

---

## คำสั่ง

```sh
npm run dev            # รันแบบ hot reload
npm run doctor         # เช็ค auth + SDK ก่อนต่อ Discord
npm run whoami         # เช็คว่าบอทอยู่เซิร์ฟเวอร์ไหน + สิทธิ์ต่อห้อง
npm run browser:login  # เปิด Chrome ให้ Operator ล็อกอินเว็บที่จะให้บอทใช้
npm run workspace:init # สร้าง workspace ของ content pipeline ที่ DEFAULT_WORKSPACE
npm test               # เทสต์ policy, คิว browser, ทะเบียน session, recurrence, scheduler, skills, store, agent session, bot, orphan-sweep, render, status-reconcile,
                        # และ Office UI: src/office/feed.test.ts, src/office/snapshot.test.ts, src/office/server.test.ts,
                        # office/app/layout.test.js, office/app/state.test.js (เร็ว ไม่ใช้โควต้า)
npm run test:agent     # เทสต์การแนบไฟล์ end-to-end (ใช้โควต้าเล็กน้อย)
npm run test:browser   # เทสต์ว่า login ที่ทำไว้บอทอ่านเห็นจริง (ต้องมี Chrome)
npm run build          # คอมไพล์ไป dist/
npm start              # รันจาก dist/
```

## รันค้างไว้

- **macOS** — `launchd` plist หรือ `pm2 start dist/index.js --name claude-bot`
- **Linux** — systemd service (ตั้ง `Restart=always`) หรือ `pm2`

## ข้อจำกัดที่รู้อยู่

- 1 บอท = 1 เครื่อง (Discord bot token ผูกกับ process เดียว) ถ้าต้องคุมหลายเครื่อง
  ให้สร้าง application แยกต่อเครื่อง
- รีสตาร์ตบอทแล้วงานที่ค้างอยู่จะหยุด แต่บริบทของเธรดยังอยู่ — พิมพ์ในเธรดเดิม
  บอทจะ resume session ให้ ถ้า Claude Code ลบประวัติ session นั้นไปแล้ว บอทจะบอกใน
  เธรดและเริ่มเซสชันใหม่ให้เมื่อพิมพ์อีกครั้ง (ไม่ค้างพยายาม resume ซ้ำ)
- Browser มีตัวเดียวทั้งระบบและถูกถือได้ทีละงาน — งานอื่นที่ขอใช้ระหว่างนั้นเข้าคิว
  รอตามลำดับ (ADR 0006) ถ้าต้องการทำงานเว็บขนานกันจริง ๆ ต้องรอ upgrade path
  แบบหลาย profile ที่ ADR บันทึกไว้
- โควต้าเป็นของ subscription เดียวที่แชร์กันทั้งทีม รันหนักพร้อมกันหลายงานอาจชนลิมิต
  ชั่วคราว บอทจะรายงานในเธรด
