/**
 * Run with: npx tsx src/recurrence.test.ts
 * Asserts the schedule recurrence model: what `/schedule create` accepts and
 * when the next Run fires. All times are host-local (ADR 0004).
 */
import assert from "node:assert/strict";
import {
  describeRecurrence,
  nextFireAt,
  normalizeRecurrence,
  parseRecurrence,
  type Recurrence,
} from "./recurrence.js";

let failures = 0;

function check(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok  ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${label}`);
    console.error(`      ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parsed(input: { every?: string; at?: string; days?: string }): Recurrence {
  const result = parseRecurrence(input);
  assert.equal(result.ok, true, `expected ok, got: ${result.ok ? "" : result.error}`);
  return (result as { ok: true; recurrence: Recurrence }).recurrence;
}

function parseError(input: { every?: string; at?: string; days?: string }): string {
  const result = parseRecurrence(input);
  assert.equal(result.ok, false, "expected a parse error");
  return (result as { ok: false; error: string }).error;
}

/** Local-time Date builder, keeping tests readable. */
function at(iso: string): Date {
  const [date, time] = iso.split(" ") as [string, string];
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}

console.log("parseRecurrence accepts the agreed forms");

check("every 30m is an interval", () => {
  assert.deepEqual(parsed({ every: "30m" }), { kind: "interval", everyMs: 30 * 60_000 });
});

check("every 2h is an interval", () => {
  assert.deepEqual(parsed({ every: "2h" }), { kind: "interval", everyMs: 2 * 3_600_000 });
});

check("at 08:00 alone means daily", () => {
  assert.deepEqual(parsed({ at: "08:00" }), {
    kind: "clock",
    times: [{ hour: 8, minute: 0 }],
    everyDays: 1,
  });
});

check("every 3d with at 21:00 is an every-N-days clock", () => {
  assert.deepEqual(parsed({ every: "3d", at: "21:00" }), {
    kind: "clock",
    times: [{ hour: 21, minute: 0 }],
    everyDays: 3,
  });
});

check("days mon,wed with at 09:00 is a weekday clock", () => {
  assert.deepEqual(parsed({ days: "mon,wed", at: "09:00" }), {
    kind: "clock",
    times: [{ hour: 9, minute: 0 }],
    days: [1, 3],
  });
});

check("day names are case-insensitive and deduplicated, output sorted", () => {
  assert.deepEqual(parsed({ days: "FRI, mon, fri", at: "18:30" }), {
    kind: "clock",
    times: [{ hour: 18, minute: 30 }],
    days: [1, 5],
  });
});

check("at takes several times a day, sorted and deduplicated", () => {
  assert.deepEqual(parsed({ at: "19:00,09:00,13:00,09:00" }), {
    kind: "clock",
    times: [
      { hour: 9, minute: 0 },
      { hour: 13, minute: 0 },
      { hour: 19, minute: 0 },
    ],
    everyDays: 1,
  });
});

check("several times a day combine with days and with every N days", () => {
  assert.deepEqual(parsed({ days: "mon", at: "09:00, 17:30" }), {
    kind: "clock",
    times: [
      { hour: 9, minute: 0 },
      { hour: 17, minute: 30 },
    ],
    days: [1],
  });
  assert.deepEqual(parsed({ every: "2d", at: "08:00,20:00" }), {
    kind: "clock",
    times: [
      { hour: 8, minute: 0 },
      { hour: 20, minute: 0 },
    ],
    everyDays: 2,
  });
});

console.log("parseRecurrence rejects what the model forbids");

check("no options at all", () => {
  parseError({});
});

check("interval shorter than 5 minutes", () => {
  parseError({ every: "1m" });
  parseError({ every: "4m" });
  assert.equal(parsed({ every: "5m" }).kind, "interval");
});

check("zero and garbage intervals", () => {
  parseError({ every: "0m" });
  parseError({ every: "0d", at: "08:00" });
  parseError({ every: "banana" });
  parseError({ every: "10x" });
  parseError({ every: "-5m" });
});

check("every in days requires at", () => {
  parseError({ every: "2d" });
});

check("minute/hour intervals reject at and days", () => {
  parseError({ every: "30m", at: "08:00" });
  parseError({ every: "2h", days: "mon" });
});

check("days requires at and rejects every", () => {
  parseError({ days: "mon,wed" });
  parseError({ days: "mon", every: "1d", at: "08:00" });
});

check("bad clock times", () => {
  parseError({ at: "24:00" });
  parseError({ at: "12:60" });
  parseError({ at: "8am" });
  assert.equal(parsed({ at: "23:59" }).kind, "clock");
  assert.equal(parsed({ at: "0:00" }).kind, "clock");
});

check("times closer together than the 5-minute floor", () => {
  parseError({ at: "09:00,09:04" });
  assert.equal(parsed({ at: "09:00,09:05" }).kind, "clock");
});

check("more times a day than the ceiling allows", () => {
  const thirteen = Array.from({ length: 13 }, (_, i) => `${String(i + 6).padStart(2, "0")}:00`);
  parseError({ at: thirteen.join(",") });
  assert.equal(parsed({ at: thirteen.slice(0, 12).join(",") }).kind, "clock");
});

check("one bad time poisons the whole list", () => {
  parseError({ at: "09:00,25:00" });
  parseError({ at: "09:00,8am" });
  parseError({ at: "," });
  // A trailing comma is tolerated, the same way `days` tolerates one.
  assert.deepEqual(parsed({ at: "09:00," }), {
    kind: "clock",
    times: [{ hour: 9, minute: 0 }],
    everyDays: 1,
  });
});

check("unknown day names", () => {
  parseError({ days: "mon,funday", at: "08:00" });
  parseError({ days: "", at: "08:00" });
});

console.log("nextFireAt: interval schedules fire on the grid from their anchor");

const anchor = at("2026-07-31 10:00");

check("first fire is one interval after creation, never immediately", () => {
  const rec: Recurrence = { kind: "interval", everyMs: 30 * 60_000 };
  assert.deepEqual(nextFireAt(rec, anchor, anchor), at("2026-07-31 10:30"));
});

check("next fire lands on the grid even after downtime", () => {
  const rec: Recurrence = { kind: "interval", everyMs: 30 * 60_000 };
  // Bot slept through 10:30, 11:00, 11:30; woke at 11:47 → next grid point.
  assert.deepEqual(nextFireAt(rec, at("2026-07-31 11:47"), anchor), at("2026-07-31 12:00"));
});

check("a fire exactly on a grid point schedules the following one", () => {
  const rec: Recurrence = { kind: "interval", everyMs: 30 * 60_000 };
  assert.deepEqual(nextFireAt(rec, at("2026-07-31 11:00"), anchor), at("2026-07-31 11:30"));
});

console.log("nextFireAt: daily / every-N-days clocks");

check("daily at 08:00 created at 07:00 fires the same morning", () => {
  const rec: Recurrence = { kind: "clock", times: [{ hour: 8, minute: 0 }], everyDays: 1 };
  const created = at("2026-07-31 07:00");
  assert.deepEqual(nextFireAt(rec, created, created), at("2026-07-31 08:00"));
});

check("daily at 08:00 created at 09:00 waits for tomorrow", () => {
  const rec: Recurrence = { kind: "clock", times: [{ hour: 8, minute: 0 }], everyDays: 1 };
  const created = at("2026-07-31 09:00");
  assert.deepEqual(nextFireAt(rec, created, created), at("2026-08-01 08:00"));
});

check("every 3 days counts from the creation date", () => {
  const rec: Recurrence = { kind: "clock", times: [{ hour: 21, minute: 0 }], everyDays: 3 };
  const created = at("2026-07-31 22:00"); // past 21:00 → day 0 already gone
  assert.deepEqual(nextFireAt(rec, created, created), at("2026-08-03 21:00"));
  // After that fire, the next one is 3 days later again.
  assert.deepEqual(nextFireAt(rec, at("2026-08-03 21:00"), created), at("2026-08-06 21:00"));
});

check("every 3 days stays on its grid across downtime", () => {
  const rec: Recurrence = { kind: "clock", times: [{ hour: 21, minute: 0 }], everyDays: 3 };
  const created = at("2026-07-31 20:00"); // grid: 7-31, 8-03, 8-06 …
  assert.deepEqual(nextFireAt(rec, at("2026-08-05 12:00"), created), at("2026-08-06 21:00"));
});

console.log("nextFireAt: weekday clocks");

check("mon/wed at 09:00 from a Friday goes to Monday", () => {
  const rec: Recurrence = { kind: "clock", times: [{ hour: 9, minute: 0 }], days: [1, 3] };
  // 2026-07-31 is a Friday; 2026-08-03 is a Monday.
  assert.deepEqual(nextFireAt(rec, at("2026-07-31 10:00"), anchor), at("2026-08-03 09:00"));
});

check("fires later the same day when the time is still ahead", () => {
  const rec: Recurrence = { kind: "clock", times: [{ hour: 9, minute: 0 }], days: [5] }; // Friday
  assert.deepEqual(nextFireAt(rec, at("2026-07-31 08:00"), anchor), at("2026-07-31 09:00"));
});

check("a fire at the slot moves to the next listed day", () => {
  const rec: Recurrence = { kind: "clock", times: [{ hour: 9, minute: 0 }], days: [1, 3] };
  // Fired Monday 09:00 → next is Wednesday 09:00.
  assert.deepEqual(nextFireAt(rec, at("2026-08-03 09:00"), anchor), at("2026-08-05 09:00"));
});

console.log("nextFireAt: several times a day");

const windows: Recurrence = {
  kind: "clock",
  times: [
    { hour: 9, minute: 0 },
    { hour: 13, minute: 0 },
    { hour: 19, minute: 0 },
  ],
  everyDays: 1,
};

check("picks the next window later the same day", () => {
  const created = at("2026-08-24 07:00");
  assert.deepEqual(nextFireAt(windows, created, created), at("2026-08-24 09:00"));
  assert.deepEqual(nextFireAt(windows, at("2026-08-24 09:00"), created), at("2026-08-24 13:00"));
  assert.deepEqual(nextFireAt(windows, at("2026-08-24 12:59"), created), at("2026-08-24 13:00"));
});

check("rolls to the first window of the next day after the last one", () => {
  const created = at("2026-08-24 07:00");
  assert.deepEqual(nextFireAt(windows, at("2026-08-24 19:00"), created), at("2026-08-25 09:00"));
  assert.deepEqual(nextFireAt(windows, at("2026-08-24 23:30"), created), at("2026-08-25 09:00"));
});

check("downtime is not back-filled — it lands on the next window from now", () => {
  const created = at("2026-08-24 07:00");
  // Bot slept from Monday 08:00 through Wednesday noon: 09:00/13:00/19:00 on
  // Monday and Tuesday are simply gone (ADR 0004).
  assert.deepEqual(nextFireAt(windows, at("2026-08-26 12:00"), created), at("2026-08-26 13:00"));
});

check("every N days keeps its grid with several times a day", () => {
  const rec: Recurrence = {
    kind: "clock",
    times: [
      { hour: 9, minute: 0 },
      { hour: 19, minute: 0 },
    ],
    everyDays: 3,
  };
  const created = at("2026-08-24 10:00"); // grid days: 8-24, 8-27, 8-30
  assert.deepEqual(nextFireAt(rec, created, created), at("2026-08-24 19:00"));
  assert.deepEqual(nextFireAt(rec, at("2026-08-24 19:00"), created), at("2026-08-27 09:00"));
});

check("weekday clocks walk their own times before moving to the next day", () => {
  const rec: Recurrence = {
    kind: "clock",
    times: [
      { hour: 9, minute: 0 },
      { hour: 17, minute: 0 },
    ],
    days: [1, 3],
  };
  // 2026-08-24 is a Monday, 2026-08-26 a Wednesday.
  assert.deepEqual(nextFireAt(rec, at("2026-08-24 10:00"), anchor), at("2026-08-24 17:00"));
  assert.deepEqual(nextFireAt(rec, at("2026-08-24 17:00"), anchor), at("2026-08-26 09:00"));
});

check("a weekday clock whose only day is today, all times past, waits a week", () => {
  const rec: Recurrence = { kind: "clock", times: [{ hour: 9, minute: 0 }], days: [1] };
  assert.deepEqual(nextFireAt(rec, at("2026-08-24 10:00"), anchor), at("2026-08-31 09:00"));
});

console.log("normalizeRecurrence migrates state written before ADR 0011");

check("a single hour/minute becomes a one-entry list", () => {
  assert.deepEqual(normalizeRecurrence({ kind: "clock", hour: 13, minute: 30, everyDays: 1 }), {
    kind: "clock",
    times: [{ hour: 13, minute: 30 }],
    everyDays: 1,
  });
  assert.deepEqual(normalizeRecurrence({ kind: "clock", hour: 9, minute: 0, days: [1, 3] }), {
    kind: "clock",
    times: [{ hour: 9, minute: 0 }],
    days: [1, 3],
  });
});

check("records already in the new shape pass through untouched", () => {
  const rec: Recurrence = { kind: "interval", everyMs: 30 * 60_000 };
  assert.equal(normalizeRecurrence(rec), rec);
  assert.equal(normalizeRecurrence(windows), windows);
});

console.log("describeRecurrence renders Thai summaries");

check("interval, daily, every-N-days, weekdays", () => {
  assert.equal(describeRecurrence({ kind: "interval", everyMs: 30 * 60_000 }), "ทุก 30 นาที");
  assert.equal(describeRecurrence({ kind: "interval", everyMs: 2 * 3_600_000 }), "ทุก 2 ชั่วโมง");
  assert.equal(
    describeRecurrence({ kind: "clock", times: [{ hour: 8, minute: 0 }], everyDays: 1 }),
    "ทุกวัน เวลา 08:00",
  );
  assert.equal(
    describeRecurrence({ kind: "clock", times: [{ hour: 21, minute: 30 }], everyDays: 3 }),
    "ทุก 3 วัน เวลา 21:30",
  );
  assert.equal(
    describeRecurrence({ kind: "clock", times: [{ hour: 9, minute: 0 }], days: [1, 3] }),
    "ทุกวันจันทร์, พุธ เวลา 09:00",
  );

  assert.equal(describeRecurrence(windows), "ทุกวัน เวลา 09:00, 13:00, 19:00");
});

if (failures > 0) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
console.log("\nall recurrence tests passed");
