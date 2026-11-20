// 中古屋與成屋出價建議：沒有建案名稱，改用「同一棟 → 同一條路 → 全中和」找可比成交，
// 並修正樓層、時間與屋齡，再用與預售屋相同的百分位給三個價格。
import { median, percentile } from './price-engine.mjs';
import { BANDS, parseFloor } from './offer-engine.mjs';

const WINDOW_MONTHS = 36;
const monthIndex = (date) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const asOfIndex = (asOf) => { const date = new Date(asOf); return date.getFullYear() * 12 + date.getMonth(); };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const typeGroup = (type) => (type === '公寓' ? 'walkup' : 'elevator');

// 解 (XᵀX) b = Xᵀy；以高斯消去法處理小型方程組。
function solve(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, index) => [...row, vector[index]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-9) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col] / a[col][col];
      for (let k = col; k <= n; k += 1) a[row][k] -= factor * a[col][k];
    }
  }
  return a.map((row, index) => row[n] / row[index]);
}

// 同一條路內比較（路段固定效果），估計樓層、時間與屋齡對單價的影響。
export function estimateResaleAdjustments(rows, asOf = new Date()) {
  const now = asOfIndex(asOf);
  const result = {};
  for (const group of ['elevator', 'walkup']) {
    const byStreet = new Map();
    for (const row of rows) {
      if (typeGroup(row.type) !== group || !row.street || !row.built) continue;
      const months = now - monthIndex(row.date);
      if (months < 0 || months >= WINDOW_MONTHS) continue;
      const floor = parseFloor(row.floor);
      if (floor === null || floor === 1) continue; // 一樓常有店面溢價，另外比較
      if (!byStreet.has(row.street)) byStreet.set(row.street, []);
      byStreet.get(row.street).push({ x: [floor, monthIndex(row.date), row.built], y: row.unitPrice });
    }
    const xtx = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; const xty = [0, 0, 0]; let sample = 0;
    for (const items of byStreet.values()) {
      if (items.length < 3) continue;
      const mean = [0, 1, 2].map((k) => items.reduce((sum, item) => sum + item.x[k], 0) / items.length);
      const meanY = items.reduce((sum, item) => sum + item.y, 0) / items.length;
      for (const item of items) {
        const d = item.x.map((value, k) => value - mean[k]); const dy = item.y - meanY;
        for (let i = 0; i < 3; i += 1) { xty[i] += d[i] * dy; for (let j = 0; j < 3; j += 1) xtx[i][j] += d[i] * d[j]; }
        sample += 1;
      }
    }
    const beta = sample >= 40 ? solve(xtx, xty) : null;
    result[group] = beta
      ? { floorPerLevel: clamp(beta[0], group === 'walkup' ? -1.5 : 0, 0.6), monthTrend: clamp(beta[1], -0.5, 0.5), perNewerYear: clamp(beta[2], 0, 1.5), sample }
      : { floorPerLevel: 0, monthTrend: 0, perNewerYear: 0, sample };
  }
  return result;
}

// 給選單用：每條路上的「棟」（門牌去樓層）及其完工年、型態與成交筆數。
export function listBuildings(rows, street) {
  const map = new Map();
  for (const row of rows) {
    if (row.street !== street) continue;
    const item = map.get(row.building) || { building: row.building, built: row.built, type: row.type, count: 0, latest: row.date };
    item.count += 1;
    if (row.date > item.latest) item.latest = row.date;
    map.set(row.building, item);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.building.localeCompare(b.building, 'zh-Hant'));
}

