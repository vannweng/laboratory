import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateResaleAdjustments, listBuildings, listStreets, resaleAdvice } from '../resale-engine.mjs';
import { marketPulse, quarterlyTrend } from '../district-engine.mjs';

const near = (actual, expected, tolerance = 0.01) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≉ ${expected}`);
const FLOORS = ['二層', '三層', '五層', '八層', '十層', '十二層'];
const NUMBERS = [2, 3, 5, 8, 10, 12];
// 每條路兩棟不同屋齡的大樓；每高一層 +0.2、每新一年 +0.5 萬／坪。
function street(name, base, count = 24) {
  return Array.from({ length: count }, (_, index) => {
    const built = index % 2 ? 2000 : 2010;
    const floor = index % FLOORS.length;
    return {
      id: `${name}-${index}`, street: name, building: `${name}${built === 2000 ? 1 : 2}號`, built, type: '住宅大樓',
      floor: FLOORS[floor], homeArea: 30, date: `2026-${String((index % 9) + 1).padStart(2, '0')}-10`,
      unitPrice: base + NUMBERS[floor] * 0.2 + (built - 2000) * 0.5,
    };
  });
}
const asOf = new Date('2026-11-20');
// 修正幅度需要至少 40 筆才估計，測試用兩條路的資料來估。
const adjustments = estimateResaleAdjustments([...street('中正路', 50), ...street('景平路', 60)], asOf);

test('floor and building age effects are estimated within each street', () => {
  const rows = [...street('中正路', 50), ...street('景平路', 60)];
  const result = estimateResaleAdjustments(rows, asOf).elevator;
  near(result.floorPerLevel, 0.2, 0.001);
  near(result.perNewerYear, 0.5, 0.001);
  near(result.monthTrend, 0, 0.001);
});

test('ground floor sales are excluded from the floor estimate and compared only with ground floors', () => {
  const rows = [...street('中正路', 50), ...street('景平路', 60), { id: 'shop', street: '中正路', building: '中正路1號', built: 2000, type: '住宅大樓', floor: '一層', homeArea: 30, date: '2026-05-01', unitPrice: 120 }];
  near(estimateResaleAdjustments(rows, asOf).elevator.floorPerLevel, 0.2, 0.001);
  const upstairs = resaleAdvice({ rows, street: '中正路', built: 2005, type: '住宅大樓', floor: 6, area: 30, askingUnit: 55, asOf, adjustments });
  assert.ok(upstairs.cases.every((row) => row.floor !== '一層'));
  const ground = resaleAdvice({ rows, street: '中正路', built: 2005, type: '住宅大樓', floor: 1, area: 30, askingUnit: 55, asOf, adjustments });
  assert.equal(ground.signal, 'neutral');
});

test('same-street sales adjusted to your floor and age give consistent prices', () => {
  const rows = street('中正路', 50);
  const result = resaleAdvice({ rows, street: '中正路', built: 2005, type: '住宅大樓', floor: 6, area: 30, askingUnit: 53, asOf, adjustments });
  // 50 + 6×0.2 + 5×0.5 = 53.7，所有修正後的價格都一樣
  near(result.market, 53.7);
  assert.equal(result.signal, 'green');
  assert.equal(result.confidence, 'high');
  assert.equal(result.counts.street, 24);
});

test('a chosen building comes first and other streets fill in only when needed', () => {
  const rows = [...street('中正路', 50, 6), ...street('景平路', 60)];
  const result = resaleAdvice({ rows, street: '中正路', building: '中正路2號', built: 2010, type: '住宅大樓', floor: 8, area: 30, askingUnit: 60, asOf });
  assert.equal(result.counts.building, 3);
  // 同路另一棟屋齡差 10 年，超過 ±5 年不納入；改由其他路段屋齡相近的 12 筆補足
  assert.equal(result.counts.street, 0);
  assert.equal(result.counts.district, 12);
  assert.equal(result.cases[0].tier, 'building');
  assert.equal(result.confidence, 'low');
});

test('different building types and sizes are not mixed', () => {
  const rows = street('中正路', 50).map((row, index) => (index % 3 === 0 ? { ...row, type: '公寓' } : index % 3 === 1 ? { ...row, homeArea: 60 } : row));
  const result = resaleAdvice({ rows, street: '中正路', built: 2005, type: '住宅大樓', floor: 6, area: 30, askingUnit: 53, asOf });
  assert.equal(result.sampleSize, 8);
});

test('streets and buildings are listed by activity for the pickers', () => {
  const rows = [...street('中正路', 50, 10), ...street('景平路', 60, 4)];
  assert.deepEqual(listStreets(rows).map((item) => item.street), ['中正路', '景平路']);
  const buildings = listBuildings(rows, '中正路');
  assert.equal(buildings.length, 2);
  assert.equal(buildings[0].count, 5);
});

test('quarterly trend marks quarters without full registrations as incomplete', () => {
  const rows = [];
  for (const [date, price, count] of [['2025-05-10', 60, 20], ['2026-05-10', 66, 12], ['2026-09-10', 70, 3]]) {
    for (let index = 0; index < count; index += 1) rows.push({ date, unitPrice: price });
  }
  const series = quarterlyTrend(rows, '2026-10-03');
  assert.deepEqual(series.map((item) => [item.quarter, item.count, item.median, item.complete]), [['2025Q2', 20, 60, true], ['2026Q2', 12, 66, true], ['2026Q3', 3, null, false]]);
  const pulse = marketPulse(series);
  assert.equal(pulse.latest.quarter, '2026Q2');
  near(pulse.priceChange, 0.1);
  near(pulse.volumeChange, -0.4);
  assert.equal(pulse.reading.tone, 'mixed');
});

test('market reading covers flat volume with rising prices', () => {
  const rows = [];
  for (const [date, price] of [['2025-05-10', 60], ['2026-05-10', 65]]) for (let index = 0; index < 20; index += 1) rows.push({ date, unitPrice: price });
  assert.equal(marketPulse(quarterlyTrend(rows, '2026-12-31')).reading.tone, 'seller');
});
