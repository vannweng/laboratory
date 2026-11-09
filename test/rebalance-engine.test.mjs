import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PLAN, applyPreset, applyTrade, calculatePlan, rearmRules } from '../assets/rebalance/engine.mjs';

test('default allocation separates Taiwan and US cash pools', () => {
  const plan = calculatePlan(DEFAULT_PLAN);
  assert.equal(plan.total, 1_000_000);
  assert.equal(plan.targets.twStock, 330_000);
  assert.equal(plan.targets.usStock, 330_000);
  assert.equal(plan.targets.twCash, 170_000);
  assert.equal(plan.targets.usCash, 170_000);
  assert.equal(plan.state, 'bull');
  assert.deepEqual(plan.usTargets, { VOO: 165_000, SPMO: 132_000, SCHD: 33_000 });
});

test('the 50% profit rule has priority and sells 30% of current positive-two holding', () => {
  const plan = { ...DEFAULT_PLAN, pos2Value: 247_500, pos2Peak: 247_500 };
  const result = calculatePlan(plan);
  assert.equal(result.action.rule, 'profit-50');
  assert.equal(result.action.legs[0].amount, 74_250);
});

test('the 30% profit rule sells half of unrealized profit', () => {
  const plan = { ...DEFAULT_PLAN, pos2Value: 214_500, pos2Peak: 214_500 };
  const result = calculatePlan(plan);
  assert.equal(result.action.rule, 'profit-30-or-weight');
  assert.equal(result.action.legs[0].amount, 24_750);
});

test('market drawdown rules take priority over ordinary positive-two pullback', () => {
  const plan = { ...DEFAULT_PLAN, pos2Value: 130_000, twIndex: 17_600, twHigh: 22_000 };
  const result = calculatePlan(plan);
  assert.equal(result.action.rule, 'market-20');
  assert.deepEqual(result.action.legs.map(leg => leg.amount), [29_750, 29_750]);
});

test('confirmed Taiwan sell stays in the Taiwan cash pool', () => {
  const plan = { ...DEFAULT_PLAN, pos2Value: 214_500, pos2Peak: 214_500 };
  const action = calculatePlan(plan).action;
  const next = applyTrade(plan, action, '2026-11-05T00:00:00.000Z');
  assert.equal(next.twCash, 194_750);
  assert.equal(next.usCash, 170_000);
  assert.equal(next.pos2Value, 189_750);
  assert.equal(next.history.length, 1);
});

test('equal VOO and SMA200 retains the previous market state and presets conserve capital', () => {
  const equal = calculatePlan({ ...DEFAULT_PLAN, vooClose: 500, vooSma200: 500, lastMarketState: 'bear' });
  assert.equal(equal.state, 'bear');
  const preset = applyPreset(2_000_000);
  assert.equal(preset.tw0050 + preset.pos2Value + preset.twCash + preset.voo + preset.spmo + preset.schd + preset.usCash, 2_000_000);
  assert.deepEqual(rearmRules({ ...DEFAULT_PLAN, activeRules: { 'market-10': true } }).activeRules, {});
});
