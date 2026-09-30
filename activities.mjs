import {activityVoters, activityVoteUpdates, safeUrl, validateActivity, activityEventId, activityUpdates, parseActivityText, parseActivityIcs, importFingerprint} from './activities-core.mjs';

export function createActivities({getState, getFamilyId, write, newId, openModal, closeModal, escapeHtml: esc, notify}) {
  const $ = id => document.getElementById(id);
  let holidayId = '', modalHolidayId = '', editingId = '', preview = [], busy = false, scheduling = false, metadataRequest = 0, voterId = '', votingFamily = '';
  const voting = new Set();
  const defaultActivity = () => ({name:'', location:'', date:'', time:'', durationHours:0, url:'', notes:'', status:'idea'});
  $('holidayActivities').innerHTML = `<div class="activity-heading"><div><h2>Unsere Ausflüge</h2><p id="activityTripDates" class="muted"></p></div><button class="primary" id="activityAdd">+ Aktivität</button></div>
    <div class="activity-toolbar"><label id="activityHolidayLabel">Ferien <select id="activityHoliday" aria-label="Ferien auswählen"></select></label><label>Abstimmen als <select id="activityVoter" aria-label="Abstimmen als"></select></label><label>Reihenfolge <select id="activitySort"><option value="added">Hinzugefügt</option><option value="popular">Beliebteste zuerst</option></select></label></div><div id="activityCards" class="activity-grid"></div>`;
  const modal = document.createElement('div');
  modal.id = 'activityModal'; modal.className = 'modal';
  modal.innerHTML = `<div class="box activity-box" role="dialog" aria-modal="true" aria-labelledby="activityModalTitle"><div class="activity-heading"><h2 id="activityModalTitle">Aktivität hinzufügen</h2><button type="button" class="ghost" data-close aria-label="Schliessen">✕</button></div>
    <div id="activityImportTools"><div class="activity-tabs"><button type="button" class="ghost" data-mode="manual">Selbst eintragen / Link</button><button type="button" class="ghost" data-mode="text">Text importieren</button><button type="button" class="ghost" data-mode="ics">.ics importieren</button></div>
    <div id="activityTextPanel" hidden><label for="activityImportText">Eine Aktivität pro Zeile</label><p class="muted">Titel | Datum oder Wochentag | Uhrzeit | Dauer | Ort | Link<br>Beispiel: Zoo | Dienstag | 10:00 | 5h<br>Nur ein Titel genügt.</p><textarea id="activityImportText" rows="5" placeholder="Zoo besuchen&#10;Museum besuchen"></textarea></div>
    <div id="activityIcsPanel" hidden><label for="activityImportFile">Kalenderdatei (.ics)</label><input id="activityImportFile" type="file" accept=".ics,text/calendar"><p class="muted">Einzeltermine innerhalb dieser Ferien. Uhrzeiten werden in Schweizer Zeit übernommen. Serientermine werden nicht importiert.</p></div>
    <div id="activityPreviewPanel" hidden><button type="button" class="ghost" id="activityPreviewBtn">Vorschau anzeigen</button><div id="activityPreview" class="activity-preview"></div><button type="button" class="primary" id="activityImportBtn" hidden>Aktivitäten übernehmen</button></div></div>
    <form id="activityForm" class="form">
      <div id="activityBasics" class="form">
        <label>Titel<input id="activityName" required maxlength="160" placeholder="Was möchtet ihr unternehmen?"></label>
        <div class="activity-fields"><label>Ort (optional)<input id="activityLocation" maxlength="250" placeholder="Ort oder Treffpunkt"></label><label>Dauer in Stunden (optional)<input id="activityDuration" type="number" min="0" max="168" step="any" placeholder="z. B. 2,5"></label></div>
        <label>Webseite (optional)<input id="activityUrl" type="url" placeholder="https://…" maxlength="2000"></label><button class="ghost" type="button" id="activityLinkBtn">Titel aus Link übernehmen</button>
        <details id="activityExtra"><summary>Notizen / Tickets</summary><label><span class="muted">Zusätzliche Angaben</span><textarea id="activityNotes" rows="3" maxlength="5000"></textarea></label></details>
      </div>
      <div id="activitySchedule" class="form" hidden><div class="activity-fields"><label>Datum<input id="activityDate" type="date"></label><label>Uhrzeit (optional)<input id="activityTime" type="time"></label></div><p class="muted">Der Ausflug erscheint im Familienkalender. Ohne Uhrzeit gilt er als ganztägiger Termin.</p><button class="ghost" type="button" id="activityUnplan" hidden>Termin entfernen</button></div>
      <div class="actions"><button class="ghost" type="button" id="activityDelete" hidden>Löschen</button><button class="ghost" type="button" data-close>Abbrechen</button><button class="primary" type="submit" id="activitySave">Speichern</button></div>
    </form><p id="activityMessage" role="status" aria-live="polite"></p></div>`;
  document.body.append(modal);
  let mode = 'manual';
  function setMode(next) {
    mode = next; preview = [];
    $('activityTextPanel').hidden = next !== 'text'; $('activityIcsPanel').hidden = next !== 'ics';
    $('activityPreviewPanel').hidden = next === 'manual'; $('activityForm').hidden = next !== 'manual';
    $('activityPreview').textContent = ''; $('activityImportBtn').hidden = true; message('');
    modal.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === next)));
  }
  function message(value) { $('activityMessage').textContent = value; }
  function close() { if (!busy) { metadataRequest++; closeModal('activityModal'); } }
  modal.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  modal.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Tab') {
      const controls = [...modal.querySelectorAll('button,input,select,textarea')].filter(el => !el.disabled && el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  });
  modal.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  const fields = {name:'Name', location:'Location', date:'Date', time:'Time', durationHours:'Duration', url:'Url', notes:'Notes'};
  function open(id = '', plan = false) {
    const state = getState(), existing = state.activities?.[id];
    if (existing) holidayId = existing.holidayId;
    const holiday = state.holidays?.[holidayId];
    if (!holiday) { notify('Bitte zuerst Ferien im Kalender anlegen.'); return; }
    editingId = id; modalHolidayId = holidayId; scheduling = plan; metadataRequest++; setMode('manual');
    const a = {...defaultActivity(), ...existing};
    if (plan) { a.status = 'planned'; a.date ||= holiday.start; }
    Object.entries(fields).forEach(([key, suffix]) => { $('activity' + suffix).value = a[key] ?? ''; });
    $('activityDate').min = holiday.start; $('activityDate').max = holiday.end;
    $('activityDate').required = plan;
    $('activityBasics').hidden = plan; $('activitySchedule').hidden = !plan;
    $('activityExtra').open = false;
    $('activitySave').textContent = plan ? 'In Kalender übernehmen' : 'Speichern';
    $('activityUnplan').hidden = !(plan && existing && existing.status !== 'idea' && existing.date);
    $('activityImportTools').hidden = !!id; $('activityDelete').hidden = !id || plan;
    $('activityModalTitle').textContent = plan ? `Termin wählen · ${a.name}` : `${id ? 'Aktivität bearbeiten' : 'Aktivität hinzufügen'} · ${holiday.name}`;
    $('activityImportText').value = ''; $('activityImportFile').value = '';
    openModal('activityModal'); $(plan ? 'activityDate' : 'activityName').focus();
  }
  $('activityAdd').onclick = () => open();
  $('activityHoliday').onchange = () => { holidayId = $('activityHoliday').value; render(); };
  $('activitySort').onchange = () => render();
  $('activityVoter').onchange = () => {voterId = $('activityVoter').value; try{localStorage.setItem(`familienplaner_activity_voter_${getFamilyId()}`, voterId)}catch{} render();};
  const dateLabel = date => new Intl.DateTimeFormat('de-CH', {day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(`${date}T12:00:00`));
  function render() {
    const state = getState(), holidays = Object.entries(state.holidays || {}).sort((a,b) => a[1].start.localeCompare(b[1].start));
    if (!state.holidays?.[holidayId]) holidayId = holidays.find(([,h]) => h.end >= new Date().toLocaleDateString('sv-SE'))?.[0] || holidays.at(-1)?.[0] || '';
    $('activityHoliday').innerHTML = holidays.map(([id,h]) => `<option value="${esc(id)}">${esc(h.name)}</option>`).join('') || '<option value="">Noch keine Ferien</option>';
    $('activityHoliday').value = holidayId; $('activityAdd').disabled = !holidayId;
    $('activityHolidayLabel').hidden = holidays.length === 1;
    const people = Object.entries(state.people || {}).filter(([id,p]) => id !== 'all' && p.name && p.name.trim().toLowerCase() !== 'alle');
    if (votingFamily !== getFamilyId()) {votingFamily = getFamilyId(); try {voterId = localStorage.getItem(`familienplaner_activity_voter_${votingFamily}`) || '';} catch {voterId = '';}}
    if (!people.some(([id]) => id === voterId)) voterId = '';
    $('activityVoter').innerHTML = '<option value="">Person wählen</option>' + people.map(([id,p]) => `<option value="${esc(id)}">${esc(p.name)}</option>`).join('');
    $('activityVoter').value = voterId;
    const h = state.holidays?.[holidayId];
    const activities = Object.entries(state.activities || {}).filter(([,a]) => a.holidayId === holidayId);
    $('activityTripDates').textContent = h ? `${h.name} · ${dateLabel(h.start)} – ${dateLabel(h.end)}` : '';
    const visible = activities.sort((a,b) => ($('activitySort').value === 'popular' ? activityVoters(state,b[0]).length - activityVoters(state,a[0]).length : 0) || (Number(a[1].createdAt)||0) - (Number(b[1].createdAt)||0) || a[0].localeCompare(b[0]));
    $('activityCards').innerHTML = visible.map(([id,a]) => {
      const url = safeUrl(a.url), voters = activityVoters(state,id), liked = voters.includes(voterId), scheduled = a.status !== 'idea' && a.date;
      const info = [a.location, Number(a.durationHours) > 0 ? `${new Intl.NumberFormat('de-CH').format(a.durationHours)} h` : ''].filter(Boolean).join(' · ');
      return `<article class="activity-card"><div class="activity-body"><div class="activity-card-heading"><h3>${esc(a.name)}</h3><button class="ghost activity-edit" data-edit="${esc(id)}" aria-label="${esc(a.name)} bearbeiten">✎</button></div>${info ? `<p class="muted">${esc(info)}</p>` : ''}${scheduled ? `<p>📅 ${dateLabel(a.date)}${a.time ? ` · ${esc(a.time)}` : ''}</p>` : ''}<div class="activity-card-actions"><button class="ghost activity-vote" data-vote="${esc(id)}" aria-pressed="${liked}" aria-label="${esc(a.name)}: ${liked ? 'Stimme zurücknehmen' : 'Abstimmen'}, ${voters.length} Stimmen" ${voting.has(id) ? 'disabled' : ''}>👍 ${voters.length}<span class="activity-vote-text"> · ${liked ? 'Gefällt mir' : 'Abstimmen'}</span></button><button class="ghost" data-plan="${esc(id)}">${scheduled ? 'Termin ändern' : 'Termin wählen'}</button></div><p class="activity-voters">${voters.length ? voters.map(personId => esc(state.people[personId].name)).join(', ') : 'Noch keine Stimmen'}</p>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Webseite ↗</a>` : ''}</div></article>`;
    }).join('') || `<div class="activity-empty">${!h ? 'Lege mit „+ Ferien“ zuerst eine Reise an.' : 'Noch keine Ausflüge. Füge eine Aktivität hinzu oder importiere eine Liste.'}</div>`;
    $('activityCards').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => open(b.dataset.edit));
    $('activityCards').querySelectorAll('[data-plan]').forEach(b => b.onclick = () => open(b.dataset.plan, true));
    $('activityCards').querySelectorAll('[data-vote]').forEach(b => b.onclick = async () => {
      const id = b.dataset.vote;
      if (!voterId) {notify('Bitte unter „Abstimmen als“ deinen Namen wählen.'); $('activityVoter').focus(); return;}
      if (voting.has(id)) return;
      voting.add(id); b.disabled = true;
      try {await write(activityVoteUpdates(getState(), id, voterId));}
      catch(e) {notify(`Stimme nicht gespeichert: ${e.message}`);}
      finally {voting.delete(id); render();}
    });
  }
  async function run(action) {
    if (busy) return;
    busy = true;
    const buttons = [...modal.querySelectorAll('button')]; buttons.forEach(b => b.disabled = true);
    message('Wird gespeichert …');
    try { await action(); } catch(e) { message(`Nicht gespeichert: ${e.message}`); }
    finally { busy = false; buttons.forEach(b => b.disabled = false); }
  }
  $('activityForm').onsubmit = e => {
    e.preventDefault();
    run(async () => {
      const state = getState(), old = state.activities?.[editingId], id = editingId || newId();
      if (editingId && !old) throw new Error('Diese Aktivität wurde inzwischen gelöscht. Bitte neu öffnen.');
      const a = {...old, holidayId:modalHolidayId, createdAt:old?.createdAt || Date.now(), updatedAt:Date.now()};
      Object.entries(fields).forEach(([key,suffix]) => { a[key] = $('activity'+suffix).value.trim(); });
      a.durationHours = Number(a.durationHours) || 0;
      a.status = scheduling ? 'planned' : (old?.status || 'idea');
      if (!scheduling) {a.date = old?.date || ''; a.time = old?.time || '';}
      validateActivity(a, state.holidays?.[modalHolidayId]);
      await write(activityUpdates(id, a, state.events?.[activityEventId(id)]));
      metadataRequest++; closeModal('activityModal'); notify('Aktivität gespeichert.');
    });
  };
  $('activityDelete').onclick = () => {
    if (!confirm('Aktivität und zugehörigen Kalendereintrag löschen?')) return;
    run(async () => { await write(activityUpdates(editingId, null)); closeModal('activityModal'); notify('Aktivität gelöscht.'); });
  };
  $('activityUnplan').onclick = () => run(async () => {const a = getState().activities?.[editingId]; if(!a) throw new Error('Diese Aktivität wurde gelöscht.'); await write(activityUpdates(editingId, {...a, status:'idea',date:'',time:'',updatedAt:Date.now()})); closeModal('activityModal'); notify('Termin entfernt. Der Ausflug bleibt erhalten.');});
  function resetPreview() { preview = []; $('activityPreview').textContent = ''; $('activityImportBtn').hidden = true; }
  $('activityImportText').oninput = resetPreview; $('activityImportFile').onchange = resetPreview;
  $('activityPreviewBtn').onclick = async () => {
    resetPreview(); message('');
    try {
      const h = getState().holidays?.[modalHolidayId];
      if (mode === 'ics') {
        const file = $('activityImportFile').files[0];
        if (!file) throw new Error('Bitte eine .ics-Datei wählen.');
        if (file.size > 1024 * 1024) throw new Error('Die Datei darf höchstens 1 MB gross sein.');
        preview = parseActivityIcs(await file.text(), h);
      } else preview = parseActivityText($('activityImportText').value, h);
      $('activityPreview').innerHTML = preview.map(a => `<p><b>${esc(a.name)}</b><br>${a.date ? dateLabel(a.date) : 'Ohne Datum'} ${esc(a.time)}${a.durationHours ? ` · ${a.durationHours} h` : ''}${a.location ? ` · ${esc(a.location)}` : ''}</p>`).join('');
      $('activityImportBtn').hidden = false; $('activityImportBtn').textContent = `${preview.length} Aktivitäten übernehmen`;
      message('Bitte Daten prüfen. Bereits vorhandene identische Aktivitäten werden übersprungen.');
    } catch(e) { message(e.message); }
  };
  $('activityImportBtn').onclick = () => run(async () => {
    const state = getState(), changes = {}, existing = Object.values(state.activities || {}).filter(a => a.holidayId === modalHolidayId);
    const fingerprints = new Set(existing.map(importFingerprint)), uids = new Set(existing.map(a => a.sourceUid).filter(Boolean));
    let count = 0;
    for (const a of preview) {
      validateActivity(a, state.holidays?.[modalHolidayId]);
      const fingerprint = importFingerprint(a);
      if (fingerprints.has(fingerprint) || (a.sourceUid && uids.has(a.sourceUid))) continue;
      fingerprints.add(fingerprint); if (a.sourceUid) uids.add(a.sourceUid);
      const now = Date.now(); Object.assign(changes, activityUpdates(newId(), {...a, holidayId:modalHolidayId, createdAt:now, updatedAt:now})); count++;
    }
    if (count) await write(changes);
    closeModal('activityModal'); notify(`${count} Aktivitäten importiert; ${preview.length-count} doppelte übersprungen.`); preview = [];
  });
  $('activityLinkBtn').onclick = async () => {
    const url = safeUrl($('activityUrl').value.trim());
    if (!url) { message('Bitte einen gültigen Webseiten-Link einfügen.'); return; }
    const request = ++metadataRequest, controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 7000);
    if (!$('activityName').value.trim()) $('activityName').value = new URL(url).hostname.replace(/^www\./, '');
    const originalName = $('activityName').value;
    message('Lese Titel …');
    try {
      const response = await fetch(url, {signal:controller.signal, credentials:'omit', referrerPolicy:'no-referrer'});
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('Keine lesbare Webseite.');
      const html = await response.text();
      if (html.length > 2000000) throw new Error('Seite zu gross.');
      // Parse metadata without inserting or executing the remote page.
      const doc = new DOMParser().parseFromString(html, 'text/html');
      if (request !== metadataRequest || safeUrl($('activityUrl').value.trim()) !== url) return;
      const title = doc.querySelector('meta[property="og:title"]')?.content || doc.title;
      if (title && $('activityName').value === originalName) $('activityName').value = title.slice(0,160);
      message('Link übernommen. Titel bitte prüfen und bei Bedarf ergänzen.');
    } catch {
      if (request === metadataRequest) message('Link übernommen. Diese Webseite erlaubt kein automatisches Auslesen. Bitte den Titel ergänzen.');
    } finally { clearTimeout(timeout); }
  };
  return {render, open,
    async unplan(id) {
      const a = getState().activities?.[id];
      if (a) await write(activityUpdates(id, {...a, status:'idea', date:'', time:'', updatedAt:Date.now()}));
    }
  };
}
