import { getProjects, summarizeProject } from './price-engine.mjs';
import { estimateAdjustments, offerAdvice } from './offer-engine.mjs';
import { affordability, defaultAfford } from './afford-engine.mjs';
import { estimateResaleAdjustments, listBuildings, listStreets, resaleAdvice } from './resale-engine.mjs';
import { marketPulse, quarterlyTrend } from './district-engine.mjs';
import { analyzeTrend } from './trend-engine.mjs';
import { CRITERIA, scoreAppreciation } from './appreciation-score.mjs';
import { addLocation, hasCoordinates } from './geo-engine.mjs';
import { officialFutureFacilities } from './future-evidence.mjs';

const $ = (selector) => document.querySelector(selector);
const number = (value, digits = 1) => Number(value).toLocaleString('zh-TW', { maximumFractionDigits: digits, minimumFractionDigits: digits });
let transactions = [];
let projects = [];
let selected = null;
let snapshot = null;
let lastAdvice = null;
let mode = 'presale';
let subject = null;
let resaleSnapshot = null;
let resaleRows = [];
let resaleAdjustments = null;
const districtSeries = {};
let districtSegment = 'elevator';
let adjustments = null;
const offerStorageKey = 'zhonghe-offers-v1';
let savedOffers = {};
const affordStorageKey = 'zhonghe-afford-v1';
let affordInput = defaultAfford();
const watchStorageKey = 'zhonghe-watchlist-v1';
let watchNames = [];
const watchSortKey = 'zhonghe-watch-sort-v1';
let watchSort = { key: null, dir: 'asc' };
try { const saved = JSON.parse(localStorage.getItem(watchSortKey) || 'null'); if (saved && ['latest', 'signal'].includes(saved.key) && ['asc', 'desc'].includes(saved.dir)) watchSort = saved; } catch { /* 使用加入順序 */ }
let trendEvidence = [];
let aiSummaries = {};
let geoSnapshot = {};
const scoreStorageKey = 'zhonghe-appreciation-v1';
let scoreAnswers = {};
const notesStorageKey = 'zhonghe-viewing-notes-v1';
let viewingNotes = [];
let editingNoteId = null;
let quickRatings = {};
let activeMetric = 'layout';
const breakerFields = ['breakerLight', 'breakerDark', 'breakerBeam', 'breakerDistance', 'breakerStairwell'];
const metricLabels = { layout: '格局動線', condition: '屋況管線', management: '社區管理', quiet: '環境安寧', preference: '直覺偏好' };
$('#top').insertBefore($('#watchlist'), $('#analysisPanel'));
function activateTab(tab, updateHash = true) {
  const watch = tab === 'watchlist';
  const trend = tab === 'trend';
  const notes = tab === 'notes';
  $('#watchlist').hidden = !watch;
  $('#analysisPanel').hidden = watch || trend || notes;
  $('#method').hidden = watch || trend || notes;
  $('#trendPanel').hidden = !trend;
  $('#notesPanel').hidden = !notes;
  $('#tabWatchlist').setAttribute('aria-selected', String(watch));
  $('#tabAnalysis').setAttribute('aria-selected', String(!watch && !trend && !notes));
  $('#tabTrend').setAttribute('aria-selected', String(trend));
  $('#tabNotes').setAttribute('aria-selected', String(notes));
  $('#tabWatchlist').tabIndex = watch ? 0 : -1;
  $('#tabAnalysis').tabIndex = !watch && !trend && !notes ? 0 : -1;
  $('#tabTrend').tabIndex = trend ? 0 : -1;
  $('#tabNotes').tabIndex = notes ? 0 : -1;
  if (updateHash) history.replaceState(null, '', watch ? '#watchlist' : trend ? '#trend' : notes ? '#notes' : '#analysis');
}
$('#tabWatchlist').addEventListener('click', () => activateTab('watchlist'));
$('#tabAnalysis').addEventListener('click', () => activateTab('analysis'));
$('#tabTrend').addEventListener('click', () => activateTab('trend'));
$('#tabNotes').addEventListener('click', () => activateTab('notes'));
$('#topAnalysisLink').addEventListener('click', () => activateTab('analysis', false));
$('.page-tabs').addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const tabs = [$('#tabWatchlist'), $('#tabAnalysis'), $('#tabTrend'), $('#tabNotes')];
  const index = tabs.indexOf(event.target);
  if (index < 0) return;
  const target = tabs[(index + (event.key === 'ArrowRight' ? 1 : 2)) % tabs.length];
  target.click();
  target.focus();
});
activateTab(location.hash === '#trend' ? 'trend' : location.hash === '#notes' ? 'notes' : ['#analysis', '#method'].includes(location.hash) ? 'analysis' : 'watchlist', false);

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

const tierOneFields = ['t1Budget', 't1Area', 't1Parking', 't1Commute'];
const tierTwoFields = ['t2Light', 't2Management', 't2Layout', 't2Bathroom'];
const tierThreeFields = ['t3KitchenBath', 't3Floor', 't3Electric'];

function saveViewingNotes() {
  try { localStorage.setItem(notesStorageKey, JSON.stringify(viewingNotes)); }
  catch { $('#noteStatus').textContent = '瀏覽器無法儲存筆記；請複製文字另存。'; }
}

function noteDecision(note) {
  const failed = tierOneFields.filter((field) => !note.tierOne?.[field]);
  const ratings = tierTwoFields.map((field) => Number(note.tierTwo?.[field])).filter((value) => value >= 1 && value <= 5);
  const score = ratings.length ? Math.round((ratings.reduce((total, value) => total + value, 0) / (ratings.length * 5)) * 100) : null;
  const budget = tierThreeFields.reduce((total, field) => total + (Number(note.tierThree?.[field]) || 0), 0);
  return { failed, score, budget, ratings: ratings.length };
}

function updateNoteCalculation() {
  const total = Number($('#noteTotal').value) || 0;
  const parking = Number($('#noteParkingPrice').value) || 0;
  const deed = Number($('#noteDeedArea').value) || 0;
  const main = Number($('#noteMainArea').value) || 0;
  if (!total || !deed) { $('#noteCalc').textContent = '填入總價與坪數後，自動算單價與公設比'; return; }
  const unit = (total - parking) / deed;
  const publicRatio = main && main <= deed ? ((deed - main) / deed) * 100 : null;
  $('#noteCalc').textContent = `扣車位單價 ${number(unit, 1)} 萬／坪${publicRatio === null ? '' : ` · 公設比 ${number(publicRatio, 1)}%`}`;
}

function paintQuickRatings() {
  for (const box of document.querySelectorAll('[data-rating]')) {
    const value = quickRatings[box.dataset.rating];
    for (const button of box.querySelectorAll('[data-score]')) button.classList.toggle('selected', Number(button.dataset.score) === Number(value));
  }
}

function renderComparison() {
  const columns = $('#comparisonColumns');
  columns.replaceChildren();
  const notes = viewingNotes.slice(0, 12);
  for (const note of notes) {
    const values = [
      note.project,
      note.deedArea && note.total ? `${number(((Number(note.total) || 0) - (Number(note.parkingPrice) || 0)) / Number(note.deedArea), 1)} 萬／坪${note.mainArea ? ` · ${number(((Number(note.deedArea) - Number(note.mainArea)) / Number(note.deedArea)) * 100, 0)}%` : ''}` : '未填',
      breakerFields.some((field) => note.breakers?.[field]) ? '踩雷' : '未發現',
      ...Object.keys(metricLabels).map((key) => note.ratings?.[key] ? `${note.ratings[key]} / 5` : '未評'),
    ];
    const card = element('div', 'comparison-property');
    values.forEach((value, index) => card.append(element('span', index === 0 ? 'comparison-name' : '', value)));
    columns.append(card);
  }
  if (!notes.length) columns.append(element('p', 'comparison-empty', '先儲存兩筆以上看屋筆記，即可開始比對。'));
  const picker = $('#metricPicker');
  picker.replaceChildren();
  for (const [key, label] of Object.entries(metricLabels)) {
    const button = element('button', key === activeMetric ? 'active' : '', label);
    button.type = 'button';
    button.addEventListener('click', () => { activeMetric = key; renderComparison(); });
    picker.append(button);
  }
  const ranking = $('#metricRanking');
  ranking.replaceChildren();
  const ranked = notes.filter((note) => Number(note.ratings?.[activeMetric])).sort((a, b) => Number(b.ratings[activeMetric]) - Number(a.ratings[activeMetric]));
  if (!ranked.length) ranking.append(element('p', 'comparison-empty', `尚無「${metricLabels[activeMetric]}」評分。`));
  ranked.forEach((note, index) => {
    const item = element('div', 'metric-rank');
    item.append(element('b', '', `#${index + 1}`), element('strong', '', note.project), element('span', '', `${note.ratings[activeMetric]} / 5`), element('small', '', note.text || '尚無備註'));
    ranking.append(item);
  });
}

