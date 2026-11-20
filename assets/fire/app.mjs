import { analyzeMicroPlan, defaultMicroPlan } from './microretire.mjs?v=20261120-1';

const key = 'life-lab-fire-plan-v2';
const legacyKey = 'life-lab-fire-plan-v1';
const form = document.querySelector('#retirementForm');
const $ = selector => document.querySelector(selector);
const integer = value => new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Math.round(value));
const money = value => `NT$${integer(value)}`;
// 大金額以「萬」顯示，100 萬以上取整數萬，較容易一眼比較。
const wan = value => {
  if (Math.abs(value) < 10_000) return `${integer(value)} 元`;
  const amount = value / 10_000;
  return `${new Intl.NumberFormat('zh-TW', { maximumFractionDigits: Math.abs(amount) >= 100 ? 0 : 1 }).format(amount)} 萬`;
};
const pct = value => `${Number((value * 100).toFixed(2))}%`;
const ungroup = value => String(value).replaceAll(',', '').trim();
const percentInput = value => String(Math.round(Number(value) * 10_000) / 100);
const moneyFields = ['monthlyExpense', 'sideIncome', 'currentAssets', 'monthlySaving', 'pensionMonthly', 'lumpSum'];

function ageText(age) {
  const years = Math.floor(age + 1e-9);
  const months = Math.round((age - years) * 12);
  return months ? `${years} 歲 ${months} 個月` : `${years} 歲`;
}
function durationText(totalMonths) {
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  if (!years) return `${months} 個月`;
  return months ? `${years} 年 ${months} 個月` : `${years} 年`;
}

function storedPlan() {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved && typeof saved === 'object') return { ...defaultMicroPlan(), ...saved };
    const legacy = JSON.parse(localStorage.getItem(legacyKey));
    if (legacy && typeof legacy === 'object') {
      const { currentAge, monthlyExpense, currentAssets, annualReturn, inflation, lifeAge } = legacy;
      return { ...defaultMicroPlan(), ...Object.fromEntries(Object.entries({ currentAge, monthlyExpense, currentAssets, annualReturn, inflation, lifeAge }).filter(([, value]) => value !== undefined)) };
    }
  } catch { /* 使用範例 */ }
  return defaultMicroPlan();
}
function save(plan) {
  try { localStorage.setItem(key, JSON.stringify(plan)); $('#saveStatus').textContent = '已儲存在此瀏覽器'; }
  catch { $('#saveStatus').textContent = '無法儲存，可下載報告留存'; }
}
function hydrate(plan) {
  for (const [name, value] of Object.entries(plan)) {
    if (name === 'includePension') { form.elements.namedItem(name).checked = Boolean(value); continue; }
    if (name === 'mode') { form.querySelectorAll('[name=mode]').forEach(input => { input.checked = input.value === value; }); continue; }
    const input = form.elements.namedItem(name);
    if (input) input.value = name === 'annualReturn' || name === 'inflation' ? percentInput(value) : value;
  }
  form.querySelectorAll('[data-money]').forEach(formatMoney);
  syncPensionFields();
  syncRanges();
}
function planFromForm() {
  const data = Object.fromEntries(new FormData(form));
  const plan = { ...data, includePension: form.elements.namedItem('includePension').checked, annualReturn: Number(data.annualReturn) / 100, inflation: Number(data.inflation) / 100 };
  for (const name of moneyFields) plan[name] = ungroup(data[name] ?? '') || 0;
  return plan;
}
function syncPensionFields() {
  const enabled = form.elements.namedItem('includePension').checked;
  form.querySelectorAll('.pension-fields .parameter input').forEach(input => { input.disabled = !enabled; });
}
function formatMoney(input) {
  const before = input.selectionStart === null ? 0 : ungroup(input.value.slice(0, input.selectionStart)).length;
  const raw = ungroup(input.value);
  if (raw && !/^\d+$/.test(raw)) return;
  input.value = raw ? Number(raw).toLocaleString('en-US') : '';
  if (document.activeElement === input && input.selectionStart !== null) {
    let position = 0, count = 0;
    while (position < input.value.length && count < before) { if (input.value[position] !== ',') count++; position++; }
    input.setSelectionRange(position, position);
  }
  input.setAttribute('aria-valuetext', input.value || '未設定');
  if (raw) input.setAttribute('aria-valuenow', raw); else input.removeAttribute('aria-valuenow');
}
function syncRanges(source) {
  for (const range of form.querySelectorAll('input[type=range]')) {
    const control = form.elements.namedItem(range.dataset.for);
    if (source === range) {
      control.value = range.value;
      if (control.matches('[data-money]')) formatMoney(control);
    } else range.value = ungroup(control.value);
  }
}
function renderRangeTicks() {
  for (const host of form.querySelectorAll('.range-with-ticks')) {
    const range = host.querySelector('input[type=range]');
    const start = Number(host.dataset.tickStart ?? range.min);
    const interval = Number(host.dataset.tickEvery);
    const labelInterval = Number(host.dataset.tickLabelEvery ?? interval);
    const scale = Number(host.dataset.tickScale ?? 1);
    const min = Number(range.min);
    const max = Number(range.max);
    const values = [];

    for (let value = start; value <= max; value += interval) {
      if (value >= min) values.push(value);
    }
    if (values.at(-1) !== max) values.push(max);

    const ticks = document.createElement('span');
    ticks.className = 'range-ticks';
    ticks.setAttribute('aria-hidden', 'true');
    ticks.style.setProperty('--tick-count', values.length);

    values.forEach((value, index) => {
      const showLabel = index === 0 || index === values.length - 1 || (value - start) % labelInterval === 0;
      const tick = document.createElement('span');
      tick.className = `range-tick${showLabel ? '' : ' range-tick--minor'}`;
      tick.innerHTML = `<i></i><b>${showLabel ? value / scale : ''}</b>`;
      ticks.append(tick);
    });
    host.append(ticks);

    const bubble = document.createElement('output');
    bubble.className = 'range-value-bubble';
    bubble.setAttribute('aria-hidden', 'true');
    host.append(bubble);

    const updateBubble = () => {
      const value = Number(range.value);
      const position = (value - min) / (max - min) * 100;
      const shownValue = value / scale;
      const formatted = Number.isInteger(shownValue) ? String(shownValue) : String(Number(shownValue.toFixed(1)));
      bubble.textContent = `${formatted}${host.dataset.tickSuffix ?? ''}`;
      bubble.style.setProperty('--range-value-position', `${position}%`);
    };
    const showBubble = () => { updateBubble(); host.classList.add('is-adjusting'); };
    const hideBubble = () => host.classList.remove('is-adjusting');
    range.addEventListener('pointerdown', showBubble);
    range.addEventListener('input', updateBubble);
    range.addEventListener('pointerup', hideBubble);
    range.addEventListener('pointercancel', hideBubble);
    range.addEventListener('blur', hideBubble);
    range.addEventListener('keydown', showBubble);
    range.addEventListener('keyup', hideBubble);
  }
}

