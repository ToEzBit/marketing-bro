# เครดิต — Office UI default asset pack

ทุกไฟล์ในโฟลเดอร์นี้ (`office/assets/default/`) เป็นงานศิลป์ตระกูล **Liberated Pixel Cup (LPC)**
ที่ดาวน์โหลดมาจากแหล่งต้นทางที่ระบุ license ให้ redistribute ได้จริง (CC-BY-SA / OGA-BY / CC-BY / CC0)
ไม่มีชิ้นไหนมาจากแพ็กที่ห้าม redistribute (เช่น LimeZu หรือแพ็กขายบน itch.io ส่วนใหญ่)

สรุปวิธีทำ: ตัวละครประกอบจาก "เลเยอร์" หลายไฟล์ (body/head/hair/torso/legs/feet + neck/facial บางตัว)
ที่ดาวน์โหลดตรงจาก repo ทางการของ Universal LPC Spritesheet Character Generator แล้ว
**เปลี่ยนสีทีละเลเยอร์ตามตาราง palette ของ repo ต้นทาง** (ดูข้อ 1.2) ก่อน **ซ้อนทับด้วย ImageMagick**
ตามลำดับ `zPos` ที่ repo ต้นทางกำหนด (ไม่มีการวาด/ตัดต่อด้วยมือ ไม่มี AI-generated art)
— ทุกเลเยอร์เป็นไฟล์ 64×64/เฟรม แนวเดียวกัน จึงซ้อนกันได้พอดีโดยไม่ต้องปรับตำแหน่ง
ส่วน tileset ห้องประกอบจากการ **crop** ไฟล์จริงของสามแพ็ก (The Office / Walls / Floors) มาวางในตารางเดียว

**Share-alike**: เลเยอร์ตัวละครและ tileset ห้องผสมไฟล์ที่มี **CC-BY-SA** อยู่ด้วย ผลลัพธ์ที่ประกอบ/crop แล้ว
(`characters/**/*.png`, `room/tileset.png`) จึงต้องแจกจ่ายภายใต้ **CC-BY-SA** ต่อ (share-alike propagation)
ห้ามเปลี่ยน license ให้กว้างกว่านี้เวลานำไปใช้ต่อ

---

## 1. ตัวละคร (`characters/01`–`14`)

### 1.1 เลเยอร์ที่ใช้

แหล่ง: [Universal LPC Spritesheet Character Generator](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator) ไฟล์จริงใต้ `spritesheets/`

แต่ละแถวคือไฟล์ `walk.png` / `idle.png` / `sit.png` ในโฟลเดอร์นั้น (เครดิต/license เหมือนกันทั้งสามไฟล์) ข้อมูลดึงจาก `credits` ใน `sheet_definitions/` ของ repo ต้นทาง ซึ่งระบุรายเลเยอร์ละเอียดกว่า `CREDITS.csv` รวม — บางเลเยอร์มี credit block ที่ใช้ได้มากกว่าหนึ่งอัน (เช่น `feet/shoes/revised/male`, `feet/shoes/basic/thin`, `legs/cuffed/male`) แถวข้างล่าง**รวมทุก block ที่ใช้ได้**เข้าด้วยกัน

