import { calculateRetirementPlan, defaultRetirementPlan } from './retirement.mjs?v=20261104-2';

const key = 'life-lab-fire-plan-v1';
const form = document.querySelector('#retirementForm');
const $ = selector => document.querySelector(selector);
const money = value => `NT$${new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(value)}`;
const compactMoney = value => `${new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1, notation: 'compact' }).format(value)}元`;
const pct = value => `${(value * 100).toFixed(value * 100 % 1 ? 1 : 0)}%`;
const precisePct = value => `${(value * 100).toFixed(3).replace(/\.?0+$/, '')}%`;
const ungroup = value => String(value).replaceAll(',', '').trim();
const percentInput = value => String(Math.round(Number(value) * 10_000) / 100).replace(/\.?0+$/, '');

function storedPlan() {
  try { const saved = JSON.parse(localStorage.getItem(key)); return saved && typeof saved === 'object' ? { ...defaultRetirementPlan(), ...saved } : defaultRetirementPlan(); }
  catch { return defaultRetirementPlan(); }
}
function save(plan) {
  try { localStorage.setItem(key, JSON.stringify(plan)); $('#saveStatus').textContent = '已儲存在此瀏覽器'; }
  catch { $('#saveStatus').textContent = '無法儲存，可下載報告留存'; }
}
function hydrate(plan) {
  for (const [name, value] of Object.entries(plan)) {
    const input = form.elements.namedItem(name);
    if (input) input.value = name === 'annualReturn' || name === 'inflation' ? percentInput(value) : value;
  }
  form.querySelectorAll('[data-money]').forEach(formatMoney);
  syncRanges();
}
function planFromForm() {
  const data = Object.fromEntries(new FormData(form));
  return { ...data, monthlyExpense: ungroup(data.monthlyExpense), currentAssets: ungroup(data.currentAssets), annualReturn: Number(data.annualReturn) / 100, inflation: Number(data.inflation) / 100 };
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
let metricId = 0;
function metric(label, value, explanation) {
  const detailId = `metric-detail-${++metricId}`;
  return `<div class="metric"><dt>${label}<button class="metric-info" type="button" aria-label="查看${label}的計算說明" aria-controls="${detailId}" aria-expanded="false">!</button></dt><dd>${value}</dd><p class="metric-detail" id="${detailId}" hidden>${explanation}</p></div>`;
}
function assetExplanation(plan, timeline) {
  const monthlyReturn = (1 + plan.annualReturn) ** (1 / 12) - 1;
  return `目前已存退休金 ${money(plan.currentAssets)}，以月報酬率 ${precisePct(monthlyReturn)} 複利 ${timeline.growMonths} 個月。此數字尚未加計「每月底需再投入」的補足金額。`;
}
function card(title, result, tone, plan, timeline) {
  const targetExplanation = tone === 'spend'
    ? `退休首年年支出依通膨調整後，以年報酬率、通膨率與 ${timeline.retireYears} 年退休期間計算遞增年金現值；規劃在用到年齡時花至零。`
    : `退休首年年支出 ÷ 實質報酬率。實質報酬率＝年報酬率 ${pct(plan.annualReturn)} − 通膨率 ${pct(plan.inflation)}＝${pct(plan.annualReturn - plan.inflation)}。`;
  return `<article class="result-card ${tone}"><div class="result-card-top"><div><p class="card-kicker">${title.kicker}</p><h3>${title.name}</h3></div><span class="mode-mark">${title.mark}</span></div><p class="card-copy">${title.copy}</p><dl class="mode-metrics">${metric('退休時目標', money(result.target), targetExplanation)}${metric('預估累積資產', money(result.estimatedAssets), assetExplanation(plan, timeline))}${metric('可支應比例', pct(result.coverage), `預估累積資產 ÷ 退休時目標 × 100%。`)}${metric('資金缺口', money(result.gap), `退休時目標 − 預估累積資產；若結果小於 0，則顯示為 0。`)}</dl><div class="progress" aria-label="可支應 ${pct(result.coverage)}"><i style="width:${Math.min(100, result.coverage * 100)}%"></i></div><p class="saving-prompt">若從現在開始，每月底需再投入 <strong>${money(result.monthlySavingRequired)}</strong></p></article>`;
}
function warning(result) {
  return `<article class="result-card warning"><div class="result-card-top"><div><p class="card-kicker">資產傳承</p><h3>留存本金</h3></div><span class="mode-mark">∞</span></div><p class="card-copy">只使用實質收益，維持本金購買力。</p><div class="warning-copy"><strong>此情境暫時無法試算</strong><p>預期年報酬率 ${pct(result.plan.annualReturn)} 低於或等於通膨率 ${pct(result.plan.inflation)}。以目前設定無法靠收益支應支出並維持本金購買力。</p></div></article>`;
}
function chart(result) {
  const groups = [result.spend.curve, result.preserve.curve].filter(rows => rows.length);
  const max = Math.max(...groups.flat().map(row => row.assets), 1);
  const width = 760, height = 270, left = 48, right = 20, top = 20, bottom = 38;
  const x = age => left + (age - result.plan.currentAge) / (result.plan.lifeAge - result.plan.currentAge) * (width - left - right);
  const y = value => height - bottom - value / max * (height - top - bottom);
  const points = list => list.map(row => `${x(row.age).toFixed(1)},${y(row.assets).toFixed(1)}`).join(' ');
  const labels = [result.plan.currentAge, result.plan.retirementAge, result.plan.lifeAge].map(age => `<text x="${x(age)}" y="${height - 12}" text-anchor="middle">${age} 歲</text>`).join('');
  const retireX = x(result.plan.retirementAge);
  return `<figure class="growth-figure"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="資產從 ${result.plan.currentAge} 歲至 ${result.plan.lifeAge} 歲的試算曲線"><line class="chart-grid" x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}"/><line class="retirement-line" x1="${retireX}" y1="${top}" x2="${retireX}" y2="${height - bottom}"/><text x="${retireX + 7}" y="${top + 12}" class="retirement-label">退休</text><polyline class="spend-line" points="${points(result.spend.curve)}"/>${result.preserve.curve.length ? `<polyline class="preserve-line" points="${points(result.preserve.curve)}"/>` : ''}${labels}</svg><figcaption><span><i class="spend-dot"></i>花本金</span>${result.preserve.curve.length ? '<span><i class="preserve-dot"></i>留存本金</span>' : ''}<span>試算最高 ${compactMoney(max)}</span></figcaption></figure>`;
}
function report(result) {
  const rows = ['# 自由生活計畫試算報告', '', `目前 ${result.plan.currentAge} 歲，預計 ${result.plan.retirementAge} 歲退休，規劃至 ${result.plan.lifeAge} 歲。`, `目前退休資產：${money(result.plan.currentAssets)}；預期年報酬率：${pct(result.plan.annualReturn)}；通膨率：${pct(result.plan.inflation)}。`, '', '## 退休起點', `- 預估資產：${money(result.assetsAtRetirement)}`, `- 退休首年月支出：${money(result.firstMonthlyExpense)}`, '', '## 花本金', `- 退休目標：${money(result.spend.target)}`, `- 資金缺口：${money(result.spend.gap)}`, `- 可支應：${pct(result.spend.coverage)}`, `- 每月底額外投入：${money(result.spend.monthlySavingRequired)}`];
  if (result.preserve.target) rows.push('', '## 留存本金', `- 退休目標：${money(result.preserve.target)}`, `- 資金缺口：${money(result.preserve.gap)}`, `- 可支應：${pct(result.preserve.coverage)}`, `- 每月底額外投入：${money(result.preserve.monthlySavingRequired)}`);
  else rows.push('', '## 留存本金', '- 預期年報酬率低於或等於通膨率，暫無法以收益維持本金購買力。');
  rows.push('', '本報告使用固定報酬與通膨假設，僅供規劃情境使用，不代表投資結果或建議。');
  return rows.join('\n');
}
function download(text) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: '自由生活計畫試算報告.md' });
  link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0);
}
function render() {
  try {
    const result = calculateRetirementPlan(planFromForm());
    save(result.plan);
    $('#summary').innerHTML = `<div class="summary-main"><h2>到 ${result.plan.retirementAge} 歲退休，還需要補足多少？</h2><p>距離退休還有 ${result.timeline.growYears} 年；以現在物價 ${money(result.plan.monthlyExpense)}／月估算，退休首年月支出約為 <strong>${money(result.firstMonthlyExpense)}</strong>。</p></div><dl class="summary-values">${metric('規劃退休年數', `${result.timeline.retireYears} 年`, `規劃用到年齡 ${result.plan.lifeAge} 歲 − 預計退休年齡 ${result.plan.retirementAge} 歲＝${result.timeline.retireYears} 年。`)}${metric('退休前資產', money(result.assetsAtRetirement), assetExplanation(result.plan, result.timeline))}</dl>`;
    $('#resultCards').innerHTML = card({ kicker: '安享晚年', name: '花本金', copy: `本金與收益一起使用，規劃至 ${result.plan.lifeAge} 歲。`, mark: '↘' }, result.spend, 'spend', result.plan, result.timeline) + (result.preserve.target ? card({ kicker: '資產傳承', name: '留存本金', copy: '只使用收益，維持本金購買力。', mark: '∞' }, result.preserve, 'preserve', result.plan, result.timeline) : warning(result));
    $('#chartOutput').innerHTML = chart(result);
    $('#exportReport').onclick = () => download(report(result));
    $('#error').hidden = true;
  } catch (error) {
    $('#error').textContent = error.message; $('#error').hidden = false;
    $('#summary').replaceChildren(); $('#resultCards').replaceChildren(); $('#chartOutput').replaceChildren();
  }
}
renderRangeTicks();
hydrate(storedPlan());
document.addEventListener('click', event => {
  const button = event.target.closest('.metric-info');
  if (!button) return;
  const detail = document.getElementById(button.getAttribute('aria-controls'));
  const isOpen = button.getAttribute('aria-expanded') === 'true';
  button.setAttribute('aria-expanded', String(!isOpen));
  detail.hidden = isOpen;
  detail.closest('.metric').classList.toggle('is-explained', !isOpen);
});
form.addEventListener('input', event => {
  if (event.target.matches('[data-money]') && !event.isComposing) formatMoney(event.target);
  syncRanges(event.target); render();
});
form.addEventListener('change', event => {
  if (!event.target.matches('#annualReturn,#inflation')) return;
  const value = Number(event.target.value);
  if (!Number.isFinite(value)) return;
  event.target.value = String(Math.round(value * 100) / 100);
  syncRanges(event.target); render();
});
$('#resetPlan').addEventListener('click', () => { hydrate(defaultRetirementPlan()); render(); });
render();
