import test from 'node:test';
import assert from 'node:assert/strict';
import {safeUrl, validDate, validateActivity, activityUpdates, parseActivityText, parseActivityIcs, importFingerprint, activityVoters, activityVoteUpdates} from '../activities-core.mjs';
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
  assert.deepEqual(activityUpdates('a', null), {'activities/a':null, 'events/activity_a':null, 'activityVotes/a':null});
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
test('text import accepts Markdown table rows with outer pipes and a header', () => {
  const week = {start:'2026-10-10', end:'2026-10-24'};
  const rows = parseActivityText(`| Titel | Datum | Uhrzeit | Dauer | Ort | Link |
| --- | --- | --- | --- | --- | --- |
| Sion entdecken | Montag | 10:00 | 5h | Sion | https://siontourisme.ch |
| Unterirdischer See | Dienstag | 10:00 | 1h | Saint-Léonard | https://lac-souterrain.com |
| Lac de Tseuzier | Mittwoch | 10:00 | 3h | Anzère / Tseuzier | https://www.valais.ch |
| Grande Dixence | Donnerstag | 10:00 | 5h | Hérémence | https://www.grande-dixence.ch |
| Escape Room | Freitag | 14:00 | 2h | Sion | https://escapeworld.ch |
| Leukerbad Therme | Samstag | 11:00 | 4h | Leukerbad | https://www.leukerbad.ch |`, week);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.map(row => row.date), ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']);
  assert.equal(rows[0].name, 'Sion entdecken');
  assert.equal(rows[0].url, 'https://siontourisme.ch');
  assert.equal(rows[1].location, 'Saint-Léonard');
  assert.throws(() => parseActivityText('| Titel | Datum | Uhrzeit | Dauer | Ort | Link |', week), /1 bis 100/);
});
test('text import accepts pasted Markdown links and escaped table line endings', () => {
  const week = {start:'2026-10-10', end:'2026-10-17'};
  const [row] = parseActivityText('| Sion entdecken | Montag | 10:00 | 5h | Sion | [Sion Tourismus](https://siontourisme.ch) |\\', week);
  assert.equal(row.name, 'Sion entdecken');
  assert.equal(row.date, '2026-10-12');
  assert.equal(row.url, 'https://siontourisme.ch');
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
test('one vote per family member; withdrawing does not overwrite other votes', () => {
  const state={people:{a:{name:'Anna'},b:{name:'Ben'}},activities:{trip:activity},activityVotes:{trip:{a:true}}};
  assert.deepEqual(activityVoters(state,'trip'),['a']);
  assert.deepEqual(activityVoteUpdates(state,'trip','a'),{'activityVotes/trip/a':null});
  assert.deepEqual(activityVoteUpdates(state,'trip','b'),{'activityVotes/trip/b':true});
  assert.equal(activityUpdates('trip',activity)['activityVotes/trip'],undefined);
  assert.throws(()=>activityVoteUpdates(state,'trip',''),/Familienmitglied/);
  assert.throws(()=>activityVoteUpdates(state,'trip','unknown'),/Familienmitglied/);
  assert.throws(()=>activityVoteUpdates(state,'missing','a'),/gelöscht/);
});
test('deleted family members and false votes are excluded from totals', () => {
  const state={people:{a:{name:'Anna'},b:{name:'Ben'},all:{name:'Alle'}},activityVotes:{trip:{a:true,b:false,deleted:true,all:true}}};
  assert.deepEqual(activityVoters(state,'trip'),['a']);
});

