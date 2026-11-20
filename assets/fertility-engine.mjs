// 好運小日子：受孕時機推估引擎（純函式，無 DOM、無儲存）。
// state = { settings: { cycleLength, periodLength, lastPeriodStart }, periods: [{start,end}], records: { 'YYYY-MM-DD': {...} } }

const DAY_MS = 86400000;
export const DEFAULT_LUTEAL = 14;

export const parseISO = (value) => new Date(`${value}T12:00:00`);
export const toISO = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const addDays = (value, days) => { const date = parseISO(value); date.setDate(date.getDate() + days); return toISO(date); };
export const dayDiff = (from, to) => Math.round((parseISO(to) - parseISO(from)) / DAY_MS);
export const shortDate = (value) => { const date = parseISO(value); return `${date.getMonth() + 1}月${date.getDate()}日`; };

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

export function periodStarts(state) {
  const starts = (state.periods || []).map((period) => period.start);
  if (!starts.length && state.settings?.lastPeriodStart) starts.push(state.settings.lastPeriodStart);
  return [...new Set(starts)].sort();
}

export function averageCycleLength(state) {
  const starts = periodStarts(state);
  const gaps = starts.slice(1).map((start, index) => dayDiff(starts[index], start)).filter((gap) => gap >= 21 && gap <= 45).slice(-6);
  if (gaps.length) return Math.round(mean(gaps));
  return Number(state.settings?.cycleLength) || 28;
}

// 基礎體溫「三高於六低」：連續 3 天高於前 6 天最高溫，且第 3 天至少高 0.2°C。
// 排卵日推定為體溫首日上升的前一天。受干擾（熬夜、飲酒、生病）的體溫不列入。
export function detectBbtShift(records, from, to) {
  const days = Object.keys(records)
    .filter((date) => date >= from && date <= to)
    .sort()
    .map((date) => ({ date, t: Math.round(Number(records[date].temperature) * 100), bad: Boolean(records[date].tempDisturbed) }))
    .filter((day) => Number.isFinite(day.t) && day.t > 0 && !day.bad);
  for (let index = 6; index <= days.length - 3; index += 1) {
    const cover = Math.max(...days.slice(index - 6, index).map((day) => day.t));
    const [a, b, c] = [days[index], days[index + 1], days[index + 2]];
    if (a.t > cover && b.t > cover && c.t >= cover + 20 && dayDiff(a.date, c.date) <= 4 && dayDiff(from, a.date) >= 7) {
      return { riseDate: a.date, ovulationDate: addDays(a.date, -1), coverline: cover / 100, confirmedThrough: c.date };
    }
  }
  return null;
}

export function firstLhPositive(records, from, to) {
  return Object.keys(records).filter((date) => date >= from && date <= to && records[date].ovulationTest === 'positive').sort()[0] || null;
}

// 個人黃體期：已完成週期中，由體溫確認的排卵日到下次月經首日的天數。
export function personalLuteal(state) {
  const starts = periodStarts(state);
  const samples = [];
  for (let index = 0; index < starts.length - 1; index += 1) {
    const shift = detectBbtShift(state.records || {}, starts[index], addDays(starts[index + 1], -1));
    if (!shift) continue;
    const luteal = dayDiff(shift.ovulationDate, starts[index + 1]);
    if (luteal >= 10 && luteal <= 18) samples.push(luteal);
  }
  return { days: samples.length ? Math.round(mean(samples.slice(-6))) : DEFAULT_LUTEAL, samples: samples.length };
}

// 日期所在週期。已記錄的週期使用實際長度，最後一次月經之後以平均週期往後推。
// 排卵日優先採用：體溫確認 > 試紙陽性（+1 天）> 週期推估（下次月經往前扣黃體期）。
export function cycleAt(state, date) {
  const starts = periodStarts(state);
  if (!starts.length) return null;
  const average = averageCycleLength(state);
  const luteal = personalLuteal(state);
  let start; let nextStart; let completed = false;
  const index = starts.filter((value) => value <= date).length - 1;
  if (index >= 0 && index < starts.length - 1) {
    start = starts[index]; nextStart = starts[index + 1]; completed = true;
  } else {
    const base = index >= 0 ? starts[starts.length - 1] : starts[0];
    const cycles = Math.floor(dayDiff(base, date) / average);
    start = addDays(base, cycles * average); nextStart = addDays(start, average);
  }
  const length = dayDiff(start, nextStart);
  const bbt = detectBbtShift(state.records || {}, start, addDays(nextStart, -1));
  const lhDate = firstLhPositive(state.records || {}, start, addDays(nextStart, -1));
  const calendarOvulation = addDays(nextStart, -luteal.days);
  let ovulation = calendarOvulation; let source = 'calendar';
  if (bbt) { ovulation = bbt.ovulationDate; source = 'bbt'; }
  else if (lhDate) { ovulation = addDays(lhDate, 1); source = 'lh'; }
  return { start, nextStart, length, completed, ovulation, fertileStart: addDays(ovulation, -5), source, confirmed: source === 'bbt', lhDate, bbt, luteal: luteal.days, lutealSamples: luteal.samples };
}

