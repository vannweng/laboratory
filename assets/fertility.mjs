import { addDays, adviceFor, cycleAt, dayDiff, averageCycleLength, fertilityOn, measurementHint, parseISO, periodStarts, periodStatus, shortDate, toISO, windowPlan } from './fertility-engine.mjs';

const legacyVaultKey = 'laboratory-fertility-vault-v1';
const dataKey = 'laboratory-fertility-data-v2';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let state;
let viewDate = new Date();
let periodSelection = { start: '', end: '' };
let periodPickerDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);

const $ = (selector) => document.querySelector(selector);
const today = () => toISO(new Date());
let quickEntryDate = today();
let lastSystemDate = today();
const defaultState = () => ({ settings: { cycleLength: 28, periodLength: 5, lastPeriodStart: '' }, periods: [], records: {} });

const mucusLabels = { dry: '乾燥', sticky: '黏稠', creamy: '乳霜狀', watery: '水狀', eggwhite: '蛋清狀' };
const levelLabels = { peak: '最佳', high: '可以', after: '排卵後' };

function formatDate(value, includeWeekday = true) {
  return parseISO(value).toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: includeWeekday ? 'short' : undefined });
}
const inRange = (value, start, end) => value >= start && value <= end;
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

// ---- 舊版加密資料遷移 ----
function fromBase64(value) { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }
async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}
async function decrypt(vault, password) {
  const key = await deriveKey(password, fromBase64(vault.salt));
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(vault.iv) }, key, fromBase64(vault.ciphertext));
  return JSON.parse(decoder.decode(plaintext));
}
async function migrateLegacyData() {
  const stored = localStorage.getItem(legacyVaultKey);
  if (!stored) return null;
  try { return await decrypt(JSON.parse(stored), '1989'); } catch { return null; }
}
async function save() { localStorage.setItem(dataKey, JSON.stringify(state)); }

// ---- 月經紀錄 ----
function latestPeriods() { return [...state.periods].sort((a, b) => b.start.localeCompare(a.start)); }
function periodsForCalendar() {
  const values = latestPeriods();
  if (!values.length && state.settings.lastPeriodStart) return [{ start: state.settings.lastPeriodStart, end: addDays(state.settings.lastPeriodStart, state.settings.periodLength - 1) }];
  return values;
}
function dateInfo(value) {
  const actual = periodsForCalendar().find((item) => inRange(value, item.start, item.end));
  const cycle = cycleAt(state, value);
  if (!cycle) return { period: actual ? 'actual' : '', level: 'none', ovulation: false };
  const predictedEnd = addDays(cycle.start, Number(state.settings.periodLength) - 1);
  const { level } = fertilityOn(state, value);
  return { period: actual ? 'actual' : (inRange(value, cycle.start, predictedEnd) && !cycle.completed ? 'predicted' : ''), level, ovulation: value === cycle.ovulation, source: cycle.source };
}

// ---- 今日建議 ----
function renderAdvice() {
  const advice = adviceFor(state, today());
  const facts = advice.facts.length ? `<p class="advice-facts">${advice.facts.map(escapeHTML).join('・')}</p>` : '';
  $('#adviceCard').className = `advice-card tone-${advice.tone}`;
  $('#adviceCard').innerHTML = `<p class="advice-badge">今天 · ${escapeHTML(advice.badge)}</p><h2 id="adviceTitle">${escapeHTML(advice.title)}</h2><p class="advice-detail">${escapeHTML(advice.detail)}</p>${advice.actions.length ? `<ul class="advice-actions">${advice.actions.map((item) => `<li>${escapeHTML(item)}</li>`).join('')}</ul>` : ''}${facts}`;
}

