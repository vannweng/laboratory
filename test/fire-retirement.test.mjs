import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRetirementPlan, defaultRetirementPlan, validateRetirementPlan } from '../assets/fire/retirement.mjs';

test('default plan matches the agreed retirement example', () => {
  const result = calculateRetirementPlan(defaultRetirementPlan());
  assert.equal(result.timeline.growYears, 30);
  assert.equal(result.timeline.retireYears, 30);
  assert.ok(Math.abs(result.assetsAtRetirement - 12_965_827) < 2);
  assert.ok(Math.abs(result.spend.target - 21_040_000) < 60_000);
  assert.ok(Math.abs(result.preserve.target - 36_200_000) < 100_000);
  assert.ok(result.spend.monthlySavingRequired > 0);
  assert.equal(result.spend.curve.at(-1).assets, 0);
});
test('retirement spending grows after retirement with inflation', () => {
  const plan = { ...defaultRetirementPlan(), currentAge: 40, retirementAge: 41, lifeAge: 43, monthlyExpense: 20_000, currentAssets: 1_000_000 };
  const result = calculateRetirementPlan(plan);
  assert.ok(result.firstMonthlyExpense > 20_000);
  assert.ok(result.spend.curve.at(-1).assets < result.spend.curve.find(row => row.age === 41).assets);
});
test('preserve-principal mode warns when return is not above inflation', () => {
  const result = calculateRetirementPlan({ ...defaultRetirementPlan(), annualReturn: .02, inflation: .02 });
  assert.equal(result.preserve.target, null);
  assert.equal(result.preserve.monthlySavingRequired, null);
  assert.equal(result.preserve.curve.length, 0);
});
test('validates chronological ages and supported assumptions', () => {
  const plan = defaultRetirementPlan();
  assert.throws(() => validateRetirementPlan({ ...plan, retirementAge: 30 }), /退休年齡/);
  assert.throws(() => validateRetirementPlan({ ...plan, lifeAge: 60 }), /規劃用到年齡/);
  assert.throws(() => validateRetirementPlan({ ...plan, inflation: -.01 }), /通貨膨脹率/);
});