// 與排卵日的距離決定受孕機率：排卵前 2 天到排卵日最高，前 5 天起進入窗口。
export function fertilityOn(state, date) {
  const cycle = cycleAt(state, date);
  if (!cycle) return { level: 'none', offset: null, cycle: null };
  const offset = dayDiff(cycle.ovulation, date);
  let level = 'none';
  if (offset >= -2 && offset <= 0) level = 'peak';
  else if (offset >= -5 && offset <= -3) level = 'high';
  return { level, offset, cycle };
}

const hasIntercourse = (state, date) => Boolean(state.records?.[date]?.intercourse);

// 目前的週期狀態：月經是否已晚於預期。
export function periodStatus(state, today) {
  const starts = periodStarts(state);
  if (!starts.length) return null;
  const last = cycleAt(state, starts[starts.length - 1]);
  const expectedNext = last.source === 'calendar' ? last.nextStart : addDays(last.ovulation, last.luteal);
  return { lastStart: last.start, expectedNext, lateDays: dayDiff(expectedNext, today), cycleDay: dayDiff(last.start, today) + 1 };
}

export function adviceFor(state, today) {
  if (!periodStarts(state).length) {
    return { tone: 'setup', badge: '開始', title: '先輸入最近一次月經首日', detail: '有了月經首日，才能推估排卵日與受孕窗口。', actions: ['在下方「週期設定」輸入最近一次月經首日', '之後每天花 30 秒記錄體溫與試紙'], facts: [] };
  }
  const record = state.records?.[today] || {};
  const status = periodStatus(state, today);
  const cycle = cycleAt(state, today);
  const offset = dayDiff(cycle.ovulation, today);
  const facts = [];
  const yesterdayLh = state.records?.[addDays(today, -1)]?.ovulationTest === 'positive';
  const intercourseYesterday = hasIntercourse(state, addDays(today, -1));
  const intercourseToday = hasIntercourse(state, today);
  const wetMucus = record.mucus === 'eggwhite' || record.mucus === 'watery';

  if (status.lateDays >= 0 && !cycle.confirmed) {
    return {
      tone: 'late', badge: '月經未到',
      title: status.lateDays >= 3 ? `月經比預期晚了 ${status.lateDays} 天` : '預計月經就在這幾天來',
      detail: status.lateDays >= 3 ? '如果這個週期有在窗口內同房，可以用驗孕棒檢查；若月經已經來了，請補登月經首日，之後的推估才會準。' : '月經來了請補登月經首日，下個週期的推估才會更準。',
      actions: status.lateDays >= 3 ? ['月經來了：到「月經紀錄」補登首日', '月經沒來：晨尿驗孕較準，陰性可隔 2–3 天再驗'] : ['月經來了：到「月經紀錄」補登首日'], facts
    };
  }

  const window = cycle.confirmed && today > cycle.ovulation;
  if (window) {
    facts.push(`體溫首日上升在 ${shortDate(cycle.bbt.riseDate)}，推定排卵日 ${shortDate(cycle.ovulation)}`);
    return {
      tone: 'past', badge: '窗口已過', title: '體溫已上升，這個週期的受孕窗口結束了',
      detail: '體溫連續偏高代表排卵已經發生，現在不需要再特地安排同房。',
      actions: [`預計下次月經約 ${shortDate(addDays(cycle.ovulation, cycle.luteal))}`, `月經沒來，約在排卵後 14 天（${shortDate(addDays(cycle.ovulation, 14))} 之後）驗孕較準`], facts
    };
  }

  if (cycle.lhDate && !cycle.confirmed) {
    const since = dayDiff(cycle.lhDate, today);
    if (since <= 1) {
      const doneToday = intercourseToday ? '今天已記錄同房，明天再一次更好。' : '建議今天或明天同房。';
      return {
        tone: 'peak', badge: '最佳時機', title: since === 0 ? '排卵試紙陽性：現在是最佳時機' : '試紙陽性後第二天：仍是最佳時機',
        detail: `排卵多半發生在試紙轉陽性後 24–36 小時內。${since === 0 ? doneToday : intercourseToday ? '今天已記錄同房。' : '今天是最後一個高機率日，建議今天同房。'}`,
        actions: ['不用每天同房，隔 1–2 天一次就夠', '繼續每天量體溫，連續 3 天偏高就能確認排卵'], facts: intercourseYesterday ? ['昨天已有同房紀錄'] : facts
      };
    }
    return {
      tone: 'past', badge: '等待確認', title: '試紙陽性已經過了，排卵應該已發生',
      detail: '繼續每天量體溫；連續 3 天明顯高於前 6 天，就能確認排卵並結束這個窗口。',
      actions: [`預計下次月經約 ${shortDate(addDays(cycle.ovulation, cycle.luteal))}`], facts
    };
  }

  if (offset >= -2 && offset <= 0) {
    const detail = intercourseToday ? '今天已記錄同房。明天再一次也可以，隔 1–2 天一次就夠。'
      : intercourseYesterday ? '昨天已經同房，今天可以再一次；隔 1–2 天一次即可，不需要每天。'
        : '建議今天或明天同房。';
    return {
      tone: 'peak', badge: '最佳時機', title: offset === 0 ? '預估排卵日就是今天' : `預估排卵日前 ${-offset} 天：受孕機率最高`,
      detail: `${detail}推估可能差 1–2 天，記得測排卵試紙，陽性代表接下來 1–2 天最佳。`,
      actions: ['今天測排卵試紙並記錄', '量體溫：排卵後體溫會上升，用來事後確認'], facts
    };
  }
  if (offset >= -5 && offset < -2) {
    return {
      tone: 'high', badge: '窗口開始', title: '已進入受孕窗口，機率逐漸升高',
      detail: intercourseToday || intercourseYesterday ? '最近已有同房紀錄，接下來隔 1–2 天保持一次就好。' : '建議每隔 1–2 天同房一次，不必刻意等到排卵日。',
      actions: ['每天測排卵試紙，轉陽性就是最佳時機', '分泌物變成透明、蛋清狀也是接近排卵的訊號'], facts
    };
  }
  if (wetMucus && offset < -5) {
    return { tone: 'high', badge: '提早出現訊號', title: '分泌物出現蛋清狀，可能提早進入窗口', detail: '分泌物是接近排卵的訊號，建議從今天開始每天測排卵試紙，也可以安排一次同房。', actions: ['今天開始測排卵試紙'], facts };
  }
  if (offset > 0) {
    return {
      tone: 'wait', badge: '等待確認', title: '預估排卵日已過', detail: '體溫連續 3 天偏高就能確認排卵；若沒有上升，排卵可能延後，窗口也跟著往後。',
      actions: ['繼續每天量體溫和測試紙，不要中斷'], facts
    };
  }
  const days = -offset - 5;
  return {
    tone: 'wait', badge: '還不用等', title: `距離受孕窗口還有 ${days} 天`,
    detail: `預估窗口從 ${shortDate(cycle.fertileStart)} 開始，現在不需要特別安排同房。`,
    actions: [`${shortDate(cycle.fertileStart)} 起每天測排卵試紙`, '平時每天起床後固定時間量體溫，累積越久，推估越準'], facts
  };
}

