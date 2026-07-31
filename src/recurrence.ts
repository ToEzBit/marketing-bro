/**
 * Recurrence model for Schedules (ADR 0004): parses what `/schedule create`
 * accepts and computes when the next Run fires. Pure host-local time — the
 * clock a person set on this machine is the clock their schedule follows.
 *
 * Two shapes, agreed in the domain model:
 *  - interval  — "ทุก 30 นาที / ทุก 2 ชั่วโมง", a grid anchored at creation
 *  - clock     — "ทุกวัน 08:00", "ทุก 3 วัน 21:00", "ทุกจันทร์/พุธ 09:00"
 */

export type Recurrence =
  | { kind: "interval"; everyMs: number }
  | { kind: "clock"; hour: number; minute: number; everyDays: number }
  | { kind: "clock"; hour: number; minute: number; days: number[] };

export type ParseResult =
  | { ok: true; recurrence: Recurrence }
  | { ok: false; error: string };

/** Fastest allowed schedule — a 1-minute loop is a runaway agent, not a plan. */
const MIN_INTERVAL_MS = 5 * 60_000;

const EVERY_PATTERN = /^(\d+)\s*([mhd])$/i;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

/** getDay() numbering: 0 = Sunday. */
const DAY_NAMES: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const THAI_DAY_NAMES = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์"];

function parseTime(at: string): { hour: number; minute: number } | undefined {
  const match = TIME_PATTERN.exec(at.trim());
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return { hour, minute };
}

function parseDays(days: string): number[] | undefined {
  const names = days
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (names.length === 0) return undefined;
  const numbers = new Set<number>();
  for (const name of names) {
    const day = DAY_NAMES[name];
    if (day === undefined) return undefined;
    numbers.add(day);
  }
  return [...numbers].sort((a, b) => a - b);
}

export function parseRecurrence(input: {
  every?: string | undefined;
  at?: string | undefined;
  days?: string | undefined;
}): ParseResult {
  const every = input.every?.trim();
  const at = input.at?.trim();
  const days = input.days?.trim();

  const time = at !== undefined ? parseTime(at) : undefined;
  if (at !== undefined && !time) {
    return { ok: false, error: `เวลา \`${at}\` ไม่ถูกต้อง — ใช้รูปแบบ 24 ชั่วโมง เช่น \`08:00\` หรือ \`21:30\`` };
  }

  if (days !== undefined) {
    if (every !== undefined) {
      return { ok: false, error: "เลือกอย่างใดอย่างหนึ่ง: `days` (วันในสัปดาห์) หรือ `every` (ทุก N นาที/ชั่วโมง/วัน)" };
    }
    if (!time) {
      return { ok: false, error: "ระบุ `days` ต้องระบุ `at` ด้วย เช่น `days: mon,wed` + `at: 09:00`" };
    }
    const parsedDays = parseDays(days);
    if (!parsedDays) {
      return { ok: false, error: `วัน \`${days}\` ไม่ถูกต้อง — ใช้ mon,tue,wed,thu,fri,sat,sun คั่นด้วยจุลภาค` };
    }
    return { ok: true, recurrence: { kind: "clock", ...time, days: parsedDays } };
  }

  if (every !== undefined) {
    const match = EVERY_PATTERN.exec(every);
    if (!match) {
      return { ok: false, error: `รอบ \`${every}\` ไม่ถูกต้อง — ใช้ตัวเลขตามด้วยหน่วย m/h/d เช่น \`30m\`, \`2h\`, \`3d\`` };
    }
    const value = Number(match[1]);
    const unit = match[2]!.toLowerCase();
    if (value <= 0) {
      return { ok: false, error: "รอบเวลาต้องมากกว่าศูนย์" };
    }

    if (unit === "d") {
      if (!time) {
        return { ok: false, error: "รอบเป็นวันต้องระบุเวลาด้วย เช่น `every: 3d` + `at: 21:00`" };
      }
      return { ok: true, recurrence: { kind: "clock", ...time, everyDays: value } };
    }

    if (time) {
      return { ok: false, error: "`at` ใช้ได้กับรอบเป็นวันเท่านั้น — รอบนาที/ชั่วโมงยิงตามระยะห่าง ไม่มีเวลาตายตัว" };
    }
    const everyMs = value * (unit === "h" ? 3_600_000 : 60_000);
    if (everyMs < MIN_INTERVAL_MS) {
      return { ok: false, error: "รอบถี่สุดที่ตั้งได้คือ 5 นาที (`5m`)" };
    }
    return { ok: true, recurrence: { kind: "interval", everyMs } };
  }

  if (time) {
    return { ok: true, recurrence: { kind: "clock", ...time, everyDays: 1 } };
  }

  return { ok: false, error: "ระบุรอบเวลาอย่างน้อยหนึ่งอย่าง: `every` (เช่น 30m, 2h, 3d) หรือ `at` (เช่น 08:00) หรือ `days` + `at`" };
}

/**
 * The first moment strictly after `after` that the schedule fires. `anchor` is
 * the schedule's creation time; interval and every-N-days grids count from it,
 * so downtime never shifts the grid — missed points are simply gone (ADR 0004:
 * the engine never back-fills).
 */
export function nextFireAt(recurrence: Recurrence, after: Date, anchor: Date): Date {
  if (recurrence.kind === "interval") {
    const elapsed = after.getTime() - anchor.getTime();
    const steps = Math.max(1, Math.floor(elapsed / recurrence.everyMs) + 1);
    return new Date(anchor.getTime() + steps * recurrence.everyMs);
  }

  if ("days" in recurrence) {
    const candidate = new Date(after);
    candidate.setHours(recurrence.hour, recurrence.minute, 0, 0);
    if (candidate.getTime() <= after.getTime()) candidate.setDate(candidate.getDate() + 1);
    while (!recurrence.days.includes(candidate.getDay())) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate;
  }

  const candidate = new Date(anchor);
  candidate.setHours(recurrence.hour, recurrence.minute, 0, 0);
  while (candidate.getTime() <= after.getTime()) {
    candidate.setDate(candidate.getDate() + recurrence.everyDays);
  }
  return candidate;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Thai one-liner for `/schedule list` and the schedule thread header. */
export function describeRecurrence(recurrence: Recurrence): string {
  if (recurrence.kind === "interval") {
    return recurrence.everyMs % 3_600_000 === 0
      ? `ทุก ${recurrence.everyMs / 3_600_000} ชั่วโมง`
      : `ทุก ${recurrence.everyMs / 60_000} นาที`;
  }
  const time = `${pad(recurrence.hour)}:${pad(recurrence.minute)}`;
  if ("days" in recurrence) {
    const names = recurrence.days.map((day) => THAI_DAY_NAMES[day]).join(", ");
    return `ทุกวัน${names} เวลา ${time}`;
  }
  return recurrence.everyDays === 1
    ? `ทุกวัน เวลา ${time}`
    : `ทุก ${recurrence.everyDays} วัน เวลา ${time}`;
}