| เลเยอร์ | path ใน repo ต้นทาง | ผู้สร้าง | License |
|---|---|---|---|
| Body — Body Color | `body/bodies/female/` | Benjamin K. Smith (BenCreating), bluecarrot16, TheraHedwig, Evert, MuffinElZangano, Durrani, Pierre Vigier (pvigier), ElizaWy, Matthew Krohn (makrohn), Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 |
| Body — Body Color | `body/bodies/male/` | bluecarrot16, JaidynReiman, Benjamin K. Smith (BenCreating), Evert, Eliza Wyatt (ElizaWy), TheraHedwig, MuffinElZangano, Durrani, Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 |
| Body — Body Color | `body/bodies/teen/` | bluecarrot16, Evert, TheraHedwig, Benjamin K. Smith (BenCreating), MuffinElZangano, Durrani, Pierre Vigier (pvigier), Eliza Wyatt (ElizaWy), Matthew Krohn (makrohn), Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 |
| Head — Human Female | `head/heads/human/female/` | bluecarrot16, Benjamin K. Smith (BenCreating), Stephen Challener (Redshrike) | OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 |
| Head — Human Female Elderly | `head/heads/human/female_elderly/` | Benjamin K. Smith (BenCreating), Eliza Wyatt (ElizaWy), Stephen Challener (Redshrike) | OGA-BY 3.0 / CC-BY 3.0 |
| Head — Human Female Small | `head/heads/human/female_small/` | ElizaWy, Stephen Challener (Redshrike) | OGA-BY 3.0 / CC-BY |
| Head — Human Male | `head/heads/human/male/` | bluecarrot16, Benjamin K. Smith (BenCreating), Stephen Challener (Redshrike) | OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 |
| Head — Human Male Elderly | `head/heads/human/male_elderly/` | Benjamin K. Smith (BenCreating), Eliza Wyatt (ElizaWy), Stephen Challener (Redshrike) | OGA-BY 3.0 / CC-BY 3.0 |
| Head — Human Male Gaunt | `head/heads/human/male_gaunt/` | Stephen Challener (Redshrike), bluecarrot16 | OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 |
| Head — Human Male Small | `head/heads/human/male_small/` | ElizaWy, Stephen Challener (Redshrike) | OGA-BY 3.0 / CC-BY |
| Hair — Balding | `hair/balding/adult/` | ElizaWy | OGA-BY 3.0 |
| Hair — Bob | `hair/bob/adult/` | ElizaWy, bluecarrot16 | CC0 |
| Hair — Buzzcut | `hair/buzzcut/adult/` | ElizaWy | OGA-BY 3.0 |
| Hair — Cornrows | `hair/cornrows/adult/` | ElizaWy, bluecarrot16 | CC0 |
| Hair — Curly short | `hair/curly_short/adult/` | ElizaWy | OGA-BY 3.0 |
| Hair — Dreadlocks short | `hair/dreadlocks_short/adult/` | ElizaWy, bluecarrot16 | CC0 |
| Hair — Half up | `hair/half_up/adult/` | ElizaWy | OGA-BY 3.0 |
| Hair — Lob | `hair/lob/adult/` | bluecarrot16 | CC0 |
| Hair — Long straight | `hair/long_straight/adult/` | JaidynReiman, thecilekli, bluecarrot16 | CC0 |
| Hair — Messy1 | `hair/messy1/adult/` | JaidynReiman, Manuel Riecke (MrBeast) | CC-BY-SA 3.0 / GPL 3.0 |
| Hair — Parted 3 | `hair/parted3/adult/` | ElizaWy | OGA-BY 3.0 |
| Hair — Pixie | `hair/pixie/adult/` | JaidynReiman, Manuel Riecke (MrBeast) | CC-BY-SA 3.0 / GPL 3.0 |
| Hair — Plain | `hair/plain/adult/` | JaidynReiman, Manuel Riecke (MrBeast), Joe White | OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 |
| Hair — Swoop | `hair/swoop/adult/` | JaidynReiman, Manuel Riecke (MrBeast) | CC-BY-SA 3.0 / GPL 3.0 |
| เสื้อ (torso) — Longsleeve 2 | `torso/clothes/longsleeve/longsleeve2/female/` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| เสื้อ (torso) — Longsleeve 2 | `torso/clothes/longsleeve/longsleeve2/male/` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| เสื้อ (torso) — Longsleeve 2 | `torso/clothes/longsleeve/longsleeve2/teen/` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| เสื้อ (torso) — Longsleeve 2 Buttoned | `torso/clothes/longsleeve/longsleeve2_buttoned/female/` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| เสื้อ (torso) — Longsleeve 2 Buttoned | `torso/clothes/longsleeve/longsleeve2_buttoned/male/` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| เสื้อ (torso) — Cardigan | `torso/clothes/longsleeve/longsleeve2_cardigan/female/` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| เสื้อ (torso) — Cardigan | `torso/clothes/longsleeve/longsleeve2_cardigan/male/` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| เสื้อ (torso) — Longsleeve Polo | `torso/clothes/longsleeve/longsleeve2_polo/female/` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| เสื้อ (torso) — Longsleeve Polo | `torso/clothes/longsleeve/longsleeve2_polo/male/` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| เสื้อ (torso) — Longsleeve 2 VNeck | `torso/clothes/longsleeve/longsleeve2_vneck/teen/` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| กางเกง (legs) — Cuffed Pants | `legs/cuffed/male/` | JaidynReiman, ElizaWy, Bluecarrot16, Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0 / GPL 3.0 |
| กางเกง (legs) — Cuffed Pants | `legs/cuffed/thin/` | ElizaWy, JaidynReiman, Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0 |
| กางเกง (legs) — Pants | `legs/pants/male/` | bluecarrot16, JaidynReiman, ElizaWy, Matthew Krohn (makrohn), Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0 / GPL 3.0 / CC-BY-SA 3.0 |
| กางเกง (legs) — Pants | `legs/pants/thin/` | bluecarrot16, JaidynReiman, ElizaWy, Joe White, Matthew Krohn (makrohn), Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0 / GPL 3.0 / CC-BY-SA 3.0 |
| กางเกง (legs) — Long Pants | `legs/pants2/thin/` | ElizaWy, JaidynReiman, Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0 |
| รองเท้า (feet) — Basic Shoes | `feet/shoes/basic/male/` | JaidynReiman, bluecarrot16, Johannes Sjölund (wulax) | OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 |
| รองเท้า (feet) — Basic Shoes | `feet/shoes/basic/thin/` | JaidynReiman, bluecarrot16, Johannes Sjölund (wulax), Joe White | OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 |
| รองเท้า (feet) — Revised Shoes | `feet/shoes/revised/male/` | JaidynReiman, ElizaWy, Bluecarrot16, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 / GPL 3.0 |
| รองเท้า (feet) — Revised Shoes | `feet/shoes/revised/thin/` | ElizaWy, JaidynReiman | OGA-BY 3.0 |
| เนกไท (neck) — Necktie | `neck/tie/necktie/female/` | JaidynReiman, bluecarrot16, Thane Brimhall (pennomi), laetissima, Makrohn | CC-BY-SA 3.0 / GPL 3.0 |
| เนกไท (neck) — Necktie | `neck/tie/necktie/male/` | JaidynReiman, bluecarrot16, Thane Brimhall (pennomi), laetissima, Makrohn | CC-BY-SA 3.0 / GPL 3.0 |
| แว่น (facial) — Glasses | `facial/glasses/glasses/adult/` | ElizaWy | OGA-BY 3.0 |
| แว่น (facial) — Secretary Glasses | `facial/glasses/secretary/adult/` | JaidynReiman, Thane Brimhall (pennomi), laetissima | CC-BY-SA 3.0 / GPL 3.0 |