function resetNoteForm(message = '') {
  editingNoteId = null;
  quickRatings = {};
  $('#noteForm').reset();
  $('#noteDate').value = new Date().toISOString().slice(0, 10);
  $('#noteSubmit').textContent = '儲存看屋筆記';
  $('#cancelNoteEdit').hidden = true;
  $('#noteStatus').textContent = message;
  paintQuickRatings();
  updateNoteCalculation();
}

function editViewingNote(note) {
  editingNoteId = note.id;
  $('#noteProject').value = note.project || '';
  $('#noteSize').value = note.size || '';
  $('#noteTotal').value = note.total || '';
  $('#noteParkingPrice').value = note.parkingPrice || '';
  $('#noteDeedArea').value = note.deedArea || '';
  $('#noteMainArea').value = note.mainArea || '';
  $('#noteDate').value = note.date || '';
  $('#noteText').value = note.text || '';
  for (const field of tierOneFields) $(`[name="${field}"]`).checked = Boolean(note.tierOne?.[field]);
  for (const field of tierTwoFields) $(`[name="${field}"]`).value = note.tierTwo?.[field] || '';
  for (const field of tierThreeFields) $(`[name="${field}"]`).value = note.tierThree?.[field] || '';
  for (const field of breakerFields) $(`[name="${field}"]`).checked = Boolean(note.breakers?.[field]);
  for (const input of document.querySelectorAll('[name="tags"]')) input.checked = (note.tags || []).includes(input.value);
  quickRatings = { ...(note.ratings || {}) };
  paintQuickRatings();
  updateNoteCalculation();
  $('#noteSubmit').textContent = '儲存修改';
  $('#cancelNoteEdit').hidden = false;
  $('#noteStatus').textContent = `正在修改「${note.project}」。`;
  $('#noteForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#noteProject').focus();
}

function renderViewingNotes() {
  const list = $('#noteList');
  list.replaceChildren();
  $('#noteCount').textContent = `${viewingNotes.length} 筆`;
  if (!viewingNotes.length) {
    list.append(element('p', 'note-empty', '還沒有看屋筆記。先記下第一個你實際走訪過的空間。'));
    return;
  }
  for (const note of viewingNotes) {
    const decision = noteDecision(note);
    const card = element('article', `note-card${decision.failed.length ? ' rejected' : ''}`);
    const header = element('div', 'note-card-header');
    const details = [note.size, note.total ? `${number(note.total, 0)} 萬` : '', note.location, note.date].filter(Boolean).join(' · ');
    header.append(element('div', '', undefined));
    header.firstChild.append(element('h4', '', note.project), element('p', '', details || '尚未補充坪數、位置或日期'));
    const actions = element('div', 'note-card-actions');
    const edit = element('button', 'note-edit', '修改');
    edit.type = 'button';
    edit.addEventListener('click', () => editViewingNote(note));
    const remove = element('button', 'note-delete', '刪除');
    remove.type = 'button';
    remove.addEventListener('click', () => {
      viewingNotes = viewingNotes.filter((item) => item.id !== note.id);
      saveViewingNotes();
      renderViewingNotes();
    });
    actions.append(edit, remove);
    header.append(actions);
    const status = element('div', 'note-summary');
    if (decision.failed.length) status.append(element('strong', 'note-reject', `建議跳過 · 硬性門檻有 ${decision.failed.length} 項未通過`));
    else status.append(element('strong', 'note-pass', '硬性門檻通過'));
    status.append(element('span', '', decision.score === null ? '核心體驗：尚未評分' : `核心體驗：${decision.score} 分${decision.score < 75 ? ' · 未達 75 分' : ' · 達標'}`));
    status.append(element('span', '', `裝修預備金：${number(decision.budget, 0)} 萬`));
    if (breakerFields.some((field) => note.breakers?.[field])) status.append(element('strong', 'note-reject', '踩雷物件'));
    card.append(header, status);
    if (note.tags?.length) card.append(element('p', 'note-card-tags', note.tags.map((tag) => `#${tag}`).join(' ')));
    if (note.text) card.append(element('p', 'note-card-text', note.text));
    list.append(card);
  }
  renderComparison();
}

$('#noteForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = new FormData(form);
  const tierOne = Object.fromEntries(tierOneFields.map((field) => [field, fields.get(field) === 'on']));
  const tierTwo = Object.fromEntries(tierTwoFields.map((field) => [field, fields.get(field)]));
  const tierThree = Object.fromEntries(tierThreeFields.map((field) => [field, fields.get(field)]));
  const breakers = Object.fromEntries(breakerFields.map((field) => [field, fields.get(field) === 'on']));
  const project = String(fields.get('noteProject') || '').trim();
  if (!project) return;
  const note = {
    id: editingNoteId || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    project,
    size: String(fields.get('noteSize') || '').trim(),
    total: String(fields.get('noteTotal') || '').trim(),
    parkingPrice: String(fields.get('noteParkingPrice') || '').trim(),
    deedArea: String(fields.get('noteDeedArea') || '').trim(),
    mainArea: String(fields.get('noteMainArea') || '').trim(),
    location: String(fields.get('noteLocation') || '').trim(),
    date: String(fields.get('noteDate') || ''),
    text: String(fields.get('noteText') || '').trim(),
    tierOne, tierTwo, tierThree, breakers, ratings: { ...quickRatings }, tags: fields.getAll('tags'),
  };
  const wasEditing = Boolean(editingNoteId);
  if (wasEditing) viewingNotes = viewingNotes.map((item) => item.id === editingNoteId ? note : item);
  else viewingNotes.unshift(note);
  saveViewingNotes();
  resetNoteForm(wasEditing ? '已更新這筆看屋筆記。' : '已儲存到這台裝置。');
  renderViewingNotes();
});

$('#cancelNoteEdit').addEventListener('click', () => resetNoteForm('已取消修改。'));
for (const input of ['#noteTotal', '#noteParkingPrice', '#noteDeedArea', '#noteMainArea']) $(input).addEventListener('input', updateNoteCalculation);
document.querySelectorAll('.rating-buttons button').forEach((button) => button.addEventListener('click', () => {
  quickRatings[button.closest('[data-rating]').dataset.rating] = Number(button.dataset.score);
  paintQuickRatings();
}));
$('#compareCards').addEventListener('click', () => { $('#compareCardView').hidden = false; $('#compareMetricView').hidden = true; $('#compareCards').classList.add('active'); $('#compareMetrics').classList.remove('active'); });
$('#compareMetrics').addEventListener('click', () => { $('#compareCardView').hidden = true; $('#compareMetricView').hidden = false; $('#compareMetrics').classList.add('active'); $('#compareCards').classList.remove('active'); renderComparison(); });

function saveWatchlist() {
  try { localStorage.setItem(watchStorageKey, JSON.stringify(watchNames)); }
  catch { $('#watchStatus').textContent = '瀏覽器無法儲存列表；重新整理後可能需要再次加入。'; }
}

