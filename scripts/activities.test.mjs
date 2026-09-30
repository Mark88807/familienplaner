import test from 'node:test';
import assert from 'node:assert/strict';
import {safeUrl, validDate, validateActivity, activityUpdates, parseActivityText, parseActivityIcs, importFingerprint} from '../activities-core.mjs';
const holiday = {start:'2026-10-10', end:'2026-10-17'};
const activity = {name:'Zoo', holidayId:'trip', status:'idea', date:'', time:'', durationHours:5};
test('ideas do not create events; planning, editing and unplanning use one stable event', () => {
  assert.equal(activityUpdates('a', activity)['events/activity_a'], null);
  const a = {...activity, status:'booked', date:'2026-10-13', time:'10:00', location:'Zürich', url:'https://zoo.ch'};
  const changes = activityUpdates('a', a, {createdAt:42, reminderFor:['mama']}, 100);
  assert.equal(changes['events/activity_a'].person, 'all');
  assert.equal(changes['events/activity_a'].activityId, 'a');
  assert.equal(changes['events/activity_a'].createdAt, 42);
  assert.deepEqual(changes['events/activity_a'].reminderFor, ['mama']);
  assert.match(changes['events/activity_a'].description, /Zürich/);
  assert.deepEqual(activityUpdates('a', null), {'activities/a':null, 'events/activity_a':null});
});
test('text import accepts ideas, exact dates, unique weekdays and decimal hours', () => {
  const [idea, planned] = parseActivityText('Minigolf\nZoo | Dienstag | 10:00 | 2,5h | Zürich | https://zoo.ch', holiday);
  assert.equal(idea.status,'idea'); assert.equal(planned.date,'2026-10-13'); assert.equal(planned.durationHours,2.5);
  assert.equal(planned.status,'planned');
  assert.throws(() => parseActivityText('Zoo | Samstag', holiday), /nicht eindeutig/);
  assert.throws(() => parseActivityText('Zoo | 2026-10-19', holiday), /innerhalb/);
  assert.throws(() => parseActivityText('Zoo | 2026-10-13 | 27:30', holiday), /Uhrzeit/);
  assert.throws(() => parseActivityText('Zoo | 2026-10-13 | 10:00 | morgen', holiday), /Dauer/);
});
test('status, dates, durations and URL schemes are validated before storage', () => {
  assert.equal(validDate('2026-02-30'),false);
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('https://user:password@example.com'), '');
  assert.equal(safeUrl('data:image/svg+xml,test'), '');
  assert.equal(safeUrl('https://example.com'), 'https://example.com/');
  assert.throws(() => validateActivity({...activity,status:'planned'},holiday),/Datum/);
  assert.throws(() => validateActivity({...activity,durationHours:-1},holiday),/Dauer/);
  assert.throws(() => validateActivity({...activity,image:'javascript:alert(1)'},holiday),/Links/);
  assert.throws(() => validateActivity(activity,null),/Ferien/);
});
const ics = body => `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\n${body}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
test('ICS preserves duration/location, unfolds fields, skips alarms and converts UTC to Swiss time', () => {
  const [a] = parseActivityIcs(ics('UID:boat-123\r\nSUMMARY:Schiff\\, See\r\nDTSTART:20261013T120000Z\r\nDTEND:20261013T133000Z\r\nLOCATION:Steg\r\nDESCRIPTION:Ticket\r\n nummer 123\r\nBEGIN:VALARM\r\nDESCRIPTION:Erinnerung\r\nEND:VALARM'),holiday);
  assert.equal(a.name,'Schiff, See'); assert.equal(a.time,'14:00'); assert.equal(a.durationHours,1.5);
  assert.equal(a.location,'Steg'); assert.equal(a.notes,'Ticketnummer 123'); assert.equal(a.sourceUid,'boat-123');
});
test('ICS supports named zones, floating dates and all-day events', () => {
  assert.equal(parseActivityIcs(ics('DTSTART;TZID=America/New_York:20261013T100000'),holiday)[0].time,'16:00');
  assert.equal(parseActivityIcs(ics('DTSTART;TZID=Europe/Zurich:20261013T100000\r\nDURATION:PT2H30M'),holiday)[0].durationHours,2.5);
  assert.equal(parseActivityIcs(ics('DTSTART;VALUE=DATE:20261013'),holiday)[0].time,'');
  assert.equal(parseActivityIcs(ics('DTSTART:20261013T100000'),holiday)[0].time,'10:00');
  assert.throws(() => parseActivityIcs(ics('DTSTART:20261013T100000\r\nRRULE:FREQ=DAILY'),holiday),/Serientermine/);
  assert.throws(() => parseActivityIcs(ics('DTSTART:20261013T100000\r\nSTATUS:CANCELLED'),holiday),/abgesagt/);
  assert.throws(() => parseActivityIcs(ics('DTSTART:20261033T100000'),holiday),/Kalenderdatum/);
  assert.throws(() => parseActivityIcs(ics('DTSTART:20261018T100000'),holiday),/innerhalb/);
});
test('duplicate detection ignores title case but distinguishes dates', () => {
  assert.equal(importFingerprint({...activity,name:' Zoo '}),importFingerprint({...activity,name:'zoo'}));
  assert.notEqual(importFingerprint(activity),importFingerprint({...activity,date:'2026-10-13'}));
});