แหล่งอ้างอิงรวมที่ `sheet_definitions/` ของ repo ต้นทางระบุไว้ต่อเลเยอร์ข้างบน:

<https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles> · <https://opengameart.org/content/lpc-medieval-fantasy-character-sprites> · <https://opengameart.org/content/lpc-ladies> · <https://opengameart.org/content/lpc-7-womens-shirts> · <https://opengameart.org/content/lpc-jump-expanded> · <https://opengameart.org/content/lpc-be-seated> · <https://opengameart.org/content/lpc-revised-character-basics> · <https://gitlab.com/vagabondgame/lpc-characters> · <https://opengameart.org/content/lpc-male-jumping-animation-by-durrani> · <https://opengameart.org/content/lpc-runcycle-and-diagonal-walkcycle> · <https://opengameart.org/content/lpc-runcycle-for-male-muscular-and-pregnant-character-bases-with-modular-heads> · <https://opengameart.org/content/lpc-character-bases> · <https://opengameart.org/content/lpc-teen-unisex-base-clothes> · <http://opengameart.org/content/lpc-clothing-updates> · <https://opengameart.org/content/lpc-expanded-socks-shoes> · <https://github.com/ElizaWy/LPC/tree/main/Characters/Clothing> · <https://opengameart.org/content/lpc-expanded-sit-run-jump-more> · <https://github.com/ElizaWy/LPC/tree/main/Characters/Head%20Accessories> · <https://opengameart.org/content/lpc-base-character-expressions> · <https://opengameart.org/content/lpc-hair> · <https://github.com/ElizaWy/LPC/blob/main/Characters/Hair> · <https://opengameart.org/content/lpc-long-straight-hair-with-12-colors> · <https://opengameart.org/content/lpc-expanded-hair> · <https://github.com/ElizaWy/LPC/tree/main/Characters/Hair> · <https://opengameart.org/content/ponytail-and-plain-hairstyles> · <https://opengameart.org/content/> · <https://opengameart.org/content/lpc-revised-elders> · <https://opengameart.org/content/lpc-folk> · <https://opengameart.org/content/lpc-expanded-pants> · <https://opengameart.org/content/lpc-2-characters> · <https://opengameart.org/content/lpc-gentleman> · <https://opengameart.org/content/lpc-expanded-simple-shirts> · <http://opengameart.org/content/lpc-revised-character-basics>