function watchLines(items) {
  const box = element('div', 'watch-lines');
  for (const [label, value] of items) {
    const line = element('div', 'watch-line');
    line.append(element('span', '', label), element('strong', '', value));
    box.append(line);
  }
  return box;
}

function paintWatchSort() {
  for (const header of document.querySelectorAll('[data-sort-col]')) {
    const active = header.dataset.sortCol === watchSort.key;
    header.setAttribute('aria-sort', active ? (watchSort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    header.querySelector('.sort-button').classList.toggle('is-active', active);
  }
}
document.querySelectorAll('.sort-button').forEach((button) => button.addEventListener('click', () => {
  const key = button.dataset.sort;
  // 每次點擊：升冪 → 降冪 → 回到加入順序
  watchSort = watchSort.key !== key ? { key, dir: 'asc' } : watchSort.dir === 'asc' ? { key, dir: 'desc' } : { key: null, dir: 'asc' };
  try { localStorage.setItem(watchSortKey, JSON.stringify(watchSort)); } catch { /* 只影響下次開啟 */ }
  renderWatchlist();
  const labels = { latest: '最新成交單價', signal: '紅綠燈' };
  $('#watchStatus').textContent = watchSort.key ? `依${labels[watchSort.key]}${watchSort.key === 'signal' ? (watchSort.dir === 'asc' ? '排序：便宜 → 昂貴' : '排序：昂貴 → 便宜') : (watchSort.dir === 'asc' ? '由低到高排序' : '由高到低排序')}。` : '已恢復加入順序。';
}));

// ---- 依紅綠燈篩選「選擇建案」清單 ----
const projectSignals = new Map();
let watchFilter = 'all';
const watchSignalNames = { green: '便宜', amber: '合理', red: '昂貴', neutral: '資料不足' };
function renderWatchPicker() {
  const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  const counts = { all: sorted.length, green: 0, amber: 0, red: 0 };
  for (const project of sorted) { const signal = projectSignals.get(project.name); if (signal in counts) counts[signal] += 1; }
  for (const button of document.querySelectorAll('[data-watch-filter]')) {
    const key = button.dataset.watchFilter;
    const on = key === watchFilter;
    button.classList.toggle('is-active', on);
    button.setAttribute('aria-pressed', String(on));
    let count = button.querySelector('small');
    if (!count) { count = element('small'); button.append(count); }
    count.textContent = counts[key];
  }
  const shown = sorted.filter((project) => watchFilter === 'all' || projectSignals.get(project.name) === watchFilter);
  const placeholder = element('option', '', shown.length ? `請選擇建案（${shown.length} 個）` : `目前沒有「${watchSignalNames[watchFilter]}」的建案`);
  placeholder.value = '';
  const options = shown.map((project) => {
    const option = element('option', '', `${project.name} · ${watchSignalNames[projectSignals.get(project.name)]}${watchNames.includes(project.name) ? '（已加入）' : ''}`);
    option.value = project.name;
    return option;
  });
  $('#watchProject').replaceChildren(placeholder, ...options);
}
document.querySelectorAll('[data-watch-filter]').forEach((button) => button.addEventListener('click', () => {
  watchFilter = button.dataset.watchFilter;
  renderWatchPicker();
  $('#watchStatus').textContent = watchFilter === 'all' ? '顯示全部建案。' : `只顯示最新成交為「${watchSignalNames[watchFilter]}」的建案。`;
}));

function renderWatchlist() {
  paintWatchSort();
  if (projectSignals.size) renderWatchPicker();
  const list = $('#watchList');
  list.replaceChildren();
  $('#watchCount').textContent = `${watchNames.length} 個建案`;
  if (!watchNames.length) {
    const row = element('tr', 'watch-empty');
    const cell = element('td', '', '列表目前是空的。從上方挑選建案，即可把它加入追蹤。');
    cell.colSpan = 7;
    row.append(cell);
    list.append(row);
    return;
  }
  const signalLabels = { green: '便宜', amber: '合理', red: '昂貴', neutral: '資料不足' };
  const signalRank = { green: 0, amber: 1, red: 2 };
  let entries = watchNames.map((name) => ({ name, summary: summarizeProject({ name, transactions }) })).filter((entry) => entry.summary);
  if (watchSort.key) {
    const direction = watchSort.dir === 'asc' ? 1 : -1;
    const value = (entry) => (watchSort.key === 'latest' ? entry.summary.latest.unitPrice : signalRank[entry.summary.signal]);
    // 「資料不足」沒有燈號，無論升冪或降冪都排在最後；同值時維持加入順序。
    entries = entries.map((entry, index) => ({ ...entry, index })).sort((a, b) => {
      const va = value(a); const vb = value(b);
      if (va === undefined || vb === undefined) return (va === undefined) - (vb === undefined) || a.index - b.index;
      return (va - vb) * direction || a.index - b.index;
    });
  }
  for (const { name, summary } of entries) {
    const row = element('tr', 'watch-row');
    const cell = (content, className = '') => {
      const td = element('td', className);
      if (typeof content === 'string') td.textContent = content;
      else td.append(content);
      row.append(td);
    };
    const identity = element('div', 'watch-identity');
    identity.append(element('strong', '', name), element('small', '', `${summary.count} 筆成交`));
    const offer = savedOffers[name];
    if (offer) identity.append(element('small', `watch-offer ${offer.signal}`, `我的開價 ${number(offer.askingUnit, 1)}${offer.target ? ` · 目標 ≤ ${number(offer.target, 1)}` : ''}${offer.floor ? ` · ${offer.floor} 樓` : ''} · ${offer.savedAt}`));
    cell(identity, 'watch-name-cell');
    const latest = element('strong', 'watch-price', number(summary.latest.unitPrice, 1));
    cell(latest);
    cell(watchLines([
      ['便', summary.cheapMax === null ? '—' : `≤ ${number(summary.cheapMax, 1)}`],
      ['合', summary.reasonablePrice === null ? '—' : number(summary.reasonablePrice, 1)],
      ['貴', summary.expensiveMin === null ? '—' : `≥ ${number(summary.expensiveMin, 1)}`],
    ]));
    cell(element('span', `watch-signal ${summary.signal}`, signalLabels[summary.signal]));
    cell(watchLines([
      ['單價', summary.averageUnitPrice === null ? '—' : `${number(summary.averageUnitPrice, 1)} 萬／坪`],
      ['總價', summary.averageTotalPrice === null ? '—' : `${number(summary.averageTotalPrice, 0)} 萬`],
      ['坪數', summary.averageHomeArea === null ? '—' : `${number(summary.averageHomeArea, 1)} 坪`],
    ]));
    cell(summary.latest.date);
    const remove = element('button', 'watch-remove', '移除');
    remove.type = 'button';
    remove.setAttribute('aria-label', `從觀察列表移除 ${name}`);
    remove.addEventListener('click', () => {
      watchNames = watchNames.filter((item) => item !== name);
      saveWatchlist();
      renderWatchlist();
      $('#watchStatus').textContent = `已移除「${name}」。`;
    });
    cell(remove);
    list.append(row);
  }
}

function resetResult() {
  $('#resultEmpty').hidden = false;
  $('#resultContent').hidden = true;
}

function setSearchOpen(isOpen) {
  $('#projectOptions').hidden = !isOpen;
  $('#projectSearch').setAttribute('aria-expanded', String(isOpen));
}

function projectOption(project) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'project-option';
  button.setAttribute('role', 'option');
  const main = document.createElement('span');
  const name = document.createElement('strong');
  name.textContent = project.name;
  const address = document.createElement('small');
  address.textContent = `${project.address} · 最近成交 ${project.latest}`;
  const count = document.createElement('em');
  count.textContent = `${project.count} 筆`;
  main.append(name, address);
  button.append(main, count);
  button.addEventListener('click', () => chooseProject(project));
  return button;
}

function renderSearch() {
  const query = $('#projectSearch').value.trim().toLocaleLowerCase('zh-Hant');
  const matches = projects.filter((project) => `${project.name} ${project.street} ${project.address}`.toLocaleLowerCase('zh-Hant').includes(query)).slice(0, 12);
  const options = $('#projectOptions');
  options.replaceChildren();
  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'field-hint';
    empty.style.padding = '8px 13px';
    empty.textContent = '沒有找到建案。此版僅收錄中和區已有公開預售成交的建案。';
    options.append(empty);
  } else {
    for (const project of matches) options.append(projectOption(project));
  }
  setSearchOpen(true);
}

