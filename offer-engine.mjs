// 出價建議：把可比成交修正到「你的樓層、今天」，再用百分位給出目標價、行情價與離場價。
import { median, percentile } from './price-engine.mjs';
import { distanceMeters, hasCoordinates } from './geo-engine.mjs';

export const BANDS = { target: 0.35, market: 0.5, walkAway: 0.65 };
const WINDOW_MONTHS = 36;
const DIGITS = '零一二三四五六七八九';

// 「二十六層」→ 26；無法判讀（地下層、多層、空白）回傳 null。
export function parseFloor(text) {
  const value = String(text || '').trim().replace(/[層樓]$/, '');
  if (/^\d+$/.test(value)) return Number(value) || null;
  if (!/^[一二三四五六七八九十]+$/.test(value)) return null;
  if (!value.includes('十')) return value.length === 1 ? DIGITS.indexOf(value) : null;
  const [tens, ones] = value.split('十');
  if (tens.length > 1 || ones.length > 1) return null;
  return (tens ? DIGITS.indexOf(tens) : 1) * 10 + (ones ? DIGITS.indexOf(ones) : 0);
}

const monthIndex = (date) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const asOfIndex = (asOf) => { const date = new Date(asOf); return date.getFullYear() * 12 + date.getMonth(); };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function recentRows(transactions, asOf) {
  const now = asOfIndex(asOf);
  return transactions.filter((row) => row.unitPrice > 0 && monthIndex(row.date) <= now && now - monthIndex(row.date) < WINDOW_MONTHS);
}

// 以「同建案內」的差異估計樓層與時間效果（固定效果迴歸），避免不同建案的價位差混進來。
export function estimateAdjustments(transactions, asOf = new Date()) {
  const groups = new Map();
  for (const row of recentRows(transactions, asOf)) {
    const floor = parseFloor(row.floor);
    if (floor === null) continue;
    if (!groups.has(row.name)) groups.set(row.name, []);
    groups.get(row.name).push({ floor, month: monthIndex(row.date), price: row.unitPrice });
  }
  let sff = 0; let sft = 0; let stt = 0; let sfy = 0; let sty = 0; let sample = 0;
  for (const rows of groups.values()) {
    if (rows.length < 3) continue;
    const mean = (key) => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
    const [mf, mt, my] = [mean('floor'), mean('month'), mean('price')];
    for (const row of rows) {
      const f = row.floor - mf; const t = row.month - mt; const y = row.price - my;
      sff += f * f; sft += f * t; stt += t * t; sfy += f * y; sty += t * y; sample += 1;
    }
  }
  const det = sff * stt - sft * sft;
  if (sample < 30 || Math.abs(det) < 1e-9) return { floorPerLevel: 0, monthTrend: 0, sample };
  return {
    floorPerLevel: clamp((sfy * stt - sty * sft) / det, 0, 0.6),
    monthTrend: clamp((sty * sff - sfy * sft) / det, -0.5, 0.5),
    sample,
  };
}

function adjustRow(row, { floor, now, adjustments }) {
  const rowFloor = parseFloor(row.floor);
  const floorShift = floor && rowFloor ? adjustments.floorPerLevel * (floor - rowFloor) : 0;
  const monthsAgo = now - monthIndex(row.date);
  const timeShift = adjustments.monthTrend * monthsAgo;
  return { ...row, floorNumber: rowFloor, monthsAgo, adjusted: row.unitPrice + floorShift + timeShift, floorShift, timeShift };
}

export function offerAdvice({ project, projects = [], transactions, askingUnit, area, floor = null, parkingPrice = 0, asOf = new Date(), nearbyMeters = 500, adjustments = estimateAdjustments(transactions, asOf) }) {
  if (!project) throw new Error('請先選擇建案。');
  if (!Number.isFinite(askingUnit) || askingUnit <= 0) throw new Error('請輸入有效的每坪開價。');
  if (!Number.isFinite(area) || area <= 0) throw new Error('請輸入有效的房屋坪數。');
  const now = asOfIndex(asOf);
  const similar = recentRows(transactions, asOf).filter((row) => row.type === project.type && row.homeArea >= area * 0.75 && row.homeArea <= area * 1.25);
  const context = { floor: Number.isFinite(floor) && floor > 0 ? floor : null, now, adjustments };
  const own = similar.filter((row) => row.name === project.name).map((row) => adjustRow(row, context));
  let nearby = [];
  if (own.length < 6 && hasCoordinates(project)) {
    const close = new Map(projects.filter((item) => item.name !== project.name && item.type === project.type)
      .map((item) => [item.name, distanceMeters(project, item)]).filter(([, meters]) => Number.isFinite(meters) && meters <= nearbyMeters));
    nearby = similar.filter((row) => close.has(row.name)).map((row) => ({ ...adjustRow(row, context), distanceMeters: close.get(row.name) }));
  }
  const cases = [...own, ...nearby];
  const values = cases.map((row) => row.adjusted);
  const latestOwn = own.reduce((latest, row) => Math.min(latest, row.monthsAgo), Infinity);
  const confidence = values.length < 5 ? 'none'
    : own.length >= 15 && latestOwn <= 9 ? 'high'
      : own.length >= 6 ? 'medium' : 'low';
  const base = { project: project.name, askingUnit, area, floor: context.floor, adjustments, own: own.length, nearby: nearby.length, nearbyProjects: [...new Set(nearby.map((row) => row.name))], confidence, latestOwnMonthsAgo: Number.isFinite(latestOwn) ? latestOwn : null };
  const askingTotal = askingUnit * area + (parkingPrice || 0);
  if (confidence === 'none') return { ...base, signal: 'neutral', askingTotal, cases: [] };
  const target = percentile(values, BANDS.target);
  const market = median(values);
  const walkAway = percentile(values, BANDS.walkAway);
  const position = values.filter((value) => value < askingUnit).length / values.length;
  const signal = askingUnit <= target ? 'green' : askingUnit <= walkAway ? 'amber' : 'red';
  const shown = [...cases].sort((a, b) => Number(b.name === project.name) - Number(a.name === project.name)
    || Math.abs((a.floorNumber ?? 99) - (context.floor ?? 0)) - Math.abs((b.floorNumber ?? 99) - (context.floor ?? 0))
    || b.date.localeCompare(a.date)).slice(0, 8);
  return {
    ...base, signal, target, market, walkAway, position, askingTotal,
    totals: { target: target * area + (parkingPrice || 0), market: market * area + (parkingPrice || 0), walkAway: walkAway * area + (parkingPrice || 0) },
    overMarket: (askingUnit - market) * area, overTarget: (askingUnit - target) * area,
    range: { min: Math.min(...values), max: Math.max(...values) }, sampleSize: values.length, cases: shown,
  };
}
