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
| Legs — pants/male (กางเกงขายาว) | `legs/pants/male/` | bluecarrot16, JaidynReiman, Eliza Wyatt (ElizaWy), Matthew Krohn (makrohn), Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0 / GPL 3.0 / CC-BY-SA 3.0 |
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

ทุกโฟลเดอร์ใช้ legs=pants/male, torso=longsleeve2/male ชุดเดียวกัน (แต่งตัวออฟฟิศ) ต่างกันที่ body/head/hair
เพื่อให้หน้าตาไม่ซ้ำกันเกินไปโดยไม่ต้องเพิ่มจำนวนไฟล์เครดิต

หมายเหตุการเลือก legs: ลองใช้ `legs/formal/male/` (กางเกงสูทสีเขียวเข้ม) ก่อน แต่พบว่าไฟล์ `sit.png` ของโฟลเดอร์นั้น
เป็นคนละสีปาเลตกับ `walk.png`/`idle.png` (สีน้ำตาลอ่อนแทนที่จะเป็นเขียวเข้ม — เป็นความไม่สม่ำเสมอที่มีอยู่แล้วใน
ไฟล์ต้นทางของ repo ไม่ใช่บั๊กจากการ crop/composite ของเรา) ทำให้ตัวละครเปลี่ยนสีกางเกงกะทันหันตอนสลับท่า
`sit` (โซนกำลังทำงาน ซึ่งเป็นสถานะที่เจอบ่อยที่สุด) จึงเปลี่ยนไปใช้ `legs/pants/male/` แทน ซึ่งตรวจแล้วว่า
walk/idle/sit ทั้งสามไฟล์เป็นสีกากีเดียวกันสม่ำเสมอ:

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

---

## 5. ภาคผนวก — เนื้อหาเต็มของ `CREDITS-walls.txt` / `CREDITS-floors.txt`

`[LPC] Walls` และ `[LPC] Floors` (ผู้ดูแล bluecarrot16) เป็นแพ็กที่รวมผลงานหลายคน/หลายแพ็กย่อยไว้ในชีตเดียว —
ไฟล์ crop ของเราหยิบมาแค่ 1 tile ต่อแพ็ก แต่ไม่รู้ว่า tile นั้นตกเป็นของสัดส่วนไหนใน "Based on:" ด้านล่าง
(sheet ไม่แยกเครดิตรายพิกัด) จึงยกไฟล์เครดิตเต็มของทั้งสองแพ็กมาทั้งก้อนไว้ตรงนี้ (แพ็กพี่น้องของผู้ดูแลคนเดียวกัน
คือ `[LPC] Wooden Furniture` ระบุไว้ชัดว่า "All information in this file must be included" — ยึดตามนั้นเผื่อไว้
แม้ไฟล์ walls/floors จะไม่ได้เขียนประโยคนี้ตรง ๆ)

### CREDITS-walls.txt

