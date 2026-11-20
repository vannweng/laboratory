// 自由生活計畫：微退休試算引擎（純函式）。
// 所有金額都以「今天的錢」表示：報酬率先扣除通膨成為實質報酬率，生活費、收入與存款都視為隨通膨調整。
// 時間以「從現在起第幾個月」計算；提領發生在每月月初，存款投入在每月月底。

const LIMIT = 1_000_000_000_000;

const number = (value, label, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw Error(`${label}必須介於 ${min} 與 ${max}`);
  return parsed;
};
const whole = (value, label, min, max) => {
  const parsed = number(value, label, min, max);
  if (!Number.isInteger(parsed)) throw Error(`${label}必須是整數`);
  return parsed;
};

export function defaultMicroPlan() {
  return {
    currentAge: 35, monthlyExpense: 40_000, sideIncome: 15_000, currentAssets: 1_500_000, monthlySaving: 20_000,
    annualReturn: 0.05, inflation: 0.02, lifeAge: 90, includePension: true, pensionAge: 65, pensionMonthly: 20_000, lumpSum: 0, mode: 'spend',
  };
}

export function validateMicroPlan(source) {
  const currentAge = whole(source.currentAge, '目前年齡', 18, 80);
  const lifeAge = whole(source.lifeAge, '規劃用到年齡', 50, 110);
  if (lifeAge <= currentAge + 1) throw Error('規劃用到年齡必須比目前年齡至少大 2 歲');
  const plan = {
    currentAge, lifeAge,
    monthlyExpense: number(source.monthlyExpense, '每月生活費', 1, LIMIT),
    sideIncome: number(source.sideIncome ?? 0, '微退休後每月收入', 0, LIMIT),
    currentAssets: number(source.currentAssets, '目前存款與投資', 0, LIMIT),
    monthlySaving: number(source.monthlySaving ?? 0, '每月可存', 0, LIMIT),
    annualReturn: number(source.annualReturn, '預期年報酬率', -0.1, 0.2),
    inflation: number(source.inflation, '通貨膨脹率', 0, 0.1),
    includePension: source.includePension !== false && source.includePension !== 'false',
    pensionAge: whole(source.pensionAge ?? 65, '開始月領年齡', 50, 80),
    pensionMonthly: number(source.pensionMonthly ?? 0, '勞保與勞退月領', 0, LIMIT),
    lumpSum: number(source.lumpSum ?? 0, '一次性大支出', 0, LIMIT),
    mode: source.mode === 'preserve' ? 'preserve' : 'spend',
  };
  if (plan.mode === 'preserve' && realAnnualReturn(plan) <= 0) throw Error('留存本金模式需要預期年報酬率高於通膨率');
  return plan;
}

export const realAnnualReturn = (plan) => (1 + plan.annualReturn) / (1 + plan.inflation) - 1;
const realMonthlyRate = (plan) => (1 + realAnnualReturn(plan)) ** (1 / 12) - 1;
const annuityDue = (rate, months) => {
  if (months <= 0) return 0;
  if (Math.abs(rate) < 1e-12) return months;
  return (1 - (1 + rate) ** -months) / rate * (1 + rate);
};

function months(plan) {
  return { pension: Math.max(0, (plan.pensionAge - plan.currentAge) * 12), end: (plan.lifeAge - plan.currentAge) * 12 };
}

// 過渡期（微退休到開始月領前）與月領後，每月需要自己補的金額。
export function monthlyGaps(plan) {
  const pension = plan.includePension ? plan.pensionMonthly : 0;
  return { bridge: Math.max(0, plan.monthlyExpense - plan.sideIncome), later: Math.max(0, plan.monthlyExpense - pension) };
}

// 在第 startMonth 個月開始微退休時，需要準備的資產（今天的錢），拆成過渡期、月領後與一次性支出。
export function needBreakdown(plan, startMonth) {
  const rate = realMonthlyRate(plan);
  const { pension, end } = months(plan);
  const gaps = monthlyGaps(plan);
  const bridgeMonths = Math.max(0, Math.min(pension, end) - startMonth);
  const laterStart = Math.max(startMonth, pension);
  const discount = (1 + rate) ** -bridgeMonths;
  const bridge = gaps.bridge * annuityDue(rate, bridgeMonths);
  const later = plan.mode === 'preserve'
    ? (gaps.later ? gaps.later * (1 + rate) / rate * discount : 0)
    : gaps.later * annuityDue(rate, Math.max(0, end - laterStart)) * discount;
  return { bridge, later, lumpSum: plan.lumpSum, total: bridge + later + plan.lumpSum, bridgeMonths, laterMonths: plan.mode === 'preserve' ? null : Math.max(0, end - laterStart) };
}
export const needAt = (plan, startMonth) => needBreakdown(plan, startMonth).total;

