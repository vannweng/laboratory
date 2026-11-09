const round = value => Math.round(Number(value || 0));
const percent = value => Number.isFinite(value) ? value * 100 : null;
const atOrBelow = (value, threshold) => value <= threshold + 1e-9;
const atOrAbove = (value, threshold) => value >= threshold - 1e-9;

export const DEFAULT_PLAN = Object.freeze({
  seedCapital: 1_000_000,
  tw0050: 165_000,
  pos2Cost: 165_000,
  pos2Value: 165_000,
  pos2Peak: 165_000,
  twCash: 170_000,
  twIndex: 22_000,
  twHigh: 22_000,
  voo: 165_000,
  spmo: 132_000,
  schd: 33_000,
  usCash: 170_000,
  vooClose: 500,
  vooSma200: 480,
  lastMarketState: 'bull',
  activeRules: {},
  history: [],
});

export const TARGETS = Object.freeze({ twStock: .33, usStock: .33, twCash: .17, usCash: .17 });

function nonNegative(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw Error(`${label}必須是非負數`);
  return number;
}

function input(plan) {
  const out = {};
  for (const key of ['seedCapital', 'tw0050', 'pos2Cost', 'pos2Value', 'pos2Peak', 'twCash', 'twIndex', 'twHigh', 'voo', 'spmo', 'schd', 'usCash', 'vooClose', 'vooSma200']) out[key] = nonNegative(plan[key], key);
  if (!out.pos2Cost) throw Error('正2 成本必須大於 0');
  if (!out.pos2Peak) throw Error('正2 近期高點市值必須大於 0');
  if (!out.twHigh) throw Error('大盤高點必須大於 0');
  if (!out.vooSma200) throw Error('VOO SMA200 必須大於 0');
  out.lastMarketState = plan.lastMarketState === 'bear' ? 'bear' : 'bull';
  out.activeRules = plan.activeRules || {};
  return out;
}

function marketState(vooClose, sma200, previous) {
  if (vooClose > sma200) return 'bull';
  if (vooClose < sma200) return 'bear';
  return previous;
}

function trade(rule, title, detail, legs) {
  return { rule, title, detail, legs: legs.filter(leg => leg.amount > 0).map(leg => ({ ...leg, amount: round(leg.amount) })) };
}

function taiwanAction(values) {
  const { tw0050, pos2Cost, pos2Value, pos2Peak, twCash, twIndex, twHigh } = values;
  const twStock = tw0050 + pos2Value;
  const pos2Return = pos2Value / pos2Cost - 1;
  const pos2Weight = twStock ? pos2Value / twStock : 0;
  const pos2Drawdown = pos2Value / pos2Peak - 1;
  const marketDrawdown = twIndex / twHigh - 1;

  let candidate = null;
  if (atOrBelow(marketDrawdown, -.30)) {
    candidate = trade('market-30', '大盤回撤達 30%：使用全部台股現金', '極端行情優先，當次不疊加正2的一般回檔規則。', [{ asset: '正2', action: 'BUY', amount: twCash }]);
  } else if (atOrBelow(marketDrawdown, -.20)) {
    const amount = twCash * .35;
    candidate = trade('market-20', '大盤回撤達 20%：使用台股現金 35%', '金額平均買進 0050 與正2。', [{ asset: '0050', action: 'BUY', amount: amount / 2 }, { asset: '正2', action: 'BUY', amount: amount / 2 }]);
  } else if (atOrBelow(marketDrawdown, -.10)) {
    candidate = trade('market-10', '大盤回撤達 10%：使用台股現金 25%', '一般修正以 0050 作為分批加碼標的。', [{ asset: '0050', action: 'BUY', amount: twCash * .25 }]);
  } else if (atOrAbove(pos2Return, .50)) {
    candidate = trade('profit-50', '正2 獲利達 50%：賣出持倉 30%', '強勢停利優先於其他正2停利規則，款項留在台股現金。', [{ asset: '正2', action: 'SELL', amount: pos2Value * .30 }]);
  } else {
    const profitHalf = atOrAbove(pos2Return, .30) ? (pos2Value - pos2Cost) * .50 : 0;
    const weightHalf = pos2Weight > .65 + 1e-9 ? (pos2Value - twStock * .50) * .50 : 0;
    if (profitHalf || weightHalf) {
      const amount = Math.max(profitHalf, weightHalf);
      const why = profitHalf >= weightHalf ? '帳面獲利的一半轉為台股現金。' : '正2 超出 50% 目標權重的部分減半。';
      candidate = trade('profit-30-or-weight', '正2 需滾動停利', why, [{ asset: '正2', action: 'SELL', amount }]);
    } else if (atOrBelow(pos2Drawdown, -.15)) {
      candidate = trade('pos2-pullback-15', '正2 自近期高點回撤 15%：使用台股現金 20%', '一般回檔規則只在大盤極端行情未觸發時使用。', [{ asset: '正2', action: 'BUY', amount: twCash * .20 }]);
    }
  }
  return { candidate, twStock, pos2Return, pos2Weight, pos2Drawdown, marketDrawdown };
}

