import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateAdjustments, offerAdvice, parseFloor } from '../offer-engine.mjs';
import { affordability, monthlyPayment } from '../afford-engine.mjs';

const near = (actual, expected, tolerance = 0.01) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≉ ${expected}`);
const floors = ['一層', '五層', '十層', '十五層', '二十層', '二十五層', '三十層'];
const numbers = [1, 5, 10, 15, 20, 25, 30];
// 兩個建案，每高一層 +0.2 萬／坪，A 案底價 70、B 案底價 60；日期分散在近一年。
function makeRows(name, base, count = 35) {
  return Array.from({ length: count }, (_, index) => {
    const floorIndex = index % floors.length;
    const month = String((index % 12) + 1).padStart(2, '0');
    return { id: `${name}-${index}`, name, type: '住宅大樓', homeArea: 30, unitPrice: base + numbers[floorIndex] * 0.2, date: `2026-${month}-15`, floor: floors[floorIndex] };
  });
}
const asOf = new Date('2026-12-31');
const project = { name: 'A', type: '住宅大樓', latitude: 25, longitude: 121.5 };
const neighbour = { name: 'B', type: '住宅大樓', latitude: 25.001, longitude: 121.5 };

test('parses Chinese floor labels', () => {
  assert.deepEqual(['一層', '十層', '十五層', '二十六層', '三十層', '12', '地下一層', '', '全'].map(parseFloor), [1, 10, 15, 26, 30, 12, null, null, null]);
});

test('floor effect is estimated within each project, ignoring the price gap between projects', () => {
  const rows = [...makeRows('A', 70), ...makeRows('B', 60)];
  const result = estimateAdjustments(rows, asOf);
  near(result.floorPerLevel, 0.2, 0.001);
  near(result.monthTrend, 0, 0.001);
});

test('too few rows means no adjustment rather than a noisy one', () => {
  assert.deepEqual(estimateAdjustments(makeRows('A', 70, 10), asOf), { floorPerLevel: 0, monthTrend: 0, sample: 10 });
});

test('comparable sales are moved to your floor so floor alone does not decide the light', () => {
  const rows = makeRows('A', 70);
  const low = offerAdvice({ project, transactions: rows, askingUnit: 71.5, area: 30, floor: 5, asOf });
  const high = offerAdvice({ project, transactions: rows, askingUnit: 71.5, area: 30, floor: 30, asOf });
  near(low.market, 71);
  near(high.market, 76);
  assert.equal(low.signal, 'red');
  assert.equal(high.signal, 'green');
  assert.equal(low.confidence, 'high');
});

test('three prices follow the 35/50/65 percentiles and totals use the area', () => {
  const rows = makeRows('A', 70);
  const result = offerAdvice({ project, transactions: rows, askingUnit: 73, area: 30, floor: 10, parkingPrice: 200, asOf });
  assert.ok(result.target <= result.market && result.market <= result.walkAway);
  near(result.totals.market, result.market * 30 + 200);
  near(result.overMarket, (73 - result.market) * 30);
  near(result.askingTotal, 73 * 30 + 200);
});

test('a project with few sales borrows nearby projects and says confidence is low', () => {
  const rows = [...makeRows('A', 70, 3), ...makeRows('B', 60)];
  const result = offerAdvice({ project, projects: [project, neighbour], transactions: rows, askingUnit: 70, area: 30, floor: 10, asOf });
  assert.equal(result.own, 3);
  assert.equal(result.nearby, 35);
  assert.equal(result.confidence, 'low');
  assert.deepEqual(result.nearbyProjects, ['B']);
});

test('sizes outside ±25% and sales older than three years are excluded', () => {
  const rows = makeRows('A', 70).map((row, index) => (index < 20 ? { ...row, homeArea: 50 } : index < 30 ? { ...row, date: '2022-01-15' } : row));
  const result = offerAdvice({ project, transactions: rows, askingUnit: 70, area: 30, floor: 10, asOf });
  assert.equal(result.own, 5);
  assert.equal(result.confidence, 'low');
});

test('no usable sales gives a neutral signal instead of a guess', () => {
  const result = offerAdvice({ project, transactions: makeRows('A', 70, 4), askingUnit: 70, area: 30, floor: 10, asOf });
  assert.equal(result.signal, 'neutral');
  assert.equal(result.confidence, 'none');
});

test('monthly payment matches the standard amortisation formula', () => {
  near(monthlyPayment(1000, 0.024, 30), 3.8993, 0.001);
  near(monthlyPayment(1200, 0, 10), 10);
});

test('affordable price is capped by cash or by income, whichever is lower', () => {
  const plan = { cash: 600, annualIncome: 150, otherMonthlyDebt: 0, rate: 0.023, years: 30, ltv: 0.8, feesRate: 0.03, burden: 1 / 3 };
  const result = affordability(plan);
  assert.equal(result.limitedBy, 'income');
  near(monthlyPayment(result.maxPrice * 0.8, 0.023, 30), 150 / 12 / 3, 0.001);
  const rich = affordability({ ...plan, annualIncome: 1000 });
  assert.equal(rich.limitedBy, 'cash');
  near(rich.maxPrice, 600 / 0.23);
});

test('checking a price reports payment, burden and cash shortfalls', () => {
  const plan = { cash: 600, annualIncome: 300, otherMonthlyDebt: 0, rate: 0.023, years: 30, ltv: 0.8, feesRate: 0.03, burden: 1 / 3 };
  const ok = affordability(plan, 2000).check;
  near(ok.loan, 1600);
  near(ok.cashNeeded, 2000 * 0.23);
  assert.equal(ok.status, 'ok');
  const short = affordability(plan, 3000).check;
  assert.equal(short.status, 'cash-short');
  near(short.cashShort, 3000 * 0.23 - 600);
  assert.equal(affordability({ ...plan, annualIncome: 150 }, 2400).check.status, 'over');
});
