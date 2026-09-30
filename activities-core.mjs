// Pure activity/import logic, shared by the browser and regression tests.
export const STATUSES = {idea: '💡 Idee', planned: '📅 Geplant', booked: '✓ Gebucht'};
export const CATEGORIES = {zoo: '🦒 Zoo / Tierpark', hike: '🥾 Wanderung', boat: '⛴️ Schifffahrt', museum: '🔬 Museum', leisure: '⛳ Freizeit', other: '🌴 Ausflug'};
export const WEATHER = {any: '☀️ / 🌧️ Jedes Wetter', outdoor: '☀️ Draussen', indoor: '🌧️ Bei Regen'};
export function safeUrl(value) {
  if (!value) return '';
  try { const u = new URL(String(value)); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
export function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function validateActivity(a, holiday) {
  if (!holiday) throw new Error('Bitte zuerst Ferien auswählen.');
  if (!String(a.name || '').trim()) throw new Error('Bitte einen Titel eingeben.');
  if (!STATUSES[a.status]) throw new Error('Ungültiger Status.');
  if (a.date && !validDate(a.date)) throw new Error('Bitte ein gültiges Datum eingeben.');
  if (a.status !== 'idea' && !a.date) throw new Error('Für geplante und gebuchte Aktivitäten bitte ein Datum wählen.');
  if (a.date && (a.date < holiday.start || a.date > holiday.end)) throw new Error('Das Datum muss innerhalb dieser Ferien liegen.');
  if (a.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(a.time)) throw new Error('Bitte eine gültige Uhrzeit eingeben.');
  if (!Number.isFinite(Number(a.durationHours)) || Number(a.durationHours) < 0 || Number(a.durationHours) > 168) throw new Error('Die Dauer muss zwischen 0 und 168 Stunden liegen.');
  for (const key of ['url', 'image']) if (a[key] && !safeUrl(a[key])) throw new Error('Webseite und Bild müssen gültige http(s)-Links sein.');
  return a;
}
export const activityEventId = id => `activity_${id}`;
export function activityVoters(state, activityId) {
  return Object.entries(state.activityVotes?.[activityId] || {})
    .filter(([id, voted]) => voted === true && id !== 'all' && state.people?.[id]?.name && state.people[id].name.trim().toLowerCase() !== 'alle')
    .map(([id]) => id);
}
export function activityVoteUpdates(state, activityId, personId) {
  if (!state.activities?.[activityId]) throw new Error('Dieser Ausflug wurde inzwischen gelöscht.');
  if (!personId || personId === 'all' || !state.people?.[personId]?.name || state.people[personId].name.trim().toLowerCase() === 'alle') throw new Error('Bitte ein Familienmitglied wählen.');
  // Leaf writes keep votes from other people and activity edits intact.
  return {[`activityVotes/${activityId}/${personId}`]: state.activityVotes?.[activityId]?.[personId] === true ? null : true};
}
export function activityUpdates(id, activity, oldEvent = {}, now = Date.now()) {
  const eventId = activityEventId(id);
  const event = activity && activity.status !== 'idea' ? {
    ...oldEvent, name: activity.name, date: activity.date, time: activity.time || '',
    durationHours: Number(activity.durationHours) || null, person: 'all',
    reminderFor: oldEvent.reminderFor || [], activityId: id, holidayId: activity.holidayId,
    location: activity.location || '', url: activity.url || '',
    description: [activity.location, activity.url, activity.notes].filter(Boolean).join('\n'),
    createdAt: oldEvent.createdAt || now, updatedAt: now
  } : null;
  return { [`activities/${id}`]: activity, [`events/${eventId}`]: event, ...(activity ? {} : {[`activityVotes/${id}`]:null}) };
}
function resolveTextDate(value, holiday) {
  if (!value) return '';
  if (validDate(value)) return value;
  const day = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'].indexOf(value.toLowerCase());
  if (day < 0) throw new Error('Datum als JJJJ-MM-TT oder Wochentag angeben.');
  const matches = [];
  const d = new Date(`${holiday.start}T12:00:00Z`);
  for (let count = 0; count < 370 && d.toISOString().slice(0, 10) <= holiday.end; count++, d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() === day) matches.push(d.toISOString().slice(0, 10));
  }
  if (matches.length !== 1) throw new Error('Dieser Wochentag ist nicht eindeutig. Bitte das genaue Datum angeben.');
  return matches[0];
}
export function parseActivityText(text, holiday) {
  if (!holiday) throw new Error('Bitte Ferien auswählen.');
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length || lines.length > 100) throw new Error('Bitte 1 bis 100 Aktivitäten einfügen.');
  return lines.map((line, index) => {
    try {
      const parts = line.split('|').map(s => s.trim());
      if (parts.length > 6) throw new Error('Zu viele Felder: Titel | Datum | Uhrzeit | Dauer | Ort | Link');
      const [name, rawDate = '', time = '', duration = '', location = '', url = ''] = parts;
      if (duration && !/^\d+(?:[.,]\d+)?\s*(?:h|std\.?)?$/i.test(duration)) throw new Error('Dauer in Stunden angeben, z. B. 2,5h.');
      const date = resolveTextDate(rawDate, holiday);
      const a = {name, date, time, durationHours: duration ? Number(duration.replace(',', '.').replace(/\s*(h|std\.?)$/i, '')) : 0, location, url, image: '', category: 'other', weather: 'any', status: date ? 'planned' : 'idea'};
      return validateActivity(a, holiday);
    } catch (e) { throw new Error(`Zeile ${index + 1}: ${e.message}`); }
  });
}
function zoneParts(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('sv-SE', {timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'}).formatToParts(new Date(ms));
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return {date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, wall: Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)};
}
function icsDate(prop) {
  if (!prop) throw new Error('DTSTART fehlt.');
  const m = prop.value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) throw new Error('Nicht unterstütztes Kalenderdatum.');
  const date = `${m[1]}-${m[2]}-${m[3]}`, time = m[4] ? `${m[4]}:${m[5]}` : '';
  if (!validDate(date) || (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) || Number(m[6] || 0) > 59) throw new Error('Ungültiges Kalenderdatum.');
  const wall = Date.UTC(+m[1],+m[2]-1,+m[3],+(m[4]||0),+(m[5]||0),+(m[6]||0));
  const zone = prop.params.match(/(?:^|;)TZID="?([^;"]+)/i)?.[1];
  let instant = wall;
  if (time && zone && !m[7]) {
    for (let i = 0; i < 4; i++) instant += wall - zoneParts(instant, zone).wall;
    if (zoneParts(instant, zone).wall !== wall) throw new Error('Uhrzeit existiert in dieser Zeitzone nicht.');
  }
  // Existing family calendar and personal feeds use Europe/Zurich.
  const display = time && (zone || m[7]) ? zoneParts(instant, 'Europe/Zurich') : {date, time};
  return {...display, instant};
}
export function parseActivityIcs(text, holiday) {
  const blocks = text.replace(/\r?\n[ \t]/g, '').match(/BEGIN:VEVENT\r?\n[\s\S]*?END:VEVENT/g) || [];
  if (!blocks.length || blocks.length > 100) throw new Error('Bitte eine .ics-Datei mit 1 bis 100 Einzelterminen wählen.');
  return blocks.map((block, i) => {
    try {
      const props = {};
      let inAlarm = false;
      for (const line of block.split(/\r?\n/)) {
        if (line === 'BEGIN:VALARM') { inAlarm = true; continue; }
        if (line === 'END:VALARM') { inAlarm = false; continue; }
        if (inAlarm) continue;
        const m = line.match(/^([A-Z-]+)([^:]*):(.*)$/i);
        if (m) props[m[1].toUpperCase()] = {params:m[2], value:m[3]};
      }
      if (props.RRULE || props.RDATE || props['RECURRENCE-ID']) throw new Error('Serientermine bitte als einzelne Termine exportieren.');
      if (props.STATUS?.value === 'CANCELLED') throw new Error('Dieser Termin wurde abgesagt.');
      const unescape = key => (props[key]?.value || '').replace(/\\([nN,;\\])/g, (_, c) => /n/i.test(c) ? '\n' : c);
      const start = icsDate(props.DTSTART), end = props.DTEND ? icsDate(props.DTEND) : null;
      let durationHours = end ? (end.instant - start.instant) / 3600000 : 0;
      if (props.DURATION && !end) {
        const d = props.DURATION.value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
        if (!d) throw new Error('Nicht unterstützte Termindauer.');
        durationHours = Number(d[1]||0)*24+Number(d[2]||0)+Number(d[3]||0)/60+Number(d[4]||0)/3600;
      }
      return validateActivity({name:unescape('SUMMARY') || 'Importierter Ausflug', date:start.date, time:start.time, durationHours, location:unescape('LOCATION'), url:unescape('URL'), notes:unescape('DESCRIPTION'), image:'', category:'other', weather:'any', status:'planned', sourceUid:unescape('UID')}, holiday);
    } catch(e) { throw new Error(`Termin ${i + 1}: ${e.message}`); }
  });
}
export function importFingerprint(a) { return JSON.stringify([a.name.trim().toLowerCase(), a.date || '', a.time || '', a.url || '']); }