function chooseProject(project) {
  selected = project;
  resetResult();
  $('#selectedName').textContent = project.name;
  $('#selectedAddress').textContent = project.address;
  $('#selectedProject').hidden = false;
  $('#projectSearch').value = project.name;
  setSearchOpen(false);
  $('#askingUnit').focus();
}

const wan = (value) => `${number(value, 0)} 萬`;
const signalTitles = { green: '綠燈 · 在目標價以內', amber: '黃燈 · 在行情附近，可以談', red: '紅燈 · 超過離場價', neutral: '資料不足 · 暫不判燈' };
const confidenceLabels = { high: '高', medium: '中', low: '低', none: '不足' };

function calculateAndRender() {
  const askingUnit = Number($('#askingUnit').value);
  const area = Number($('#targetArea').value);
  const floor = Number($('#targetFloor').value) || null;
  const parkingPrice = Number($('#parkingPrice').value) || 0;
  if (mode === 'resale') {
    const street = $('#resaleStreet').value.trim();
    const building = $('#resaleBuilding').value;
    subject = { name: building || street, address: `新北市中和區${building || street}`, kind: 'resale' };
    lastAdvice = resaleAdvice({ rows: resaleRows, street, building, built: Number($('#resaleBuilt').value), type: $('#resaleType').value, floor, area, askingUnit, parkingPrice, asOf: resaleSnapshot.generatedAt, adjustments: resaleAdjustments });
  } else {
    subject = { name: selected.name, address: selected.address, kind: 'presale' };
    lastAdvice = offerAdvice({ project: selected, projects, transactions, askingUnit, area, floor, parkingPrice, asOf: snapshot.generatedAt, adjustments });
  }
  lastAdvice.parkingPrice = parkingPrice;
  renderResult(lastAdvice);
}

const tierLabels = { building: '同一棟', street: '同路段', district: '其他路段' };
function renderMarketContext(advice) {
  const segment = advice.kind === 'resale' ? (advice.type === '公寓' ? 'walkup' : 'elevator') : 'presale';
  const pulse = districtSeries[segment] && marketPulse(districtSeries[segment]);
  const labels = { elevator: '中古大樓／華廈', walkup: '中古公寓', presale: '預售屋' };
  $('#marketContext').innerHTML = pulse?.reading
    ? `<strong>整區時機參考</strong> · 中和${labels[segment]} ${pulse.latest.quarter.replace('Q', ' 第 ')} 季中位數 ${number(pulse.latest.median, 1)} 萬／坪，比去年同季 ${pulse.priceChange >= 0 ? '+' : ''}${number(pulse.priceChange * 100, 1)}%，成交量 ${pulse.volumeChange >= 0 ? '+' : ''}${number(pulse.volumeChange * 100, 0)}%。${pulse.reading.text}`
    : '';
}

function renderPriceBand(advice) {
  const band = $('#priceBand');
  if (advice.signal === 'neutral') { band.replaceChildren(); return; }
  const low = Math.min(advice.range.min, advice.askingUnit); const high = Math.max(advice.range.max, advice.askingUnit);
  const span = high - low || 1;
  const at = (value) => `${((value - low) / span) * 100}%`;
  band.innerHTML = `<div class="band-track"><i class="band-green" style="left:0;width:${at(advice.target)}"></i><i class="band-amber" style="left:${at(advice.target)};width:calc(${at(advice.walkAway)} - ${at(advice.target)})"></i><i class="band-red" style="left:${at(advice.walkAway)};right:0"></i><b class="band-you" style="left:${at(advice.askingUnit)}"><span>你的開價</span></b></div><div class="band-scale"><span>${number(low, 1)}</span><span>${number(high, 1)} 萬／坪</span></div>`;
}

