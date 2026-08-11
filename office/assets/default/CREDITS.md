# เครดิต — Office UI default asset pack

ทุกไฟล์ในโฟลเดอร์นี้ (`office/assets/default/`) เป็นงานศิลป์ตระกูล **Liberated Pixel Cup (LPC)**
ที่ดาวน์โหลดมาจากแหล่งต้นทางที่ระบุ license ให้ redistribute ได้จริง (CC-BY-SA / OGA-BY / CC-BY / CC0)
ไม่มีชิ้นไหนมาจากแพ็กที่ห้าม redistribute (เช่น LimeZu หรือแพ็กขายบน itch.io ส่วนใหญ่)

สรุปวิธีทำ: ตัวละครประกอบจาก "เลเยอร์" หลายไฟล์ (body/head/legs/torso/hair) ที่ดาวน์โหลดตรงจาก repo
ทางการของ Universal LPC Spritesheet Character Generator แล้ว**ซ้อนทับด้วย ImageMagick** (ไม่มีการวาด/ตัดต่อ
ด้วยมือ ไม่มี AI-generated art) — ทุกเลเยอร์เป็นไฟล์ 64×64/เฟรม แนวเดียวกัน จึงซ้อนกันได้พอดีโดยไม่ต้องปรับตำแหน่ง
ส่วน tileset ห้องประกอบจากการ **crop** ไฟล์จริงของสามแพ็ก (The Office / Walls / Floors) มาวางในตารางเดียว

**Share-alike**: เลเยอร์ตัวละครและ tileset ห้องผสมไฟล์ที่มี **CC-BY-SA** อยู่ด้วย ผลลัพธ์ที่ประกอบ/crop แล้ว
(`characters/**/*.png`, `room/tileset.png`) จึงต้องแจกจ่ายภายใต้ **CC-BY-SA** ต่อ (share-alike propagation)
ห้ามเปลี่ยน license ให้กว้างกว่านี้เวลานำไปใช้ต่อ

---

## 1. ตัวละคร (`characters/01`–`06`)

### 1.1 เลเยอร์ที่ใช้ (แหล่ง: [Universal LPC Spritesheet Character Generator](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator), ไฟล์จริงใต้ `spritesheets/`)

แต่ละแถวคือไฟล์ `walk.png` / `idle.png` / `sit.png` ในโฟลเดอร์นั้น (license/เครดิตเหมือนกันทั้ง 3 ไฟล์
ตรวจแล้วจาก `CREDITS.csv` ของ repo ต้นทาง):

| เลเยอร์ | path ใน repo ต้นทาง | ผู้สร้าง | License |
|---|---|---|---|
| Body — male | `body/bodies/male/` | bluecarrot16, JaidynReiman, Benjamin K. Smith (BenCreating), Evert, Eliza Wyatt (ElizaWy), TheraHedwig, MuffinElZangano, Durrani, Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 |
| Body — muscular | `body/bodies/muscular/` | bluecarrot16, JaidynReiman, Evert, TheraHedwig, MuffinElZangano, Durrani, Sander Frenken (castelonia), Benjamin K. Smith (BenCreating), Eliza Wyatt (ElizaWy), dalonedrau, Stephen Challener (Redshrike) | CC-BY-SA 3.0 / GPL 3.0 |
| Body — teen | `body/bodies/teen/` | bluecarrot16, Evert, TheraHedwig, Benjamin K. Smith (BenCreating), MuffinElZangano, Durrani, Pierre Vigier (pvigier), Eliza Wyatt (ElizaWy), Matthew Krohn (makrohn), Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 |
| Head — human/male | `head/heads/human/male/` | bluecarrot16, Benjamin K. Smith (BenCreating), Stephen Challener (Redshrike) | OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 |
| Head — human/male_small (ใช้กับตัว teen) | `head/heads/human/male_small/` | Eliza Wyatt (ElizaWy), Stephen Challener (Redshrike) | OGA-BY 3.0 / CC-BY |
| Legs — formal/male (กางเกงสูท) | `legs/formal/male/` | bluecarrot16, JaidynReiman, Eliza Wyatt (ElizaWy), Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 |
| Torso — longsleeve2/male (เสื้อแขนยาว) | `torso/clothes/longsleeve/longsleeve2/male/` | Eliza Wyatt (ElizaWy), JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| Hair — plain/adult | `hair/plain/adult/` | JaidynReiman, Manuel Riecke (MrBeast), Joe White | OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 |
| Hair — buzzcut/adult | `hair/buzzcut/adult/` | Eliza Wyatt (ElizaWy) | OGA-BY 3.0 |
| Hair — bob/adult | `hair/bob/adult/` | Eliza Wyatt (ElizaWy), bluecarrot16 | CC0 |

