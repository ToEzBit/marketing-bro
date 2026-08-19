/**
 * Recurrence model for Schedules (ADR 0004): parses what `/schedule create`
 * accepts and computes when the next Run fires. Pure host-local time — the
 * clock a person set on this machine is the clock their schedule follows.
 *
 * Two shapes, agreed in the domain model:
 *  - interval  — "ทุก 30 นาที / ทุก 2 ชั่วโมง", a grid anchored at creation
 *  - clock     — "ทุกวัน 08:00", "ทุก 3 วัน 21:00", "ทุกจันทร์/พุธ 09:00"
 *
 * A clock recurrence holds a *list* of times a day ("ทุกวัน 09:00,13:00,19:00")
 * so one Schedule can cover every publish window of the Content Calendar
 * without turning into one Schedule — and one Discord thread — per window
 * (ADR 0011).
 */

/** A time of day on the Host's clock. */
export type TimeOfDay = { hour: number; minute: number };

export type Recurrence =
  | { kind: "interval"; everyMs: number }
  | { kind: "clock"; times: TimeOfDay[]; everyDays: number }
  | { kind: "clock"; times: TimeOfDay[]; days: number[] };

/** The pre-ADR-0011 clock shape, kept only so loading old state can migrate it. */
export type LegacyClock =
  | { kind: "clock"; hour: number; minute: number; everyDays: number }
  | { kind: "clock"; hour: number; minute: number; days: number[] };

export type ParseResult =
  | { ok: true; recurrence: Recurrence }
  | { ok: false; error: string };

/** Fastest allowed schedule — a 1-minute loop is a runaway agent, not a plan. */
const MIN_INTERVAL_MS = 5 * 60_000;

/**
 * Ceiling on times per day. Well above the handful of publish windows a
 * Content Calendar needs, and low enough that a slip of the comma cannot turn
 * a schedule into a polling loop.
 */
const MAX_CLOCK_TIMES = 12;

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

function minutesOf(time: TimeOfDay): number {
  return time.hour * 60 + time.minute;
}

/**
 * `at` takes one time or several, comma-separated. The result is sorted and
 * deduplicated so every caller can walk it front to back and stop at the
 * first hit.
 */
function parseTimes(at: string): TimeOfDay[] | undefined {
  const parts = at
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;

  const byMinute = new Map<number, TimeOfDay>();
  for (const part of parts) {
    const match = TIME_PATTERN.exec(part);
    if (!match) return undefined;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return undefined;
    byMinute.set(hour * 60 + minute, { hour, minute });
  }
  return [...byMinute.keys()].sort((a, b) => a - b).map((key) => byMinute.get(key)!);
}

/**
 * The MIN_INTERVAL_MS guard, applied within a day: two times a minute apart
 * would start a Run while the previous one is still going, which is exactly
 * what the 5-minute floor exists to prevent.
 */