// ---- 窗口規劃 ----
function renderWindowPlan() {
  const plan = windowPlan(state, today());
  const list = $('#windowPlanList');
  if (!plan) {
    $('#windowPlanSource').textContent = '輸入最近一次月經首日後，這裡會列出每天的受孕機率。';
    $('#windowPlanTip').textContent = '';
    list.replaceChildren();
    return;
  }
  const sourceText = { bbt: '排卵日已由體溫上升確認', lh: '排卵日依試紙陽性推估（陽性後約 24–36 小時）', calendar: plan.cycle.lutealSamples ? `排卵日由下次月經往前推 ${plan.cycle.luteal} 天（你的黃體期）` : '排卵日由下次月經往前推 14 天，記錄體溫後會修正成你自己的黃體期' }[plan.cycle.source];
  $('#windowPlanSource').textContent = `${shortDate(plan.cycle.fertileStart)} – ${shortDate(plan.cycle.ovulation)}：${sourceText}`;
  list.replaceChildren(...plan.days.map((day) => {
    const item = document.createElement('li');
    const marks = [];
    if (day.intercourse) marks.push('<span class="mark mark-heart">♥ 同房</span>');
    if (day.lh === 'positive') marks.push('<span class="mark mark-lh">試紙陽性</span>');
    else if (day.lh === 'negative') marks.push('<span class="mark">試紙陰性</span>');
    if (day.mucus) marks.push(`<span class="mark">${mucusLabels[day.mucus]}</span>`);
    if (day.temperature) marks.push(`<span class="mark">${escapeHTML(day.temperature)}°C</span>`);
    item.innerHTML = `<button type="button" class="window-day level-${day.level} ${day.today ? 'is-today' : ''}" data-date="${day.date}"><span class="window-date">${formatDate(day.date)}${day.today ? '<em>今天</em>' : ''}</span><span class="window-level">${levelLabels[day.level]}</span><span class="window-marks">${marks.join('') || '<span class="mark mark-empty">尚無紀錄</span>'}</span></button>`;
    return item;
  }));
  const peakDone = plan.days.filter((day) => day.level === 'peak' && day.intercourse).length;
  $('#windowPlanTip').textContent = plan.intercourseCount
    ? `這個窗口已記錄同房 ${plan.intercourseCount} 次（最佳日 ${peakDone} 次）。窗口內每 1–2 天一次就夠，不必每天。`
    : '窗口內每 1–2 天同房一次即可，最佳日（排卵日前 2 天到排卵日）不要錯過。點任一天可以補記錄。';
}

// ---- 週期摘要 ----
function renderSummary() {
  const output = $('#cycleSummary');
  const status = periodStatus(state, today());
  if (!status) {
    output.innerHTML = '<div class="summary-card"><small>目前週期</small><strong>等待輸入</strong></div><div class="summary-card"><small>預估排卵日</small><strong>等待輸入</strong></div><div class="summary-card"><small>平均週期</small><strong>—</strong></div>';
    return;
  }
  const plan = windowPlan(state, today());
  const cycle = plan.cycle;
  const sourceNote = { bbt: '已由體溫確認', lh: '依試紙陽性推估', calendar: '依週期推估' }[cycle.source];
  output.innerHTML = `<div class="summary-card"><small>目前週期</small><strong>第 ${status.cycleDay} 天</strong><span class="card-note">月經首日 ${shortDate(status.lastStart)}</span></div><div class="summary-card"><small>排卵日</small><strong>${formatDate(cycle.ovulation, false)}</strong><span class="card-note">${sourceNote}</span></div><div class="summary-card"><small>平均週期 · 黃體期</small><strong>${averageCycleLength(state)} 天 · ${cycle.luteal} 天</strong><span class="card-note">${cycle.lutealSamples ? `根據 ${cycle.lutealSamples} 次體溫確認` : '黃體期暫用 14 天'}</span></div>`;
}

function renderPeriods() {
  const list = $('#periodList');
  const periods = latestPeriods();
  list.replaceChildren(...periods.map((period) => { const item = document.createElement('li'); item.innerHTML = `<span>${formatDate(period.start)} 至 ${formatDate(period.end)}</span><button type="button" aria-label="刪除這筆月經紀錄" data-delete-period="${period.start}">×</button>`; return item; }));
  if (!periods.length) list.innerHTML = '<li><span>還沒有補登的月經紀錄</span></li>';
}

