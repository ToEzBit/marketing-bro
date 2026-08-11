# Office UI — asset pack (`default/`)

คู่มือสำหรับ Operator ที่จะแก้ art ของ Office UI (ดูภาพรวมของ Office UI ใน README หลักของ repo และ spec §8)

## โครงไฟล์

```
office/assets/
├── default/         # ชุดนี้ — commit ลง repo ได้ (LPC / CC0 เท่านั้น ดู CREDITS.md)
│   ├── manifest.json
│   ├── CREDITS.md
│   ├── README.md    # ไฟล์นี้
│   ├── room/
│   │   ├── tileset.png
│   │   └── map.json
│   └── characters/
│       ├── 01/ walk.png idle.png sit.png
│       ├── 02/ ...
│       └── 06/ ...
└── custom/           # .gitignore ทั้งโฟลเดอร์ — Operator วางชุดของตัวเองที่นี่ (เช่น LimeZu ที่ห้าม commit)
```

## สลับเป็นชุดของตัวเอง (`custom/`)

1. สร้างโฟลเดอร์ `office/assets/custom/` (ถูก `.gitignore` ไว้แล้ว ไม่มีวันถูก commit)
2. ก็อปโครงเดียวกับ `default/` ทั้งหมดเข้าไป (`manifest.json`, `room/tileset.png`, `room/map.json`,
   `characters/<folder>/{walk,idle,sit}.png`, ...) แล้วแก้ไฟล์ตามใจ
3. เปิดหน้า Office UI แล้ว refresh — ตัว loader (`office/app/assets.js`) เช็ค `GET /assets/custom/manifest.json`
   ก่อนเสมอ ถ้าได้ 200 = ใช้ชุด `custom/` **ทั้งชุด** ไม่ผสมกับ `default/`
4. ถ้าอยากกลับไปใช้ชุด default เฉย ๆ ลบ (หรือย้ายออก) `office/assets/custom/manifest.json`

**กติกาสำคัญ: ห้ามผสมสองชุด** — ถ้า `custom/manifest.json` มีอยู่ โค้ดจะโหลด **ทุกไฟล์** จาก `custom/` เท่านั้น
(ไม่ fallback ไปหยิบไฟล์จาก `default/` เป็นราย ๆ) เหตุผล: สไตล์งานศิลป์คนละแพ็กกัน (เช่น LPC มีเส้นขอบ/เฉดสี,
Kenney/LimeZu แบนเรียบ) ผสมกันแล้วจะดูแปลก ๆ — ถ้า `custom/manifest.json` โหลดไม่ได้หรือพัง โค้ดจะ fallback ไป
`default/` ทั้งชุดแทน (ไม่ crash)

## `manifest.json` อ่านฟิลด์ไหนบ้าง

ดู schema เต็มใน spec §8.2 ของ effort "Office UI" — สรุปสั้น ๆ:

- `character.frameSize` = ขนาดเฟรม px ของสไปรต์ตัวละคร (default LPC = `[64, 64]`)
- `character.anchor` = จุด "เท้า" ในเฟรม ใช้วางตัวละครบน tile
- `character.directions` = ลำดับแถวในชีตแต่ละไฟล์ (default `["up","left","down","right"]`)
- `character.animations.<name>` = `{ file, frames, fps }` ต่อท่า, หรือ `{ fallback: "<ชื่อท่าอื่น>" }`
  ถ้าไม่มีชีตจริงของท่านั้น (เช่น `sleep` ในชุด default ใช้ `sit` แทน)
- `character.offset` = จุดเริ่ม px ในชีต เผื่อชีตที่รวมทุกท่าไว้ไฟล์เดียว (default `[0,0]`)
- `character.folders` = รายชื่อโฟลเดอร์ตัวละครที่มี — จำนวนช่องที่ hash ของ session/run เลือก (ยิ่งเยอะ ยิ่งไม่ซ้ำหน้า)
- `room.tileset` / `room.map` / `room.tileSize` / `room.scale` = path ของ tileset, path ของ map,
  ขนาด tile ต้นฉบับ, ตัวคูณตอนเรนเดอร์ (ตั้ง `2` ถ้าใช้ tileset 16×16 ให้สัดส่วนกับตัวละคร 64×64 ไม่เพี้ยน)
