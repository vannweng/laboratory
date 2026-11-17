const vaultKey = 'laboratory-fertility-vault-v1';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let cryptoKey;
let state;
let viewDate = new Date();

const $ = (selector) => document.querySelector(selector);
const localISO = (date) => {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
};
const parseDate = (value) => new Date(`${value}T12:00:00`);
const addDays = (date, days) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };
const dayDistance = (from, to) => Math.round((parseDate(to) - parseDate(from)) / 86400000);
const defaultState = () => ({ settings: { cycleLength: 28, periodLength: 5, lastPeriodStart: '' }, periods: [], records: {} });

function base64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
function fromBase64(value) { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }
async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encrypt(data, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(data)));
  return { version: 1, salt: base64(salt), iv: base64(iv), ciphertext: base64(encrypted) };
}
async function decrypt(vault, password) {
  const key = await deriveKey(password, fromBase64(vault.salt));
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(vault.iv) }, key, fromBase64(vault.ciphertext));
  return { key, data: JSON.parse(decoder.decode(plaintext)) };
}
async function save() {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, encoder.encode(JSON.stringify(state)));
  const old = JSON.parse(localStorage.getItem(vaultKey));
  localStorage.setItem(vaultKey, JSON.stringify({ ...old, iv: base64(iv), ciphertext: base64(encrypted) }));
}
function latestPeriods() { return [...state.periods].sort((a, b) => b.start.localeCompare(a.start)); }
function periodsForCalendar() {
  const values = latestPeriods();
  if (!values.length && state.settings.lastPeriodStart) return [{ start: state.settings.lastPeriodStart, end: addDays(parseDate(state.settings.lastPeriodStart), state.settings.periodLength - 1) }].map((item) => ({ ...item, end: localISO(item.end) }));
  return values;
}
function cycleLength() {
  const periods = [...latestPeriods()].reverse();
  const differences = periods.slice(1).map((item, index) => dayDistance(periods[index].start, item.start)).filter((value) => value >= 21 && value <= 45);
  if (differences.length) return Math.round(differences.reduce((sum, value) => sum + value, 0) / differences.length);
  return Number(state.settings.cycleLength) || 28;
}
function latestStart() { return periodsForCalendar()[0]?.start || state.settings.lastPeriodStart; }
function inRange(value, start, end) { return value >= start && value <= end; }
function dateInfo(value) {
  const period = periodsForCalendar().find((item) => inRange(value, item.start, item.end));
  const base = latestStart();
  if (!base) return { period: period ? 'actual' : '', fertile: false, ovulation: false };
  const length = cycleLength();
  const cycleNumber = Math.floor(dayDistance(base, value) / length);
  const start = localISO(addDays(parseDate(base), cycleNumber * length));
  const periodEnd = localISO(addDays(parseDate(start), Number(state.settings.periodLength) - 1));
  const ovulation = localISO(addDays(parseDate(start), length - 14));
  const fertileStart = localISO(addDays(parseDate(ovulation), -5));
  return { period: period ? 'actual' : (inRange(value, start, periodEnd) ? 'predicted' : ''), fertile: inRange(value, fertileStart, ovulation), ovulation: value === ovulation };
}
function formatDate(value) { return parseDate(value).toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'short' }); }
function renderSummary() {
  const start = latestStart();
  const output = $('#cycleSummary');
  if (!start) { output.innerHTML = '<div class="summary-card"><small>最近一次月經首日</small><strong>等待輸入</strong></div><div class="summary-card"><small>預估排卵日</small><strong>等待輸入</strong></div><div class="summary-card"><small>平均週期</small><strong>—</strong></div>'; $('#todayPrompt').textContent = '先輸入最近一次月經首日，開始你的週期紀錄。'; return; }
  const length = cycleLength();
  const cycleNumber = Math.floor(dayDistance(start, localISO(new Date())) / length);
  const ovulation = localISO(addDays(parseDate(start), cycleNumber * length + length - 14));
  const fertileStart = localISO(addDays(parseDate(ovulation), -5));
  output.innerHTML = `<div class="summary-card"><small>最近一次月經首日</small><strong>${formatDate(start)}</strong></div><div class="summary-card"><small>預估排卵日</small><strong>${formatDate(ovulation)}</strong></div><div class="summary-card"><small>平均週期</small><strong>${length} 天</strong></div>`;
  $('#todayPrompt').textContent = inRange(localISO(new Date()), fertileStart, ovulation) ? '今天位於預估受孕窗口，記得依需要完成每日紀錄。' : `下一個預估受孕窗口從 ${formatDate(fertileStart)} 開始。`;
}
function renderPeriods() {
  const list = $('#periodList');
  const periods = latestPeriods();
  list.replaceChildren(...periods.map((period) => { const item = document.createElement('li'); item.innerHTML = `<span>${formatDate(period.start)} 至 ${formatDate(period.end)}</span><button type="button" aria-label="刪除這筆月經紀錄" data-delete-period="${period.start}">×</button>`; return item; }));
  if (!periods.length) list.innerHTML = '<li><span>還沒有補登的月經紀錄</span></li>';
}
function monthView(date) {
  const year = date.getFullYear(); const month = date.getMonth(); const first = new Date(year, month, 1); const startOffset = first.getDay(); const lastDay = new Date(year, month + 1, 0).getDate();
  const monthNode = document.createElement('section'); monthNode.className = 'month'; monthNode.innerHTML = `<h3 class="month-title">${year} 年 ${month + 1} 月</h3><div class="weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div>`;
  const days = document.createElement('div'); days.className = 'days';
  for (let index = 0; index < 42; index += 1) { const day = index - startOffset + 1; const current = new Date(year, month, day); const value = localISO(current); const info = dateInfo(value); const button = document.createElement('button'); button.type = 'button'; button.className = `day ${day < 1 || day > lastDay ? 'is-outside' : ''} ${info.period ? `${info.period}-period` : ''} ${info.fertile ? 'fertile' : ''} ${info.ovulation ? 'ovulation' : ''} ${state.records[value] ? 'has-record' : ''}`; button.dataset.date = value; button.textContent = current.getDate(); button.setAttribute('aria-label', `${formatDate(value)}，${info.ovulation ? '預估排卵日' : info.fertile ? '預估受孕窗口' : info.period ? `${info.period === 'actual' ? '實際' : '預估'}月經` : '一般日期'}，${state.records[value] ? '已有紀錄' : '尚未記錄'}`); days.append(button); }
  monthNode.append(days); return monthNode;
}
function renderCalendar() { const grid = $('#calendarGrid'); grid.replaceChildren(...[0, 1, 2].map((offset) => monthView(new Date(viewDate.getFullYear(), viewDate.getMonth() + offset, 1)))); }
function renderTemperature() {
  const values = Object.entries(state.records).filter(([, item]) => item.temperature).sort(([a], [b]) => a.localeCompare(b)).slice(-30);
  const root = $('#temperatureChart'); if (values.length < 2) { root.innerHTML = '<div class="chart-empty">記錄至少兩天基礎體溫後，這裡會顯示趨勢。</div>'; return; }
  const points = values.map(([, item]) => Number(item.temperature)); const min = Math.min(...points) - .1; const max = Math.max(...points) + .1; const plot = points.map((value, index) => `${(index / (points.length - 1)) * 100},${95 - ((value - min) / (max - min || 1)) * 84}`).join(' ');
  root.innerHTML = `<svg class="temperature-svg" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="最近 ${points.length} 筆基礎體溫趨勢"><polyline points="${plot}" fill="none" stroke="#ef9ca7" stroke-width="2.4" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
}
function renderAll() { $('#cycleLength').value = state.settings.cycleLength; $('#periodLength').value = state.settings.periodLength; $('#lastPeriodStart').value = state.settings.lastPeriodStart; renderSummary(); renderPeriods(); renderCalendar(); renderTemperature(); }
function openDay(date) {
  const record = state.records[date] || {}; $('#recordDate').value = date; $('#dayDialogTitle').textContent = formatDate(date); $('#flow').value = record.flow || ''; $('#temperature').value = record.temperature || ''; $('#temperatureTime').value = record.temperatureTime || ''; $('#ovulationTest').value = record.ovulationTest || ''; $('#mucus').value = record.mucus || ''; $('#intercourse').checked = Boolean(record.intercourse); $('#note').value = record.note || ''; document.querySelectorAll('.symptom-field input').forEach((input) => { input.checked = (record.symptoms || []).includes(input.value); }); $('#deleteRecordButton').hidden = !state.records[date]; $('#dayDialog').showModal();
}
async function unlock(password) { const vault = JSON.parse(localStorage.getItem(vaultKey)); const result = await decrypt(vault, password); cryptoKey = result.key; state = result.data; $('#app').hidden = false; $('#lockScreen').hidden = true; renderAll(); }
async function initialize() { if (!localStorage.getItem(vaultKey)) localStorage.setItem(vaultKey, JSON.stringify(await encrypt(defaultState(), '1989'))); }

await initialize();
$('#unlockForm').addEventListener('submit', async (event) => { event.preventDefault(); try { await unlock($('#unlockPassword').value); $('#unlockPassword').value = ''; $('#unlockError').textContent = ''; } catch { $('#unlockError').textContent = '密碼不正確，請再試一次。'; } });
$('#lockButton').addEventListener('click', () => { cryptoKey = undefined; state = undefined; $('#app').hidden = true; $('#lockScreen').hidden = false; });
$('#settingsForm').addEventListener('submit', async (event) => { event.preventDefault(); const previous = state.settings.lastPeriodStart; state.settings = { cycleLength: Number($('#cycleLength').value), periodLength: Number($('#periodLength').value), lastPeriodStart: $('#lastPeriodStart').value }; if (state.settings.lastPeriodStart && state.settings.lastPeriodStart !== previous) { const existing = state.periods.find((period) => period.start === state.settings.lastPeriodStart); if (!existing) state.periods.push({ start: state.settings.lastPeriodStart, end: localISO(addDays(parseDate(state.settings.lastPeriodStart), state.settings.periodLength - 1)) }); } await save(); renderAll(); });
$('#calendarGrid').addEventListener('click', (event) => { const button = event.target.closest('[data-date]'); if (button) openDay(button.dataset.date); });
$('#previousMonths').addEventListener('click', () => { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 3, 1); renderCalendar(); }); $('#nextMonths').addEventListener('click', () => { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 3, 1); renderCalendar(); }); $('#todayButton').addEventListener('click', () => { viewDate = new Date(); renderCalendar(); });
$('#dayForm').addEventListener('submit', async (event) => { if (event.submitter?.value !== 'save') return; event.preventDefault(); const date = $('#recordDate').value; const record = { flow: $('#flow').value, temperature: $('#temperature').value, temperatureTime: $('#temperatureTime').value, ovulationTest: $('#ovulationTest').value, mucus: $('#mucus').value, intercourse: $('#intercourse').checked, symptoms: [...document.querySelectorAll('.symptom-field input:checked')].map((input) => input.value), note: $('#note').value.trim() }; if (Object.values(record).every((value) => value === '' || value === false || (Array.isArray(value) && !value.length))) delete state.records[date]; else state.records[date] = record; await save(); $('#dayDialog').close(); renderAll(); });
$('#deleteRecordButton').addEventListener('click', async () => { delete state.records[$('#recordDate').value]; await save(); $('#dayDialog').close(); renderAll(); });
$('#addPeriodButton').addEventListener('click', () => { $('#periodStart').value = ''; $('#periodEnd').value = ''; $('#periodDialog').showModal(); });
$('#periodForm').addEventListener('submit', async (event) => { if (event.submitter?.value !== 'save') return; event.preventDefault(); const start = $('#periodStart').value; const end = $('#periodEnd').value; if (!start || !end || end < start) return; state.periods = state.periods.filter((period) => period.start !== start); state.periods.push({ start, end }); if (!state.settings.lastPeriodStart || start > state.settings.lastPeriodStart) state.settings.lastPeriodStart = start; await save(); $('#periodDialog').close(); renderAll(); });
$('#periodList').addEventListener('click', async (event) => { const key = event.target.dataset.deletePeriod; if (!key) return; state.periods = state.periods.filter((period) => period.start !== key); if (state.settings.lastPeriodStart === key) state.settings.lastPeriodStart = latestPeriods()[0]?.start || ''; await save(); renderAll(); });
$('#changePasswordButton').addEventListener('click', () => { $('#passwordForm').reset(); $('#passwordError').textContent = ''; $('#passwordDialog').showModal(); });
$('#passwordForm').addEventListener('submit', async (event) => { if (event.submitter?.value !== 'save') return; event.preventDefault(); const oldPassword = $('#currentPassword').value; const nextPassword = $('#newPassword').value; if (nextPassword !== $('#confirmPassword').value) { $('#passwordError').textContent = '兩次輸入的新密碼不同。'; return; } try { await decrypt(JSON.parse(localStorage.getItem(vaultKey)), oldPassword); localStorage.setItem(vaultKey, JSON.stringify(await encrypt(state, nextPassword))); cryptoKey = await deriveKey(nextPassword, fromBase64(JSON.parse(localStorage.getItem(vaultKey)).salt)); $('#passwordDialog').close(); } catch { $('#passwordError').textContent = '目前密碼不正確。'; } });
