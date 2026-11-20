// 中和整區行情：每季單價中位數與成交量，並與去年同季比較。只當時機參考，不預測漲跌。
import { median } from './price-engine.mjs';

export const quarterOf = (date) => `${date.slice(0, 4)}Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
const quarterEnd = (quarter) => {
  const year = Number(quarter.slice(0, 4)); const q = Number(quarter.slice(5));
  return new Date(year, q * 3, 0);
};
const shiftQuarter = (quarter, delta) => {
  let year = Number(quarter.slice(0, 4)); let q = Number(quarter.slice(5)) + delta;
  while (q > 4) { q -= 4; year += 1; }
  while (q < 1) { q += 4; year -= 1; }
  return `${year}Q${q}`;
};

// 實價登錄有約 30 天的申報期，加上季報發布的時間差：以「資料中最新成交日」為準，
// 季末之後還不到 45 天的季別視為尚未完整，不拿來比較。
export function quarterlyTrend(rows, dataThrough = new Date(), minCount = 10) {
  const groups = new Map();
  for (const row of rows) {
    if (!(row.unitPrice > 0)) continue;
    const quarter = quarterOf(row.date);
    if (!groups.has(quarter)) groups.set(quarter, []);
    groups.get(quarter).push(row.unitPrice);
  }
  const cutoff = new Date(dataThrough); cutoff.setDate(cutoff.getDate() - 45);
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([quarter, prices]) => ({
    quarter, count: prices.length, median: prices.length >= minCount ? median(prices) : null, complete: quarterEnd(quarter) <= cutoff,
  }));
}

export function marketPulse(series) {
  const complete = series.filter((item) => item.complete && item.median !== null);
  const latest = complete.at(-1);
  if (!latest) return null;
  const lastYear = series.find((item) => item.quarter === shiftQuarter(latest.quarter, -4));
  if (!lastYear || lastYear.median === null) return { latest, lastYear: null, priceChange: null, volumeChange: null, reading: null };
  const priceChange = latest.median / lastYear.median - 1;
  const volumeChange = latest.count / lastYear.count - 1;
  const priceUp = priceChange >= 0.03; const priceDown = priceChange <= -0.03;
  const volumeUp = volumeChange >= 0.1; const volumeDown = volumeChange <= -0.1;
  const price = priceUp ? 'up' : priceDown ? 'down' : 'flat';
  const volume = volumeUp ? 'up' : volumeDown ? 'down' : 'flat';
  const readings = {
    'down-down': { tone: 'buyer', text: '量縮價跌：買方相對有議價空間，可以多看多比。' },
    'down-flat': { tone: 'buyer', text: '量縮價平：買氣降溫，價格還沒鬆動，但議價空間正在變大。' },
    'down-up': { tone: 'mixed', text: '量縮價漲：賣方開價還硬，但追價的人變少，可以耐心等。' },
    'flat-down': { tone: 'buyer', text: '量平價跌：價格開始鬆動，可以多談。' },
    'flat-flat': { tone: 'neutral', text: '量價大致持平：行情穩定，重點回到個案價格是否在目標價以內。' },
    'flat-up': { tone: 'seller', text: '量平價漲：行情偏熱，議價空間有限，更要守住離場價。' },
    'up-down': { tone: 'buyer', text: '量增價跌：有人降價求售，是比價的好時機。' },
    'up-flat': { tone: 'neutral', text: '量增價平：買氣回溫但價格還沒漲，可以把握時間比價。' },
    'up-up': { tone: 'seller', text: '量增價漲：買氣熱，議價空間較小，更要守住離場價。' },
  };
  const reading = readings[`${volume}-${price}`];
  return { latest, lastYear, priceChange, volumeChange, reading };
}
