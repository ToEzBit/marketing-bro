# วิจัย: ชุด pixel-art asset ฟรีสำหรับ "Office UI" แสดงสถานะ Agent Session

- วันที่: 2026-08-06
- ผู้จัดทำ: research agent (ตรวจทุกข้อกล่าวอ้างกับ primary source — หน้า asset จริง, หน้า license, repo ทางการ — ไม่อิงบล็อกรีวิว)
- บริบท: บอทจะโฮสต์หน้า localhost เป็น "ออฟฟิศพิกเซล" แสดง Agent Session เป็นตัวละครเดินไปมาระหว่าง 6 โซนตามสถานะ (idle / working / รอ Approval / เข้าคิว browser / failed / stopped) โดย asset ชุดแรกเป็นแค่ placeholder และ **Operator ต้องสลับเป็นงานศิลป์ของตัวเองได้ภายหลังโดยไม่ต้องแก้โค้ด**

---

## คำถามที่วิจัย

1. ระบบ LPC (Liberated Pixel Cup) บน OpenGameArt: ฟอร์แมตแผ่นสไปรต์ตัวละคร, มีท่านั่ง/นอนไหม, license ทำงานยังไง, มี tileset ออฟฟิศ/ภายในอาคารไหม
2. Kenney (kenney.nl): แพ็กไหนเหมาะกับห้องออฟฟิศ + ตัวละคร, CC0 จริงไหม, ขนาด tile, ตัวละครมี walk animation ไหม
3. itch.io: แพ็กออฟฟิศ/ภายในสมัยใหม่ที่ดังสุด (โดยเฉพาะ LimeZu) ฟรีแค่ไหน license ว่าอะไร, มีทางเลือก CC0 ไหม
4. License hygiene: commit ไฟล์ PNG ลง git repo (ที่อาจเป็น public) ได้ไหม ต้องมีไฟล์เครดิตอะไร
5. ควรเลือกชุดไหนเป็นหลัก (ตัวละคร / ห้อง) และ style/scale ตีกันตรงไหน
6. โครงไฟล์แบบ swappable ให้ Operator เปลี่ยน art ได้โดยไม่แตะโค้ด

## TL;DR — คำแนะนำ