// ---- 補登月經的日期選擇 ----
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
    const value = toISO(current);
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

// ---- 月曆 ----
function monthView(date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const startOffset = new Date(year, month, 1).getDay();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const node = document.createElement('section');
  node.className = 'month';
  node.innerHTML = `<h3 class="month-title">${year} 年 ${month + 1} 月</h3><div class="weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div>`;
  const days = document.createElement('div');
  days.className = 'days';
  for (let index = 0; index < 42; index += 1) {
    const day = index - startOffset + 1;
    const current = new Date(year, month, day);
    const value = toISO(current);
    const info = dateInfo(value);
    const record = state.records[value];
    const outside = day < 1 || day > lastDay;
    const classes = ['day', outside && 'is-outside', info.period && `${info.period}-period`, info.level !== 'none' && 'fertile', info.level === 'peak' && 'peak', info.ovulation && 'ovulation', record && 'has-record', record?.intercourse && 'has-intercourse', record?.ovulationTest === 'positive' && 'lh-positive'].filter(Boolean);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = classes.join(' ');
    button.dataset.date = value;
    button.textContent = current.getDate();
    const description = info.ovulation ? (info.source === 'calendar' ? '預估排卵日' : '排卵日') : info.level === 'peak' ? '最佳受孕日' : info.level === 'high' ? '受孕窗口' : info.period ? `${info.period === 'actual' ? '實際' : '預估'}月經` : '一般日期';
    button.setAttribute('aria-label', `${formatDate(value)}，${description}${record?.intercourse ? '，有同房' : ''}${record?.ovulationTest === 'positive' ? '，試紙陽性' : ''}，${record ? '已有紀錄' : '尚未記錄'}`);
    days.append(button);
  }
  days.querySelector(`[data-date="${today()}"]`)?.setAttribute('aria-current', 'date');
  node.append(days);
  return node;
}
function renderCalendar() { $('#calendarGrid').replaceChildren(monthView(new Date(viewDate.getFullYear(), viewDate.getMonth(), 1))); }

