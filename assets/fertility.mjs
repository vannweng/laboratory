const legacyVaultKey = 'laboratory-fertility-vault-v1';
const dataKey = 'laboratory-fertility-data-v2';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let state;
let viewDate = new Date();
let periodSelection = { start: '', end: '' };
let periodPickerDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);

const $ = (selector) => document.querySelector(selector);
const localISO = (date) => {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
};
const parseDate = (value) => new Date(`${value}T12:00:00`);
const addDays = (date, days) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };
const dayDistance = (from, to) => Math.round((parseDate(to) - parseDate(from)) / 86400000);
let quickTemperatureEntryDate = localISO(viewDate);
let lastSystemDate = localISO(viewDate);
const defaultState = () => ({ settings: { cycleLength: 28, periodLength: 5, lastPeriodStart: '' }, periods: [], records: {} });

function base64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
function fromBase64(value) { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }
async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function decrypt(vault, password) {
  const key = await deriveKey(password, fromBase64(vault.salt));
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(vault.iv) }, key, fromBase64(vault.ciphertext));
  return { key, data: JSON.parse(decoder.decode(plaintext)) };
}
async function save() { localStorage.setItem(dataKey, JSON.stringify(state)); }
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
function formatDate(value, includeWeekday = true) {
  return parseDate(value).toLocaleDateString('zh-TW', {
    month: 'long', day: 'numeric', weekday: includeWeekday ? 'short' : undefined
  });
}
function cycleWindowFor(dateValue) {
  const base = latestStart();
  if (!base) return null;
  const length = cycleLength();
  const cycleNumber = Math.floor(dayDistance(base, dateValue) / length);
  const cycleStart = localISO(addDays(parseDate(base), cycleNumber * length));
  const ovulation = localISO(addDays(parseDate(cycleStart), length - 14));
  const fertileStart = localISO(addDays(parseDate(ovulation), -5));
  return { length, cycleStart, fertileStart, ovulation };
}
function nextRelevantWindow(dateValue) {
  let window = cycleWindowFor(dateValue);
  if (!window) return null;
  if (dateValue > window.ovulation) {
    const nextStart = localISO(addDays(parseDate(window.cycleStart), window.length));
    const ovulation = localISO(addDays(parseDate(nextStart), window.length - 14));
    window = { ...window, cycleStart: nextStart, fertileStart: localISO(addDays(parseDate(ovulation), -5)), ovulation };
  }
  return window;
}
function renderSummary() {
  const start = latestStart();
  const output = $('#cycleSummary');
  if (!start) { output.innerHTML = '<div class="summary-card"><small>最近一次月經首日</small><strong>等待輸入</strong></div><div class="summary-card"><small>預估排卵日</small><strong>等待輸入</strong></div><div class="summary-card"><small>平均週期</small><strong>—</strong></div>'; $('#todayPrompt').textContent = '先輸入最近一次月經首日，開始你的週期紀錄。'; return; }
  const today = localISO(new Date());
  const current = cycleWindowFor(today);
  const relevant = nextRelevantWindow(today);
  output.innerHTML = `<div class="summary-card"><small>最近一次月經首日</small><strong>${formatDate(start, false)}</strong></div><div class="summary-card"><small>預估排卵日</small><strong>${formatDate(relevant.ovulation, false)}</strong></div><div class="summary-card"><small>平均週期</small><strong>${relevant.length} 天</strong></div>`;
  if (inRange(today, current.fertileStart, current.ovulation)) $('#todayPrompt').textContent = '今天位於預估受孕窗口，記得依需要完成每日紀錄。';
  else if (today < current.fertileStart) $('#todayPrompt').textContent = `下一個預估受孕窗口從 ${formatDate(current.fertileStart)} 開始。`;
  else $('#todayPrompt').textContent = `本次預估受孕窗口已結束，下個窗口從 ${formatDate(relevant.fertileStart)} 開始。`;
}
function renderPeriods() {
  const list = $('#periodList');
  const periods = latestPeriods();
  list.replaceChildren(...periods.map((period) => { const item = document.createElement('li'); item.innerHTML = `<span>${formatDate(period.start)} 至 ${formatDate(period.end)}</span><button type="button" aria-label="刪除這筆月經紀錄" data-delete-period="${period.start}">×</button>`; return item; }));
  if (!periods.length) list.innerHTML = '<li><span>還沒有補登的月經紀錄</span></li>';
}
function renderPeriodPicker() {
  const year = periodPickerDate.getFullYear();
  const month = periodPickerDate.getMonth();
  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const lastDay = new Date(year, month + 1, 0).getDate();
  $('#periodPickerTitle').textContent = `${year} 年 ${month + 1} 月`;
  $('#periodPickerHint').textContent = !periodSelection.start ? '請先選擇月經開始日。' : !periodSelection.end ? '再選擇月經結束日。' : '已選擇月經日期範圍，可儲存紀錄。';
  $('#periodPickerSelection').textContent = periodSelection.start ? (periodSelection.end ? `${formatDate(periodSelection.start)} 至 ${formatDate(periodSelection.end)}` : `開始日 ${formatDate(periodSelection.start)}`) : '';
  $('#periodForm button[value="save"]').disabled = !(periodSelection.start && periodSelection.end);
  const calendar = $('#periodPickerCalendar');
  calendar.innerHTML = '<div class="weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div>';
  const days = document.createElement('div');
  days.className = 'days';
  for (let index = 0; index < 42; index += 1) {
    const day = index - startOffset + 1;
    const current = new Date(year, month, day);
    const value = localISO(current);
    const outside = day < 1 || day > lastDay;
    const selectedStart = value === periodSelection.start;
    const selectedEnd = value === periodSelection.end;
    const selectedRange = periodSelection.start && periodSelection.end && inRange(value, periodSelection.start, periodSelection.end);
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.periodDate = value;
    button.className = `period-picker-day ${outside ? 'is-outside' : ''} ${selectedRange ? 'is-selected-range' : ''} ${selectedStart ? 'is-range-start' : ''} ${selectedEnd ? 'is-range-end' : ''}`;
    button.textContent = current.getDate();
    button.setAttribute('aria-label', `${formatDate(value)}${selectedStart ? '，開始日' : selectedEnd ? '，結束日' : selectedRange ? '，已選區間' : ''}`);
    days.append(button);
  }
  calendar.append(days);
}
function openPeriodPicker() {
  periodSelection = { start: '', end: '' };
  periodPickerDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  renderPeriodPicker();
  $('#periodDialog').showModal();
}
function selectPeriodDate(value) {
  if (!periodSelection.start || periodSelection.end) periodSelection = { start: value, end: '' };
  else periodSelection = value < periodSelection.start ? { start: value, end: periodSelection.start } : { start: periodSelection.start, end: value };
  renderPeriodPicker();
}
function monthView(date) {
  const year = date.getFullYear(); const month = date.getMonth(); const first = new Date(year, month, 1); const startOffset = first.getDay(); const lastDay = new Date(year, month + 1, 0).getDate();
  const monthNode = document.createElement('section'); monthNode.className = 'month'; monthNode.innerHTML = `<h3 class="month-title">${year} 年 ${month + 1} 月</h3><div class="weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div>`;
  const days = document.createElement('div'); days.className = 'days';
  for (let index = 0; index < 42; index += 1) { const day = index - startOffset + 1; const current = new Date(year, month, day); const value = localISO(current); const info = dateInfo(value); const button = document.createElement('button'); button.type = 'button'; button.className = `day ${day < 1 || day > lastDay ? 'is-outside' : ''} ${info.period ? `${info.period}-period` : ''} ${info.fertile ? 'fertile' : ''} ${info.ovulation ? 'ovulation' : ''} ${state.records[value] ? 'has-record' : ''}`; button.dataset.date = value; button.textContent = current.getDate(); button.setAttribute('aria-label', `${formatDate(value)}，${info.ovulation ? '預估排卵日' : info.fertile ? '預估受孕窗口' : info.period ? `${info.period === 'actual' ? '實際' : '預估'}月經` : '一般日期'}，${state.records[value] ? '已有紀錄' : '尚未記錄'}`); days.append(button); }
  days.querySelector(`[data-date="${localISO(new Date())}"]`)?.setAttribute('aria-current', 'date');
  monthNode.append(days); return monthNode;
}
function renderCalendar() { const grid = $('#calendarGrid'); grid.replaceChildren(monthView(new Date(viewDate.getFullYear(), viewDate.getMonth(), 1))); }
function renderTemperature() {
  const values = Object.entries(state.records).filter(([, item]) => item.temperature).sort(([a], [b]) => a.localeCompare(b)).slice(-30);
  const root = $('#temperatureChart'); if (values.length < 2) { root.innerHTML = '<div class="chart-empty">記錄至少兩天基礎體溫後，這裡會顯示趨勢。</div>'; return; }
  const points = values.map(([, item]) => Number(item.temperature)); const min = Math.min(...points) - .1; const max = Math.max(...points) + .1; const plot = points.map((value, index) => `${(index / (points.length - 1)) * 100},${95 - ((value - min) / (max - min || 1)) * 84}`).join(' ');
  root.innerHTML = `<svg class="temperature-svg" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="最近 ${points.length} 筆基礎體溫趨勢"><polyline points="${plot}" fill="none" stroke="#ef9ca7" stroke-width="2.4" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
}
function renderQuickTemperature() {
  const record = state.records[quickTemperatureEntryDate] || {};
  const now = new Date();
  const defaultTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  $('#quickTemperatureDate').textContent = formatDate(quickTemperatureEntryDate);
  $('#quickTemperatureEntryDate').value = quickTemperatureEntryDate;
  $('#quickTemperature').value = record.temperature || '36';
  $('#quickTemperatureTime').value = record.temperatureTime || defaultTime;
  $('#quickTemperatureStatus').textContent = record.temperature ? `已記錄 ${record.temperature} °C${record.temperatureTime ? ` · ${record.temperatureTime}` : ''}` : '尚未記錄';
}
function renderAll() { $('#cycleLength').value = state.settings.cycleLength; $('#periodLength').value = state.settings.periodLength; $('#lastPeriodStart').value = state.settings.lastPeriodStart; renderSummary(); renderQuickTemperature(); renderPeriods(); renderCalendar(); renderTemperature(); }
function openDay(date) {
  const record = state.records[date] || {}; $('#recordDate').value = date; $('#dayDialogTitle').textContent = formatDate(date); $('#flow').value = record.flow || ''; $('#temperature').value = record.temperature || ''; $('#temperatureTime').value = record.temperatureTime || ''; $('#ovulationTest').value = record.ovulationTest || ''; $('#mucus').value = record.mucus || ''; $('#intercourse').checked = Boolean(record.intercourse); $('#note').value = record.note || ''; document.querySelectorAll('.symptom-field input').forEach((input) => { input.checked = (record.symptoms || []).includes(input.value); }); $('#deleteRecordButton').hidden = !state.records[date]; $('#dayDialog').showModal();
}
async function migrateLegacyData() {
  const stored = localStorage.getItem(legacyVaultKey);
  if (!stored) return null;
  try { return (await decrypt(JSON.parse(stored), '1989')).data; } catch { return null; }
}
async function initialize() {
  try { state = JSON.parse(localStorage.getItem(dataKey) || 'null'); } catch { state = null; }
  if (!state) {
    state = (await migrateLegacyData()) || defaultState();
    await save();
  }
  $('#app').hidden = false;
  renderAll();
}

function bindEvents() {
$('#dayDialog').addEventListener('close', () => {
  const day = $('#calendarGrid').querySelector(`[data-date="${$('#recordDate').value}"]`);
  day?.removeAttribute('aria-pressed');
  day?.focus({ preventScroll: true });
});
$('#settingsForm').addEventListener('submit', async (event) => { event.preventDefault(); const previous = state.settings.lastPeriodStart; state.settings = { cycleLength: Number($('#cycleLength').value), periodLength: Number($('#periodLength').value), lastPeriodStart: $('#lastPeriodStart').value }; if (state.settings.lastPeriodStart && state.settings.lastPeriodStart !== previous) { const existing = state.periods.find((period) => period.start === state.settings.lastPeriodStart); if (!existing) state.periods.push({ start: state.settings.lastPeriodStart, end: localISO(addDays(parseDate(state.settings.lastPeriodStart), state.settings.periodLength - 1)) }); } await save(); renderAll(); });
$('#quickTemperatureEntryDate').addEventListener('change', () => { if (!$('#quickTemperatureEntryDate').value) return; quickTemperatureEntryDate = $('#quickTemperatureEntryDate').value; renderQuickTemperature(); });
$('#quickTemperatureForm').addEventListener('submit', async (event) => { event.preventDefault(); const date = $('#quickTemperatureEntryDate').value; if (!date) return; quickTemperatureEntryDate = date; state.records[date] = { ...(state.records[date] || {}), temperature: $('#quickTemperature').value, temperatureTime: $('#quickTemperatureTime').value }; await save(); renderAll(); });
$('#calendarGrid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-date]');
  if (!button) return;
  openDay(button.dataset.date);
  button.setAttribute('aria-pressed', 'true');
});
$('#previousMonths').addEventListener('click', () => { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1); renderCalendar(); }); $('#nextMonths').addEventListener('click', () => { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1); renderCalendar(); }); $('#todayButton').addEventListener('click', () => { viewDate = new Date(); renderCalendar(); });
$('#dayForm').addEventListener('submit', async (event) => { if (event.submitter?.value !== 'save') return; event.preventDefault(); const date = $('#recordDate').value; const record = { flow: $('#flow').value, temperature: $('#temperature').value, temperatureTime: $('#temperatureTime').value, ovulationTest: $('#ovulationTest').value, mucus: $('#mucus').value, intercourse: $('#intercourse').checked, symptoms: [...document.querySelectorAll('.symptom-field input:checked')].map((input) => input.value), note: $('#note').value.trim() }; if (Object.values(record).every((value) => value === '' || value === false || (Array.isArray(value) && !value.length))) delete state.records[date]; else state.records[date] = record; await save(); $('#dayDialog').close(); renderAll(); });
$('#deleteRecordButton').addEventListener('click', async () => { delete state.records[$('#recordDate').value]; await save(); $('#dayDialog').close(); renderAll(); });
$('#addPeriodButton').addEventListener('click', openPeriodPicker);
$('#periodPreviousMonth').addEventListener('click', () => { periodPickerDate = new Date(periodPickerDate.getFullYear(), periodPickerDate.getMonth() - 1, 1); renderPeriodPicker(); });
$('#periodNextMonth').addEventListener('click', () => { periodPickerDate = new Date(periodPickerDate.getFullYear(), periodPickerDate.getMonth() + 1, 1); renderPeriodPicker(); });
$('#periodPickerCalendar').addEventListener('click', (event) => { const button = event.target.closest('[data-period-date]'); if (button) selectPeriodDate(button.dataset.periodDate); });
$('#periodForm').addEventListener('submit', async (event) => { if (event.submitter?.value !== 'save') return; event.preventDefault(); const { start, end } = periodSelection; if (!start || !end) return; state.periods = state.periods.filter((period) => period.start !== start); state.periods.push({ start, end }); if (!state.settings.lastPeriodStart || start > state.settings.lastPeriodStart) state.settings.lastPeriodStart = start; await save(); $('#periodDialog').close(); renderAll(); });
$('#periodList').addEventListener('click', async (event) => { const key = event.target.dataset.deletePeriod; if (!key) return; state.periods = state.periods.filter((period) => period.start !== key); if (state.settings.lastPeriodStart === key) state.settings.lastPeriodStart = latestPeriods()[0]?.start || ''; await save(); renderAll(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible' || !state) return; const today = localISO(new Date()); if (quickTemperatureEntryDate === lastSystemDate) quickTemperatureEntryDate = today; lastSystemDate = today; renderSummary(); renderCalendar(); renderQuickTemperature(); });
}

initialize().then(bindEvents).catch(() => {
  state = defaultState();
  $('#app').hidden = false;
  renderAll();
  bindEvents();
});