แหล่งอ้างอิงรวม (ตามที่ `CREDITS.csv` ของ repo ต้นทางระบุไว้ต่อไฟล์): [LPC Base Assets](https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles),
[LPC Character Bases](https://opengameart.org/content/lpc-character-bases), [LPC Revised Character Basics](https://opengameart.org/content/lpc-revised-character-basics),
[LPC Medieval Fantasy Character Sprites](https://opengameart.org/content/lpc-medieval-fantasy-character-sprites),
[LPC Expanded Pants](https://opengameart.org/content/lpc-expanded-pants), [LPC Hair](https://opengameart.org/content/lpc-hair),
[Ponytail and Plain Hairstyles](https://opengameart.org/content/ponytail-and-plain-hairstyles) — repo ต้นทาง (พร้อม `CREDITS.csv`
ที่ใช้ตรวจรายการนี้): <https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator>

### 1.2 คอมโบต่อโฟลเดอร์

ทุกโฟลเดอร์ใช้ legs=formal/male, torso=longsleeve2/male ชุดเดียวกัน (แต่งตัวออฟฟิศ) ต่างกันที่ body/head/hair
เพื่อให้หน้าตาไม่ซ้ำกันเกินไปโดยไม่ต้องเพิ่มจำนวนไฟล์เครดิต:

| โฟลเดอร์ | body | head | hair |
|---|---|---|---|
| `01` | male | human/male | plain |
| `02` | male | human/male | bob |
| `03` | muscular | human/male | buzzcut |
| `04` | muscular | human/male | plain |
| `05` | teen | human/male_small | bob |
| `06` | teen | human/male_small | buzzcut |

หมายเหตุ: `sleep` ไม่มีไฟล์จริง ใช้ `fallback: "sit"` ตาม `manifest.json` (ไม่มีท่านอนในเลเยอร์ที่หยิบมา)
ทุกเลเยอร์ตรวจแล้วว่ามี `walk.png`/`idle.png`/`sit.png` ครบก่อนเลือกใช้

---

## 2. ห้อง (`room/tileset.png`, `room/map.json`)

`tileset.png` เป็นภาพ **crop มาประกอบใหม่** จากไฟล์จริงของ 3 แพ็ก (ไม่ใช่งานวาดใหม่) วางเรียงเป็นตาราง 4×3 ช่อง 32×32:

| ชิ้น | แหล่ง | ผู้สร้าง | License |
|---|---|---|---|
| พื้นไม้ (floor) | crop จาก `floors.png` — **[\[LPC\] Floors](https://opengameart.org/content/lpc-floors)** | "bluecarrot16, Lanea Zimmerman (Sharm), William Thompson (William.Thompsonj), Hyptosis, SpiderDave, Cougarmint, Stephen Challener (Redshrike), Bonsaiheldin, Tyler Olsen (Roots), Jetrel, jestan, The Open Surge team, Gaurav Munjal, Reemax, Silveira Neto, bleutailfly, Casper Nilsson, NaRNeRZz, Buch, keith karnage, Arthur Carvalho, Guilherme Vieira (n2liquid), Chris Hamons (maintainer)" — ข้อความเครดิตทั้งก้อนตามที่ `CREDITS-floors.txt` ของแพ็กกำหนด (แพ็กรวมผลงานหลายคน ไม่ระบุราย tile ว่าใครวาดจุดไหน) | CC-BY-SA 4.0 |
| ผนัง (wall) | crop จาก `walls.png` — **[\[LPC\] Walls](https://opengameart.org/content/lpc-walls)** | "bluecarrot16, Lanea Zimmerman (Sharm), Daniel Armstrong (HughSpectrum), William Thompson (William.Thompsonj), Hyptosis, Zabin, Daniel Cook, Guido Bos, SpiderDave, Cougarmint, Stephen Challener (Redshrike), Matthew Nash, Wolthera van Hövell tot Westerflier (TheraHedwig), Reemax, bleutailfly, NaRNeRZz, Sir Spummington, Casper Nilsson, KnoblePersona" — ข้อความเครดิตทั้งก้อนตามที่ `CREDITS-walls.txt` ของแพ็กกำหนด | CC-BY-SA 3.0 |
| แก้วกาแฟ, แล็ปท็อป (เปิด/ปิด), เครื่องทำน้ำเย็น, เครื่องถ่ายเอกสาร | ไฟล์เต็มจาก **[\[LPC Revised\] The Office](https://opengameart.org/content/lpc-revised-the-office)** (`Coffee Cup.png`, `Laptop.png`, `Water Cooler.png`, `Copy Machine.png`) | Eliza Wyatt | OGA-BY 3.0 |

`map.json` เป็นไฟล์ Tiled JSON ที่เขียนขึ้นเอง (geometry/พิกัดล้วน ไม่ใช่งานศิลป์) อ้าง gid เข้า `tileset.png` ข้างต้น
— ดูความหมายฟิลด์ที่โค้ดอ่านใน [`README.md`](./README.md)

**Liberated Palette** (`_ Liberated Palette Ramps.png` ที่แนบมากับ The Office แต่ไม่ได้ใช้ตัดต่อในไฟล์นี้)
เป็นของ Liberated Pixel Cup เช่นกัน ไม่ได้ commit ไฟล์นี้ลง repo (ไม่จำเป็นต่อการ render)

---

## 3. เครื่องมือที่ใช้ประกอบ

- **Universal LPC Spritesheet Character Generator** — <https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/>
  (ใช้เฉพาะไฟล์ `spritesheets/` ดิบจาก repo ตรง ๆ ไม่ได้เปิดเว็บแอปสร้างเอง — ตรวจ license ต่อไฟล์จาก `CREDITS.csv` ของ repo)
- ImageMagick (`magick composite`) — ซ้อนเลเยอร์ / crop tile เท่านั้น ไม่มีการวาดหรือแก้พิกเซลด้วยมือ ไม่มี AI-generated art

## 4. License โดยรวมของโฟลเดอร์นี้

ผสม **CC0 / CC-BY / OGA-BY 3.0 / CC-BY-SA 3.0 / CC-BY-SA 4.0** — ไฟล์ผลลัพธ์ที่ประกอบจากเลเยอร์ CC-BY-SA
(ตัวละครทุกโฟลเดอร์ และ `room/tileset.png`) ต้องแจกจ่ายต่อภายใต้ **CC-BY-SA** (เงื่อนไข share-alike ของ Creative
Commons) — ไฟล์ path/แหล่งครบตามตารางข้างบน ใช้ต่อได้แต่ต้องคงเครดิตนี้ไว้