function renderResult(advice) {
  $('#resultEmpty').hidden = true;
  $('#resultContent').hidden = false;
  const isResale = advice.kind === 'resale';
  $('#resultDate').textContent = `資料快照 ${(isResale ? resaleSnapshot : snapshot).generatedAt}`;
  $('#resultProject').textContent = `${subject.name}${isResale ? ` · ${advice.type} · ${advice.built} 年完工` : ''} · ${advice.floor ? `${advice.floor} 樓 · ` : ''}${number(advice.area, 1)} 坪 · 開價 ${number(advice.askingUnit, 1)} 萬／坪`;
  $('#signalLamp').className = `signal-lamp ${advice.signal}`;
  $('#signalTitle').textContent = signalTitles[advice.signal];
  renderPriceBand(advice);
  const neutral = advice.signal === 'neutral';
  for (const [key, id] of [['target', 'target'], ['market', 'market'], ['walkAway', 'walk']]) {
    $(`#${id}Display`).textContent = neutral ? '—' : `${number(advice[key], 1)} 萬／坪`;
    $(`#${id}Total`).textContent = neutral ? '' : `總價約 ${wan(advice.totals[key])}`;
  }
  if (neutral) {
    $('#signalDescription').textContent = isResale
      ? '同型態、屋齡相差 5 年內、坪數相近的成交，近三年少於 5 筆。可以放寬坪數或確認完工年份與型態後再試。'
      : '本案和 500 公尺內的同類型建案，近三年相近坪數的成交少於 5 筆。資料太少時燈號容易誤導，請改用附近成交行情或實地詢價。';
    $('#overMarketNote').textContent = '';
  } else {
    const messages = {
      green: isResale ? '開價在目標價以內，屬於近三年同條件成交的中低價位。仍要確認屋況、漏水壁癌、管線年份與社區管理。' : '開價在目標價以內，屬於近三年同條件成交的中低價位。仍要確認棟別、座向、付款條件與車位。',
      amber: `開價落在目標價與離場價之間，大約在第 ${Math.round(advice.position * 100)} 百分位。可以拿下方案例，試著往目標價談。`,
      red: `開價高於近三年同條件成交的第 65 百分位。除非有明確理由（景觀、邊間、特殊格局），否則先不急著買。`,
    };
    $('#signalDescription').textContent = messages[advice.signal];
    const diff = advice.overMarket;
    $('#overMarketNote').innerHTML = `${diff > 0 ? `比行情貴約 <strong>${wan(diff)}</strong>` : `比行情便宜約 <strong>${wan(-diff)}</strong>`}；要談到目標價，${advice.overTarget > 0 ? `總價需要再少約 <strong>${wan(advice.overTarget)}</strong>` : '目前開價已經做到'}。你的開價總價約 ${wan(advice.askingTotal)}${advice.parkingPrice ? '（含車位）' : ''}。`;
  }
  const adj = advice.adjustments;
  const floorText = advice.floor ? `每差一層修正 ${number(adj.floorPerLevel, 2)} 萬／坪` : '沒有填樓層，所以沒有做樓層修正';
  const timeText = `時間修正每月 ${adj.monthTrend >= 0 ? '+' : ''}${number(adj.monthTrend, 2)} 萬／坪`;
  if (isResale) {
    const used = [['building', '同一棟'], ['street', '同路段（屋齡差 5 年內）'], ['district', '其他路段']].filter(([key]) => advice.counts[key]).map(([key, label]) => `${label} ${advice.counts[key]} 筆`).join('、') || '沒有可用成交';
    $('#confidenceNote').innerHTML = `<strong>信心程度：${confidenceLabels[advice.confidence]}</strong> · 用了${used}。${floorText}；屋齡每新一年 +${number(adj.perNewerYear, 2)} 萬／坪；${timeText}。${advice.counts.district ? '用到其他路段時，地段差異沒有修正，請把燈號當參考就好。' : ''}`;
  } else {
    const borrowed = advice.nearby ? `，並借用附近 ${advice.nearbyProjects.length} 個建案 ${advice.nearby} 筆` : '';
    $('#confidenceNote').innerHTML = `<strong>信心程度：${confidenceLabels[advice.confidence]}</strong> · 用了本案 ${advice.own} 筆${borrowed}。${floorText}；${timeText}。${advice.confidence === 'low' ? '借用其他建案時，建商、屋齡與地段差異沒有修正，請把燈號當參考就好。' : ''}`;
  }
  renderMarketContext(advice);
  $('#casesCount').textContent = neutral ? '0 筆' : `${advice.sampleSize} 筆 · 顯示 ${advice.cases.length} 筆`;
  $('#casesSummary').textContent = neutral ? '' : isResale ? '優先列出同一棟、同路段、樓層最接近的成交。右邊是修正到你的樓層、屋齡與今天後的單價。' : '優先列出本案、樓層最接近的成交。右邊是修正到你的樓層與今天後的單價。';
  $('#caseList').replaceChildren(...advice.cases.map((row) => {
    const mine = isResale ? row.tier === 'building' : row.name === subject.name;
    const item = element('div', `case-item${mine ? ' is-included' : ''}`);
    const main = element('div');
    const label = isResale ? `${row.building}（${tierLabels[row.tier]} · ${row.built} 年）` : row.name;
    main.append(element('strong', '', `${label}${row.floorNumber ? ` · ${row.floorNumber} 樓` : ''} · ${number(row.homeArea, 1)} 坪`));
    const signed = (value) => `${value > 0 ? '+' : ''}${number(value, 1)}`;
    const shifts = [row.floorShift ? `樓層 ${signed(row.floorShift)}` : '', row.ageShift ? `屋齡 ${signed(row.ageShift)}` : '', row.timeShift ? `時間 ${signed(row.timeShift)}` : ''].filter(Boolean).join('、');
    main.append(element('small', '', `${row.date} 成交 ${number(row.unitPrice, 1)} 萬／坪${shifts ? `（${shifts}）` : ''}${row.distanceMeters ? ` · 距離 ${Math.round(row.distanceMeters)} 公尺` : ''}`));
    item.append(main, element('b', '', `${number(row.adjusted, 1)} 萬／坪`));
    return item;
  }));
  $('#saveOffer').hidden = isResale;
  $('#offerStatus').textContent = isResale ? '觀察列表目前只收預售建案；可以先把這間寫進看屋筆記。' : savedOffers[subject.name] ? '這個建案已有記錄的開價，再按一次會更新。' : '把這次的開價和目標價記下來，之後回來比較。';
  $('#mapsLink').href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(isResale ? subject.address : `${subject.address} ${subject.name}`)}`;
  renderAfford();
}

// ---- 負擔能力 ----
function hydrateAfford() {
  const plan = affordInput;
  $('#affordCash').value = plan.cash;
  $('#affordIncome').value = plan.annualIncome;
  $('#affordDebt').value = Math.round(plan.otherMonthlyDebt * 10000);
  $('#affordRate').value = Math.round(plan.rate * 10000) / 100;
  $('#affordYears').value = plan.years;
  $('#affordLtv').value = plan.ltv * 10;
}
function readAfford() {
  return { ...affordInput, cash: Number($('#affordCash').value), annualIncome: Number($('#affordIncome').value), otherMonthlyDebt: (Number($('#affordDebt').value) || 0) / 10000, rate: Number($('#affordRate').value) / 100, years: Number($('#affordYears').value), ltv: Number($('#affordLtv').value) / 10 };
}
function renderAfford() {
  const output = $('#affordResult');
  try {
    const input = readAfford();
    const result = affordability(input, lastAdvice?.askingTotal);
    affordInput = result.plan;
    try { localStorage.setItem(affordStorageKey, JSON.stringify(affordInput)); } catch { /* 只影響下次預填 */ }
    $('#ltvLabel').textContent = number(result.plan.ltv * 10, result.plan.ltv * 10 % 1 ? 1 : 0);
    const limit = result.limitedBy === 'cash' ? '自備款' : '收入';
    const parts = [`<div class="afford-headline"><span>你可負擔的總價上限</span><strong>約 ${wan(result.maxPrice)}</strong><small>目前卡在${limit}；月付上限約 ${number(result.maxMonthly * 10000, 0)} 元</small></div>`];
    const check = result.check;
    if (check) {
      const issues = [];
      if (check.cashShort > 0) issues.push(`自備款還差約 ${wan(check.cashShort)}`);
      if (check.ratio > 0.4) issues.push('月付超過收入四成，負擔過重');
      else if (check.ratio > result.plan.burden + 1e-9) issues.push('月付超過收入三分之一，偏緊');
      const statusText = issues.length ? issues.join('；') : '負擔得起';
      const tone = check.cashShort > 0 || check.ratio > 0.4 ? 'over' : check.ratio > result.plan.burden + 1e-9 ? 'tight' : 'ok';
      parts.push(`<div class="afford-check is-${tone}"><span>以這次開價總價 ${wan(check.price)} 計算</span><strong>${statusText}</strong><ul><li>需準備現金約 ${wan(check.cashNeeded)}（頭期款加稅費 ${wan(check.fees)}）</li><li>貸款約 ${wan(check.loan)}，每月房貸約 ${number(check.payment * 10000, 0)} 元</li><li>房貸加其他貸款佔月收入 ${number(check.ratio * 100, 0)}%</li></ul></div>`);
      if (lastAdvice?.signal && lastAdvice.signal !== 'neutral' && lastAdvice.totals.target > result.maxPrice) parts.push('<p class="field-hint">就算談到目標價，仍超過可負擔上限，建議改看較小坪數或其他建案。</p>');
    }
    output.innerHTML = parts.join('');
  } catch (error) {
    output.innerHTML = `<p class="field-hint">${error.message}</p>`;
  }
}

// ---- 串接觀察列表與看屋筆記 ----
function saveOffer() {
  if (!lastAdvice || !selected || lastAdvice.kind === 'resale') return;
  const advice = lastAdvice;
  savedOffers[selected.name] = { askingUnit: advice.askingUnit, area: advice.area, floor: advice.floor, parkingPrice: advice.parkingPrice || 0, signal: advice.signal, target: advice.target ?? null, market: advice.market ?? null, walkAway: advice.walkAway ?? null, confidence: advice.confidence, savedAt: new Date().toISOString().slice(0, 10) };
  try { localStorage.setItem(offerStorageKey, JSON.stringify(savedOffers)); } catch { /* 下方提示 */ }
  if (!watchNames.includes(selected.name)) { watchNames.push(selected.name); saveWatchlist(); }
  renderWatchlist();
  $('#offerStatus').textContent = `已加入觀察列表，並記下開價 ${number(advice.askingUnit, 1)} 萬／坪${advice.target ? `、目標價 ${number(advice.target, 1)} 萬／坪` : ''}。`;
}
function writeNoteFromResult() {
  if (!lastAdvice || !subject) return;
  resetNoteForm();
  $('#noteProject').value = subject.name;
  $('#noteSize').value = [lastAdvice.floor ? `${lastAdvice.floor} 樓` : '', `${number(lastAdvice.area, 1)} 坪`].filter(Boolean).join(' · ');
  $('#noteTotal').value = Math.round(lastAdvice.askingTotal);
  if (lastAdvice.parkingPrice) $('#noteParkingPrice').value = lastAdvice.parkingPrice;
  updateNoteCalculation();
  activateTab('notes');
  $('#notesPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#noteStatus').textContent = `已帶入${subject.kind === 'resale' ? '地址' : '建案'}、樓層、坪數與開價總價。`;
}
$('#saveOffer').addEventListener('click', saveOffer);
$('#writeNote').addEventListener('click', writeNoteFromResult);
$('#affordForm').addEventListener('input', renderAfford);

$('#projectSearch').addEventListener('focus', () => { if (projects.length) renderSearch(); });
$('#projectSearch').addEventListener('input', () => { selected = null; resetResult(); $('#selectedProject').hidden = true; renderSearch(); });
$('#projectSearch').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setSearchOpen(false);
  if (event.key === 'Enter' && !$('#projectOptions').hidden) {
    const first = $('#projectOptions .project-option');
    if (first) { event.preventDefault(); first.click(); }
  }
});
$('#clearSearch').addEventListener('click', () => { $('#projectSearch').value = ''; selected = null; resetResult(); $('#selectedProject').hidden = true; $('#projectSearch').focus(); renderSearch(); });
$('#changeProject').addEventListener('click', () => { $('#projectSearch').focus(); $('#projectSearch').select(); renderSearch(); });
document.addEventListener('click', (event) => { if (!event.target.closest('.search-wrap, .project-options')) setSearchOpen(false); });
$('#askingUnit').addEventListener('input', resetResult);
$('#targetArea').addEventListener('input', resetResult);
$('#targetFloor').addEventListener('input', resetResult);
$('#parkingPrice').addEventListener('input', resetResult);
$('#priceForm').addEventListener('submit', (event) => {
  event.preventDefault();
  if (mode === 'presale' && !selected) { $('#projectSearch').focus(); renderSearch(); return; }
  if (mode === 'resale') {
    if (!resaleRows.length) { $('#resaleStatus').textContent = '中古屋資料還沒載入完成，請稍候再試。'; return; }
    if (!$('#resaleStreet').value.trim()) { $('#resaleStreet').focus(); $('#resaleStatus').textContent = '請先選路名。'; return; }
    if (!(Number($('#resaleBuilt').value) >= 1950)) { $('#resaleBuilt').focus(); $('#resaleStatus').textContent = '請填完工年份（可在權狀或 591 物件頁找到）。'; return; }
  }
  if (!event.currentTarget.reportValidity()) return;
  try { calculateAndRender(); } catch (error) { $(mode === 'resale' ? '#resaleStatus' : '#dataStatus').textContent = error.message; return; }
  if (window.innerWidth < 900) $('#resultContent').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

function setMode(next) {
  mode = next;
  $('#modePresale').classList.toggle('is-active', mode === 'presale');
  $('#modeResale').classList.toggle('is-active', mode === 'resale');
  $('#modePresale').setAttribute('aria-pressed', String(mode === 'presale'));
  $('#modeResale').setAttribute('aria-pressed', String(mode === 'resale'));
  $('#presaleEntry').hidden = mode !== 'presale';
  $('#resaleEntry').hidden = mode !== 'resale';
  resetResult();
}
$('#modePresale').addEventListener('click', () => setMode('presale'));
$('#modeResale').addEventListener('click', () => setMode('resale'));
function renderBuildingOptions() {
  const street = $('#resaleStreet').value.trim();
  const select = $('#resaleBuilding');
  const options = [element('option', '', street ? '不指定（用整條路比較）' : '先選路名')];
  options[0].value = '';
  const buildings = street ? listBuildings(resaleRows, street) : [];
  for (const item of buildings.slice(0, 80)) {
    const option = element('option', '', `${item.building} · ${item.built} 年 · ${item.type} · ${item.count} 筆`);
    option.value = item.building;
    options.push(option);
  }
  select.replaceChildren(...options);
  $('#resaleStatus').textContent = street ? (buildings.length ? `${street}近四年有 ${buildings.reduce((sum, item) => sum + item.count, 0)} 筆住宅成交、${buildings.length} 棟。選同一棟會自動帶入完工年份與型態。` : `資料中沒有「${street}」的成交，會改用全中和屋齡相近的成交比較，信心程度較低。`) : $('#resaleStatus').dataset.base;
}
$('#resaleStreet').addEventListener('change', () => { renderBuildingOptions(); resetResult(); });
$('#resaleStreet').addEventListener('input', resetResult);
$('#resaleBuilding').addEventListener('change', () => {
  const item = listBuildings(resaleRows, $('#resaleStreet').value.trim()).find((entry) => entry.building === $('#resaleBuilding').value);
  if (item) { $('#resaleBuilt').value = item.built; $('#resaleType').value = item.type; }
  resetResult();
});
$('#resaleBuilt').addEventListener('input', resetResult);
$('#resaleType').addEventListener('change', resetResult);

// ---- 中和整區行情 ----
function renderDistrict() {
  const series = districtSeries[districtSegment];
  const chart = $('#districtChart');
  if (!series?.length) { chart.replaceChildren(); $('#districtPulse').textContent = '整區資料載入中或無資料。'; return; }
  document.querySelectorAll('[data-segment]').forEach((button) => { const on = button.dataset.segment === districtSegment; button.classList.toggle('is-active', on); button.setAttribute('aria-pressed', String(on)); });
  const pulse = marketPulse(series);
  $('#districtPulse').innerHTML = pulse?.reading
    ? `<span class="pulse-tag ${pulse.reading.tone}">${{ buyer: '偏買方', seller: '偏賣方', mixed: '觀望', neutral: '持平' }[pulse.reading.tone]}</span> ${pulse.latest.quarter.replace('Q', ' 第 ')} 季中位數 <strong>${number(pulse.latest.median, 1)} 萬／坪</strong>（去年同季 ${pulse.priceChange >= 0 ? '+' : ''}${number(pulse.priceChange * 100, 1)}%），成交 ${pulse.latest.count} 筆（${pulse.volumeChange >= 0 ? '+' : ''}${number(pulse.volumeChange * 100, 0)}%）。${pulse.reading.text}`
    : '資料不足，暫時無法比較去年同季。';
  const width = 760; const height = 240; const left = 44; const right = 44; const top = 16; const bottom = 34;
  const prices = series.filter((item) => item.median !== null).map((item) => item.median);
  const minPrice = Math.floor(Math.min(...prices) - 2); const maxPrice = Math.ceil(Math.max(...prices) + 2);
  const maxCount = Math.max(...series.map((item) => item.count));
  const step = (width - left - right) / series.length;
  const x = (index) => left + step * index + step / 2;
  const yPrice = (value) => top + (1 - (value - minPrice) / (maxPrice - minPrice || 1)) * (height - top - bottom);
  const yCount = (value) => height - bottom - (value / maxCount) * (height - top - bottom) * 0.55;
  const bars = series.map((item, index) => `<rect class="volume-bar${item.complete ? '' : ' is-partial'}" x="${x(index) - step * 0.32}" y="${yCount(item.count)}" width="${step * 0.64}" height="${height - bottom - yCount(item.count)}"><title>${item.quarter} 成交 ${item.count} 筆</title></rect>`).join('');
  const done = series.map((item, index) => ({ ...item, index })).filter((item) => item.median !== null && item.complete);
  const line = done.map((item) => `${x(item.index)},${yPrice(item.median)}`).join(' ');
  const partial = series.map((item, index) => ({ ...item, index })).filter((item) => item.median !== null && !item.complete);
  const lastDone = done.at(-1);
  const partialLine = partial.length && lastDone ? `<polyline class="price-line is-partial" points="${[lastDone, ...partial].map((item) => `${x(item.index)},${yPrice(item.median)}`).join(' ')}"/>` : '';
  const dots = done.map((item) => `<circle class="price-dot" cx="${x(item.index)}" cy="${yPrice(item.median)}" r="3"><title>${item.quarter} 中位數 ${number(item.median, 1)} 萬／坪</title></circle>`).join('');
  const labels = series.map((item, index) => (item.quarter.endsWith('Q1') || index === series.length - 1) ? `<text x="${x(index)}" y="${height - 12}" text-anchor="middle">${item.quarter.endsWith('Q1') ? item.quarter.slice(0, 4) : item.quarter.replace('Q', 'Q')}</text>` : '').join('');
  const grid = [minPrice, (minPrice + maxPrice) / 2, maxPrice].map((value) => `<line class="grid" x1="${left}" x2="${width - right}" y1="${yPrice(value)}" y2="${yPrice(value)}"/><text x="${left - 6}" y="${yPrice(value) + 4}" text-anchor="end">${number(value, 0)}</text>`).join('');
  chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="中和整區每季單價中位數與成交量">${grid}${bars}<polyline class="price-line" points="${line}"/>${partialLine}${dots}${labels}<text x="${width - right + 6}" y="${top + 10}">萬／坪</text></svg><div class="district-legend"><span><i class="legend-line"></i>單價中位數</span><span><i class="legend-bar"></i>成交筆數</span><span><i class="legend-partial"></i>申報中、資料不完整</span></div>`;
}
document.querySelectorAll('[data-segment]').forEach((button) => button.addEventListener('click', () => { districtSegment = button.dataset.segment; renderDistrict(); }));