function hero(result) {
  const { plan } = result;
  if (result.start === 0) {
    return `<p class="hero-kicker">好消息</p><h2 class="hero-title">你現在就可以開始微退休</h2><p class="hero-copy">目前資產 ${wan(plan.currentAssets)}，已經超過需要的約 <strong>${wan(result.need)}</strong>（今天的錢）。</p>${progress(1)}`;
  }
  if (result.start === null) {
    return `<p class="hero-kicker">照現在的存法</p><h2 class="hero-title">在 ${plan.lifeAge} 歲前還存不到需要的金額</h2><p class="hero-copy">如果從 ${ageText(result.referenceAge)} 開始，需要約 <strong>${wan(result.need)}</strong>（今天的錢）。試試下方「怎樣可以更早開始」，或調整生活費、微退休收入。</p>${progress(result.progress)}`;
  }
  return `<p class="hero-kicker">你需要約</p><h2 class="hero-title"><span class="hero-number">${wan(result.need)}</span><span class="hero-unit">（今天的錢）</span></h2><p class="hero-lead">就能開始微退休</p><p class="hero-copy">照現在每月存 ${money(plan.monthlySaving)}，約 <strong>${ageText(result.startAge)}</strong>可以開始，還要 ${durationText(result.start)}。</p>${progress(result.progress)}<p class="hero-note">考慮 ${pct(plan.inflation)} 通膨，相當於屆時的 ${wan(result.nominalNeed)}。</p>`;
}
function progress(value) {
  return `<div class="hero-progress"><div class="progress" role="img" aria-label="目前已完成 ${Math.round(value * 100)}%"><i style="width:${Math.max(value * 100, 1)}%"></i></div><span>目前已完成 ${Math.round(value * 100)}%</span></div>`;
}