export function listStreets(rows) {
  const counts = new Map();
  for (const row of rows) if (row.street) counts.set(row.street, (counts.get(row.street) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([street, count]) => ({ street, count }));
}

export function resaleAdvice({ rows, street, building = '', built, type, floor = null, area, askingUnit, parkingPrice = 0, asOf = new Date(), adjustments = estimateResaleAdjustments(rows, asOf) }) {
  if (!street) throw new Error('請選擇路名。');
  if (!Number.isFinite(built) || built < 1950) throw new Error('請輸入建築完成年份。');
  if (!['住宅大樓', '華廈', '公寓'].includes(type)) throw new Error('請選擇建物型態。');
  if (!Number.isFinite(askingUnit) || askingUnit <= 0) throw new Error('請輸入有效的每坪開價。');
  if (!Number.isFinite(area) || area <= 0) throw new Error('請輸入有效的房屋坪數。');
  const now = asOfIndex(asOf);
  const adj = adjustments[typeGroup(type)];
  const targetFloor = Number.isFinite(floor) && floor > 0 ? floor : null;
  // 一樓與樓上價格結構不同：一樓只跟一樓比，樓上不拿一樓來比。
  const groundOnly = targetFloor === 1;
  const eligible = rows.filter((row) => {
    const months = now - monthIndex(row.date);
    const rowFloor = parseFloor(row.floor);
    if (targetFloor && rowFloor && (rowFloor === 1) !== groundOnly) return false;
    return months >= 0 && months < WINDOW_MONTHS && row.type === type && row.homeArea >= area * 0.75 && row.homeArea <= area * 1.25 && row.unitPrice > 0;
  });
  const sameBuilding = building ? eligible.filter((row) => row.building === building) : [];
  const sameStreet = eligible.filter((row) => row.street === street && row.building !== building && Math.abs(row.built - built) <= 5);
  // 全中和只取屋齡最接近、最近成交的一部分，避免蓋過同路段的成交。
  const district = eligible.filter((row) => row.street !== street && Math.abs(row.built - built) <= 5)
    .sort((a, b) => Math.abs(a.built - built) - Math.abs(b.built - built) || b.date.localeCompare(a.date)).slice(0, 30);
  const tiers = [['building', sameBuilding], ['street', sameStreet], ['district', district]];
  const chosen = [];
  for (const [tier, items] of tiers) {
    if (chosen.length >= 12) break;
    for (const row of items) chosen.push({ ...row, tier });
  }
  const adjusted = chosen.map((row) => {
    const rowFloor = parseFloor(row.floor);
    const floorShift = targetFloor && rowFloor ? adj.floorPerLevel * (targetFloor - rowFloor) : 0;
    const monthsAgo = now - monthIndex(row.date);
    const timeShift = adj.monthTrend * monthsAgo;
    const ageShift = adj.perNewerYear * (built - row.built);
    return { ...row, floorNumber: rowFloor, monthsAgo, floorShift, timeShift, ageShift, adjusted: row.unitPrice + floorShift + timeShift + ageShift };
  });
  const counts = { building: sameBuilding.length, street: adjusted.filter((row) => row.tier === 'street').length, district: adjusted.filter((row) => row.tier === 'district').length };
  const nearCount = counts.building + counts.street;
  const latestBuilding = adjusted.filter((row) => row.tier === 'building').reduce((latest, row) => Math.min(latest, row.monthsAgo), Infinity);
  const confidence = adjusted.length < 5 ? 'none'
    : (counts.building >= 8 && latestBuilding <= 12) || nearCount >= 15 ? 'high'
      : nearCount >= 6 && !counts.district ? 'medium' : 'low';
  const askingTotal = askingUnit * area + (parkingPrice || 0);
  const base = { kind: 'resale', askingUnit, area, floor: targetFloor, built, type, street, building, adjustments: adj, counts, confidence, askingTotal };
  if (confidence === 'none') return { ...base, signal: 'neutral', cases: [] };
  const values = adjusted.map((row) => row.adjusted);
  const target = percentile(values, BANDS.target);
  const market = median(values);
  const walkAway = percentile(values, BANDS.walkAway);
  const signal = askingUnit <= target ? 'green' : askingUnit <= walkAway ? 'amber' : 'red';
  const tierOrder = { building: 0, street: 1, district: 2 };
  const shown = [...adjusted].sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier]
    || Math.abs((a.floorNumber ?? 99) - (targetFloor ?? 0)) - Math.abs((b.floorNumber ?? 99) - (targetFloor ?? 0))
    || b.date.localeCompare(a.date)).slice(0, 8);
  return {
    ...base, signal, target, market, walkAway,
    position: values.filter((value) => value < askingUnit).length / values.length,
    totals: { target: target * area + (parkingPrice || 0), market: market * area + (parkingPrice || 0), walkAway: walkAway * area + (parkingPrice || 0) },
    overMarket: (askingUnit - market) * area, overTarget: (askingUnit - target) * area,
    range: { min: Math.min(...values), max: Math.max(...values) }, sampleSize: values.length, cases: shown,
  };
}
