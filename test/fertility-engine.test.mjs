import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, adviceFor, cycleAt, detectBbtShift, fertilityOn, measurementHint, periodStatus, personalLuteal, windowPlan } from '../assets/fertility-engine.mjs';

const make = (overrides = {}) => ({ settings: { cycleLength: 28, periodLength: 5, lastPeriodStart: '2026-11-01' }, periods: [{ start: '2026-11-01', end: '2026-11-05' }], records: {}, ...overrides });
// 6 天低溫 36.40，之後從 day 14 起升到 36.70
const bbtRecords = (start, riseOffset, high = 36.7) => {
  const records = {};
  for (let offset = 0; offset < riseOffset + 4; offset += 1) records[addDays(start, offset)] = { temperature: String(offset >= riseOffset ? high : 36.4), temperatureTime: '06:30' };
  return records;
};

test('calendar estimate puts ovulation 14 days before the next period', () => {
  const cycle = cycleAt(make(), '2026-11-10');
  assert.equal(cycle.nextStart, '2026-11-29');
  assert.equal(cycle.ovulation, '2026-11-15');
  assert.equal(cycle.fertileStart, '2026-11-10');
  assert.equal(cycle.source, 'calendar');
});

test('fertility is highest from two days before ovulation through ovulation day', () => {
  const state = make();
  assert.equal(fertilityOn(state, '2026-11-09').level, 'none');
  assert.equal(fertilityOn(state, '2026-11-10').level, 'high');
  assert.equal(fertilityOn(state, '2026-11-12').level, 'high');
  assert.equal(fertilityOn(state, '2026-11-13').level, 'peak');
  assert.equal(fertilityOn(state, '2026-11-15').level, 'peak');
  assert.equal(fertilityOn(state, '2026-11-16').level, 'none');
});

test('basal temperature shift needs three highs above the previous six, third at least 0.2 higher', () => {
  const records = bbtRecords('2026-11-01', 14);
  const shift = detectBbtShift(records, '2026-11-01', '2026-11-28');
  assert.equal(shift.riseDate, '2026-11-15');
  assert.equal(shift.ovulationDate, '2026-11-14');
  assert.equal(shift.coverline, 36.4);
  assert.equal(detectBbtShift(bbtRecords('2026-11-01', 14, 36.55), '2026-11-01', '2026-11-28'), null);
});

test('disturbed temperatures are ignored and early noise before cycle day 8 is not a shift', () => {
  const records = bbtRecords('2026-11-01', 14);
  records['2026-11-15'].tempDisturbed = true;
  assert.equal(detectBbtShift(records, '2026-11-01', '2026-11-28')?.riseDate, '2026-11-16');
  assert.equal(detectBbtShift(bbtRecords('2026-11-01', 3), '2026-11-01', '2026-11-28'), null);
});

test('a confirmed temperature shift overrides the calendar estimate', () => {
  const state = make({ records: bbtRecords('2026-11-01', 17) });
  const cycle = cycleAt(state, '2026-11-20');
  assert.equal(cycle.source, 'bbt');
  assert.equal(cycle.ovulation, '2026-11-17');
});

test('a positive LH test puts ovulation on the next day', () => {
  const state = make({ records: { '2026-11-12': { ovulationTest: 'positive' } } });
  const cycle = cycleAt(state, '2026-11-12');
  assert.equal(cycle.source, 'lh');
  assert.equal(cycle.ovulation, '2026-11-13');
  assert.equal(fertilityOn(state, '2026-11-12').level, 'peak');
});

test('personal luteal length is learned from completed cycles with a temperature shift', () => {
  const state = make({
    settings: { cycleLength: 28, periodLength: 5, lastPeriodStart: '2026-11-01' },
    periods: [{ start: '2026-10-01', end: '2026-10-05' }, { start: '2026-11-01', end: '2026-11-05' }],
    records: bbtRecords('2026-10-01', 16)
  });
  // 週期 31 天，體溫 day 16 上升 → 排卵日 day 15（10/16）→ 黃體期 16 天
  const luteal = personalLuteal(state);
  assert.equal(luteal.days, 16);
  assert.equal(luteal.samples, 1);
  // 下個週期以平均 31 天推，12/2 往前扣 16 天黃體期 → 11/16
  assert.equal(cycleAt(state, '2026-11-10').ovulation, '2026-11-16');
});

test('advice says wait before the window, high near ovulation, and stop after a confirmed shift', () => {
  const before = adviceFor(make(), '2026-11-05');
  assert.equal(before.tone, 'wait');
  assert.match(before.title, /還有 5 天/);
  assert.equal(adviceFor(make(), '2026-11-11').tone, 'high');
  const peak = adviceFor(make(), '2026-11-14');
  assert.equal(peak.tone, 'peak');
  assert.match(peak.detail, /今天或明天同房/);
  const confirmed = make({ records: bbtRecords('2026-11-01', 14) });
  assert.equal(adviceFor(confirmed, '2026-11-18').tone, 'past');
});

test('advice acknowledges recent intercourse instead of repeating the same prompt', () => {
  const state = make({ records: { '2026-11-13': { intercourse: true } } });
  assert.match(adviceFor(state, '2026-11-14').detail, /昨天已經同房/);
});

test('positive LH today is the best time; two days later the window is over', () => {
  const state = make({ records: { '2026-11-11': { ovulationTest: 'positive' } } });
  assert.equal(adviceFor(state, '2026-11-11').tone, 'peak');
  assert.equal(adviceFor(state, '2026-11-12').tone, 'peak');
  assert.equal(adviceFor(state, '2026-11-14').tone, 'past');
});

test('a late period asks for a pregnancy test or for the new period to be logged', () => {
  const state = make();
  assert.equal(periodStatus(state, '2026-12-03').lateDays, 4);
  const advice = adviceFor(state, '2026-12-03');
  assert.equal(advice.tone, 'late');
  assert.match(advice.title, /晚了 4 天/);
});

test('window plan lists ovulation-5 through ovulation+1 and counts intercourse', () => {
  const state = make({ records: { '2026-11-13': { intercourse: true }, '2026-11-17': { intercourse: true } } });
  const plan = windowPlan(state, '2026-11-12');
  assert.equal(plan.days.length, 7);
  assert.equal(plan.days[0].date, '2026-11-10');
  assert.equal(plan.days[5].level, 'peak');
  assert.equal(plan.days[6].level, 'after');
  assert.equal(plan.intercourseCount, 1);
  assert.equal(windowPlan(state, '2026-11-25').cycle.start, '2026-11-29');
});

test('measurement hint flags inconsistent or late readings', () => {
  const records = {};
  ['06:00', '07:30', '06:10', '08:00'].forEach((time, index) => { records[`2026-11-0${index + 1}`] = { temperature: '36.4', temperatureTime: time }; });
  assert.match(measurementHint(make({ records }), '2026-11-05'), /相差約 120 分鐘/);
  const late = {};
  ['10:30', '11:00', '10:15'].forEach((time, index) => { late[`2026-11-0${index + 1}`] = { temperature: '36.4', temperatureTime: time }; });
  assert.match(measurementHint(make({ records: late }), '2026-11-05'), /10 點後/);
  assert.equal(measurementHint(make(), '2026-11-05'), '');
});