```
"[LPC] Walls" by bluecarrot16, Lanea Zimmerman (Sharm), Daniel Armstrong (HughSpectrum), William Thompson (William.Thompsonj), Hyptosis, Zabin, Daniel Cook, Guido Bos, SpiderDave, Cougarmint, Stephen Challener (Redshrike), Matthew Nash, Wolthera van Hövell tot Westerflier (TheraHedwig), Reemax, bleutailfly, NaRNeRZz, Sir Spummington, Casper Nilsson, KnoblePersona. CC-BY-SA 3.0.

Based on:

Liberated Pixel Cup (LPC) Base Assets (sprites & map tiles)
Lanea Zimmerman (Sharm)
CC-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0
http://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles

Liberated Pixel Cup (LPC) Base Assets (sprites & map tiles)
Daniel Armstrong (HughSpectrum)
CC-BY-SA 3.0 / GPL 3.0
http://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles#tiles/castlewalls.png
http://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles#tiles/castlefloors.png

[LPC] Arabic Elements
Lanea Zimmerman (Sharm), commissioned by William Thompson (William.Thompsonj)
CC-BY 4.0 / CC-BY 3.0 / GPL 3.0 / GPL 2.0 / OGA-BY 3.0
https://opengameart.org/content/lpc-arabic-elements

[LPC] Dungeon Elements
Lanea Zimmerman (Sharm), commissioned by William Thompson (William.Thompsonj)
CC-BY 4.0 / CC-BY 3.0 / GPL 3.0 / GPL 2.0 / OGA-BY 3.0
https://opengameart.org/content/lpc-dungeon-elements

[LPC] Adobe Building Set
Lanea Zimmerman (Sharm), commissioned by William Thompson (William.Thompsonj)
CC-BY 4.0 / CC-BY 3.0 / GPL 3.0 / GPL 2.0 / OGA-BY 3.0
https://opengameart.org/content/lpc-adobe-building-set

Castle Tiles for RPG's
Hyptosis, Zabin, Daniel Cook
CC-BY 3.0
http://opengameart.org/content/castle-tiles-for-rpgs

LPC: Interior Castle Tiles
Lanea Zimmerman (Sharm)
CC-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 / OGA-BY 3.0
https://opengameart.org/content/lpc-interior-castle-tiles

Lots of free 2d tiles and sprites by Hyptosis
Hyptosis
CC-BY 3.0
https://opengameart.org/content/lots-of-free-2d-tiles-and-sprites-by-hyptosis

LPC Compatible Ancient Roman Architecture
Wolthera van Hövell tot Westerflier (TheraHedwig), Lanea Zimmerman (Sharm)
CC-BY-SA 3.0 / GPL 3.0
https://opengameart.org/content/lpc-compatible-ancient-roman-architecture

Flowers, buildings and boxes; Interior wooden tiles; some old castle stuff
Guido Bos
CC-BY-SA 3.0 / GPL 3.0
https://opengameart.org/content/flowers-buildings-and-boxes-interior-wooden-tiles-some-old-castle-stuff

Wallpaper pattern tiles
SpiderDave
CC0
https://opengameart.org/content/wallpaper-pattern-tiles

Wallpaper pattern tiles
SpiderDave
CC0
https://opengameart.org/content/wallpaper-pattern-tiles-0

Patterns and Cursors
Cougarmint
CC0
https://opengameart.org/content/patterns-and-cursors

Patterns and Cursors II
Cougarmint
CC0
https://opengameart.org/content/patterns-and-cursors-ii

RPG Indoor Tileset: Expansion 1
Redshrike
CC-BY 3.0 / GPL 3.0 / GPL 2.0 / OGA-BY 3.0
https://opengameart.org/content/rpg-indoor-tileset-expansion-1

"RPG Enemies; Bathroom Tiles"
Matthew Nash
CC-BY-SA 3.0 / GPL 3.0
https://opengameart.org/content/public-toilet-tileset

Pixel Texture Pack
jestan
CC-BY 4.0 / CC-BY 3.0 / CC-BY-SA 4.0 / CC-BY-SA 3.0
https://opengameart.org/content/pixel-texture-pack

[LPC] House interior and decorations
Reemax
CC-BY-SA 3.0 / GPL 3.0 / GPL 2.0
https://opengameart.org/content/lpc-house-interior-and-decorations

walls and stuff
bleutailfly
CC-BY-SA 3.0
https://opengameart.org/content/walls-and-stuff

Tileset and Characters - Unfinished
NaRNeRZz
CC0
https://opengameart.org/content/tileset-and-characters-unfinished

Adventure Tileset (Unfinished)
NaRNeRZz
CC0
https://opengameart.org/content/adventure-tileset-unfinished

Interior Tiles
Sir Spummington
CC-BY-SA 3.0 / GPL 3.0
https://opengameart.org/content/interior-tiles

LPC C.Nilsson
Casper Nilsson
CC-BY-SA 3.0 / GPL 3.0
https://opengameart.org/content/lpc-cnilsson

Steampunk Level Tileset Mega Pack [Level Tileset] [16x16]
KnoblePersona
CC-BY 3.0
https://opengameart.org/content/steampunk-level-tileset-mega-pack-level-tileset-16x16
```

### CREDITS-floors.txt