### 1.2 ขั้นตอนเปลี่ยนสี (palette recolor) — สิ่งที่รอบก่อนไม่ได้ทำ

LPC รุ่นปัจจุบัน **เลิกแจกไฟล์แยกรายสี** แล้ว เก็บ art ไว้ชุดเดียวใน "สีฐาน" ต่อวัสดุ แล้วเปลี่ยนสีตอนรันด้วยตาราง palette สีฐานที่ repo ต้นทางประกาศไว้เองคือ `hair` = `orange`, `cloth` = `white`, `body` = `light`, `eye` = `blue` (`palette_definitions/*/meta_*.json`)

ชุดเดิมหยิบ art สีฐานมาซ้อนกันตรง ๆ โดยไม่เคยรันขั้นตอนนี้ ผลคือ**ผมส้มเหมือนกันทุกตัว** และ **เสื้อกับกางเกงเป็น ramp `white` อันเดียวกัน** จึงกลืนเป็นก้อนเดียวไม่มีเส้นแบ่งเอว

รอบนี้ bake การเปลี่ยนสีลงไฟล์ **ทีละเลเยอร์ก่อนซ้อน** โดยจับคู่สีตามลำดับใน ramp (`ramp ฐาน[i]` → `ramp เป้าหมาย[i]`, ทุก ramp มี 6 ช่องเท่ากัน) ตามที่ [`sources/canvas/palette-recolor.ts`](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/blob/master/sources/canvas/palette-recolor.ts) ของ repo ต้นทางทำ ตาราง ramp มาจาก `palette_definitions/{hair,cloth,body,eye}/*_ulpc.json`

> **ต้องซ้อนหลังเปลี่ยนสีเท่านั้น** — ramp ต่างวัสดุใช้ค่า hex ซ้ำกันได้ ถ้าไปเปลี่ยนสีบนภาพที่ซ้อนเสร็จแล้วจะทาสีผิดบริเวณ

รายละเอียดที่ต่างจากต้นทางเล็กน้อย และเหตุผล:

- **tolerance 6 ต่อ channel** (ต้นทางใช้ 1) — ไฟล์ art ต้นทางมีสี "เกือบตรง ramp" อยู่จริง (`#A22600` / `#A02600` เทียบกับ `#A42600` ในผม bob / lob / half_up / flat_top_fade) ถ้าใช้ 1 สีพวกนี้จะรอดมาเป็นจุดส้มบนผมที่ย้อมสีแล้ว · ตรวจแล้วว่าที่ tolerance 6 ไม่มี ramp ไหนมีสองสีใกล้กันจนจับคู่กำกวม

- **`neck/tie/necktie`** ไม่ได้วาดบน ramp ฐานใด ๆ (เป็นเทา 4 เฉด `#2A2A2A #434343 #5B5B5B #6B6B6B`) จึงแมปเองเข้าช่องที่ 2–5 ของ ramp `cloth` ที่เลือก