$('#addWatchProject').addEventListener('click', () => {
  const name = $('#watchProject').value;
  if (!name || !projects.some((project) => project.name === name)) {
    $('#watchStatus').textContent = '請先選一個建案。';
    return;
  }
  if (watchNames.includes(name)) {
    $('#watchStatus').textContent = `「${name}」已在列表中。`;
    return;
  }
  watchNames.push(name);
  saveWatchlist();
  renderWatchlist();
  $('#watchStatus').textContent = `已加入「${name}」。`;
});

function nearbyNames(project, type) {
  return (project.nearby?.[type] || []).slice(0, 3).map((item) => `${item.name}（${item.distanceMeters}m）`);
}

function automaticAnswers(project, leads) {
  if (!hasCoordinates(project)) return Object.fromEntries(CRITERIA.map((criterion) => [criterion.rank, 'unknown']));
  const has = (type) => nearbyNames(project, type).length > 0;
  const hasOfficialFuture = (rank) => officialFutureFacilities(project, leads, rank).length > 0;
  const currentPoiType = { 2: 'transit', 4: 'grocery', 7: 'park', 11: 'mall', 12: 'hospital' };
  return Object.fromEntries(CRITERIA.map((criterion) => {
    if (hasOfficialFuture(criterion.rank)) return [criterion.rank, 'yes'];
    if (currentPoiType[criterion.rank]) return [criterion.rank, has(currentPoiType[criterion.rank]) ? 'yes' : 'no'];
    return [criterion.rank, 'unknown'];
  }));
}

