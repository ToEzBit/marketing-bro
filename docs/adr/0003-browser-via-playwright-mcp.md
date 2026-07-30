# 0003 — Browser: Playwright MCP แบบ headed + persistent profile

Status: accepted (2026-07-30)

## Context

ต้องการให้ Agent ใช้ browser ได้เป็นความสามารถทั่วไป use case ตั้งต้น: (1) gen รูปผ่านหน้าเว็บของบริการที่ Operator จ่าย subscription อยู่แล้ว — เหตุผลหลักคือไม่ต้องการจ่ายค่า API เพิ่ม (2) โพสต์และอ่านยอด like/comment เพจ Facebook (3) ดูเพจ Facebook ของคนอื่น

## Decision

- ใช้ **Playwright MCP** (`@playwright/mcp`) เสียบเข้า `mcpServers` ของ Agent Session ข้าง ๆ server `discord` ที่มีอยู่
- รันแบบ **headed** (หน้าต่างจริงบนเครื่อง Host) + **persistent profile** — ลด bot detection และเก็บ login ค้างข้าม Task
- Policy: tool call แรกที่แตะ browser ใน Task = Risky command หนึ่งครั้ง (อนุมัติแล้วที่เหลือใน Task ผ่านหมด) ยกเว้นสอง tool ที่ทะลุขอบเขต browser ไปแตะเครื่อง Host เอง ต้องขอ Approval แยกทุกครั้ง: `browser_file_upload` (ช่องทางไฟล์ออกจากเครื่อง Host สู่เว็บภายนอก) และ `browser_run_code_unsafe` (รันโค้ดระดับ Node บนเครื่อง Host — ปล่อยผ่านคือเปิดทางอ้อมข้าม Bash allowlist ของ ADR 0002)
- ผู้อนุมัติใช้กติกาเดิมของ Approval (ผู้สั่งงาน + Operator) — Member อนุมัติงานตัวเองได้
- Browser เป็น singleton: profile เปิดพร้อมกันสอง instance ไม่ได้ → Task ที่ขอใช้ระหว่างที่ Task อื่นถืออยู่ ถูกปฏิเสธพร้อมระบุ Task ที่ถือ (ไม่เข้าคิว — ทีมเล็ก โอกาสชนต่ำ อัพเกรดเป็นคิวทีหลังได้ถ้าชนบ่อยจริง)

## ข้อบังคับที่ค้นพบตอนใช้งานจริง (2026-07-30)

ทั้ง browser ของ Agent และหน้าต่างที่ Operator ใช้ล็อกอิน **ต้องเปิดผ่าน Playwright เท่านั้น**
(ทางเดียวกันคือ `src/browser.ts`) ห้ามเปิด Chrome binary ตรง ๆ แม้จะชี้ `--user-data-dir`
เดียวกันก็ตาม เพราะ Playwright สั่ง Chrome ด้วย `--use-mock-keychain --password-store=basic`
คุกกี้จึงถูกเข้ารหัสด้วยกุญแจคนละดอกกับ Chrome ที่เปิดเอง (ซึ่งใช้ macOS Keychain) ผลคือ
profile เดียวมี "ชุด login สองชุดที่มองไม่เห็นกัน" — ล็อกอินแล้วแต่บอทยังเจอหน้า login เหมือนเดิม
โดยไม่มี error ให้เห็น `src/browser-profile.test.ts` (`npm run test:browser`) ล็อกเงื่อนไขนี้ไว้
โดยยิงผ่าน Playwright MCP server ตัวจริง — ข้อแม้คือ `playwright-core` ที่โปรเจกต์ import
ต้องเป็นสำเนาเดียวกับที่ `@playwright/mcp` ใช้ ถ้า npm ติดตั้งซ้อนกันคนละเวอร์ชันเมื่อไร
launch args ของสองฝั่งจะเริ่มต่างกันอีก (เช็คด้วย `npm ls playwright-core`)

## Considered Options

- **browserless/browserless** — ถูกปัดตก: เป็น Chrome-as-a-service ใน Docker เกิดมาเพื่อฟาร์ม headless แบบ scale ตรงข้ามกับโจทย์ (headed ตัวเดียว + login ถาวรบนเครื่องตัวเอง) และต้องเขียน tool layer เชื่อม Agent เองทั้งหมด
- **Facebook Graph API** — ฟรีสำหรับเพจที่เป็น admin เอง (โพสต์/อ่าน like/comment ได้ตั้งแต่ dev mode ไม่ต้องผ่าน App Review) ถูกเสนอแล้วแต่ Operator เลือกเริ่มด้วย browser ทางเดียวก่อนเพื่อความง่าย — **เก็บไว้เป็นทางอัพเกรด** ถ้า browser พังบ่อยหรือบัญชีเริ่มโดนตรวจ ส่วนเพจคนอื่นผ่าน API ต้องผ่าน App Review + business verification จึงไม่คุ้มตั้งแต่แรก
- **Headless** — ถูกปัดตก: fingerprint โดนระบบกันบอท (Facebook, Cloudflare หน้าเว็บ gen รูป) จับง่ายกว่า headed อย่างมีนัยยะ

## Consequences

- ⚠️ **ความเสี่ยงที่ Operator รับไว้โดยรู้ตัว:** browser automation บนบัญชี Facebook ที่ล็อกอินจริงขัด ToS ของ Meta — headed + profile จริงลดโอกาสโดนจับ แต่ไม่เป็นศูนย์ ผลร้ายสุดคือบัญชีที่ล็อกอินถูกล็อก
- ⚠️ **Member ทุกคน = ถือทุกบัญชีที่ล็อกอินใน Browser Profile โดยปริยาย** (สั่งงาน + อนุมัติตัวเองได้) โมเดลนี้อยู่บนความเชื่อใจทีมภายในเต็มรูปแบบ ถ้าทีมโตหรือความเชื่อใจเปลี่ยน ต้องกลับมาคิดข้อนี้ใหม่
- ⚠️ โพสต์ในนาม**บัญชีส่วนตัว**ผ่าน Graph API ทำไม่ได้ (Meta ถอด permission ไปตั้งแต่ 2018) — เคสนี้จึงทำได้ผ่าน browser เท่านั้น และเป็นเคสเสี่ยงสุด
- ✅ ไม่มี infra เพิ่ม (ไม่มี Docker/service) — `npx @playwright/mcp` รันเป็น MCP server ของ session