- **หัวคนแก่** (`male_elderly` / `female_elderly`) ใช้สีตา `#18506F #4F8FBA #6CDCE7` ซึ่งไม่ใช่ ramp `eye` ฐาน จึงแมปเองเข้าช่อง 1–3 ของ ramp `eye` ที่เลือก

- สีที่ **จงใจไม่แตะ**: ขาวตา (`#F2F7F8` / `#FFFFFF`), เลนส์แว่น, และเส้นขอบดำของผมบางทรง (`#1C131E`, `#000000`) — เป็นเส้นขอบ/ไฮไลต์ที่ควรคงเดิมทุกสีผม

ลำดับการซ้อนใช้ `zPos` จาก `sheet_definitions/` ตรง ๆ: body (10) → รองเท้า (15) → กางเกง (20) → เสื้อ (35) → เนกไท (90) → หัว (100) → แว่น (115) → ผม (120)

หมายเหตุ: ภาพที่ซ้อนเสร็จมีสี "ลูกผสม" เพิ่มมาเล็กน้อย (สูงสุด ~2% ของพิกเซลที่ทึบ) เพราะเส้นขอบของผมบางทรงเป็นพิกเซลกึ่งโปร่ง เมื่อซ้อนทับหัวที่ทึบจึงได้สีผสม — เป็นพฤติกรรมเดิมของ art ต้นทาง ไม่ใช่ของใหม่ (ชุด 6 ตัวเดิมก็มี `#8F5E4C` / `#AC9184` แบบเดียวกัน)

### 1.3 คอมโบต่อโฟลเดอร์

ทุกโฟลเดอร์ต่างกันหลายมิติพร้อมกัน ไม่ใช่แค่ทรงผม — ชื่อสีคือชื่อ ramp ใน `palette_definitions/` ของ repo ต้นทาง

| โฟลเดอร์ | body | head | ผม | เสื้อ | กางเกง | รองเท้า | ผิว | ตา | ของประดับ |
|---|---|---|---|---|---|---|---|---|---|
| `01` | male | male | plain / dark_brown | buttoned / sky | pants / navy | revised / charcoal | light | blue | เนกไท maroon |
| `02` | female | female | bob / black | longsleeve2 / rose | pants2 / charcoal | revised / brown | amber | brown | — |
| `03` | male | male_gaunt | buzzcut / gray | polo / forest | pants / gray | basic / walnut | bronze | green | แว่น glasses black |
| `04` | male | male_elderly | balding / white | cardigan / tan | cuffed / charcoal | basic / leather | taupe | gray | แว่น secretary charcoal |
| `05` | teen | male_small | messy1 / chestnut | vneck / teal | pants2 / walnut | revised / slate | olive | purple | — |
| `06` | teen | female_small | long_straight / blonde | longsleeve2 / lavender | pants / gray | revised / pink | light | yellow | — |
| `07` | female | female | curly_short / redhead | buttoned / white | pants2 / maroon | basic / black | brown | orange | เนกไท navy |
| `08` | male | male | cornrows / raven | polo / yellow | pants / forest | revised / black | brown | red | — |
| `09` | female | female_elderly | lob / platinum | cardigan / maroon | cuffed / bluegray | basic / slate | light | blue | แว่น glasses black |
| `10` | male | male | swoop / sandy | longsleeve2 / red | pants / black | revised / brown | amber | green | เนกไท yellow |
| `11` | teen | male_small | parted3 / strawberry | vneck / green | pants2 / navy | revised / walnut | bronze | brown | — |
| `12` | female | female_small | pixie / ash | polo / navy | pants / teal | basic / maroon | olive | purple | แว่น secretary rose |
| `13` | male | male_gaunt | dreadlocks_short / dark_gray | buttoned / bluegray | cuffed / leather | revised / charcoal | taupe | gray | เนกไท red |
| `14` | female | female | half_up / light_brown | longsleeve2 / orange | pants2 / forest | basic / gray | light | red | — |