- `states.<state>` = โซน + ท่าที่ใช้ตอนตัวละครอยู่สถานะนั้น

## `room/map.json` อ่านฟิลด์ไหนบ้าง (Tiled JSON subset)

ไฟล์นี้เป็น [Tiled](https://www.mapeditor.org/) JSON มาตรฐาน — เปิดแก้ด้วยโปรแกรม Tiled ได้ตรง ๆ
(ตั้ง "Embed tileset" หรือชี้ไปที่ `room/tileset.png` เดิม, tile size 32×32) แต่โค้ดฝั่งเว็บอ่านแค่ subset นี้
เท่านั้น ฟิลด์อื่นของ Tiled เขียนเผื่อไว้ให้โปรแกรม Tiled เปิดได้ปกติ แต่โค้ดไม่แตะ:

- `orientation` ต้องเป็น `"orthogonal"`, `width`/`height` = ขนาดห้องเป็น tile (default 32×16),
  `tilewidth`/`tileheight` = 32
- `tilesets` รองรับ **ชุดเดียว** (ไม่รองรับหลาย tileset ต่อแผนที่) — `firstgid` ของชุดต้องตรงกับ gid ที่ใช้ใน layer
- layer ชนิด `tilelayer` (เช่น `floor`, `walls`, `props` ในไฟล์นี้) — `data` เป็น array แบน ๆ ของ gid
  เรียงซ้าย→ขวา, บน→ล่าง (`0` = ไม่มี tile) **ไม่รองรับ flip/rotate flag บน gid**
- layer ชนิด `objectgroup` **ชื่อ `zones`** (บังคับ) — object แต่ละอันคือ rectangle ที่ `name` ตรงกับ
  zone id หนึ่งใน `lounge` / `stopped` / `approval` / `desks` / `browser` / `bug` พิกัด `x`/`y`/`width`/`height`
  เป็น**หน่วยพิกเซล** (มาตรฐาน Tiled) — โค้ดจะหารด้วย `tileSize` เพื่อแปลงเป็น rect หน่วย tile `[x,y,w,h]`
  แทนค่า default ของโซนนั้น ถ้าไม่มี object layer นี้ (หรือไม่มีบางโซน) ใช้ค่า default ในโค้ดแทนโซนที่ขาด
- layer ชนิด `objectgroup` ชื่อ `seats` (**optional**) — point object ในโซน `desks` พร้อม property `dir`
  (เช่น `up`) บอกพิกัดเก้าอี้ + ทิศที่นั่งหันเข้าโต๊ะ ไม่มีก็คำนวณที่นั่งจาก rect ของโซนแทน (ดู spec §7.2)

ไฟล์ `default/room/map.json` มี 3 tile layer (`floor` เต็มห้อง, `walls` เป็นกรอบรอบห้อง, `props` วางของตกแต่ง
เช่นเครื่องถ่ายเอกสาร/เครื่องทำน้ำเย็น/แล็ปท็อป/แก้วกาแฟ) และ object layer `zones` ที่พิกัดตรงกับ zone rect
default ของสเปกเป๊ะ ๆ (เผื่อ Operator ลากขยับโซนด้วย Tiled ได้ในอนาคต) — ไม่มี `seats` layer (ใช้ค่า
คำนวณอัตโนมัติ)

## `characters/<folder>/` มีอะไรบ้าง

แต่ละโฟลเดอร์ (ชื่อคือค่าหนึ่งใน `character.folders` ของ manifest) มี `walk.png` / `idle.png` / `sit.png`
เป็นชีตแนวตั้ง 4 แถว (ตามลำดับ `character.directions`) แถวละ N เฟรมตาม `character.animations.<name>.frames`
เฟรมละ `character.frameSize` px เรียงซ้าย→ขวาในแถว — `sleep.png` ไม่บังคับ (ชุด default ไม่มีไฟล์นี้ ใช้
`fallback: "sit"` แทน)

## เพิ่ม/ลดจำนวนตัวละคร

แก้ `character.folders` ใน `manifest.json` ให้ตรงกับโฟลเดอร์ที่มีจริงใต้ `characters/` — จำนวนช่องกำหนดว่า
hash ของ session/run id จะกระจายไปกี่หน้าตา (ดู spec §5.1 — FNV-1a hash แบบ deterministic ผูกกับ id ถาวร)