// ---- 基礎體溫圖 ----
function renderTemperature() {
  const root = $('#temperatureChart');
  const cycle = cycleAt(state, today());
  const points = cycle ? Object.entries(state.records)
    .filter(([date, item]) => item.temperature && date >= cycle.start && date <= addDays(cycle.start, 59) && date <= today())
    .map(([date, item]) => ({ date, day: dayDiff(cycle.start, date), temp: Number(item.temperature), bad: Boolean(item.tempDisturbed) }))
    .filter((point) => Number.isFinite(point.temp)).sort((a, b) => a.day - b.day) : [];
  if (points.length < 2) { root.innerHTML = '<div class="chart-empty">這個週期記錄至少兩天基礎體溫後，這裡會顯示趨勢。</div>'; return; }
  const width = Math.max(root.clientWidth || 640, 300);
  const height = 250;
  const pad = { left: 38, right: 12, top: 14, bottom: 52 };
  const lastDay = Math.max(points.at(-1).day, dayDiff(cycle.start, cycle.ovulation) + 2, 27);
  const days = Math.min(lastDay + 1, 60);
  const temps = points.map((point) => point.temp);
  if (cycle.bbt) temps.push(cycle.bbt.coverline);
  const min = Math.floor((Math.min(...temps) - 0.1) * 10) / 10;
  const max = Math.ceil((Math.max(...temps) + 0.1) * 10) / 10;
  const x = (day) => pad.left + (day / Math.max(days - 1, 1)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - (value - min) / (max - min || 1)) * (height - pad.top - pad.bottom);
  const parts = [];
  const windowStart = dayDiff(cycle.start, cycle.fertileStart);
  const windowEnd = dayDiff(cycle.start, cycle.ovulation);
  if (windowEnd >= 0 && windowStart <= days) parts.push(`<rect class="chart-window" x="${x(Math.max(windowStart, 0)) - 4}" y="${pad.top}" width="${x(Math.min(windowEnd, days - 1)) - x(Math.max(windowStart, 0)) + 8}" height="${height - pad.top - pad.bottom}" rx="4"><title>受孕窗口</title></rect>`);
  for (let value = min; value <= max + 1e-9; value += 0.1) parts.push(`<line class="chart-grid" x1="${pad.left}" x2="${width - pad.right}" y1="${y(value)}" y2="${y(value)}" /><text class="chart-label" x="${pad.left - 6}" y="${y(value) + 4}" text-anchor="end">${value.toFixed(1)}</text>`);
  for (let day = 0; day < days; day += 7) parts.push(`<text class="chart-label" x="${x(day)}" y="${height - 28}" text-anchor="middle">${shortDate(addDays(cycle.start, day)).replace('月', '/').replace('日', '')}</text>`);
  if (cycle.bbt) {
    parts.push(`<line class="chart-cover" x1="${pad.left}" x2="${width - pad.right}" y1="${y(cycle.bbt.coverline)}" y2="${y(cycle.bbt.coverline)}" /><text class="chart-label chart-cover-label" x="${width - pad.right}" y="${y(cycle.bbt.coverline) - 4}" text-anchor="end">基準線 ${cycle.bbt.coverline.toFixed(2)}</text>`);
  }
  if (cycle.source !== 'calendar') parts.push(`<line class="chart-ovulation" x1="${x(windowEnd)}" x2="${x(windowEnd)}" y1="${pad.top}" y2="${height - pad.bottom}" /><text class="chart-label chart-ovulation-label" x="${x(windowEnd) + 4}" y="${pad.top + 10}">排卵日</text>`);
  let segment = [];
  const flush = () => { if (segment.length > 1) parts.push(`<polyline class="chart-line" points="${segment.map((point) => `${x(point.day)},${y(point.temp)}`).join(' ')}" />`); segment = []; };
  points.forEach((point) => { if (segment.length && point.day - segment.at(-1).day > 2) flush(); segment.push(point); });
  flush();
  points.forEach((point) => parts.push(`<circle class="chart-dot ${point.bad ? 'is-disturbed' : ''}" cx="${x(point.day)}" cy="${y(point.temp)}" r="${point.bad ? 4 : 3.5}"><title>${shortDate(point.date)} ${point.temp.toFixed(2)}°C${point.bad ? '（受干擾，不列入判斷）' : ''}</title></circle>`));
  for (let day = 0; day < days; day += 1) {
    const record = state.records[addDays(cycle.start, day)];
    if (!record) continue;
    if (record.intercourse) parts.push(`<text class="chart-heart" x="${x(day)}" y="${height - 12}" text-anchor="middle">♥</text>`);
    if (record.ovulationTest === 'positive') parts.push(`<text class="chart-lh" x="${x(day)}" y="${height - 2}" text-anchor="middle">▲</text>`);
  }
  const summary = cycle.bbt ? `體溫已於 ${shortDate(cycle.bbt.riseDate)} 上升，推定排卵日 ${shortDate(cycle.ovulation)}` : '尚未偵測到持續的體溫上升';
  root.innerHTML = `<svg class="temperature-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="本週期基礎體溫趨勢，${points.length} 筆，${summary}">${parts.join('')}</svg><p class="chart-summary">${summary}。<span class="chart-key"><i class="key-dot"></i>體溫 <i class="key-dot is-disturbed"></i>受干擾 <i class="key-window"></i>受孕窗口 <b class="key-heart">♥</b>同房 <b class="key-lh">▲</b>試紙陽性</span></p>`;
}

