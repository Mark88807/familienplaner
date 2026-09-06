import assert from "node:assert/strict";
import test from "node:test";
import { buildCalendar, escapeIcs, foldIcsLine, validateFeeds } from "./generate-calendars.mjs";

const family = {
  people: { kind2: { name: "Kind 2" }, mama: { name: "Mamá" } },
  events: {
    arzt: { name: "Arzt, Kontrolle; A\\B", description: "Zeile 1\nZeile 2", person: "kind2", reminderFor: ["kind2"], date: "2026-10-24", time: "09:15", durationHours: 2, createdAt: 1_700_000_000_000 },
    familie: { name: "Für alle sichtbar", person: "all", reminderFor: ["mama"], date: "2026-10-25", time: "18:00", updatedAt: 1_700_000_100_000 },
    alt: { name: "Ohne reminderFor", person: "kind2", date: "2026-10-26", time: "08:00" },
  },
};

test("persönlicher Feed filtert ausschließlich reminderFor", () => {
  const ics = buildCalendar({ familyId: "familie-geheim", personId: "kind2", family });
  assert.match(ics, /SUMMARY:Arzt\\, Kontrolle\\; A\\\\B/);
  assert.doesNotMatch(ics, /Für alle sichtbar/);
  assert.doesNotMatch(ics, /Ohne reminderFor/);
  assert.match(ics, /DTSTART;TZID=Europe\/Zurich:20261024T091500/);
  assert.match(ics, /DTEND;TZID=Europe\/Zurich:20261024T111500/);
  assert.match(ics, /TRIGGER:-P1D/);
  assert.match(ics, /TRIGGER:-PT1H/);
  assert.match(ics, /DTSTAMP:20231114T221320Z/);
  assert.match(ics, /LAST-MODIFIED:20231114T221320Z/);
});

test("UID bleibt zwischen Generierungen stabil", () => {
  const first = buildCalendar({ familyId: "familie-geheim", personId: "kind2", family });
  const second = buildCalendar({ familyId: "familie-geheim", personId: "kind2", family });
  assert.equal(first, second);
});

test("Escaping und UTF-8 Line Folding entsprechen RFC 5545", () => {
  assert.equal(escapeIcs("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  const folded = foldIcsLine(`DESCRIPTION:${"ä".repeat(80)}`);
  for (const line of folded.split("\r\n")) assert.ok(Buffer.byteLength(line, "utf8") <= 75);
  assert.equal(folded.replace(/\r\n /g, ""), `DESCRIPTION:${"ä".repeat(80)}`);
});

test("Feed-Pfade müssen lang, relativ, eindeutig und geheim sein", () => {
  const good = JSON.stringify({ kind2: "calendar/0123456789abcdef0123456789abcdef/calendar.ics" });
  assert.deepEqual(validateFeeds(good), { kind2: "calendar/0123456789abcdef0123456789abcdef/calendar.ics" });
  assert.throws(() => validateFeeds('{"kind2":"kind2.ics"}'));
  assert.throws(() => validateFeeds('{"kind2":"../0123456789abcdef0123456789abcdef.ics"}'));
});