function automaticDetail(project, rank, leads) {
  const planned = officialFutureFacilities(project, leads, rank);
  if (!hasCoordinates(project)) return '基地尚未定位，系統預填為待查。';
  if (planned.length) return `官方公共建設資料：${planned.map((site) => `${site.code ? `${site.code} ` : ''}${site.name}（約 ${Math.round(site.distanceMeters)}m，規劃／施工中）`).join('、')}；${planned[0].coordinateNote || '以官方公開資料為準，仍須查核最新公告。'}`;
  const type = { 2: 'transit', 4: 'grocery', 7: 'park', 11: 'mall', 12: 'hospital' }[rank];
  if (!type) return '尚無可定位的官方規劃／施工中建設資料，系統預填為待查。';
  const names = nearbyNames(project, type);
  if (!names.length) return 'OpenStreetMap 0–300 公尺快照未找到對應設施，系統暫選不符合；可自行查核後調整。';
  return `系統在 0–300 公尺快照找到：${names.join('、')}。`;
}

function saveScoreAnswers() {
  try { localStorage.setItem(scoreStorageKey, JSON.stringify(scoreAnswers)); }
  catch { $('#appreciationNote').textContent = '瀏覽器無法儲存評估；重新整理後可能需要再次填寫。'; }
}

function renderSafetyConfirmation(project, manual, leads) {
  const safety = $('#appreciationSafety');
  safety.replaceChildren();
  const copy = element('div', 'appreciation-safety-copy');
  copy.append(element('strong', '', '警示：尚未自行確認是否有嫌惡設施與地質安全風險。'), element('p', '', '此項不會自動判定、不列入增值分數，也不影響燈號。請另以官方圖資、基地周邊與現場查核；若要自行記錄，可在下方選擇。'));
  const controls = element('div', 'appreciation-choices safety-choices');
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', '嫌惡設施與地質安全自行確認，不納入分數');
  for (const [value, label] of [['yes', '已確認無重大風險'], ['no', '發現重大風險'], ['unknown', '待查']]) {
    const button = element('button', manual[1] === value ? 'selected' : '', label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(manual[1] === value));
    button.addEventListener('click', () => {
      scoreAnswers[project.name] = { ...manual, 1: value };
      saveScoreAnswers();
      renderAppreciation(project, leads);
    });
    controls.append(button);
  }
  safety.append(copy, controls);
}

function renderAppreciation(project, leads) {
  const automatic = automaticAnswers(project, leads);
  const manual = scoreAnswers[project.name] || {};
  const answers = { ...automatic, ...manual };
  renderSafetyConfirmation(project, manual, leads);
  const list = $('#appreciationCriteria');
  list.replaceChildren();
  for (const criterion of CRITERIA) {
    if (criterion.rank === 1) continue;
    const item = element('div', 'appreciation-item');
    const main = element('div', 'appreciation-item-main');
    main.append(element('span', 'appreciation-rank', String(criterion.rank)), element('strong', '', criterion.title), element('em', 'appreciation-tier', criterion.tier));
    main.append(element('small', '', `${criterion.weight} 分`));
    const detail = element('p', '', `${criterion.reason}｜${automaticDetail(project, criterion.rank, leads)}｜購屋者想法：「${criterion.psychology}」`);
    const controls = element('div', 'appreciation-choices');
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', `${criterion.title}評估`);
    for (const [value, label] of [['yes', '符合'], ['no', '不符合'], ['unknown', '待查']]) {
      const button = element('button', answers[criterion.rank] === value ? 'selected' : '', label);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(answers[criterion.rank] === value));
      button.addEventListener('click', () => {
        scoreAnswers[project.name] = { ...manual, [criterion.rank]: value };
        saveScoreAnswers();
        renderAppreciation(project, leads);
      });
      controls.append(button);
    }
    item.append(main, detail, controls);
    list.append(item);
  }
  const score = scoreAppreciation(answers);
  const display = $('#appreciationScore');
  display.replaceChildren();
  display.classList.remove('blocked');
  display.append(element('span', '', '目前加權分數'));
  display.append(element('strong', '', `${score.score} / 100`));
  display.append(element('small', '', `已查核權重 ${score.assessed}% · 可能範圍 ${score.range[0]}–${score.range[1]} 分`));
  const caution = score.assessed < 70 ? '已查核權重尚低，分數只反映目前已知條件；請搭配可能範圍判讀，不代表完整評估。' : '此分數只反映你標記的條件，未檢驗價格是否已反映利多，也不代表未來房價漲幅。';
  $('#appreciationNote').textContent = `${caution}警示：嫌惡設施與地質安全尚未由系統確認，且刻意排除在本分數之外；請自行查核。系統預填依 ${geoSnapshot.generatedAt || '未提供'} 的 OpenStreetMap 0–300 公尺快照及官方公共建設站位資料；點選任一選項可覆寫。規劃／施工中的站點不等於已通車，仍須以官方出入口圖與現場確認。`;
}