export function calculatePlan(plan) {
  const values = input(plan);
  const tw = taiwanAction(values);
  const state = marketState(values.vooClose, values.vooSma200, values.lastMarketState);
  const total = values.tw0050 + values.pos2Value + values.twCash + values.voo + values.spmo + values.schd + values.usCash;
  const usStock = values.voo + values.spmo + values.schd;
  const targets = {
    twStock: round(total * TARGETS.twStock), usStock: round(total * TARGETS.usStock),
    twCash: round(total * TARGETS.twCash), usCash: round(total * TARGETS.usCash),
  };
  const usWeights = state === 'bull' ? { VOO: .5, SPMO: .4, SCHD: .1 } : { VOO: .4, SPMO: .4, SCHD: .2 };
  const usTargets = Object.fromEntries(Object.entries(usWeights).map(([symbol, weight]) => [symbol, round(usStock * weight)]));
  const active = Boolean(tw.candidate && values.activeRules[tw.candidate.rule]);
  return {
    values, total: round(total), targets, state, usStock: round(usStock), usTargets, usWeights,
    tw: { ...tw, pos2ReturnPercent: percent(tw.pos2Return), pos2WeightPercent: percent(tw.pos2Weight), pos2DrawdownPercent: percent(tw.pos2Drawdown), marketDrawdownPercent: percent(tw.marketDrawdown) },
    action: tw.candidate ? { ...tw.candidate, active } : null,
  };
}

export function applyTrade(plan, action, executedAt = new Date().toISOString()) {
  if (!action?.legs?.length) throw Error('沒有可確認的交易');
  const next = structuredClone(plan);
  for (const leg of action.legs) {
    if (leg.action === 'SELL' && leg.asset === '正2') {
      if (leg.amount > next.pos2Value) throw Error('正2 市值不足以完成此交易');
      const costSold = next.pos2Cost * leg.amount / next.pos2Value;
      next.pos2Value = round(next.pos2Value - leg.amount);
      next.pos2Cost = round(Math.max(0, next.pos2Cost - costSold));
      next.twCash = round(next.twCash + leg.amount);
    }
    if (leg.action === 'BUY') {
      if (leg.amount > next.twCash) throw Error('台股現金不足以完成此交易');
      next.twCash = round(next.twCash - leg.amount);
      if (leg.asset === '0050') next.tw0050 = round(next.tw0050 + leg.amount);
      if (leg.asset === '正2') { next.pos2Value = round(next.pos2Value + leg.amount); next.pos2Cost = round(next.pos2Cost + leg.amount); }
    }
  }
  next.activeRules = { ...(next.activeRules || {}), [action.rule]: true };
  next.history = [{ at: executedAt, rule: action.rule, title: action.title, legs: action.legs }, ...(next.history || [])].slice(0, 30);
  return next;
}

export function rearmRules(plan) {
  const result = calculatePlan(plan);
  const current = result.action?.rule;
  const activeRules = { ...(plan.activeRules || {}) };
  for (const rule of Object.keys(activeRules)) if (rule !== current) delete activeRules[rule];
  return { ...plan, activeRules };
}

export function applyPreset(capital) {
  const total = nonNegative(capital, '總投入資金');
  const twStock = total * TARGETS.twStock;
  const usStock = total * TARGETS.usStock;
  return { ...DEFAULT_PLAN, seedCapital: round(total), tw0050: round(twStock / 2), pos2Cost: round(twStock / 2), pos2Value: round(twStock / 2), pos2Peak: round(twStock / 2), twCash: round(total * TARGETS.twCash), voo: round(usStock * .5), spmo: round(usStock * .4), schd: round(usStock * .1), usCash: round(total * TARGETS.usCash), history: [], activeRules: {} };
}
