import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TIMEZONE = "Europe/Zurich";

export function escapeIcs(value = "") {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

export function foldIcsLine(line) {
  const parts = [];
  let current = "";
  let limit = 75;
  for (const character of line) {
    const candidate = current + character;
    if (Buffer.byteLength(candidate, "utf8") > limit) {
      parts.push(current);
      current = character;
      limit = 74;
    } else {
      current = candidate;
    }
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function formatDateTimeParts(year, month, day, hour, minute, second = 0) {
  return `${String(year).padStart(4, "0")}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}${String(second).padStart(2, "0")}`;
}

function addWallClockMinutes(date, time, minutes) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day, hour, minute + minutes));
  return formatDateTimeParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate(), value.getUTCHours(), value.getUTCMinutes());
}

function addDays(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return `${value.getUTCFullYear()}${String(value.getUTCMonth() + 1).padStart(2, "0")}${String(value.getUTCDate()).padStart(2, "0")}`;
}

const PUSH_CHARS = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
function pushIdTimestamp(eventId) {
  if (!eventId?.startsWith("-") || eventId.length < 8) return 0;
  let value = 0;
  for (const character of eventId.slice(0, 8)) {
    const digit = PUSH_CHARS.indexOf(character);
    if (digit < 0) return 0;
    value = value * 64 + digit;
  }
  return value;
}