```
"[LPC] Floors" by bluecarrot16, Lanea Zimmerman (Sharm), William Thompson (William.Thompsonj), Hyptosis, SpiderDave, Cougarmint, Stephen Challener (Redshrike), Bonsaiheldin, Tyler Olsen (Roots), Jetrel, jestan, The Open Surge team (http://opensnc.sourceforge.net), Gaurav Munjal, Reemax, Silveira Neto, bleutailfly, Casper Nilsson, NaRNeRZz, Buch, keith karnage, Arthur Carvalho, Guilherme Vieira (n2liquid), Chris Hamons (maintainer). CC-BY-SA 4.0

Based on:

Liberated Pixel Cup (LPC) Base Assets (sprites & map tiles)
Lanea Zimmerman (Sharm)
CC-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0
http://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles

[LPC] Arabic Elements
Lanea Zimmerman (Sharm), commissioned by William Thompson (William.Thompsonj)
CC-BY 4.0 / CC-BY 3.0 / GPL 3.0 / GPL 2.0 / OGA-BY 3.0
https://opengameart.org/content/lpc-arabic-elements

LPC: Interior Castle Tiles
Lanea Zimmerman (Sharm)
CC-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 / OGA-BY 3.0
https://opengameart.org/content/lpc-interior-castle-tiles

Lots of free 2d tiles and sprites by Hyptosis
Hyptosis
CC-BY 3.0
https://opengameart.org/content/lots-of-free-2d-tiles-and-sprites-by-hyptosis

Wallpaper pattern tiles
SpiderDave
CC0
https://opengameart.org/content/wallpaper-pattern-tiles

Wallpaper pattern tiles
SpiderDave
CC0
https://opengameart.org/content/wallpaper-pattern-tiles-0

Patterns and Cursors
Cougarmint
CC0
https://opengameart.org/content/patterns-and-cursors

Patterns and Cursors II
Cougarmint
CC0
https://opengameart.org/content/patterns-and-cursors-ii

RPG Indoor Tileset: Expansion 1
Redshrike
CC-BY 3.0 / GPL 3.0 / GPL 2.0 / OGA-BY 3.0
https://opengameart.org/content/rpg-indoor-tileset-expansion-1

Interior Tileset 16x16
Bonsaiheldin
CC-BY-SA 3.0
https://opengameart.org/content/interior-tileset-16x16

Stone Home Interior Tileset
Tyler Olsen (Roots), Jetrel
CC-BY-SA 3.0
https://opengameart.org/content/stone-home-interior-tileset

Pixel Texture Pack
jestan
CC-BY 4.0 / CC-BY 3.0 / CC-BY-SA 4.0 / CC-BY-SA 3.0
https://opengameart.org/content/pixel-texture-pack

32x32 (and 16x16) RPG Tiles--Forest and some Interior Tiles
Stephen Challener (Redshrike) and the Open Surge team (http://opensnc.sourceforge.net) commissioned by Gaurav Munjal
CC-BY 3.0
https://opengameart.org/content/32x32-and-16x16-rpg-tiles-forest-and-some-interior-tiles

[LPC] House interior and decorations
Reemax
CC-BY-SA 3.0 / GPL 3.0 / GPL 2.0
https://opengameart.org/content/lpc-house-interior-and-decorations

OpenPixels:Characters & Tilesets -Silveira Neto
Silveira Neto
CC-BY-SA 3.0
https://opengameart.org/content/openpixelscharacters-tilesets-silveira-neto

walls and stuff
bleutailfly
CC-BY-SA 3.0
https://opengameart.org/content/walls-and-stuff

LPC C.Nilsson
Casper Nilsson
CC-BY-SA 3.0 / GPL 3.0
https://opengameart.org/content/lpc-cnilsson

Adventure Tileset (Unfinished)
NaRNeRZz
CC0
https://opengameart.org/content/adventure-tileset-unfinished

Outdoor 32x32 tileset
Buch
CC0
https://opengameart.org/content/outdoor-32x32-tileset

Medieval town
keith karnage
CC-BY 3.0
https://opengameart.org/content/medieval-town-0

Exterior 32x32 Town tileset
Arthur Carvalho, copyright Guilherme Vieira (n2liquid)
CC-BY-SA 4.0
https://opengameart.org/content/town-tileset-exterior-32x32

Dungeon Crawl 32x32 tiles
Chris Hamons (maintainer)
CC0
https://opengameart.org/content/dungeon-crawl-32x32-tiles
```
