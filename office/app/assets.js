// office/app/assets.js
//
// โหลด asset manifest (LPC sprite sheet + tileset) ตาม spec §8 — และ fallback เป็น
// placeholder เรขาคณิตในกรอบ 64x64 / tile 32px เดิมเป๊ะ ๆ เมื่อไม่มี manifest ให้โหลด
// (ticket #20/T7 ต้องจบได้เองโดยไม่ต้องรอ T8 ที่จะมาวาง office/assets/ จริง)
//
// กติกา loader (spec §8.1): ลอง custom/ ก่อน (ชนะทั้งชุดถ้ามี manifest.json) ไม่งั้น default/
// ทั้งชุด — ห้ามผสมสองชุด ถ้าทั้งสองโหลดไม่ได้/manifest พัง → placeholder พร้อม console.warn
//
// หมายเหตุ: ใช้ path แบบ relative ("./assets/...") เสมอ ไม่ใช่ root-relative ("/assets/...")
// เพื่อให้ index.html เปิดจาก file:// ได้ตรง ๆ ด้วย (spec §7.6 / เกณฑ์รับของ #20)

"use strict";

export const PLACEHOLDER_FRAME_SIZE = [64, 64];
export const PLACEHOLDER_ANCHOR = [32, 62];
export const PLACEHOLDER_TILE_SIZE = 32;
/** จำนวน "หน้าตา" placeholder ที่ให้ hash เลือกความหลากหลาย (ไม่ผูกกับ manifest จริงใด ๆ) */
export const PLACEHOLDER_FOLDER_COUNT = 6;

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null; // 404 = ไม่มีชุดนี้ (สัญญาณปกติ ไม่ใช่ error)
  return res.json();
}

function isValidManifest(manifest) {
  return Boolean(
    manifest &&
      manifest.character &&
      Array.isArray(manifest.character.frameSize) &&
      manifest.character.frameSize.length === 2 &&
      Array.isArray(manifest.character.folders) &&
      manifest.character.folders.length > 0 &&
      manifest.room &&
      typeof manifest.room.tileSize === "number",
  );
}

async function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`โหลดรูปไม่สำเร็จ: ${url}`));
    img.src = url;
  });
}

