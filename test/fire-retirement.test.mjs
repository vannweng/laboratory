import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRetirementPlan, defaultRetirementPlan, validateRetirementPlan } from '../assets/fire/retirement.mjs';

test('default plan uses the agreed FIRE starting assumptions', () => {
  const result = calculateRetirementPlan(defaultRetirementPlan());
  assert.equal(result.plan.currentAge, 35);
  assert.equal(result.plan.retirementAge, 65);
  assert.equal(result.plan.lifeAge, 85);
  assert.equal(result.plan.monthlyExpense, 40_000);
  assert.equal(result.plan.currentAssets, 1_500_000);
  assert.equal(result.timeline.growYears, 30);
  assert.equal(result.timeline.retireYears, 20);
  assert.ok(Math.abs(result.assetsAtRetirement - 6_482_914) < 2);
  assert.ok(Math.abs(result.spend.target - 12_750_885) < 2);
  assert.ok(Math.abs(result.preserve.target - 28_981_784) < 2);
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
