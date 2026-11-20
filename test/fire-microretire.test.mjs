import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMicroPlan, assetsAt, defaultMicroPlan, earliestStart, monthlyGaps, needAt, needBreakdown, savingRequired, simulate, validateMicroPlan } from '../assets/fire/microretire.mjs';

const near = (actual, expected, tolerance = 1) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≉ ${expected}`);
const flat = (changes = {}) => validateMicroPlan({ ...defaultMicroPlan(), annualReturn: 0, inflation: 0, ...changes });

test('monthly gaps subtract side income before pension and pension afterwards', () => {
  assert.deepEqual(monthlyGaps(validateMicroPlan(defaultMicroPlan())), { bridge: 25_000, later: 20_000 });
  assert.deepEqual(monthlyGaps(validateMicroPlan({ ...defaultMicroPlan(), includePension: false })), { bridge: 25_000, later: 40_000 });
  assert.deepEqual(monthlyGaps(validateMicroPlan({ ...defaultMicroPlan(), sideIncome: 60_000 })), { bridge: 0, later: 20_000 });
});

test('with zero real return the need is simply the sum of monthly gaps', () => {
  const plan = flat();
  // 45 歲開始：過渡期 20 年 × 25,000，月領後 25 年 × 20,000
  const breakdown = needBreakdown(plan, 120);
  assert.equal(breakdown.bridge, 25_000 * 240);
  assert.equal(breakdown.later, 20_000 * 300);
  assert.equal(breakdown.total, 25_000 * 240 + 20_000 * 300);
});

test('starting after the pension age has no bridge phase', () => {
  const plan = flat({ currentAge: 66, lifeAge: 90 });
  const breakdown = needBreakdown(plan, 0);
  assert.equal(breakdown.bridge, 0);
  assert.equal(breakdown.later, 20_000 * 24 * 12);
});

test('one-off spending is added to the need and paid at the start', () => {
  const plan = flat({ lumpSum: 500_000 });
  assert.equal(needAt(plan, 120) - needAt(flat(), 120), 500_000);
});

test('a plan funded with exactly the need runs to zero at the planned age', () => {
  const plan = validateMicroPlan(defaultMicroPlan());
  const start = earliestStart(plan);
  assert.ok(start > 0);
  const curve = simulate({ ...plan, currentAssets: needAt(plan, 0), monthlySaving: 0 }, 0);
  near(curve.at(-1).assets, 0, 5);
  assert.ok(curve.at(-2).assets > 0);
});

test('preserve mode keeps the principal and needs more than spend mode', () => {
  const plan = validateMicroPlan({ ...defaultMicroPlan(), currentAge: 70, mode: 'preserve' });
  const need = needAt(plan, 0);
  const curve = simulate({ ...plan, currentAssets: need, monthlySaving: 0 }, 0);
  near(curve.at(-1).assets, need, 5);
  assert.ok(need > needAt({ ...plan, mode: 'spend' }, 0));
  assert.throws(() => validateMicroPlan({ ...defaultMicroPlan(), mode: 'preserve', annualReturn: 0.02, inflation: 0.02 }), /高於通膨率/);
});

test('earliest start is the first month where projected assets cover the need', () => {
  const plan = validateMicroPlan(defaultMicroPlan());
  const start = earliestStart(plan);
  assert.ok(assetsAt(plan, start) >= needAt(plan, start));
  assert.ok(assetsAt(plan, start - 1) < needAt(plan, start - 1));
});

test('already having enough means you can start now', () => {
  assert.equal(earliestStart(flat({ currentAssets: 100_000_000 })), 0);
});

test('unreachable plans report null instead of a fake age', () => {
  const result = analyzeMicroPlan({ ...defaultMicroPlan(), monthlyExpense: 200_000, sideIncome: 0, monthlySaving: 0, currentAssets: 0 });
  assert.equal(result.start, null);
  assert.equal(result.startAge, null);
  assert.ok(result.need > 0);
});

test('saving required for a target age reaches the need exactly', () => {
  const plan = validateMicroPlan(defaultMicroPlan());
  const saving = savingRequired(plan, 120);
  near(assetsAt(plan, 120, saving), needAt(plan, 120), 2);
  assert.equal(savingRequired(flat({ currentAssets: 100_000_000 }), 120), 0);
});

test('levers move the start earlier and scenarios order by return', () => {
  const result = analyzeMicroPlan(defaultMicroPlan());
  for (const lever of result.levers) assert.ok(lever.start < result.start, lever.key);
  const [low, base, high] = result.scenarios;
  assert.ok(low.start > base.start && base.start > high.start);
  assert.equal(base.start, result.start);
});

test('age table rounds to the next multiple of five and shows projected assets', () => {
  const result = analyzeMicroPlan(defaultMicroPlan());
  assert.deepEqual(result.ages.map((row) => row.age), [40, 45, 50, 55, 60, 65]);
  const row = result.ages[1];
  near(row.projected, assetsAt(result.plan, 120));
});

test('validation rejects impossible ages', () => {
  assert.throws(() => validateMicroPlan({ ...defaultMicroPlan(), currentAge: 60, lifeAge: 61 }), /至少大 2 歲/);
  assert.throws(() => validateMicroPlan({ ...defaultMicroPlan(), currentAge: 35.5 }), /整數/);
});