/** พยายามโหลด manifest ชุดหนึ่ง (custom หรือ default) — คืน null เมื่อไม่มี/พัง (ไม่ throw) */
async function tryLoadSpriteSet(manifestUrl, setName) {
  let manifest;
  try {
    manifest = await fetchJson(manifestUrl);
  } catch (err) {
    console.warn(`[office-ui] โหลด manifest ชุด ${setName} ไม่สำเร็จ: ${err}`);
    return null;
  }
  if (!manifest) return null; // 404 — เงียบ ๆ ไปลองชุดถัดไป
  if (!isValidManifest(manifest)) {
    console.warn(`[office-ui] manifest ชุด ${setName} รูปแบบไม่ถูกต้อง ข้ามไปใช้ placeholder`);
    return null;
  }

  const baseUrl = new URL(manifestUrl, document.baseURI);
  const charDir = new URL(`characters/`, baseUrl);
  const roomTilesetUrl = new URL(manifest.room.tileset, baseUrl).href;
  const anims = manifest.character.animations || {};

  // map.json เป็น optional: ไม่มี/พัง → ยังใช้ชุดนี้ได้ปกติ แค่ตกกลับไปใช้ zone rect ค่าเริ่มต้นในโค้ด
  // (แยกความล้มเหลวออกจาก tileset โดยตั้งใจ — manifest ที่ไม่ประกาศ room.map ก็ถือว่าถูกต้อง)
  let map = null;
  if (manifest.room.map) {
    try {
      map = await fetchJson(new URL(manifest.room.map, baseUrl).href);
      if (!map) console.warn(`[office-ui] ไม่พบ ${manifest.room.map} ของชุด ${setName} — ใช้ผังห้องค่าเริ่มต้น`);
    } catch (err) {
      console.warn(`[office-ui] อ่าน map ของชุด ${setName} ไม่สำเร็จ: ${err} — ใช้ผังห้องค่าเริ่มต้น`);
      map = null;
    }
  }

  try {
    const [tileset, ...folderImages] = await Promise.all([
      loadImage(roomTilesetUrl),
      ...manifest.character.folders.map(async (folder) => {
        const images = {};
        for (const [animName, def] of Object.entries(anims)) {
          if (def.fallback) continue; // ท่าที่ไม่มีชีตจริง ใช้ fallback ตอน render แทน
          const url = new URL(`${folder}/${def.file}`, charDir).href;
          images[animName] = await loadImage(url);
        }
        return { folder, images };
      }),
    ]);
    const byFolder = {};
    for (const f of folderImages) byFolder[f.folder] = f.images;

    const tileSize = manifest.room.tileSize;
    const roomScale = manifest.room.scale || 1;
    return {
      mode: "sprites",
      setName,
      manifest,
      tileset,
      map, // Tiled JSON ที่ parse แล้ว (หรือ null) — layout.js เป็นคนตีความ
      characterImages: byFolder, // folder -> { animName: HTMLImageElement }
      frameSize: manifest.character.frameSize,
      anchor: manifest.character.anchor || PLACEHOLDER_ANCHOR,
      tileSize,
      roomScale,
      /** px ต่อ tile บนจอจริง — ขนาดต้นฉบับใน tileset คูณ scale (spec §8.2: ชีต 16px ตั้ง scale 2
       *  แล้วสัดส่วนกับตัวละคร 64px ไม่เพี้ยน) นี่คือค่าที่ทุกจุดที่วาดต้องใช้ ไม่ใช่ค่าคงที่ 32 */
      tilePx: tilePxOf(tileSize, roomScale),
      folders: manifest.character.folders,
    };
  } catch (err) {
    console.warn(`[office-ui] โหลดรูปของชุด ${setName} ไม่สำเร็จ: ${err}`);
    return null;
  }
}

/** px ต่อ tile บนจอ = ขนาดต้นฉบับ x scale — ปัดเป็นจำนวนเต็มกันรอยต่อ tile เป็นเส้นบาง ๆ ตอนวาด */
export function tilePxOf(tileSize, scale = 1) {
  const px = Math.round(Number(tileSize) * (Number(scale) || 1));
  return px > 0 ? px : PLACEHOLDER_TILE_SIZE;
}

/** ชุด placeholder เรขาคณิต — export ไว้ให้ bootstrap ใช้เป็นตาข่ายกันจอขาวเมื่อ loadAssets() พังผิดคาด */
export function placeholderAssets() {
  return buildPlaceholderAssets();
}

function buildPlaceholderAssets() {
  return {
    mode: "placeholder",
    map: null,
    frameSize: PLACEHOLDER_FRAME_SIZE,
    anchor: PLACEHOLDER_ANCHOR,
    tileSize: PLACEHOLDER_TILE_SIZE,
    roomScale: 1,
    tilePx: PLACEHOLDER_TILE_SIZE,
    folders: Array.from({ length: PLACEHOLDER_FOLDER_COUNT }, (_, i) => `placeholder-${i}`),
  };
}

/**
 * โหลด asset ตามลำดับ custom → default → placeholder (spec §8.1)
 * @returns {Promise<object>} object หน้าตาต่างกันตาม mode ("sprites" | "placeholder") —
 *   ดูฟิลด์ที่ render.js อ่านจริงในคอมเมนต์ข้างบนแต่ละ branch
 */
export async function loadAssets() {
  const custom = await tryLoadSpriteSet("./assets/custom/manifest.json", "custom");
  if (custom) return custom;

  const def = await tryLoadSpriteSet("./assets/default/manifest.json", "default");
  if (def) return def;

  console.warn(
    "[office-ui] ไม่พบ asset manifest ทั้งชุด custom และ default — ใช้ placeholder เรขาคณิตแทน " +
      "(หน้านี้ยังใช้งานได้ปกติทุกฟีเจอร์ แค่ไม่มีภาพศิลปะจริง)",
  );
  return buildPlaceholderAssets();
}