function breakdown(result) {
  const { plan, gaps, breakdown: parts } = result;
  const startAge = result.referenceAge;
  const pensionLabel = plan.includePension ? `勞保與勞退 ${money(plan.pensionMonthly)}` : '不計勞保與勞退';
  const rows = [];
  if (parts.bridgeMonths > 0) rows.push({ key: 'bridge', title: `過渡期：${ageText(startAge)} – ${plan.pensionAge} 歲`, detail: `每月自己補 ${money(gaps.bridge)}（生活費 ${money(plan.monthlyExpense)} − 微退休收入 ${money(plan.sideIncome)}），共 ${durationText(parts.bridgeMonths)}`, value: parts.bridge });
  const laterStart = Math.max(startAge, plan.pensionAge);
  rows.push({ key: 'later', title: plan.mode === 'preserve' ? `${ageText(laterStart)} 以後（本金不動）` : `月領後：${ageText(laterStart)} – ${plan.lifeAge} 歲`, detail: `每月自己補 ${money(gaps.later)}（生活費 ${money(plan.monthlyExpense)} − ${pensionLabel}）${parts.laterMonths ? `，共 ${durationText(parts.laterMonths)}` : ''}`, value: parts.later });
  if (parts.lumpSum) rows.push({ key: 'lump', title: '一次性大支出', detail: '開始微退休時預留', value: parts.lumpSum });
  const total = parts.total || 1;
  const bar = rows.map(row => `<i class="part-${row.key}" style="width:${row.value / total * 100}%"></i>`).join('');
  return `<div class="stack-bar" aria-hidden="true">${bar}</div><dl class="breakdown-list">${rows.map(row => `<div class="breakdown-row"><dt><i class="part-dot part-${row.key}"></i>${row.title}<small>${row.detail}</small></dt><dd>${wan(row.value)}</dd></div>`).join('')}<div class="breakdown-row breakdown-total"><dt>合計</dt><dd>${wan(parts.total)}</dd></div></dl><p class="block-note">已把錢在提領期間繼續投資算進去：以實質報酬率 ${pct(result.realReturn)}（年報酬 ${pct(plan.annualReturn)}、通膨 ${pct(plan.inflation)}）折算，所以合計會比「每月缺口 × 月數」少。</p>`;
}

function levers(result) {
  return result.levers.map(lever => {
    let headline; let detail;
    if (lever.start === null) { headline = '仍無法達成'; detail = `在 ${result.plan.lifeAge} 歲前還不夠`; }
    else if (result.start === null) { headline = `${ageText(result.plan.currentAge + lever.start / 12)} 可以開始`; detail = `需要約 ${wan(lever.need)}`; }
    else {
      const saved = result.start - lever.start;
      headline = saved > 0 ? `提早 ${durationText(saved)}` : '時間差不多';
      detail = `約 ${ageText(result.plan.currentAge + lever.start / 12)} 開始，需要約 ${wan(lever.need)}`;
      if (lever.key !== 'saving' && result.need - lever.need > 0) detail += `，少準備 ${wan(result.need - lever.need)}`;
    }
    return `<article class="lever-card"><p class="lever-label">${lever.label}</p><p class="lever-headline">${headline}</p><p class="lever-detail">${detail}</p></article>`;
  }).join('');
}

function scenarios(result) {
  return result.scenarios.map(scenario => {
    const current = Math.abs(scenario.annualReturn - result.plan.annualReturn) < 1e-9;
    const body = scenario.start === null
      ? `<p class="scenario-age">${result.plan.lifeAge} 歲前無法達成</p>`
      : `<p class="scenario-age">${scenario.start === 0 ? '現在就可以' : `約 ${ageText(result.plan.currentAge + scenario.start / 12)}`}</p><p class="scenario-need">需要約 ${wan(scenario.need)}</p>`;
    return `<article class="scenario-card${current ? ' is-current' : ''}"><p class="scenario-label">${scenario.label} · 年報酬 ${pct(scenario.annualReturn)}${current ? '<span>你的設定</span>' : ''}</p>${body}</article>`;
  }).join('');
}

