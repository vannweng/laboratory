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
const rounded = value => {
  if (!Number.isFinite(value) || Math.abs(value) > LIMIT) throw Error('試算金額超出支援範圍');
  return Math.round(value * 100) / 100;
};
const annualToMonthly = annual => (1 + annual) ** (1 / 12) - 1;

export function defaultRetirementPlan() {
  return { currentAge: 35, retirementAge: 65, lifeAge: 85, monthlyExpense: 40_000, currentAssets: 1_500_000, annualReturn: .05, inflation: .02 };
}

export function validateRetirementPlan(source) {
  const currentAge = whole(source.currentAge, '目前年齡', 18, 100);
  const retirementAge = whole(source.retirementAge, '退休年齡', 19, 105);
  const lifeAge = whole(source.lifeAge, '規劃用到年齡', 20, 120);
  if (retirementAge <= currentAge) throw Error('預計退休年齡必須大於目前年齡');
  if (lifeAge <= retirementAge) throw Error('規劃用到年齡必須大於預計退休年齡');
  return {
    currentAge, retirementAge, lifeAge,
    monthlyExpense: number(source.monthlyExpense, '退休後每月花費', 1, LIMIT),
    currentAssets: number(source.currentAssets, '目前已存退休金', 0, LIMIT),
    annualReturn: number(source.annualReturn, '預期年報酬率', -.5, .5),
    inflation: number(source.inflation, '通貨膨脹率', 0, .2),
  };
}

function futureValue(principal, monthlyRate, months) { return rounded(principal * (1 + monthlyRate) ** months); }
function growingAnnuityPresentValue(firstAnnualPayment, annualReturn, annualInflation, years) {
  if (Math.abs(annualReturn - annualInflation) < 1e-12) return rounded(firstAnnualPayment * years / (1 + annualReturn));
  const ratio = (1 + annualInflation) / (1 + annualReturn);
  return rounded(firstAnnualPayment * (1 - ratio ** years) / (annualReturn - annualInflation));
}
function monthlySavingRequired(target, currentAssetsAtRetirement, monthlyRate, months) {
  const gap = Math.max(0, target - currentAssetsAtRetirement);
  if (!gap) return 0;
  if (Math.abs(monthlyRate) < 1e-12) return rounded(gap / months);
  const factor = ((1 + monthlyRate) ** months - 1) / monthlyRate;
  if (factor <= 0) throw Error('目前報酬假設無法計算每月補足金額');
  return rounded(gap / factor);
}
function buildCurve(plan, retirementTarget, mode, monthlySaving) {
  const growMonths = (plan.retirementAge - plan.currentAge) * 12;
  const monthlyReturn = annualToMonthly(plan.annualReturn);
  let assets = plan.currentAssets;
  const rows = [{ age: plan.currentAge, assets: rounded(assets), phase: '累積期' }];
  for (let month = 1; month <= growMonths; month++) {
    assets *= 1 + monthlyReturn;
    assets += monthlySaving;
    if (month % 12 === 0) rows.push({ age: plan.currentAge + month / 12, assets: rounded(assets), phase: '累積期' });
  }
  rows[rows.length - 1] = { age: plan.retirementAge, assets: rounded(assets), phase: '退休起點' };
  const firstAnnualExpense = plan.monthlyExpense * 12 * (1 + plan.inflation) ** (plan.retirementAge - plan.currentAge);
  for (let year = 1; year <= plan.lifeAge - plan.retirementAge; year++) {
    const withdrawal = firstAnnualExpense * (1 + plan.inflation) ** (year - 1);
    assets = Math.max(0, assets - withdrawal);
    assets *= 1 + plan.annualReturn;
    rows.push({ age: plan.retirementAge + year, assets: rounded(assets), phase: mode === 'spend' ? '提領期' : '留存期' });
  }
  return rows;
}

export function calculateRetirementPlan(source) {
  const plan = validateRetirementPlan(source);
  const growYears = plan.retirementAge - plan.currentAge;
  const retireYears = plan.lifeAge - plan.retirementAge;
  const growMonths = growYears * 12;
  const retireMonths = retireYears * 12;
  const monthlyReturn = annualToMonthly(plan.annualReturn);
  const assetsAtRetirement = futureValue(plan.currentAssets, monthlyReturn, growMonths);
  const firstMonthlyExpense = rounded(plan.monthlyExpense * (1 + plan.inflation) ** growYears);
  const annualExpenseAtRetirement = rounded(firstMonthlyExpense * 12);
  const spendTarget = growingAnnuityPresentValue(annualExpenseAtRetirement, plan.annualReturn, plan.inflation, retireYears);
  const realReturn = plan.annualReturn - plan.inflation;
  const preserveAvailable = realReturn > 0;
  const preserveTarget = preserveAvailable ? rounded(annualExpenseAtRetirement / realReturn) : null;
  const describeMode = target => ({
    target, estimatedAssets: assetsAtRetirement, gap: rounded(Math.max(0, target - assetsAtRetirement)), coverage: target ? assetsAtRetirement / target : null,
    monthlySavingRequired: monthlySavingRequired(target, assetsAtRetirement, monthlyReturn, growMonths),
  });
  const spend = describeMode(spendTarget);
  const preserve = preserveAvailable ? describeMode(preserveTarget) : { target: null, estimatedAssets: assetsAtRetirement, gap: null, coverage: null, monthlySavingRequired: null };
  return {
    plan, timeline: { growYears, retireYears, growMonths, retireMonths }, firstMonthlyExpense, annualExpenseAtRetirement, assetsAtRetirement, realReturn,
    spend: { ...spend, curve: buildCurve(plan, spendTarget, 'spend', spend.monthlySavingRequired) },
    preserve: { ...preserve, curve: preserveAvailable ? buildCurve(plan, preserveTarget, 'preserve', preserve.monthlySavingRequired) : [] },
  };
}