function checkTimes(times: TimeOfDay[]): string | undefined {
  if (times.length > MAX_CLOCK_TIMES) {
    return `ตั้งเวลาได้มากที่สุด ${MAX_CLOCK_TIMES} เวลาต่อวัน`;
  }
  for (let i = 1; i < times.length; i += 1) {
    const gap = minutesOf(times[i]!) - minutesOf(times[i - 1]!);
    if (gap * 60_000 < MIN_INTERVAL_MS) {
      return "เวลาที่ตั้งไว้ต้องห่างกันอย่างน้อย 5 นาที";
    }
  }
  return undefined;
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

  const times = at !== undefined ? parseTimes(at) : undefined;
  if (at !== undefined && !times) {
    return {
      ok: false,
      error:
        `เวลา \`${at}\` ไม่ถูกต้อง — ใช้รูปแบบ 24 ชั่วโมง เช่น \`08:00\` ` +
        "หรือหลายเวลาคั่นด้วยจุลภาค เช่น `09:00,13:00,19:00`",
    };
  }
  if (times) {
    const problem = checkTimes(times);
    if (problem) return { ok: false, error: problem };
  }

  if (days !== undefined) {
    if (every !== undefined) {
      return { ok: false, error: "เลือกอย่างใดอย่างหนึ่ง: `days` (วันในสัปดาห์) หรือ `every` (ทุก N นาที/ชั่วโมง/วัน)" };
    }
    if (!times) {
      return { ok: false, error: "ระบุ `days` ต้องระบุ `at` ด้วย เช่น `days: mon,wed` + `at: 09:00`" };
    }
    const parsedDays = parseDays(days);
    if (!parsedDays) {
      return { ok: false, error: `วัน \`${days}\` ไม่ถูกต้อง — ใช้ mon,tue,wed,thu,fri,sat,sun คั่นด้วยจุลภาค` };
    }
    return { ok: true, recurrence: { kind: "clock", times, days: parsedDays } };
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
      if (!times) {
        return { ok: false, error: "รอบเป็นวันต้องระบุเวลาด้วย เช่น `every: 3d` + `at: 21:00`" };
      }
      return { ok: true, recurrence: { kind: "clock", times, everyDays: value } };
    }

    if (times) {
      return { ok: false, error: "`at` ใช้ได้กับรอบเป็นวันเท่านั้น — รอบนาที/ชั่วโมงยิงตามระยะห่าง ไม่มีเวลาตายตัว" };
    }
    const everyMs = value * (unit === "h" ? 3_600_000 : 60_000);
    if (everyMs < MIN_INTERVAL_MS) {
      return { ok: false, error: "รอบถี่สุดที่ตั้งได้คือ 5 นาที (`5m`)" };
    }
    return { ok: true, recurrence: { kind: "interval", everyMs } };
  }

  if (times) {
    return { ok: true, recurrence: { kind: "clock", times, everyDays: 1 } };
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

  // `times` is sorted, so the first one that lands after `after` on the first
  // eligible day is the answer — later days can only be later.
  if ("days" in recurrence) {
    const day = startOfDay(after);
    // Eight steps: a full week of candidates, plus today again for a list
    // whose only match is today but whose times have all passed.
    for (let step = 0; step <= 7; step += 1) {
      if (recurrence.days.includes(day.getDay())) {
        const hit = firstTimeAfter(day, recurrence.times, after);
        if (hit) return hit;
      }
      day.setDate(day.getDate() + 1);
    }
    // Unreachable: parseDays never returns an empty set, and parseTimes never
    // returns an empty list.
    throw new Error("recurrence has no eligible day");
  }

  const day = startOfDay(anchor);
  for (;;) {
    const hit = firstTimeAfter(day, recurrence.times, after);
    if (hit) return hit;
    day.setDate(day.getDate() + recurrence.everyDays);
  }
}

function startOfDay(from: Date): Date {
  const day = new Date(from);
  day.setHours(0, 0, 0, 0);
  return day;
}

/** The earliest of `times` on `day` that falls strictly after `after`. */
function firstTimeAfter(day: Date, times: TimeOfDay[], after: Date): Date | undefined {
  for (const time of times) {
    const candidate = new Date(day);
    candidate.setHours(time.hour, time.minute, 0, 0);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  return undefined;
}

/**
 * Records written before `at` accepted several times a day stored one
 * `hour`/`minute` pair. Fold them into the list shape when state is loaded,
 * so nothing downstream has to know the old layout ever existed.
 */
export function normalizeRecurrence(recurrence: Recurrence | LegacyClock): Recurrence {
  if (recurrence.kind !== "clock") return recurrence;
  if ("times" in recurrence) return recurrence;
  const times = [{ hour: recurrence.hour, minute: recurrence.minute }];
  return "days" in recurrence
    ? { kind: "clock", times, days: recurrence.days }
    : { kind: "clock", times, everyDays: recurrence.everyDays };
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
  const time = recurrence.times.map((at) => `${pad(at.hour)}:${pad(at.minute)}`).join(", ");
  if ("days" in recurrence) {
    const names = recurrence.days.map((day) => THAI_DAY_NAMES[day]).join(", ");
    return `ทุกวัน${names} เวลา ${time}`;
  }
  return recurrence.everyDays === 1
    ? `ทุกวัน เวลา ${time}`
    : `ทุก ${recurrence.everyDays} วัน เวลา ${time}`;
}