function ageTable(result) {
  if (!result.ages.length) return '<p class="block-note">目前年齡已接近規劃上限，沒有可比較的起始年齡。</p>';
  const rows = result.ages.map(row => {
    const ready = row.projected >= row.need;
    const saving = row.saving === null ? '—' : row.saving === 0 ? '不用再存' : money(row.saving);
    return `<tr class="${ready ? 'is-ready' : ''}"><th scope="row">${row.age} 歲</th><td>${wan(row.need)}</td><td>${wan(row.projected)}${ready ? ' <span class="ready-mark">✓ 夠了</span>' : ''}</td><td>${saving}</td></tr>`;
  }).join('');
  return `<table class="age-table"><thead><tr><th scope="col">開始年齡</th><th scope="col">需要準備</th><th scope="col">照現在存法屆時有</th><th scope="col">每月需存</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function chart(result) {
  const { plan, curve } = result;
  const max = Math.max(...curve.map(row => row.assets), result.need, 1);
  const width = 760, height = 280, left = 56, right = 20, top = 20, bottom = 40;
  const x = age => left + (age - plan.currentAge) / (plan.lifeAge - plan.currentAge) * (width - left - right);
  const y = value => height - bottom - value / max * (height - top - bottom);
  const points = curve.map(row => `${x(row.age).toFixed(1)},${y(row.assets).toFixed(1)}`).join(' ');
  const grid = [0.5, 1].map(ratio => `<line class="chart-grid" x1="${left}" x2="${width - right}" y1="${y(max * ratio)}" y2="${y(max * ratio)}"/><text x="${left - 8}" y="${y(max * ratio) + 4}" text-anchor="end">${wan(max * ratio)}</text>`).join('');
  const marks = [];
  if (result.startAge !== null) {
    const startX = x(result.startAge);
    marks.push(`<line class="retirement-line" x1="${startX}" y1="${top}" x2="${startX}" y2="${height - bottom}"/><text x="${startX + 6}" y="${top + 12}" class="retirement-label">微退休</text>`);
  }
  if (plan.includePension && plan.pensionAge > plan.currentAge && plan.pensionAge < plan.lifeAge) {
    const pensionX = x(plan.pensionAge);
    marks.push(`<line class="pension-line" x1="${pensionX}" y1="${top}" x2="${pensionX}" y2="${height - bottom}"/><text x="${pensionX + 6}" y="${top + 28}" class="pension-label">開始月領</text>`);
  }
  const ages = [plan.currentAge, result.startAge !== null ? Math.round(result.startAge) : null, plan.pensionAge, plan.lifeAge]
    .filter((age, index, list) => age !== null && age >= plan.currentAge && age <= plan.lifeAge && list.indexOf(age) === index);
  const labels = ages.map(age => `<text x="${x(age)}" y="${height - 14}" text-anchor="middle">${age} 歲</text>`).join('');
  return `<figure class="growth-figure"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="資產從 ${plan.currentAge} 歲到 ${plan.lifeAge} 歲的變化"><line class="chart-grid" x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}"/>${grid}${marks.join('')}<polyline class="spend-line" points="${points}"/>${labels}</svg><figcaption><span><i class="spend-dot"></i>資產（今天的錢）</span>${result.startAge !== null ? '<span><i class="start-dot"></i>開始微退休</span>' : ''}${plan.includePension ? '<span><i class="pension-dot"></i>開始月領勞保與勞退</span>' : ''}</figcaption></figure>`;
}

