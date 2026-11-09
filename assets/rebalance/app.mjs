import { DEFAULT_PLAN, applyPreset, applyTrade, calculatePlan, rearmRules } from './engine.mjs';

const KEY = 'life-lab-rebalance-v1';
const $ = selector => document.querySelector(selector);
const form = $('#rebalanceForm');
const money = value => new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Math.round(value || 0));
const pct = value => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
const readMoney = value => Number(String(value).replace(/,/g, '').trim() || 0);

function load() {
  try { return { ...DEFAULT_PLAN, ...JSON.parse(localStorage.getItem(KEY) || 'null') }; } catch { return { ...DEFAULT_PLAN }; }
}
let state = load();

function save(message = '已儲存在此瀏覽器') {
  localStorage.setItem(KEY, JSON.stringify(state));
  $('#savedState').textContent = message;
}

function valuesFromForm() {
  const fields = new FormData(form);
  const out = { ...state };
  for (const [key, raw] of fields) out[key] = form.elements[key].matches('[data-money]') ? readMoney(raw) : Number(raw || 0);
  return out;
}

function renderForm() {
  for (const [key, value] of Object.entries(state)) {
    const field = form.elements[key];
    if (!field) continue;
    field.value = field.matches('[data-money]') ? money(value) : value;
  }
}

function actionLegs(legs) {
  return legs.map(leg => `<li><strong class="${leg.action === 'SELL' ? 'sell' : 'buy'}">${leg.action === 'SELL' ? '賣出' : '買進'} ${leg.asset}</strong><span>NT$${money(leg.amount)}</span></li>`).join('');
}

function renderHistory() {
  $('#historyList').innerHTML = state.history?.length ? state.history.map(record => `<li><time>${new Date(record.at).toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' })}</time><span>${record.title}</span><small>${record.legs.map(leg => `${leg.action === 'SELL' ? '賣出' : '買進'} ${leg.asset} NT$${money(leg.amount)}`).join('、')}</small></li>`).join('') : '<li class="empty-history">還沒有確認完成的交易。</li>';
}

function render() {
  state = rearmRules(valuesFromForm());
  let result;
  try { result = calculatePlan(state); } catch (error) { $('#overviewOutput').innerHTML = `<p class="error-box">${error.message}</p>`; $('#actionOutput').replaceChildren(); $('#applyAction').disabled = true; return; }
  state.lastMarketState = result.state;
  const groups = [
    ['台股持倉', result.tw.twStock, result.targets.twStock], ['美股持倉', result.usStock, result.targets.usStock],
    ['台股現金', result.values.twCash, result.targets.twCash], ['美股現金', result.values.usCash, result.targets.usCash],
  ];
  $('#overviewOutput').innerHTML = `<div class="status-grid">${groups.map(([label, amount, target]) => `<div><span>${label}</span><strong>NT$${money(amount)}</strong><small>基準 NT$${money(target)} ・ ${pct((amount / result.total - target / result.total) * 100)}</small></div>`).join('')}</div><div class="signal-row"><span class="signal ${result.state}">${result.state === 'bull' ? 'VOO 高於 SMA200・上漲配置' : 'VOO 低於 SMA200・下跌配置'}</span><span>正2 報酬 ${pct(result.tw.pos2ReturnPercent)}</span><span>正2 台股權重 ${result.tw.pos2WeightPercent.toFixed(1)}%</span><span>大盤回撤 ${pct(result.tw.marketDrawdownPercent)}</span></div>`;
  if (result.action) {
    $('#actionOutput').innerHTML = `<div class="action-card"><p class="action-rule">${result.action.active ? '已執行，等待條件解除後重啟' : '條件已觸發'}</p><h3>${result.action.title}</h3><p>${result.action.detail}</p><ul>${actionLegs(result.action.legs)}</ul></div>`;
  } else {
    $('#actionOutput').innerHTML = '<div class="action-card calm"><h3>目前沒有台股交易建議</h3><p>尚未達到停利、回檔或大盤回撤門檻。每月最後一個交易日更新一次資料即可。</p></div>';
  }
  $('#applyAction').disabled = !result.action || result.action.active;
  const amounts = { VOO: result.values.voo, SPMO: result.values.spmo, SCHD: result.values.schd };
  $('#usOutput').innerHTML = `<div class="us-reference"><p><strong>${result.state === 'bull' ? '上漲配置' : '下跌配置'}</strong>：VOO ${result.usWeights.VOO * 100}%、SPMO ${result.usWeights.SPMO * 100}%、SCHD ${result.usWeights.SCHD * 100}%。</p><ul>${Object.entries(result.usTargets).map(([symbol, target]) => `<li><span>${symbol}</span><span>目前 NT$${money(amounts[symbol])}</span><strong>參考 NT$${money(target)}</strong></li>`).join('')}</ul><p class="rebalance-help">這是美股持倉內部的配置參考，不會動用台股現金，也不會自動交易。</p></div>`;
  renderHistory();
  save('已更新本機預覽');
}

function formatMoneyField(event) {
  const field = event.currentTarget;
  field.value = money(readMoney(field.value));
}

form.addEventListener('input', event => { if (event.target.matches('[data-money]')) event.target.value = event.target.value.replace(/[^0-9]/g, ''); render(); });
form.addEventListener('change', event => { if (event.target.matches('[data-money]')) formatMoneyField(event); render(); });
$('#applyPreset').addEventListener('click', () => { state = applyPreset(readMoney(form.elements.seedCapital.value)); renderForm(); render(); save('已套用 33／33／17／17 初始配置'); });
$('#applyAction').addEventListener('click', () => {
  const result = calculatePlan(state);
  if (!result.action || result.action.active) return;
  state = applyTrade(state, result.action);
  renderForm(); render(); save('已記錄完成交易並更新持倉');
});
$('#clearHistory').addEventListener('click', () => { state.history = []; state.activeRules = {}; render(); save('已清除執行紀錄'); });

renderForm();
render();