// ---- 今日紀錄 ----
function recordSummary(record) {
  const items = [];
  if (record.temperature) items.push(`${record.temperature} °C${record.temperatureTime ? ` ${record.temperatureTime}` : ''}${record.tempDisturbed ? '（受干擾）' : ''}`);
  if (record.ovulationTest) items.push(record.ovulationTest === 'positive' ? '試紙陽性' : '試紙陰性');
  if (record.mucus) items.push(mucusLabels[record.mucus]);
  if (record.intercourse) items.push('同房');
  return items;
}
function renderQuickRecord(saved = false) {
  const record = state.records[quickEntryDate] || {};
  const now = new Date();
  const defaultTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  $('#quickTemperatureDate').textContent = quickEntryDate === today() ? `${formatDate(quickEntryDate)}（今天）` : formatDate(quickEntryDate);
  $('#quickTemperatureEntryDate').value = quickEntryDate;
  $('#quickTemperature').value = record.temperature || '';
  $('#quickTemperatureTime').value = record.temperatureTime || defaultTime;
  $('#quickOvulationTest').value = record.ovulationTest || '';
  $('#quickMucus').value = record.mucus || '';
  $('#quickIntercourse').checked = Boolean(record.intercourse);
  $('#quickDisturbed').checked = Boolean(record.tempDisturbed);
  const items = recordSummary(record);
  $('#quickTemperatureStatus').textContent = items.length ? `${saved ? '已儲存：' : '這天已記錄：'}${items.join('・')}` : '這天還沒有紀錄。';
  const hint = measurementHint(state, today());
  $('#measureHint').textContent = hint;
  $('#measureHint').hidden = !hint;
}
function isEmptyRecord(record) {
  return Object.values(record).every((value) => value === '' || value === false || value === undefined || (Array.isArray(value) && !value.length));
}

function renderAll() {
  $('#cycleLength').value = state.settings.cycleLength;
  $('#periodLength').value = state.settings.periodLength;
  $('#lastPeriodStart').value = state.settings.lastPeriodStart;
  renderAdvice();
  renderQuickRecord();
  renderWindowPlan();
  renderSummary();
  renderPeriods();
  renderCalendar();
  renderTemperature();
}