function utcStamp(value, eventId) {
  const date = new Date(Number(value) || pushIdTimestamp(eventId) || 0);
  if (Number.isNaN(date.getTime())) throw new Error("Ungültiger DTSTAMP-Wert");
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function stableUid(familyId, eventId) {
  const familyHash = createHash("sha256").update(familyId).digest("hex").slice(0, 16);
  return `${eventId}.${familyHash}@familienplaner`;
}

function eventLines({ familyId, eventId, event, people }) {
  const affected = event.person === "all" ? "Alle" : (people[event.person]?.name || "Unbekannt");
  const reminderNames = (Array.isArray(event.reminderFor) ? event.reminderFor : [])
    .map((id) => people[id]?.name || id);
  const description = [
    event.description,
    `Für wen: ${affected}`,
    reminderNames.length ? `Erinnerung für: ${reminderNames.join(", ")}` : null,
  ].filter(Boolean).join("\n");
  const lines = [
    "BEGIN:VEVENT",
    `UID:${escapeIcs(stableUid(familyId, eventId))}`,
    `DTSTAMP:${utcStamp(event.updatedAt || event.createdAt, eventId)}`,
  ];

  const date = String(event.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = String(event.time || "");
  if (/^\d{2}:\d{2}$/.test(time)) {
    const compactStart = `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;
    const durationMinutes = Math.max(1, Math.round((Number(event.durationHours) || 1) * 60));
    lines.push(`DTSTART;TZID=${TIMEZONE}:${compactStart}`);
    lines.push(`DTEND;TZID=${TIMEZONE}:${addWallClockMinutes(date, time, durationMinutes)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${date.replaceAll("-", "")}`);
    lines.push(`DTEND;VALUE=DATE:${addDays(date, 1)}`);
  }
  lines.push(`SUMMARY:${escapeIcs(event.name || "Termin")}`);
  lines.push(`DESCRIPTION:${escapeIcs(description)}`);
  if (event.updatedAt || event.createdAt) lines.push(`LAST-MODIFIED:${utcStamp(event.updatedAt || event.createdAt, eventId)}`);
  for (const [trigger, label] of [["-P1D", "1 Tag vorher"], ["-PT1H", "1 Stunde vorher"]]) {
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `TRIGGER:${trigger}`, `DESCRIPTION:${escapeIcs(label)}`, "END:VALARM");
  }
  lines.push("END:VEVENT");
  return lines;
}

export function buildCalendar({ familyId, personId, family }) {
  const people = family.people || {};
  if (!people[personId]) throw new Error(`Unbekannte Personen-ID in CALENDAR_FEEDS_JSON: ${personId}`);
  const events = Object.entries(family.events || {})
    .filter(([, event]) => Array.isArray(event.reminderFor) && event.reminderFor.includes(personId))
    .sort(([idA, a], [idB, b]) => `${a.date || ""}${a.time || ""}${idA}`.localeCompare(`${b.date || ""}${b.time || ""}${idB}`));
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Familienplaner//Persoenliche Erinnerungen//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcs(`Familienplaner – ${people[personId].name || personId}`)}`,
    `X-WR-TIMEZONE:${TIMEZONE}`,
  ];
  for (const [eventId, event] of events) {
    const item = eventLines({ familyId, eventId, event, people });
    if (item) lines.push(...item);
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

export function validateFeeds(value) {
  let feeds;
  try { feeds = JSON.parse(value); } catch { throw new Error("CALENDAR_FEEDS_JSON ist kein gültiges JSON"); }
  if (!feeds || Array.isArray(feeds) || typeof feeds !== "object" || !Object.keys(feeds).length) {
    throw new Error("CALENDAR_FEEDS_JSON muss Personen-IDs auf geheime .ics-Pfade abbilden");
  }
  for (const [personId, feedPath] of Object.entries(feeds)) {
    if (!personId || typeof feedPath !== "string" || !feedPath.endsWith(".ics") || path.isAbsolute(feedPath) || feedPath.includes("..") || !/^[A-Za-z0-9_/-]+\.ics$/.test(feedPath)) {
      throw new Error(`Unsicherer Feed-Pfad für Personen-ID ${personId}`);
    }
    const hasLongSecret = feedPath.split("/").some((part) => part !== "calendar.ics" && part.replace(/\.ics$/, "").length >= 32);
    if (!hasLongSecret) throw new Error(`Feed-Pfad für ${personId} muss mindestens 32 geheime Zeichen enthalten`);
  }
  if (new Set(Object.values(feeds)).size !== Object.keys(feeds).length) throw new Error("Jeder persönliche Feed benötigt einen eigenen Pfad");
  return feeds;
}

function normalizedPersonKey(value) {
  return String(value || "").normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function resolveFeeds(feeds, people) {
  const resolved = [];
  const usedPersonIds = new Set();
  for (const [feedKey, feedPath] of Object.entries(feeds)) {
    let personId = people[feedKey] ? feedKey : null;
    if (!personId) {
      const wanted = normalizedPersonKey(feedKey);
      const matches = Object.entries(people).filter(([, person]) => normalizedPersonKey(person?.name) === wanted);
      if (matches.length > 1) throw new Error(`Mehrdeutiger Personenname in CALENDAR_FEEDS_JSON: ${feedKey}`);
      personId = matches[0]?.[0] || null;
    }
    if (!personId) throw new Error(`Unbekannte Person in CALENDAR_FEEDS_JSON: ${feedKey}`);
    if (usedPersonIds.has(personId)) throw new Error(`Mehrere Feed-Pfade verweisen auf dieselbe Person: ${feedKey}`);
    usedPersonIds.add(personId);
    resolved.push({ personId, feedPath });
  }
  return resolved;
}

async function firebaseIdToken({ apiKey, email, password }) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Firebase-Anmeldung fehlgeschlagen: ${result?.error?.message || `HTTP ${response.status}`}`);
  if (!result.idToken) throw new Error("Firebase-Anmeldung liefert kein ID-Token");
  return result.idToken;
}

export async function fetchFamily({ databaseUrl, familyId, apiKey, email, password }) {
  const idToken = await firebaseIdToken({ apiKey, email, password });
  const url = `${databaseUrl.replace(/\/$/, "")}/families/${encodeURIComponent(familyId)}.json?auth=${encodeURIComponent(idToken)}`;
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Firebase-Lesen fehlgeschlagen (${response.status})`);
  const family = await response.json();
  if (!family) throw new Error("Die konfigurierte Familie wurde in Firebase nicht gefunden");
  return family;
}

export async function generateAll({ databaseUrl, familyId, apiKey, email, password, feedsJson, outputDir }) {
  const feeds = validateFeeds(feedsJson);
  const family = await fetchFamily({ databaseUrl, familyId, apiKey, email, password });
  const resolvedFeeds = resolveFeeds(feeds, family.people || {});
  const configuredPeople = new Set(resolvedFeeds.map(({ personId }) => personId));
  const missingPeople = Object.keys(family.people || {}).filter((personId) => !configuredPeople.has(personId));
  if (missingPeople.length) throw new Error(`CALENDAR_FEEDS_JSON enthält keine Pfade für: ${missingPeople.join(", ")}`);
  for (const { personId, feedPath } of resolvedFeeds) {
    const destination = path.join(outputDir, feedPath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, buildCalendar({ familyId, personId, family }), "utf8");
  }
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  const required = ["FIREBASE_API_KEY", "FIREBASE_DATABASE_URL", "FIREBASE_EXPORT_EMAIL", "FIREBASE_EXPORT_PASSWORD", "FIREBASE_FAMILY_ID", "CALENDAR_FEEDS_JSON"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Fehlende Umgebungsvariablen: ${missing.join(", ")}`);
  await generateAll({
    databaseUrl: process.env.FIREBASE_DATABASE_URL,
    familyId: process.env.FIREBASE_FAMILY_ID,
    apiKey: process.env.FIREBASE_API_KEY,
    email: process.env.FIREBASE_EXPORT_EMAIL,
    password: process.env.FIREBASE_EXPORT_PASSWORD,
    feedsJson: process.env.CALENDAR_FEEDS_JSON,
    outputDir: process.argv[2] || "_site",
  });
}