| ลำดับ | ชุด | เหตุผล | license |
|---|---|---|---|
| **หลัก (ตัวละคร)** | LPC — export จาก [Universal LPC Spritesheet Character Generator](https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/) | มีครบ walk (9 เฟรม 4 ทิศ), sit (นั่งเก้าอี้), idle, hurt (ล้มลงนอนราบ — ใช้แทน sleep ได้) เฟรม 64x64 มาตรฐานเดียวทั้ง ecosystem | CC-BY-SA 3.0 / GPL 3.0 (บางชิ้น OGA-BY / CC-BY / CC0) — **commit ลง repo ได้** ถ้าแนบไฟล์เครดิต |
| **หลัก (ห้อง+เฟอร์นิเจอร์)** | [\[LPC Revised\] The Office](https://opengameart.org/content/lpc-revised-the-office) + [\[LPC\] Wooden Furniture](https://opengameart.org/content/lpc-wooden-furniture) (+ Walls/Floors/Upholstery ในคอลเลกชัน [\[LPC\] Interiors](https://opengameart.org/content/lpc-interiors)) | โต๊ะทำงาน แล็ปท็อป (เปิด/ปิด) เครื่องถ่ายเอกสาร water cooler ครบธีมออฟฟิศ, tile 32x32 สไตล์เดียวกับตัวละคร LPC | CC-BY-SA 3.0 / OGA-BY 3.0 (The Office), CC-BY-SA 4.0/3.0 + GPL 3.0 (Wooden Furniture) — commit ได้ + ต้องเครดิต |
| **รอง (license สะอาดสุด)** | Kenney [Roguelike/RPG pack](https://kenney.nl/assets/roguelike-rpg-pack) + [Roguelike Characters](https://kenney.nl/assets/roguelike-characters) | CC0 ทั้งหมด commit ได้ไร้เงื่อนไข แต่**ตัวละครเป็นภาพนิ่ง ไม่มี walk animation** และ tile 16x16 คนละสเกลกับ LPC | CC0 |
| **สวยสุดแต่ห้าม commit** | LimeZu [Modern Interiors](https://limezu.itch.io/moderninteriors) / [Modern Office - Revamped](https://limezu.itch.io/modernoffice) | มีจริงทั้ง sit และ sleep animation, ตัวเลือกเฟอร์นิเจอร์เยอะสุด แต่ license **ห้าม redistribute** → ลง git repo ไม่ได้, free version ใช้ non-commercial เท่านั้น, Modern Office ปัจจุบันเป็นของเสียเงิน | custom (no redistribution) |

ข้อค้นพบสำคัญเรื่อง license: **แพ็กสาย itch.io เกือบทั้งหมด (LimeZu, Donarg, Penzilla) ห้าม redistribute** — commit PNG ลง GitHub repo คือการ redistribute จึงทำไม่ได้ ต้องออกแบบ layout ให้มีโฟลเดอร์ `custom/` ที่ gitignore ไว้ให้ Operator วาง asset เหล่านี้เอง ส่วนชุดที่ commit ได้จริงคือ Kenney (CC0) กับตระกูล LPC (CC-BY-SA/OGA-BY + แนบเครดิต)

---

## 0) Star-Office-UI (แรงบันดาลใจ) — เรียนรู้อะไรได้บ้าง

Repo: <https://github.com/ringhyacinth/Star-Office-UI>

- เป็น "pixel-style AI office kanban" แสดงสถานะ agent แบบเรียลไทม์ ผูก state → โซนในออฟฟิศ: `idle` → โซฟาพักผ่อน, สถานะทำงาน (`writing`/`researching`/`executing`/`syncing`) → โต๊ะทำงาน, `error` → "bug zone" ([README](https://github.com/ringhyacinth/Star-Office-UI/blob/master/README.md)) — คอนเซปต์เดียวกับ 6 โซนของเรา
- Tech stack: Python/Flask backend + vanilla JS frontend (+ Electron optional) ([README](https://github.com/ringhyacinth/Star-Office-UI/blob/master/README.md))
- **Asset ตัวละคร**: ใช้ของ LimeZu แพ็ก [Animated mini characters 2 \[Platform\] \[FREE\]](https://limezu.itch.io/animated-mini-characters-2-platform-free) — เป็นตัวละคร**มุมมองด้านข้างสำหรับเกม platformer** (แอนิเมชัน Idle/Run/Jump/Attack/Hit) ไม่ใช่ top-down ([หน้าแพ็ก](https://limezu.itch.io/animated-mini-characters-2-platform-free))
- **License**: โค้ดเป็น MIT แต่ art ติดธง "non-commercial use only (learning/demo/discussion only)" และบอกตรง ๆ ว่าถ้าจะใช้เชิงพาณิชย์ให้เปลี่ยน art ทั้งหมดเป็นของตัวเอง ([README](https://github.com/ringhyacinth/Star-Office-UI/blob/master/README.md)) — น่าสังเกตว่า LimeZu ระบุว่า "You may not redistribute it" แต่ repo นี้ vendor ไฟล์ art ไว้ใน repo เลย ถือเป็นแนวปฏิบัติที่**เราไม่ควรทำตาม**
- **รูปแบบไฟล์**: asset วางแบน ๆ ใน `frontend/` (เช่น `guest_anim_1.webp`…`guest_anim_6.webp`, `cats-spritesheet.webp`, `office_bg.webp`, `desk-v3.webp`, `sofa-idle-v3.png`) อ้างชื่อไฟล์ตรง ๆ จาก JS **ไม่มี manifest/config สำหรับสลับ art** ([รายการไฟล์ผ่าน GitHub API](https://api.github.com/repos/ringhyacinth/Star-Office-UI/contents/frontend)) — จุดนี้คือสิ่งที่เราจะทำให้ดีกว่า (ดูข้อ 6)

บทเรียน: คอนเซปต์โซนใช้ได้เลย แต่ (ก) อย่า vendor asset ที่ห้าม redistribute, (ข) ควรมี manifest แทนการ hardcode ชื่อไฟล์ใน JS

## 1) ระบบ LPC บน OpenGameArt

### 1.1 ฟอร์แมตแผ่นสไปรต์ตัวละคร (ตรวจจากไฟล์จริงใน repo ของ generator)

README ของ generator ยืนยันมาตรฐานเฟรม: LPC ดั้งเดิม "stuck to a standard **64x64 format**" และมีแอนิเมชันดั้งเดิม spellcast, slash, thrust, walk, shoot, hurt; ภายหลังขยาย (LPCE) เพิ่ม bow, climb, run, jump ([README](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator))

ผมยืนยันเลย์เอาต์โดย**ดาวน์โหลดไฟล์จริง**จาก `spritesheets/body/bodies/male/` ใน repo ([โฟลเดอร์](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/tree/master/spritesheets/body/bodies/male)) แล้ววัดขนาด:

| ไฟล์ | ขนาดจริง (px) | ตีความ (เฟรม 64x64) |
|---|---|---|
| `walk.png` | 576×256 | 9 เฟรม × 4 ทิศ (แถวละทิศ) |
| `idle.png` | 128×256 | 2 เฟรม × 4 ทิศ |
| `sit.png` | 192×256 | 3 ท่านั่ง × 4 ทิศ |
| `hurt.png` | 384×64 | 6 เฟรม แถวเดียว (หันหน้าลง) — ลำดับภาพคือค่อย ๆ ล้มจนจบที่**ท่านอนราบกับพื้น** |

- ลำดับแถวทิศทาง (ตรวจด้วยตาจากภาพ `walk.png`/`sit.png`): **แถว 1 = up (หันหลัง), แถว 2 = left, แถว 3 = down (หันหน้า), แถว 4 = right**
- รายการไฟล์แอนิเมชันทั้งหมดของ body ชาย (จาก [GitHub API listing](https://api.github.com/repos/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/contents/spritesheets/body/bodies/male)): `backslash, climb, combat_idle, emote, halfslash, hurt, idle, jump, run, shoot, sit, slash, spellcast, thrust, walk` — **มี `sit` แต่ไม่มี `sleep`/`lie down` ตรง ๆ**
- ทางเลือกท่านอน: ใช้เฟรมท้ายของ `hurt` (ท่านอนราบ) เป็น sleep/rest หรือใช้ `sit` + วาด bubble "Zzz" ทับ — เป็นการตีความของเรา ไม่ใช่ฟีเจอร์ที่แพ็กระบุ
- แผ่นรวมแบบเก่า ("universal sheet" ของ Makrohn) รวมแอนิเมชันดั้งเดิม 6 ชุดไว้แผ่นเดียว (ตัวย่อในไฟล์: "sc: spellcast, th: thrust, wc: walkcycle, sl: slash, sh: shoot, hu: hurt") และประกาศว่า "According to the rules of the LPC all art submissions were dual licensed under both GNU GPL 3.0 and CC-BY-SA 3.0" ([makrohn/Universal-LPC-spritesheet README](https://github.com/makrohn/Universal-LPC-spritesheet)) — repo generator ปัจจุบันย้ายไปเก็บแบบ**แยกไฟล์ต่อแอนิเมชัน**แล้ว ซึ่งเหมาะกับ manifest ของเรากว่า

### 1.2 Universal LPC Spritesheet Character Generator

- Repo ทางการ (ย้ายจาก sanderfrenken ไปอยู่ org LiberatedPixelCup แล้ว — repo เดิม redirect): <https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator> / เว็บใช้งานจริง: <https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/>
- **Licensing model** (ข้อความจาก README, ตัด quote ตรง):
  - "Each piece of artwork distributed from this project (all images in the `spritesheets` subdirectory) is licensed under one or more of the following supported open license(s): CC0, CC-BY-SA, CC-BY, OGA-BY, GPL"
  - "If you generate a sprite using this tool, or use individual images taken directly from the `spritesheets` subdirectory from this repo, you must at least credit all the authors (except for CC0 licensed artwork)"
  - วิธีให้เครดิตเลือกได้สองทาง: "Distribute the entire CREDITS.csv file along with your project" หรือ "Distribute a composed list containing the credits for the assets you use" (ตัวเว็บ generator มีปุ่ม export รายชื่อเครดิตเฉพาะชิ้นที่เลือก)
  - เงื่อนไข CC-BY-SA ที่ README สรุป: "Must credit the authors, may not encrypt or protect AND must distribute any derivative artwork or modifications under CC-BY-SA 4.0 or later"
  ([README](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator))
- สรุป: ไม่ใช่ "dual license ก้อนเดียวทั้ง repo" แต่เป็น **license รายชิ้น** — ต้อง export เครดิตของชิ้นที่ใช้เสมอ ถ้าเลือกเฉพาะชิ้นที่เป็น CC0/OGA-BY/CC-BY จะเลี่ยงเงื่อนไข share-alike ได้ แต่ใช้ค่า default (CC-BY-SA) ก็ commit ได้เพียงแนบเครดิต

### 1.3 Entry ตัวละคร LPC ที่เกี่ยวข้อง (ยืนยัน license รายหน้า)

- **LPC Base Assets** (ต้นตระกูล จากการแข่ง LPC 2012): license "CC-BY-SA 3.0" + "GPL 3.0", เครดิตรายชิ้นอยู่ใน CREDITS.TXT ("Images are copyright their respective authors, as listed in CREDITS.TXT") — <https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles>
- **LPC Character Bases** (BenCreating + คณะ): body 6 แบบ + หัวหลายเผ่าพันธุ์ มีแอนิเมชัน walk, cast, thrust, slash, shoot, hurt, **sit**, idle, jump; license CC-BY-SA 3.0 + GPL 3.0 — <https://opengameart.org/content/lpc-character-bases>
- **LPC Revised Character Basics** (Eliza Wyatt): idle, walk (8 เฟรม), run (8 เฟรม), jump, **sitting (still frames)**, emote; license CC-BY-SA 3.0 / GPL 3.0 / **OGA-BY 3.0** — <https://opengameart.org/content/lpc-revised-character-basics>
- **\[LPC\] Medieval fantasy character sprites** (wulax — ชุดที่ทำให้เกิด universal sheet): CC-BY-SA 3.0 / GPL 3.0 / OGA-BY 3.0 และผู้เขียน waive ข้อ DRM ของ CC ("I waive the DRM-limitation clause … provided you give credit as specified") — <https://opengameart.org/content/lpc-medieval-fantasy-character-sprites>

### 1.4 Tileset ออฟฟิศ/ภายในอาคารตระกูล LPC

- **\[LPC Revised\] The Office** (Eliza Wyatt / Death's Darling) — ตรงธีมสุด: โต๊ะทำงานไม้, **แล็ปท็อปหมุนได้ 4 ทิศ สถานะเปิด/ปิด**, เครื่องถ่ายเอกสาร (ไฟเขียว animated), โทรศัพท์, water cooler, TV จอกว้าง, ถังขยะ ฯลฯ ขนาดฐาน **32x32** license "CC-BY-SA 3.0" + "OGA-BY 3.0" เครดิต "Eliza Wyatt" (บางชิ้นมีส่วนของ Lanea Zimmerman/Sharm) — <https://opengameart.org/content/lpc-revised-the-office>
- **\[LPC\] Wooden Furniture** (bluecarrot16 + คณะ): โต๊ะ เก้าอี้ ตู้ เตียง ม้านั่ง เปียโน แยกเลเยอร์ให้ recolor ได้ license CC-BY-SA 4.0 / CC-BY-SA 3.0 / GPL 3.0 เงื่อนไขเครดิตชัด: "Please link back to https://opengameart.org/content/lpc-wooden-furniture. See CREDITS-\*.txt. All information in this file must be included." — <https://opengameart.org/content/lpc-wooden-furniture>
- **\[LPC\] House interior and decorations** (Reemax + คณะ): เฟอร์นิเจอร์บ้านสเกล 32x32 (ตู้ 32x64, เตียง 32x96) license CC-BY-SA 3.0 / GPL 3.0 / GPL 2.0 เครดิตตาม credits.txt ในไฟล์ — <https://opengameart.org/content/lpc-house-interior-and-decorations>
- **\[LPC\] Interiors** (bluecarrot16) เป็นหน้าคอลเลกชันรวมลิงก์ \[LPC\] Walls / Floors / Wooden Furniture / Upholstery (โซฟาสำหรับโซนพักอยู่ใน Upholstery) — <https://opengameart.org/content/lpc-interiors> (license ดูรายแพ็กย่อย)

## 2) Kenney (kenney.nl) — CC0 ทั้งหมด

ทุกหน้า asset ระบุ license บนหน้าเว็บเองว่า "Creative Commons CC0":

- **Roguelike/RPG pack**: tile **16x16** จำนวน ~1,700 tiles มีหมวดเฟอร์นิเจอร์ภายในอาคาร (indoor) — เหมาะทำห้อง/ของตกแต่ง — <https://kenney.nl/assets/roguelike-rpg-pack>
- **Roguelike Characters**: ~450 ไฟล์ ตัวละครแบบ layer ประกอบเอง (ฐาน+เสื้อผ้า) license CC0 — <https://kenney.nl/assets/roguelike-characters> — **ภาพนิ่ง ไม่มีแอนิเมชัน**: ยืนยันจาก entry ทางการของ Kenney บน OpenGameArt (448 sprites, มีคอมเมนต์ระบุว่า static) — <https://opengameart.org/content/roguelike-character-pack>
- **Tiny Town**: 16x16, 130 tiles, CC0 — สไตล์น่ารักแต่เนื้อหาเป็นเมือง/ภายนอกมากกว่า — <https://kenney.nl/assets/tiny-town>
- **RPG Urban Pack**: 16x16, 480 tiles, CC0 มีแท็ก character (บนหน้าไม่ได้ระบุว่ามี walk frames) — <https://kenney.nl/assets/rpg-urban-pack>

ข้อสรุปฝั่ง Kenney: license ดีที่สุดในตลาด (CC0 = commit ลง repo public ได้ ไม่ต้องเครดิต) แต่**จุดอ่อนคือตัวละครไม่มี walk animation** — ถ้าใช้ Kenney เป็นหลัก ตัวละครจะ "ลอยไถล" ระหว่างโซนแทนการก้าวเดิน (ยอมรับได้สำหรับ placeholder แต่เสียเสน่ห์)

## 3) itch.io

### 3.1 LimeZu (<https://limezu.itch.io/>) — มาตรฐานของธีม "modern interior" แต่ license แคบ

- **Modern Interiors - RPG Tileset \[16X16\]** — <https://limezu.itch.io/moderninteriors>
  - ฐาน 16x16 มีเวอร์ชันสเกล 32x32 และ 48x48 ในชุดเต็ม (หน้าแพ็กระบุ)
  - **ฟรี**: `Modern_Interiors_Free_v2.2.zip` (1 MB) ≈ 1% ของชุดเต็ม: 16x16 เท่านั้น, พื้น 9 แบบ + วอลเปเปอร์ 8 แบบ, ห้องนั่งเล่น + ห้องเรียน, Room_builder, **ตัวละคร fully animated 4 ตัว** และ**จำกัด non-commercial**: "You CAN use the asset for non commercial purposes (more info in the LICENSE.txt)" ([devlog Free version overview](https://limezu.itch.io/moderninteriors/devlog/244045/free-version-overview-18042021-update))
  - **จ่ายขั้นต่ำ $1.50**: ชุดเต็ม + Character Generator; license บนหน้าแพ็ก: "YOU CAN: Edit and use the asset in any commercial or non commercial project" / "YOU CAN'T: Resell or distribute the asset to others; Edit and resell the asset to others" / "Credits required" (ลิงก์กลับ https://limezu.itch.io/)
  - แอนิเมชันตัวละครที่หน้าแพ็กระบุ: "idle, run, gift, shoot, punch, pick up, read a book, lift, throw" ([หน้าแพ็ก](https://limezu.itch.io/moderninteriors))
  - **sit + sleep มีจริง** ยืนยันจาก devlog ชุด Bedroom Revamp เช่น "Added a sleep animation to all the Character_Generator hairstyles (24 with 7 recolors each)" ([260th update](https://limezu.itch.io/moderninteriors/devlog/248896/260th-update-bedroom-revamp-4)) และ devlog ข้างเคียงพูดถึงการเพิ่ม/แก้ท่า sit ให้ body ทุกไฟล์ ([devlog index](https://limezu.itch.io/moderninteriors/devlog))
- **Modern Office - Revamped \[16x16\]** — <https://limezu.itch.io/modernoffice>
  - **ปัจจุบันไม่ฟรี**: ราคาปกติ $5.00 (ตอนเช็ควันที่ 2026-08-06 ลด 50% เหลือ $2.50) ต้องจ่ายขั้นต่ำจึงโหลดได้
  - 16x16 + เวอร์ชันสเกล 32x/48x, sprite 300+ ชิ้น เฟอร์นิเจอร์ออฟฟิศล้วน **ไม่มีตัวละคร** (ตัวละครใน GIF โปรโมตมาจาก Modern Interiors)
  - license แบบเดียวกัน: ใช้ได้ commercial/non-commercial, ห้าม resell/distribute, "Credits required"
- **Animated mini characters 2 \[Platform\] \[FREE\]** — <https://limezu.itch.io/animated-mini-characters-2-platform-free> (ตัวที่ Star-Office-UI ใช้)
  - ฟรี 3 ตัว (Fish, Yellow, White) แอนิเมชัน Idle/Run/Jump/Attack/Hit — เป็น**มุมมองด้านข้าง (platformer)** ไม่เหมาะกับห้อง top-down
  - license (quote ตรงจากหน้าแพ็ก): "This asset pack can be used in both free and commercial projects. You can modify it to suit your own needs. **You may not redistribute it or resell it.**"

### 3.2 ทางเลือกอื่นบน itch.io

- **Office Interior Tileset (16x16)** โดย Donarg — <https://donarg.itch.io/officetileset> — ตรงธีมมาก (โต๊ะทำงานหลายแบบ คอม แล็ปท็อป printer whiteboard ตู้ vending) มี 16/32/48px แต่**เสียเงิน ($2.00+)**, ภาพนิ่งทั้งหมด ไม่มีตัวละคร, license ห้าม resell/distribute (แม้แก้ไขแล้ว), ห้ามใช้กับ web3/NFT, ห้ามใช้เทรน AI; เครดิต "appreciated but not required"
- **Top-Down Retro Interior** โดย Penzilla — <https://penzilla.itch.io/top-down-retro-interior> — ฟรีแบบ name-your-own-price, 16x16, เฟอร์นิเจอร์ 39 ชิ้น + ของจุกจิก 64 ชิ้น; เงื่อนไข: non-commercial ฟรี / commercial ให้จ่ายราคาแนะนำ, ต้องเครดิต "Graphics created by Penzilla Design", **ห้าม redistribute/resell**
- **16x16 Industrial Tileset** โดย 0x72 — <https://0x72.itch.io/16x16-industrial-tileset> — ตัวอย่างแพ็ก **CC0 แท้บน itch**: "You can use this tileset for whatever you like (CC-0)" แต่ธีมเป็นโรงงาน/อุตสาหกรรม ไม่ใช่ออฟฟิศ (ใช้เป็นของแต่งฉาก server room ได้)
- ข้อสังเกตจากการสำรวจ: **ไม่พบแพ็ก "ออฟฟิศ" คุณภาพดีบน itch.io ที่เป็น CC0** — สาย itch นิยม license แบบ "ใช้ได้แต่ห้ามแจกต่อ" เกือบทั้งหมด ทางเลือก CC0 จริงจังคือ Kenney (ซึ่งมีบน itch ด้วยแต่หน้าอย่างเป็นทางการคือ kenney.nl)

## 4) สรุป License hygiene สำหรับ repo นี้

หลักคิด: ตัวบอทเป็นเครื่องมือ local/private ก็จริง แต่ **repo อยู่บน GitHub — การ commit ไฟล์ asset คือการ redistribute** จึงต้องตัดสินตาม license ของการแจกจ่าย ไม่ใช่การใช้งาน

| แพ็ก | license | commit PNG ลง repo (อาจ public) ได้? | ต้องทำอะไร |
|---|---|---|---|
| Kenney ทุกแพ็ก | CC0 ([ระบุบนหน้า asset](https://kenney.nl/assets/roguelike-rpg-pack)) | **ได้ ไม่มีเงื่อนไข** | ไม่ต้องเครดิต (ใส่เป็นมารยาทได้) |
| สไปรต์จาก LPC generator | รายชิ้น: CC0 / CC-BY / OGA-BY / CC-BY-SA / GPL ([README](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator)) | **ได้** | แนบรายการเครดิตของชิ้นที่ใช้ (export จากตัว generator หรือแนบ CREDITS.csv ทั้งไฟล์); ถ้าแก้ไข art ที่เป็น CC-BY-SA งานแก้ต้องอยู่ใต้ CC-BY-SA ต่อ |
| \[LPC Revised\] The Office | CC-BY-SA 3.0 / OGA-BY 3.0 ([หน้า entry](https://opengameart.org/content/lpc-revised-the-office)) | **ได้** | เครดิต Eliza Wyatt (+ Lanea Zimmerman สำหรับบางชิ้น) ในไฟล์เครดิตของ repo |
| \[LPC\] Wooden Furniture | CC-BY-SA 4.0/3.0 / GPL 3.0 ([หน้า entry](https://opengameart.org/content/lpc-wooden-furniture)) | **ได้** | ลิงก์กลับหน้า entry + รวมเนื้อหา CREDITS-\*.txt ทั้งหมด |
| LimeZu ทุกแพ็ก (รวม free) | custom: ใช้ในโปรเจกต์ได้ แต่ "You may not redistribute it or resell it" ([ตัวอย่าง](https://limezu.itch.io/animated-mini-characters-2-platform-free)); free version ของ Modern Interiors จำกัด non-commercial ([devlog](https://limezu.itch.io/moderninteriors/devlog/244045/free-version-overview-18042021-update)) | **ไม่ได้** | ให้ Operator ดาวน์โหลด/ซื้อเองแล้ววางในโฟลเดอร์ที่ gitignore; ใส่เครดิต LimeZu ใน UI/README ถ้าใช้ |
| Donarg Office Interior / Penzilla Retro Interior | custom no-redistribution | **ไม่ได้** | เหมือน LimeZu (Operator จัดหาเอง) |
| 0x72 Industrial | CC0 ([หน้าแพ็ก](https://0x72.itch.io/16x16-industrial-tileset)) | ได้ | ไม่ต้องเครดิต |

หมายเหตุ dual/multi-license ของ LPC: งาน LPC ประกาศหลาย license พร้อมกัน (เช่น CC-BY-SA 3.0 **หรือ** GPL 3.0) ผู้ใช้เลือกปฏิบัติตามฉบับใดฉบับหนึ่งได้ — สำหรับ repo นี้เลือกฝั่ง CC-BY-SA/OGA-BY แล้วทำไฟล์เครดิตให้ครบจะตรงไปตรงมาที่สุด (การตีความมาตรฐานของ multi-licensing; ตัวประกาศ dual license ดู [makrohn README](https://github.com/makrohn/Universal-LPC-spritesheet))

## 5) คำแนะนำ

### (a) ตัวละคร (ต้องมี เดิน + นั่งโต๊ะ + พัก/หลับ)

**เลือก: LPC ผ่าน Universal LPC Spritesheet Character Generator** (<https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/>)

- ครอบคลุมสถานะทั้ง 6 โซนของเรา: `walk` (เดินย้ายโซน, 9 เฟรม 4 ทิศ), `sit` (นั่งทำงานที่โต๊ะ — Working), `idle` (ยืนรอ — Idle/รอ Approval/คิว browser), `hurt` (ล้มลงนอน — Failed หรือใช้เฟรมนอนราบเป็น Sleep/Stopped), `run`/`jump`/`emote` เป็นของแถม (ยืนยันจากไฟล์จริง — ดู §1.1)
- สร้างตัวละครหลายชุด (สุ่มเสื้อผ้า/สีผม) ได้ไม่จำกัดจากเว็บ generator แล้ว export เป็นแผ่น
- จุดที่ต้องยอม: **ไม่มีท่า sleep ตรง ๆ** (ใช้ hurt/sit+Zzz แทน) และต้องดูแลไฟล์เครดิต

### (b) ห้อง + เฟอร์นิเจอร์ออฟฟิศ

**เลือก: \[LPC Revised\] The Office เป็นแกน** (<https://opengameart.org/content/lpc-revised-the-office>) เสริมด้วย \[LPC\] Wooden Furniture (โต๊ะ/เก้าอี้/ตู้) และ Walls/Floors/Upholstery จากคอลเลกชัน \[LPC\] Interiors (โซฟาโซนพัก)

- ได้ laptop เปิด/ปิด (สื่อสถานะ Working ชัด), เครื่องถ่ายเอกสาร animated, water cooler — ครบสำหรับ 6 โซน
- 32x32 สเกลเดียวกับตัวละคร LPC (ตัวละครสูง ~2 tiles) สไตล์เข้ากันเพราะออกแบบใต้ palette เดียวกัน

### (c) Runner-ups

1. **Kenney Roguelike/RPG pack + Roguelike Characters** — เลือกเมื่ออยากได้ repo ที่ license สะอาด 100% (CC0 ไม่ต้องมีไฟล์เครดิตเลย) และยอมรับตัวละครนิ่ง + งาน 16x16
2. **LimeZu Modern Interiors (+ Modern Office ถ้าซื้อ)** — สวยสุด แอนิเมชันครบสุด (มี sit/sleep จริง) เหมาะเป็น "ชุดที่ Operator อัปเกรดเอง" ผ่านโฟลเดอร์ `custom/` เพราะ commit ไม่ได้และ free version เป็น non-commercial

### เรื่อง scale/style clash

- LPC characters (64x64) + LPC tiles (32x32) = ระบบเดียวกัน ไม่ตีกัน (นี่คือเหตุผลหลักที่เลือกคู่นี้)
- LPC characters บนโลก 16x16 (Kenney/LimeZu) = ตัวละครโตกว่า tile 4 เท่า **ไม่เข้ากัน** — ถ้า Operator สลับ tileset เป็น 16x16 ต้องเรนเดอร์ tile ที่ scale 2x (16→32) ซึ่ง manifest รองรับ (ฟิลด์ `scale` ด้านล่าง) แต่สไตล์เส้น/สัดส่วนยังต่างกันอยู่ดี — แนะนำให้สลับ**ทั้งชุด** (ตัวละคร+ห้อง) พร้อมกันเสมอ
- Kenney (flat, minimal) กับ LPC (มีเส้นขอบ/เฉดสี) สไตล์ต่างกันชัด อย่าผสมในฉากเดียว

## 6) โครงไฟล์แบบ swappable (Operator เปลี่ยน art ได้โดยไม่แก้โค้ด)

หลักการ 3 ข้อ:

1. **ชื่อไฟล์/โฟลเดอร์ fix ตายตัว** — โค้ดรู้จักแค่ path ตาม convention ไม่ hardcode ชื่อ asset เฉพาะชุด (แก้จุดอ่อนของ Star-Office-UI ที่อ้างชื่อไฟล์ตรง ๆ ใน JS)
2. **manifest.json อธิบาย geometry** — โค้ดไม่ assume ขนาดเฟรม/จำนวนเฟรม อ่านจาก manifest เท่านั้น → แผ่นสไปรต์ฟอร์แมตไหนก็ drop-in ได้ถ้าเขียน manifest ให้ตรง
3. **แยก `default/` (commit ได้) กับ `custom/` (gitignore)** — ชุด placeholder ที่ license อนุญาต redistribute อยู่ใน git ส่วนชุด no-redistribution (LimeZu ฯลฯ) Operator วางใน `custom/` เครื่องตัวเอง; ตอนโหลด ถ้ามี `custom/manifest.json` ให้ใช้ชุด custom ทั้งชุด ไม่งั้น fallback เป็น default

### โครงโฟลเดอร์

```
assets/office/
├── default/                     # ชุด placeholder — commit ลง repo (LPC/CC0 เท่านั้น)
│   ├── manifest.json
│   ├── CREDITS.md               # เครดิตตามเงื่อนไข CC-BY-SA/OGA-BY (รวมเนื้อหา CREDITS ของทุกแพ็กที่ใช้)
│   ├── room/
│   │   ├── tileset.png          # แผ่น tile 32x32 (ตัด/รวมจาก The Office + Wooden Furniture + Walls/Floors)
│   │   └── map.json             # แผนที่ห้องรูปแบบ Tiled JSON (วาดใน Tiled editor ได้เลย)
│   ├── characters/
│   │   ├── 01/                  # โฟลเดอร์ละ 1 ตัวละคร ชื่อเป็นเลขลำดับ (บอทหยิบวนตามจำนวน session)
│   │   │   ├── walk.png         # 9 เฟรม x 4 ทิศ (ฟอร์แมต export ของ LPC generator)
│   │   │   ├── idle.png         # 2 เฟรม x 4 ทิศ
│   │   │   ├── sit.png          # 3 เฟรม x 4 ทิศ
│   │   │   └── sleep.png        # (optional) ถ้าไม่มี ใช้ fallback ตาม manifest
│   │   └── 02/ ...
│   └── props/                   # (optional) ของประดับ animated เช่น เครื่องชงกาแฟ
│       └── copier.png
└── custom/                      # gitignore ทั้งโฟลเดอร์ — Operator วาง art ของตัวเอง โครงเดียวกับ default/
    └── (โครงเดียวกัน)
```

กติกา loader (เขียนครั้งเดียวในโค้ด ไม่ต้องแก้อีก): `root = exists(assets/office/custom/manifest.json) ? custom : default` แล้วอ่านทุกอย่างจาก manifest ใต้ root นั้น

### manifest.json (ค่า default อิงฟอร์แมต LPC ที่วัดจริงใน §1.1)

```json
{
  "version": 1,
  "character": {
    "frameSize": [64, 64],
    "directions": ["up", "left", "down", "right"],
    "animations": {
      "walk":  { "file": "walk.png",  "frames": 9, "fps": 8, "loop": true  },
      "idle":  { "file": "idle.png",  "frames": 2, "fps": 2, "loop": true  },
      "sit":   { "file": "sit.png",   "frames": 3, "fps": 0, "loop": false },
      "sleep": { "file": "sleep.png", "frames": 1, "fps": 0, "loop": false,
                 "fallback": "sit", "directions": ["down"] }
    },
    "anchor": [32, 62]
  },
  "room": {
    "tileSize": 32,
    "scale": 1,
    "map": "room/map.json"
  },
  "states": {
    "idle":          { "zone": "lounge",   "anim": "idle"  },
    "working":       { "zone": "desks",    "anim": "sit"   },
    "approval":      { "zone": "approval", "anim": "idle"  },
    "browser_queue": { "zone": "browser",  "anim": "idle"  },
    "failed":        { "zone": "bug",      "anim": "idle"  },
    "stopped":       { "zone": "lounge",   "anim": "sleep" }
  }
}
```

ความหมายฟิลด์:

- `character.frameSize` — ขนาดเฟรม px; สไปรต์ทุกแอนิเมชันของทุกตัวละครใช้ค่าเดียวกัน (LPC = 64x64; ถ้า Operator ใช้ LimeZu 16x16 ก็เปลี่ยนเป็น [16, 32] หรือขนาดจริงของชีตนั้น)
- `character.directions` — ลำดับแถวบน→ล่างของชีต (default = ลำดับแถวของ LPC ที่ตรวจจากไฟล์จริง: up, left, down, right); แอนิเมชันที่มีทิศเดียว (เช่น sleep ของบางแพ็ก หรือ hurt ของ LPC) override เป็น `["down"]` ระดับ animation ได้
- `animations.<name>.file` — path ในโฟลเดอร์ตัวละคร; `frames` = จำนวนคอลัมน์; `fps` (0 = ภาพนิ่ง ใช้เฟรมแรก); `loop`; `fallback` = ชื่อแอนิเมชันสำรองถ้าไฟล์ไม่มี (ทำให้ sheet ที่ไม่มี sleep ก็ drop-in ได้ โดย stopped จะไปใช้ sit แทน — ไม่ crash)
- `animations.<name>.offset` — (optional, ไม่ใส่ = [0,0]) พิกัด px มุมซ้ายบนของ block แอนิเมชันในไฟล์ ใช้กรณีแพ็กที่รวมทุกแอนิเมชันในชีตเดียว (เช่นชีตตัวละคร LimeZu) จะได้ไม่ต้องตัดไฟล์ใหม่
- `character.anchor` — จุด "เท้า" ภายในเฟรม (px) ใช้วางตัวละครบน tile; LPC ตัวยืนเต็มเฟรม 64 สูงจรดประมาณ y=62 กลาง x=32
- `room.tileSize` + `room.scale` — ขนาด tile ต้นฉบับ และตัวคูณตอนเรนเดอร์ (ชุด 16x16 ตั้ง `scale: 2` เพื่อให้สัดส่วนกับตัวละครไม่เพี้ยนมาก)
- `room.map` — ไฟล์แผนที่รูปแบบ **Tiled JSON** (<https://www.mapeditor.org/>) เพื่อให้ Operator แก้ผังห้องด้วย Tiled ได้โดยไม่แตะโค้ด ข้อกำหนดขั้นต่ำ:
  - tile layers วาดพื้น/ผนัง/เฟอร์นิเจอร์ตามปกติ (อ้าง `tileset.png`)
  - object layer ชื่อ `zones` มี object สี่เหลี่ยม **ตั้งชื่อตรงกับค่า `zone` ใน `states`** (default: `lounge`, `desks`, `approval`, `browser`, `bug`) — ขอบเขตที่ตัวละครของโซนนั้นจะเดินไปยืน/นั่ง
  - object layer ชื่อ `seats` (optional) เป็น point objects ในโซน `desks` พร้อม property `dir` (เช่น `up`) — พิกัดเก้าอี้ + ทิศที่นั่งหันเข้าโต๊ะ ให้ท่า `sit` วางถูกที่; ถ้าไม่มี ใช้จุดสุ่มในโซน
- `states` — ผูก 6 สถานะของ Agent Session (ตาม glossary ของ repo: Idle / Working / รอ Approval / คิว browser ตาม ADR 0006 / Failed / Stopped) เข้ากับชื่อโซน + แอนิเมชัน — Operator เปลี่ยนได้ เช่นให้ failed ใช้ท่า hurt ของ LPC ก็เพิ่ม `"hurt": {...}` ใน animations แล้วชี้มาที่นี่

เหตุผลของค่า default:

- `64x64 / 9-2-3 เฟรม / แถว up-left-down-right` มาจากไฟล์จริงของ LPC generator (§1.1) — ชุด placeholder ที่เราจะ commit export มาจากที่นั่นตรง ๆ ไม่ต้องแปลงอะไร
- `tileSize: 32` มาจาก \[LPC Revised\] The Office และเฟอร์นิเจอร์ LPC ที่เป็นฐาน 32x32 ([entry](https://opengameart.org/content/lpc-revised-the-office))
- แยกไฟล์ต่อแอนิเมชัน (ไม่ใช่ universal sheet แผ่นเดียว) ตามโครง `spritesheets/` ปัจจุบันของ generator — ไฟล์เล็ก สลับรายท่าได้ และแพ็กอื่น (Kenney นิ่ง ๆ, LimeZu ชีตรวม+offset) map ลง schema เดียวกันได้หมด
- `fallback` ทำให้ requirement "walk + sit + sleep" ไม่กลายเป็นข้อบังคับของทุกชุด art — ชุดที่มีแค่ idle ก็ยังใช้งานได้ (ทุกสถานะ fallback ลงมาที่ idle ได้)

## 7) สิ่งที่ยังไม่แน่ใจ / ต้องเช็คต่อ

> **ปิดครบแล้ว (2026-08-17, ADR [0009](../adr/0009-office-ui-scope-closed.md))** — เก็บรายการเดิมไว้เป็นบันทึกของงาน
> research รอบนั้น ไม่ต้องเช็คต่อ ดิสโพสิชันกำกับท้ายแต่ละข้อ:
> **resolved** = ตอบแล้ว · **moot** = ไม่เกี่ยวแล้วเพราะสุดท้ายส่งมอบด้วย LPC ล้วน · **won't do** = ตัดสินว่าไม่ทำ

- **LimeZu Modern Interiors ชุดเต็ม (v41.x)**: ยืนยันจาก devlog ปี 2021 ว่ามี sit/sleep แต่โครงไฟล์-จำนวนเฟรมของชีตปัจจุบันต้องซื้อ ($1.50+) มาเปิดดูจริงก่อนเขียน offset ใน manifest; และ "4 fully animated characters" ใน free version ไม่ได้ระบุว่ามีท่าอะไรบ้าง ([devlog](https://limezu.itch.io/moderninteriors/devlog/244045/free-version-overview-18042021-update))
  — **moot**: ไม่ได้ใช้ LimeZu เลย ชุดที่ส่งมอบเป็น LPC ล้วน (`office/assets/default/`)
- **ข้อความ LICENSE.txt ฉบับเต็มของ LimeZu free version**: หน้าเว็บบอกแค่ "non commercial purposes (more info in the LICENSE.txt)" — ไฟล์จริงอยู่ใน zip ต้องดาวน์โหลดมาอ่าน (บอทเราเป็นเครื่องมือภายในของธุรกิจ อาจถูกตีความเป็น commercial use ได้ — จุดนี้ทำให้ free version ของ LimeZu เสี่ยงเกินกว่าจะเป็น default)
  — **moot**: ข้อกังวลนี้เองที่ทำให้ตัด LimeZu ออก ไม่มีไฟล์ของแพ็กนี้ใน repo จึงไม่ต้องอ่าน LICENSE.txt
- **ขนาด sprite ของ Kenney Roguelike Characters**: หน้า kenney.nl ไม่ระบุตัวเลข (ซีรีส์เดียวกันเป็น 16x16 และทวีตของ Kenney เรียกว่า "16x16 Roguelike pack" — <https://x.com/KenneyNL/status/600603088743956480> — แต่ควรวัดไฟล์จริงก่อนใช้)
  — **moot**: ไม่ได้ใช้ Kenney เลย
- **License รายแพ็กย่อยของ \[LPC\] Walls / Floors / Upholstery**: หน้าคอลเลกชัน \[LPC\] Interiors ไม่แสดง license รวม ต้องเปิดหน้า entry ของแต่ละแพ็กตอนหยิบมาใช้จริง (คาดว่า CC-BY-SA/GPL เหมือนพี่น้องในชุด แต่ยังไม่ได้ยืนยันรายหน้า)
  — **resolved**: เปิดหน้า entry รายแพ็กตอนประกอบ tileset จริงแล้ว ผลอยู่ใน
  [`office/assets/default/CREDITS.md`](../../office/assets/default/CREDITS.md) §2 — Walls = CC-BY-SA 3.0,
  Floors = CC-BY-SA 4.0, Upholstery = หลาย license ให้เลือก พร้อมข้อความเครดิตที่ต้นทางบังคับให้แนบ
  (และยกเนื้อ `CREDITS-walls.txt` / `CREDITS-floors.txt` มาไว้ครบใน §5 ของไฟล์นั้น)
- **ราคา Modern Office - Revamped**: ค่าที่เห็น ($5.00 ลดเหลือ $2.50) เป็น snapshot วันที่ 2026-08-06 — เคยมีข้อมูลมือสองว่าแพ็กนี้เคยฟรี แต่หน้าปัจจุบันเป็น paid แล้ว ราคาน่าจะแกว่งตามเซลของ itch
  — **moot**: ไม่ได้ซื้อและไม่ได้ใช้ ห้องประกอบจากแพ็ก LPC ฟรีทั้งหมด
- **จำนวนเฟรมของแอนิเมชัน LPC อื่น ๆ** (run, jump, emote, climb ฯลฯ): ผมวัดเฉพาะ walk/idle/sit/hurt — ตัวอื่นให้วัดจากไฟล์ใน `spritesheets/` ตอน implement (แนวทางเดียวกับ §1.1)
  — **moot**: ชุดที่ส่งมอบใช้แค่ `walk` / `idle` / `sit` (`sleep` fallback ไป `sit`) ไม่มีท่าอื่นในแผน
- **สถานะ "waiting-for-Approval" ควรมีท่าเฉพาะไหม**: LPC มี `emote.png` (มี bubble อารมณ์) อาจใช้สื่อ "ยกมือรอ Approval" ได้ — ยังไม่ได้ตรวจเนื้อหาเฟรมของไฟล์นี้
  — **won't do**: โซน Approval สื่อด้วยตำแหน่งโซน + นาฬิกานับถอยหลังอยู่แล้ว ท่าเฉพาะเป็นงานปรับความสวย
  ซึ่งปิดรับตาม ADR 0009