$('#runTrend').addEventListener('click', () => {
  const project = projects.find((item) => item.name === $('#trendProject').value);
  if (!project) { $('#trendStatus').textContent = '請先選擇建案。'; return; }
  const result = analyzeTrend(project, transactions, trendEvidence);
  $('#trendResult').hidden = false;
  $('#trendStatus').textContent = `資料快照：${snapshot.generatedAt}；建設線索請點開官方來源查核最新狀態。`;
  const ai = aiSummaries[project.name];
  $('#trendSummary').replaceChildren();
  $('#trendSummary').append(element('span', 'step-index', ai ? 'LLM 整理摘要' : '資料摘要'));
  $('#trendSummary').append(element('h3', '', project.name));
  $('#trendSummary').append(element('p', '', ai?.summary || (result.change === null ? '近三年足量的年度成交樣本不足，尚無法比較年度價格變化。' : `足量樣本的最早與最近年度成交單價中位數相差 ${result.change >= 0 ? '+' : ''}${number(result.change, 1)}%。這是歷史成交變化，不代表未來漲跌。`)));
  const prices = $('#trendPrices');
  prices.replaceChildren();
  if (!result.years.length) prices.append(element('p', '', '近三年沒有可用成交。'));
  for (const item of result.years) prices.append(element('p', 'trend-fact', `${item.year} 年：中位數 ${number(item.median, 1)} 萬／坪 · ${item.count} 筆${item.count < 5 ? '（樣本偏少）' : ''}`));
  const infrastructure = $('#trendInfrastructure');
  infrastructure.replaceChildren();
  if (!result.leads.length) infrastructure.append(element('p', '', '目前沒有可依路名對應的官方建設線索；不代表附近沒有建設。'));
  for (const lead of result.leads) {
    const item = element('div', 'trend-lead');
    item.append(element('strong', '', lead.title), element('small', '', `${lead.status} · ${lead.note}`));
    const link = element('a', '', `查核${lead.source}資料 ↗`);
    link.href = lead.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    item.append(link);
    infrastructure.append(item);
  }
  $('#trendCaution').textContent = ai?.caution || '同路名只代表可能值得查核，不代表基地靠近車站。完工與通車時程可能變動，利多也可能早已反映在開價中；利率、供給、人口與個案條件同樣影響價格。請以官方公告和現場步行確認，不以此推估報酬率。';
  renderAppreciation(project, result.leads);
});

try {
  const response = await fetch(new URL('./data/zhonghe-presale.json', import.meta.url));
  if (!response.ok) throw new Error('資料檔無法讀取');
  snapshot = await response.json();
  transactions = snapshot.transactions;
  try {
    const geoResponse = await fetch(new URL('./data/zhonghe-geo.json', import.meta.url));
    if (geoResponse.ok) geoSnapshot = await geoResponse.json();
  } catch { geoSnapshot = {}; }
  projects = addLocation(getProjects(transactions), geoSnapshot);
  adjustments = estimateAdjustments(transactions, snapshot.generatedAt);
  districtSeries.presale = quarterlyTrend(transactions, snapshot.latestTransaction);
  try {
    const saved = JSON.parse(localStorage.getItem(offerStorageKey) || '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) savedOffers = saved;
  } catch { savedOffers = {}; }
  try {
    const saved = JSON.parse(localStorage.getItem(affordStorageKey) || 'null');
    if (saved && typeof saved === 'object') affordInput = { ...defaultAfford(), ...saved };
  } catch { affordInput = defaultAfford(); }
  hydrateAfford();
  for (const project of projects) projectSignals.set(project.name, summarizeProject({ name: project.name, transactions })?.signal || 'neutral');
  renderWatchPicker();
  const trendOptions = [element('option', '', '請選擇建案')];
  trendOptions[0].value = '';
  for (const project of [...projects].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))) { const option = element('option', '', project.name); option.value = project.name; trendOptions.push(option); }
  $('#trendProject').replaceChildren(...trendOptions);
  $('#noteProjectOptions').replaceChildren(...projects.map((project) => {
    const option = document.createElement('option');
    option.value = project.name;
    return option;
  }));
  try {
    const saved = JSON.parse(localStorage.getItem(scoreStorageKey) || '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const [name, answers] of Object.entries(saved)) {
        if (!projects.some((project) => project.name === name) || !answers || typeof answers !== 'object') continue;
        scoreAnswers[name] = Object.fromEntries(Object.entries(answers).filter(([rank, value]) => CRITERIA.some((item) => String(item.rank) === rank) && ['yes', 'no', 'unknown'].includes(value)));
      }
    }
  } catch { scoreAnswers = {}; }
  try {
    const response = await fetch(new URL('./data/trend-evidence.json', import.meta.url), { cache: 'no-store' });
    if (response.ok) trendEvidence = (await response.json()).items || [];
  } catch { /* Trends still work without infrastructure leads. */ }
  try {
    const response = await fetch(new URL('./data/trend-ai.json', import.meta.url));
    if (response.ok) aiSummaries = (await response.json()).projects || {};
  } catch { /* AI summaries are optional and generated offline. */ }
  try {
    const saved = JSON.parse(localStorage.getItem(watchStorageKey) || '[]');
    const renamed = { '?捷橙品': '双捷橙品', '偉鉅中山?匯': '偉鉅中山双匯', '寶亞南山公?': '寶亞南山公館' };
    if (Array.isArray(saved)) watchNames = [...new Set(saved.map((name) => renamed[name] || name).filter((name) => typeof name === 'string' && projects.some((project) => project.name === name)))];
  } catch { watchNames = []; }
  try {
    const saved = JSON.parse(localStorage.getItem(notesStorageKey) || '[]');
    if (Array.isArray(saved)) {
      viewingNotes = saved.filter((note) => note && typeof note.project === 'string' && note.project.trim()).slice(0, 100);
    }
  } catch { viewingNotes = []; }
  $('#noteDate').value = new Date().toISOString().slice(0, 10);
  renderWatchlist();
  renderViewingNotes();
  $('#dataStatus').textContent = `收錄 ${projects.length} 個建案、${transactions.length} 筆符合條件的成交 · 最新成交 ${snapshot.latestTransaction}`;
  $('#sourceFreshness').textContent = `內政部實價登錄 · 預售屋快照 ${snapshot.generatedAt} · 最新成交 ${snapshot.latestTransaction}`;
  try {
    const resaleResponse = await fetch(new URL('./data/zhonghe-resale.json', import.meta.url));
    if (!resaleResponse.ok) throw new Error('中古屋資料無法讀取');
    resaleSnapshot = await resaleResponse.json();
    resaleRows = resaleSnapshot.transactions;
    resaleAdjustments = estimateResaleAdjustments(resaleRows, resaleSnapshot.generatedAt);
    districtSeries.elevator = quarterlyTrend(resaleRows.filter((row) => row.type !== '公寓'), resaleSnapshot.latestTransaction);
    districtSeries.walkup = quarterlyTrend(resaleRows.filter((row) => row.type === '公寓'), resaleSnapshot.latestTransaction);
    $('#streetOptions').replaceChildren(...listStreets(resaleRows).map(({ street, count }) => { const option = document.createElement('option'); option.value = street; option.label = `${count} 筆`; return option; }));
    const base = `收錄中和區 ${resaleRows.length} 筆中古屋與成屋住宅成交 · 最新成交 ${resaleSnapshot.latestTransaction}`;
    $('#resaleStatus').dataset.base = base;
    $('#resaleStatus').textContent = base;
    $('#sourceFreshness').textContent += ` · 中古屋最新成交 ${resaleSnapshot.latestTransaction}`;
  } catch (error) {
    $('#resaleStatus').textContent = '中古屋資料載入失敗，請稍後重試。';
    console.error(error);
  }
  renderDistrict();
} catch (error) {
  $('#dataStatus').textContent = '資料載入失敗。請依 README 使用本機網頁伺服器開啟，或稍後重試。';
  $('#watchStatus').textContent = '建案資料載入失敗，列表暫時無法使用。';
  console.error(error);
}