// 只靠目前資產與每月存款，到第 month 個月的資產（今天的錢）。
export function assetsAt(plan, month, monthlySaving = plan.monthlySaving) {
  const rate = realMonthlyRate(plan);
  const growth = (1 + rate) ** month;
  const annuity = Math.abs(rate) < 1e-12 ? month : (growth - 1) / rate;
  return plan.currentAssets * growth + monthlySaving * annuity;
}

// 最早可以開始的月份；在規劃用到年齡前都達不到時回傳 null。
export function earliestStart(plan) {
  const { end } = months(plan);
  for (let month = 0; month < end; month += 1) if (assetsAt(plan, month) >= needAt(plan, month)) return month;
  return null;
}

// 想在第 startMonth 個月開始，從現在起每月要存多少（含目前已在存的部分）。
export function savingRequired(plan, startMonth) {
  const shortfall = needAt(plan, startMonth) - assetsAt(plan, startMonth, 0);
  if (shortfall <= 0) return 0;
  if (startMonth <= 0) return null;
  return shortfall / (assetsAt({ ...plan, currentAssets: 0 }, startMonth, 1));
}

// 逐年資產曲線（今天的錢）。
export function simulate(plan, startMonth) {
  const rate = realMonthlyRate(plan);
  const { pension, end } = months(plan);
  const gaps = monthlyGaps(plan);
  let assets = plan.currentAssets;
  const rows = [{ age: plan.currentAge, assets }];
  for (let month = 0; month < end; month += 1) {
    if (startMonth !== null && month >= startMonth) {
      if (month === startMonth) assets -= plan.lumpSum;
      assets -= month < pension ? gaps.bridge : gaps.later;
      assets *= 1 + rate;
    } else {
      assets = assets * (1 + rate) + plan.monthlySaving;
    }
    if ((month + 1) % 12 === 0) rows.push({ age: plan.currentAge + (month + 1) / 12, assets: Math.max(0, assets) });
  }
  return rows;
}

const ageOf = (plan, month) => (month === null ? null : plan.currentAge + month / 12);

export function analyzeMicroPlan(source) {
  const plan = validateMicroPlan(source);
  const { pension, end } = months(plan);
  const start = earliestStart(plan);
  const referenceMonth = start ?? Math.min(Math.max(pension, 12), end - 12);
  const breakdown = needBreakdown(plan, referenceMonth);
  const tryPlan = (changes) => {
    const variant = { ...plan, ...changes };
    if (variant.mode === 'preserve' && realAnnualReturn(variant) <= 0) return { start: null, need: null };
    const month = earliestStart(variant);
    return { start: month, need: month === null ? null : needAt(variant, month) };
  };
  const levers = [
    { key: 'saving', label: '每月多存 5,000 元', ...tryPlan({ monthlySaving: plan.monthlySaving + 5_000 }) },
    { key: 'income', label: '微退休收入多 1 萬元', ...tryPlan({ sideIncome: plan.sideIncome + 10_000 }) },
    { key: 'expense', label: '生活費少 5,000 元', ...tryPlan({ monthlyExpense: Math.max(1, plan.monthlyExpense - 5_000) }) },
  ];
  const scenarios = [{ key: 'low', label: '保守', annualReturn: 0.03 }, { key: 'base', label: '一般', annualReturn: 0.05 }, { key: 'high', label: '樂觀', annualReturn: 0.07 }]
    .map((scenario) => ({ ...scenario, ...tryPlan({ annualReturn: scenario.annualReturn }) }));
  const firstTarget = Math.ceil((plan.currentAge + 1) / 5) * 5;
  const ages = [];
  for (let age = firstTarget; age < Math.min(plan.lifeAge, 71) && ages.length < 6; age += 5) {
    const month = (age - plan.currentAge) * 12;
    ages.push({ age, need: needAt(plan, month), projected: assetsAt(plan, month), saving: savingRequired(plan, month) });
  }
  return {
    plan, realReturn: realAnnualReturn(plan), gaps: monthlyGaps(plan),
    start, startAge: ageOf(plan, start), need: breakdown.total, breakdown, referenceAge: ageOf(plan, referenceMonth),
    nominalNeed: breakdown.total * (1 + plan.inflation) ** (referenceMonth / 12),
    progress: breakdown.total > 0 ? Math.min(1, plan.currentAssets / breakdown.total) : 1,
    levers, scenarios, ages, curve: simulate(plan, start),
  };
}