หมายเหตุ: ไม่ใช้ body `muscular` เพราะ **ไม่มีเลเยอร์เสื้อ `longsleeve2` ของทรงนั้น** (ชุดเดิมเอาเสื้อทรง male ไปแปะบน body muscular) และเป็น body เดียวที่ `CREDITS.csv` ไม่มีช่อง OGA-BY ให้เลือก

หมายเหตุ: เลี่ยง `legs/formal` เพราะไฟล์ต้นทางไม่สม่ำเสมอ — `walk.png`/`idle.png` เป็นสีเขียวเข้มที่ baked ไว้ (`#182611 #203416 #314F22`) แต่ `sit.png` อยู่บน ramp `white` ปกติ ถ้าใช้จะเปลี่ยนสีกางเกงตอนนั่ง (ตรวจซ้ำแล้วรอบนี้ ทุกเลเยอร์ที่เลือกใช้ `walk`/`idle`/`sit` อยู่บน ramp ฐานเดียวกันหมด)

`sleep` ไม่มีไฟล์จริง ใช้ `fallback: "sit"` ตาม `manifest.json` เหมือนเดิม และ `sit.png` ของ LPC เป็น **3 ท่านั่งคนละท่า** ไม่ใช่ลูปเดิน — คงไว้แบบนั้น

### 1.4 license ต่อโฟลเดอร์

LPC ระบุ license หลายอันต่อไฟล์ และ [README §Licensing ของ repo ต้นทาง](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator#licensing-and-attribution-credits) เขียนว่างานแต่ละชิ้น *"is licensed under one or more of the following supported open license(s)"* → ผู้ใช้เลือกช่องเดียวได้

ตรวจรายโฟลเดอร์แล้ว: **7 โฟลเดอร์** ที่ทุกเลเยอร์มีช่อง OGA-BY 3.0 หรือ CC0 ให้เลือก (เลือกเป็น attribution-only ได้ ไม่ติด share-alike) — `02`, `03`, `06`, `08`, `09`, `11`, `14`

อีก **7 โฟลเดอร์** มีเลเยอร์ที่เป็น CC-BY-SA 3.0 / GPL เท่านั้น จึงต้องแจกจ่ายต่อแบบ CC-BY-SA:

| โฟลเดอร์ | เลเยอร์ที่บังคับ CC-BY-SA |
|---|---|
| `01` | `neck/tie/necktie` (เนกไท) |
| `04` | `facial/glasses/secretary` (แว่น) |
| `05` | `hair/messy1` (ผม) |
| `07` | `neck/tie/necktie` (เนกไท) |
| `10` | `hair/swoop` (ผม), `neck/tie/necktie` (เนกไท) |
| `12` | `hair/pixie` (ผม), `facial/glasses/secretary` (แว่น) |
| `13` | `neck/tie/necktie` (เนกไท) |

> ⚠️ อย่าก็อปข้อความเครดิตสำเร็จรูปท้าย README ของ repo ต้นทางมาแปะ — มันลงท้ายว่า *"License: Creative Commons Attribution-ShareAlike 3.0"* ซึ่งจะลาก share-alike กลับมาใส่โฟลเดอร์ที่อุตส่าห์เลือกเลเยอร์ OGA-BY มาแล้ว (ตัวบท OGA-BY 3.0: <https://static.opengameart.org/OGA-BY-3.0.txt>)

ในทางปฏิบัติ แพ็กนี้ทั้งแพ็กยังเป็น **CC-BY-SA** อยู่ดีเพราะ `room/tileset.png` (ดูข้อ 2) — ตารางข้างบนมีไว้เผื่อใครหยิบเฉพาะโฟลเดอร์ตัวละครไปใช้ต่อ

เครื่องมือ: ImageMagick (ซ้อนเลเยอร์) + สคริปต์เปลี่ยนสีตามตาราง palette ของ repo ต้นทาง — ไม่มีการวาดหรือแก้พิกเซลด้วยมือ ไม่มี AI-generated art

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