function openDay(date) {
  const record = state.records[date] || {};
  $('#recordDate').value = date;
  $('#dayDialogTitle').textContent = formatDate(date);
  $('#flow').value = record.flow || '';
  $('#temperature').value = record.temperature || '';
  $('#temperatureTime').value = record.temperatureTime || '';
  $('#ovulationTest').value = record.ovulationTest || '';
  $('#mucus').value = record.mucus || '';
  $('#intercourse').checked = Boolean(record.intercourse);
  $('#tempDisturbed').checked = Boolean(record.tempDisturbed);
  $('#note').value = record.note || '';
  document.querySelectorAll('.symptom-field input').forEach((input) => { input.checked = (record.symptoms || []).includes(input.value); });
  $('#deleteRecordButton').hidden = !state.records[date];
  $('#dayDialog').showModal();
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
  $('#settingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const previous = state.settings.lastPeriodStart;
    state.settings = { cycleLength: Number($('#cycleLength').value), periodLength: Number($('#periodLength').value), lastPeriodStart: $('#lastPeriodStart').value };
    if (state.settings.lastPeriodStart && state.settings.lastPeriodStart !== previous && !state.periods.some((period) => period.start === state.settings.lastPeriodStart)) {
      state.periods.push({ start: state.settings.lastPeriodStart, end: addDays(state.settings.lastPeriodStart, state.settings.periodLength - 1) });
    }
    await save();
    renderAll();
  });
  $('#quickTemperatureEntryDate').addEventListener('change', () => {
    if (!$('#quickTemperatureEntryDate').value) return;
    quickEntryDate = $('#quickTemperatureEntryDate').value;
    renderQuickRecord();
  });
  $('#quickTemperatureForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const date = $('#quickTemperatureEntryDate').value;
    if (!date) return;
    quickEntryDate = date;
    const temperature = $('#quickTemperature').value;
    const record = {
      ...(state.records[date] || {}),
      temperature,
      temperatureTime: temperature ? $('#quickTemperatureTime').value : '',
      ovulationTest: $('#quickOvulationTest').value,
      mucus: $('#quickMucus').value,
      intercourse: $('#quickIntercourse').checked,
      tempDisturbed: temperature ? $('#quickDisturbed').checked : false
    };
    if (isEmptyRecord(record)) delete state.records[date]; else state.records[date] = record;
    await save();
    renderAll();
    renderQuickRecord(true);
  });
  const openFromDate = (event) => {
    const button = event.target.closest('[data-date]');
    if (!button) return;
    openDay(button.dataset.date);
    button.setAttribute('aria-pressed', 'true');
  };
  $('#calendarGrid').addEventListener('click', openFromDate);
  $('#windowPlanList').addEventListener('click', (event) => { const button = event.target.closest('[data-date]'); if (button) openDay(button.dataset.date); });
  $('#previousMonths').addEventListener('click', () => { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1); renderCalendar(); });
  $('#nextMonths').addEventListener('click', () => { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1); renderCalendar(); });
  $('#todayButton').addEventListener('click', () => { viewDate = new Date(); renderCalendar(); });
  $('#dayForm').addEventListener('submit', async (event) => {
    if (event.submitter?.value !== 'save') return;
    event.preventDefault();
    const date = $('#recordDate').value;
    const record = {
      flow: $('#flow').value, temperature: $('#temperature').value, temperatureTime: $('#temperatureTime').value, ovulationTest: $('#ovulationTest').value, mucus: $('#mucus').value,
      intercourse: $('#intercourse').checked, tempDisturbed: $('#tempDisturbed').checked,
      symptoms: [...document.querySelectorAll('.symptom-field input:checked')].map((input) => input.value), note: $('#note').value.trim()
    };
    if (isEmptyRecord(record)) delete state.records[date]; else state.records[date] = record;
    await save();
    $('#dayDialog').close();
    renderAll();
  });
  $('#deleteRecordButton').addEventListener('click', async () => { delete state.records[$('#recordDate').value]; await save(); $('#dayDialog').close(); renderAll(); });
  $('#addPeriodButton').addEventListener('click', openPeriodPicker);
  $('#periodPreviousMonth').addEventListener('click', () => { periodPickerDate = new Date(periodPickerDate.getFullYear(), periodPickerDate.getMonth() - 1, 1); renderPeriodPicker(); });
  $('#periodNextMonth').addEventListener('click', () => { periodPickerDate = new Date(periodPickerDate.getFullYear(), periodPickerDate.getMonth() + 1, 1); renderPeriodPicker(); });
  $('#periodPickerCalendar').addEventListener('click', (event) => { const button = event.target.closest('[data-period-date]'); if (button) selectPeriodDate(button.dataset.periodDate); });
  $('#periodForm').addEventListener('submit', async (event) => {
    if (event.submitter?.value !== 'save') return;
    event.preventDefault();
    const { start, end } = periodSelection;
    if (!start || !end) return;
    state.periods = state.periods.filter((period) => period.start !== start);
    state.periods.push({ start, end });
    if (!state.settings.lastPeriodStart || start > state.settings.lastPeriodStart) state.settings.lastPeriodStart = start;
    await save();
    $('#periodDialog').close();
    renderAll();
  });
  $('#periodList').addEventListener('click', async (event) => {
    const key = event.target.dataset.deletePeriod;
    if (!key) return;
    state.periods = state.periods.filter((period) => period.start !== key);
    if (state.settings.lastPeriodStart === key) state.settings.lastPeriodStart = latestPeriods()[0]?.start || '';
    await save();
    renderAll();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state) return;
    const now = today();
    if (quickEntryDate === lastSystemDate) quickEntryDate = now;
    lastSystemDate = now;
    renderAll();
  });
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderTemperature, 150); });
}

initialize().then(bindEvents).catch(() => {
  state = defaultState();
  $('#app').hidden = false;
  renderAll();
  bindEvents();
});