function report(result) {
  const { plan, breakdown: parts } = result;
  const rows = ['# 自由生活計畫：微退休試算報告', '', '所有金額以今天的購買力表示。', '', '## 你的條件',
    `- 目前 ${plan.currentAge} 歲，規劃用到 ${plan.lifeAge} 歲`,
    `- 每月生活費 ${money(plan.monthlyExpense)}；微退休後每月收入 ${money(plan.sideIncome)}`,
    `- 目前存款與投資 ${money(plan.currentAssets)}；每月可存 ${money(plan.monthlySaving)}`,
    `- 年報酬 ${pct(plan.annualReturn)}、通膨 ${pct(plan.inflation)}（實質 ${pct(result.realReturn)}）`,
    `- 勞保與勞退：${plan.includePension ? `${plan.pensionAge} 歲起每月 ${money(plan.pensionMonthly)}` : '不計入'}`,
    `- 一次性大支出 ${money(plan.lumpSum)}；規劃方式：${plan.mode === 'preserve' ? '留存本金' : '花本金'}`,
    '', '## 結果'];
  if (result.start === null) rows.push(`- 照現在的存法，在 ${plan.lifeAge} 歲前還存不到需要的金額`, `- 若 ${ageText(result.referenceAge)} 開始，需要約 ${wan(result.need)}`);
  else rows.push(`- 需要約 ${wan(result.need)}（${money(result.need)}）`, `- 約 ${ageText(result.startAge)} 可以開始${result.start ? `，還要 ${durationText(result.start)}` : '（現在就可以）'}`);
  rows.push(`- 過渡期 ${wan(parts.bridge)}、月領後 ${wan(parts.later)}、一次性支出 ${wan(parts.lumpSum)}`, '', '## 怎樣可以更早開始');
  for (const lever of result.levers) rows.push(`- ${lever.label}：${lever.start === null ? '仍無法達成' : `約 ${ageText(plan.currentAge + lever.start / 12)} 開始，需要約 ${wan(lever.need)}`}`);
  rows.push('', '## 報酬率情境');
  for (const scenario of result.scenarios) rows.push(`- ${scenario.label}（${pct(scenario.annualReturn)}）：${scenario.start === null ? '無法達成' : `約 ${ageText(plan.currentAge + scenario.start / 12)}，需要約 ${wan(scenario.need)}`}`);
  rows.push('', '## 想在幾歲開始', '| 開始年齡 | 需要準備 | 照現在存法屆時有 | 每月需存 |', '| --- | --- | --- | --- |');
  for (const row of result.ages) rows.push(`| ${row.age} 歲 | ${wan(row.need)} | ${wan(row.projected)} | ${row.saving === null ? '—' : money(row.saving)} |`);
  rows.push('', '本報告使用固定報酬與通膨假設，僅供規劃參考，不代表投資結果或建議。');
  return rows.join('\n');
}
function download(text) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: '自由生活計畫微退休試算.md' });
  link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function render() {
  try {
    const result = analyzeMicroPlan(planFromForm());
    save(result.plan);
    $('#hero').innerHTML = hero(result);
    $('#miniAnswer').innerHTML = result.start === null
      ? `<span>${result.plan.lifeAge} 歲前還存不到</span><strong>看結果</strong>`
      : `<span>需要約 <b>${wan(result.need)}</b> · ${result.start === 0 ? '現在就可以開始' : `約 <b>${ageText(result.startAge)}</b> 開始`}</span><strong>看結果 ↓</strong>`;
    $('#breakdown').innerHTML = breakdown(result);
    $('#levers').innerHTML = levers(result);
    $('#scenarios').innerHTML = scenarios(result);
    $('#ageTable').innerHTML = ageTable(result);
    $('#chartOutput').innerHTML = chart(result);
    $('#exportReport').onclick = () => download(report(result));
    $('#error').hidden = true;
    document.querySelectorAll('.result-block, .chart-section').forEach(node => { node.hidden = false; });
  } catch (error) {
    $('#error').textContent = error.message; $('#error').hidden = false;
    $('#hero').replaceChildren();
    $('#miniAnswer').innerHTML = '<span>請檢查輸入的數字</span>';
    document.querySelectorAll('.result-block, .chart-section').forEach(node => { node.hidden = true; });
  }
}

renderRangeTicks();
hydrate(storedPlan());
// 窄螢幕時答案在表單下方，底部固定一條精簡答案；答案區出現在畫面上時隱藏。
const miniAnswer = $('#miniAnswer');
const narrow = window.matchMedia('(max-width: 900px)');
let heroVisible = false;
const syncMiniAnswer = () => { miniAnswer.hidden = !narrow.matches || heroVisible; };
new IntersectionObserver(([entry]) => { heroVisible = entry.isIntersecting; syncMiniAnswer(); }).observe($('.retirement-results'));
narrow.addEventListener('change', syncMiniAnswer);
syncMiniAnswer();
form.addEventListener('input', event => {
  if (event.target.matches('[data-money]') && !event.isComposing) formatMoney(event.target);
  if (event.target.matches('#includePension')) syncPensionFields();
  syncRanges(event.target); render();
});
form.addEventListener('change', event => {
  if (!event.target.matches('#annualReturn,#inflation')) return;
  const value = Number(event.target.value);
  if (!Number.isFinite(value)) return;
  event.target.value = String(Math.round(value * 100) / 100);
  syncRanges(event.target); render();
});
$('#resetPlan').addEventListener('click', () => { hydrate(defaultMicroPlan()); render(); });
render();
