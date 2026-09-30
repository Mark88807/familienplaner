import {STATUSES, CATEGORIES, WEATHER, safeUrl, validateActivity, activityEventId, activityUpdates, parseActivityText, parseActivityIcs, importFingerprint} from './activities-core.mjs';

export function createActivities({getState, write, newId, openModal, closeModal, escapeHtml: esc, notify}) {
  const $ = id => document.getElementById(id);
  let holidayId = '', editingId = '', preview = [], busy = false, metadataRequest = 0;
  const options = values => Object.entries(values).map(([id, name]) => `<option value="${id}">${name}</option>`).join('');
  const defaultActivity = () => ({name:'', location:'', date:'', time:'', durationHours:0, category:'other', weather:'any', url:'', image:'', notes:'', status:'idea'});
  $('holidayActivities').innerHTML = `<div class="activity-heading"><div><h2>🌴 Ferien-Aktivitäten</h2><p class="muted">Ideen sammeln und gemeinsam die Ferien planen.</p></div><button class="primary" id="activityAdd">+ Aktivität hinzufügen</button></div>
    <div class="activity-toolbar"><label>Ferien <select id="activityHoliday" aria-label="Ferien auswählen"></select></label><label>Anzeigen <select id="activityFilter"><option value="all">Alle Aktivitäten</option><option value="idea">💡 Ideen</option><option value="planned">📅 Geplant</option><option value="booked">✓ Gebucht</option><option value="indoor">🌧️ Bei Regen</option></select></label></div><p id="activityTripDates" class="muted"></p><div id="activityCards" class="activity-grid"></div>`;
  const modal = document.createElement('div');
  modal.id = 'activityModal'; modal.className = 'modal';
  modal.innerHTML = `<div class="box activity-box" role="dialog" aria-modal="true" aria-labelledby="activityModalTitle"><div class="activity-heading"><h2 id="activityModalTitle">Aktivität hinzufügen</h2><button type="button" class="ghost" data-close aria-label="Schliessen">✕</button></div>
    <div id="activityImportTools"><div class="activity-tabs"><button type="button" class="ghost" data-mode="manual">Selbst eintragen / Link</button><button type="button" class="ghost" data-mode="text">Text importieren</button><button type="button" class="ghost" data-mode="ics">.ics importieren</button></div>
    <div id="activityTextPanel" hidden><label for="activityImportText">Eine Aktivität pro Zeile</label><p class="muted">Titel | Datum oder Wochentag | Uhrzeit | Dauer | Ort | Link<br>Beispiel: Zoo | Dienstag | 10:00 | 5h<br>Nur ein Titel genügt für eine Idee.</p><textarea id="activityImportText" rows="5" placeholder="Zoo besuchen&#10;Museum besuchen"></textarea></div>
    <div id="activityIcsPanel" hidden><label for="activityImportFile">Kalenderdatei (.ics)</label><input id="activityImportFile" type="file" accept=".ics,text/calendar"><p class="muted">Einzeltermine innerhalb dieser Ferien. Uhrzeiten werden in Schweizer Zeit übernommen. Serientermine werden nicht importiert.</p></div>
    <div id="activityPreviewPanel" hidden><button type="button" class="ghost" id="activityPreviewBtn">Vorschau anzeigen</button><div id="activityPreview" class="activity-preview"></div><button type="button" class="primary" id="activityImportBtn" hidden>Aktivitäten übernehmen</button></div></div>
    <form id="activityForm" class="form">
      <label>Webseite (optional)<input id="activityUrl" type="url" placeholder="https://…" maxlength="2000"></label><button class="ghost" type="button" id="activityLinkBtn">Titel und Bild aus Link übernehmen</button>
      <label>Titel<input id="activityName" required maxlength="160" placeholder="Was möchtet ihr unternehmen?"></label>
      <div class="activity-fields"><label>Status<select id="activityStatus">${options(STATUSES)}</select></label><label>Kategorie<select id="activityCategory">${options(CATEGORIES)}</select></label></div>
      <label>Ort<input id="activityLocation" maxlength="250" placeholder="Adresse oder Treffpunkt"></label>
      <div class="activity-fields"><label>Datum<input id="activityDate" type="date"></label><label>Uhrzeit (optional)<input id="activityTime" type="time"></label><label>Dauer in Stunden<input id="activityDuration" type="number" min="0" max="168" step="any" placeholder="z. B. 2,5"></label><label>Wetter<select id="activityWeather">${options(WEATHER)}</select></label></div>
      <label>Bild-Link (optional)<input id="activityImage" type="url" maxlength="2000" placeholder="https://…/bild.jpg"></label>
      <label>Notizen / Tickets<textarea id="activityNotes" rows="3" maxlength="5000"></textarea></label>
      <p class="muted">Nur „Geplant“ und „Gebucht“ erscheinen im Familienkalender. Ohne Uhrzeit wird ein ganztägiger Termin angezeigt.</p>
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
  const fields = {name:'Name', location:'Location', date:'Date', time:'Time', durationHours:'Duration', category:'Category', weather:'Weather', url:'Url', image:'Image', notes:'Notes', status:'Status'};
  function open(id = '', plan = false) {
    const state = getState(), existing = state.activities?.[id];
    if (existing) holidayId = existing.holidayId;
    const holiday = state.holidays?.[holidayId];
    if (!holiday) { notify('Bitte zuerst Ferien im Kalender anlegen.'); return; }
    editingId = id; metadataRequest++; setMode('manual');
    const a = {...defaultActivity(), ...existing};
    if (plan) { a.status = 'planned'; a.date ||= holiday.start; }
    Object.entries(fields).forEach(([key, suffix]) => { $('activity' + suffix).value = a[key] ?? ''; });
    $('activityDate').min = holiday.start; $('activityDate').max = holiday.end;
    $('activityDate').required = a.status !== 'idea';
    $('activityImportTools').hidden = !!id; $('activityDelete').hidden = !id;
    $('activityModalTitle').textContent = `${id ? 'Aktivität bearbeiten' : 'Aktivität hinzufügen'} · ${holiday.name}`;
    $('activityImportText').value = ''; $('activityImportFile').value = '';
    openModal('activityModal'); $('activityName').focus();
  }
  $('activityStatus').onchange = () => { $('activityDate').required = $('activityStatus').value !== 'idea'; };
  $('activityAdd').onclick = () => open();
  $('activityHoliday').onchange = () => { holidayId = $('activityHoliday').value; render(); };
  $('activityFilter').onchange = () => render();
  const dateLabel = date => new Intl.DateTimeFormat('de-CH', {day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(`${date}T12:00:00`));
  function render() {
    const state = getState(), holidays = Object.entries(state.holidays || {}).sort((a,b) => a[1].start.localeCompare(b[1].start));
    if (!state.holidays?.[holidayId]) holidayId = holidays.find(([,h]) => h.end >= new Date().toLocaleDateString('sv-SE'))?.[0] || holidays.at(-1)?.[0] || '';
    $('activityHoliday').innerHTML = holidays.map(([id,h]) => `<option value="${esc(id)}">${esc(h.name)}</option>`).join('') || '<option value="">Noch keine Ferien</option>';
    $('activityHoliday').value = holidayId; $('activityAdd').disabled = !holidayId;
    const h = state.holidays?.[holidayId];
    const activities = Object.entries(state.activities || {}).filter(([,a]) => a.holidayId === holidayId);
    $('activityTripDates').textContent = h ? `${dateLabel(h.start)} – ${dateLabel(h.end)} · ${activities.length} Aktivitäten` : '';
    const filter = $('activityFilter').value;
    const visible = activities.filter(([,a]) => filter === 'all' || a.status === filter || (filter === 'indoor' && ['indoor','any'].includes(a.weather))).sort((a,b) => (a[1].date || '9999').localeCompare(b[1].date || '9999') || (a[1].time || '').localeCompare(b[1].time || ''));
    $('activityCards').innerHTML = visible.map(([id,a]) => {
      const category = CATEGORIES[a.category] || CATEGORIES.other, image = safeUrl(a.image), url = safeUrl(a.url);
      return `<article class="activity-card"><div class="activity-cover" data-category="${esc(CATEGORIES[a.category] ? a.category : 'other')}"><span aria-hidden="true">${category.split(' ')[0]}</span>${image ? `<img src="${esc(image)}" alt="${esc(a.name)}" loading="lazy" referrerpolicy="no-referrer">` : ''}</div><div class="activity-body"><span class="activity-status">${esc(STATUSES[a.status] || STATUSES.idea)}</span><h3>${esc(a.name)}</h3>${a.location ? `<p>📍 ${esc(a.location)}</p>` : ''}<p class="muted">${esc(category)} · ${esc(WEATHER[a.weather] || WEATHER.any)}${Number(a.durationHours) > 0 ? ` · ${Number(a.durationHours)} h` : ''}</p>${a.date ? `<p>📅 ${dateLabel(a.date)}${a.time ? ` · ${esc(a.time)}` : ''}</p>` : '<p class="muted">Noch ohne Datum</p>'}${a.notes ? `<p class="activity-note">${esc(a.notes)}</p>` : ''}<div class="activity-card-actions">${url ? `<a class="ghost" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Webseite ↗</a>` : ''}<button class="ghost" data-edit="${esc(id)}">Bearbeiten</button>${a.status === 'idea' ? `<button class="primary" data-plan="${esc(id)}">Einplanen</button>` : ''}</div></div></article>`;
    }).join('') || `<div class="activity-empty">${!h ? 'Lege mit „+ Ferien“ zuerst eine Reise an.' : activities.length ? 'Keine Aktivitäten für diesen Filter.' : 'Noch alles offen? Sammle hier eure Ausflugsideen – mit Link, Text oder Kalenderdatei.'}</div>`;
    $('activityCards').querySelectorAll('img').forEach(img => img.onerror = () => img.remove());
    $('activityCards').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => open(b.dataset.edit));
    $('activityCards').querySelectorAll('[data-plan]').forEach(b => b.onclick = () => open(b.dataset.plan, true));
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
      const a = {...old, holidayId, createdAt:old?.createdAt || Date.now(), updatedAt:Date.now()};
      Object.entries(fields).forEach(([key,suffix]) => { a[key] = $('activity'+suffix).value.trim(); });
      a.durationHours = Number(a.durationHours) || 0;
      validateActivity(a, state.holidays?.[holidayId]);
      await write(activityUpdates(id, a, state.events?.[activityEventId(id)]));
      metadataRequest++; closeModal('activityModal'); notify('Aktivität gespeichert.');
    });
  };
  $('activityDelete').onclick = () => {
    if (!confirm('Aktivität und zugehörigen Kalendereintrag löschen?')) return;
    run(async () => { await write(activityUpdates(editingId, null)); closeModal('activityModal'); notify('Aktivität gelöscht.'); });
  };
  function resetPreview() { preview = []; $('activityPreview').textContent = ''; $('activityImportBtn').hidden = true; }
  $('activityImportText').oninput = resetPreview; $('activityImportFile').onchange = resetPreview;
  $('activityPreviewBtn').onclick = async () => {
    resetPreview(); message('');
    try {
      const h = getState().holidays?.[holidayId];
      if (mode === 'ics') {
        const file = $('activityImportFile').files[0];
        if (!file) throw new Error('Bitte eine .ics-Datei wählen.');
        if (file.size > 1024 * 1024) throw new Error('Die Datei darf höchstens 1 MB gross sein.');
        preview = parseActivityIcs(await file.text(), h);
      } else preview = parseActivityText($('activityImportText').value, h);
      $('activityPreview').innerHTML = preview.map(a => `<p><b>${esc(a.name)}</b><br>${esc(STATUSES[a.status])} · ${a.date ? dateLabel(a.date) : 'Ohne Datum'} ${esc(a.time)}${a.durationHours ? ` · ${a.durationHours} h` : ''}${a.location ? ` · ${esc(a.location)}` : ''}</p>`).join('');
      $('activityImportBtn').hidden = false; $('activityImportBtn').textContent = `${preview.length} Aktivitäten übernehmen`;
      message('Bitte Daten prüfen. Bereits vorhandene identische Aktivitäten werden übersprungen.');
    } catch(e) { message(e.message); }
  };
  $('activityImportBtn').onclick = () => run(async () => {
    const state = getState(), changes = {}, existing = Object.values(state.activities || {}).filter(a => a.holidayId === holidayId);
    const fingerprints = new Set(existing.map(importFingerprint)), uids = new Set(existing.map(a => a.sourceUid).filter(Boolean));
    let count = 0;
    for (const a of preview) {
      validateActivity(a, state.holidays?.[holidayId]);
      const fingerprint = importFingerprint(a);
      if (fingerprints.has(fingerprint) || (a.sourceUid && uids.has(a.sourceUid))) continue;
      fingerprints.add(fingerprint); if (a.sourceUid) uids.add(a.sourceUid);
      const now = Date.now(); Object.assign(changes, activityUpdates(newId(), {...a, holidayId, createdAt:now, updatedAt:now})); count++;
    }
    if (count) await write(changes);
    closeModal('activityModal'); notify(`${count} Aktivitäten importiert; ${preview.length-count} doppelte übersprungen.`); preview = [];
  });
  $('activityLinkBtn').onclick = async () => {
    const url = safeUrl($('activityUrl').value.trim());
    if (!url) { message('Bitte einen gültigen Webseiten-Link einfügen.'); return; }
    const request = ++metadataRequest, controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 7000);
    if (!$('activityName').value.trim()) $('activityName').value = new URL(url).hostname.replace(/^www\./, '');
    const originalName = $('activityName').value, originalImage = $('activityImage').value;
    message('Lese Titel und Bild …');
    try {
      const response = await fetch(url, {signal:controller.signal, credentials:'omit', referrerPolicy:'no-referrer'});
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('Keine lesbare Webseite.');
      const html = await response.text();
      if (html.length > 2000000) throw new Error('Seite zu gross.');
      // Parse metadata without inserting or executing the remote page.
      const doc = new DOMParser().parseFromString(html, 'text/html');
      if (request !== metadataRequest || safeUrl($('activityUrl').value.trim()) !== url) return;
      const title = doc.querySelector('meta[property="og:title"]')?.content || doc.title;
      const image = doc.querySelector('meta[property="og:image"]')?.content;
      if (title && $('activityName').value === originalName) $('activityName').value = title.slice(0,160);
      if (image && $('activityImage').value === originalImage) $('activityImage').value = safeUrl(new URL(image, response.url || url).href);
      message('Link übernommen. Titel und Bild bitte prüfen und bei Bedarf ergänzen.');
    } catch {
      if (request === metadataRequest) message('Link übernommen. Diese Webseite erlaubt kein automatisches Auslesen. Bitte Titel und bei Bedarf einen Bild-Link ergänzen.');
    } finally { clearTimeout(timeout); }
  };
  return {render, open,
    async unplan(id) {
      const a = getState().activities?.[id];
      if (a) await write(activityUpdates(id, {...a, status:'idea', date:'', time:'', updatedAt:Date.now()}));
    }
  };
}