// 受孕窗口規劃：排卵日前 5 天到排卵後 1 天，逐日列出機率與紀錄狀態。
export function windowPlan(state, today) {
  let cycle = cycleAt(state, today);
  if (!cycle) return null;
  if (today > addDays(cycle.ovulation, cycle.confirmed ? 1 : 2)) cycle = cycleAt(state, cycle.nextStart);
  const days = [];
  for (let offset = -5; offset <= 1; offset += 1) {
    const date = addDays(cycle.ovulation, offset);
    const record = state.records?.[date] || {};
    days.push({
      date, offset, today: date === today, past: date < today,
      level: offset >= -2 && offset <= 0 ? 'peak' : offset < -2 ? 'high' : 'after',
      intercourse: Boolean(record.intercourse), lh: record.ovulationTest || '', mucus: record.mucus || '', temperature: record.temperature || ''
    });
  }
  const intercourseCount = days.filter((day) => day.offset <= 0 && day.intercourse).length;
  return { cycle, days, intercourseCount };
}

// 量測品質提醒：時間差過大或太晚量都會讓基礎體溫失真。
export function measurementHint(state, today) {
  const recent = Object.entries(state.records || {})
    .filter(([date, record]) => date <= today && dayDiff(date, today) <= 14 && record.temperature && record.temperatureTime && !record.tempDisturbed)
    .sort(([a], [b]) => a.localeCompare(b)).slice(-7)
    .map(([, record]) => { const [h, m] = record.temperatureTime.split(':').map(Number); return h * 60 + m; });
  if (recent.length < 3) return '';
  const spread = Math.max(...recent) - Math.min(...recent);
  if (Math.min(...recent) >= 10 * 60) return '最近多半在上午 10 點後才量，體溫容易偏高；盡量起床後、下床前就量。';
  if (spread > 60) return `最近 ${recent.length} 次量測時間相差約 ${spread} 分鐘。時間越不固定，越難判讀排卵；建議固定在起床後的同一時段量。`;
  return '';
}
