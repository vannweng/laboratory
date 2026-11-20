// 負擔能力：自備款、收入與房貸條件推算可負擔總價，並檢查指定總價的月付與負擔率。金額單位：萬元（月付另以元顯示）。

export function defaultAfford() {
  return { cash: 600, annualIncome: 150, otherMonthlyDebt: 0, rate: 0.023, years: 30, ltv: 0.8, feesRate: 0.03, burden: 1 / 3 };
}

// 本息平均攤還的每月付款（萬元）。
export function monthlyPayment(loan, annualRate, years) {
  if (loan <= 0) return 0;
  const rate = annualRate / 12; const months = years * 12;
  if (Math.abs(rate) < 1e-12) return loan / months;
  return loan * rate / (1 - (1 + rate) ** -months);
}
function loanForPayment(payment, annualRate, years) {
  if (payment <= 0) return 0;
  const rate = annualRate / 12; const months = years * 12;
  if (Math.abs(rate) < 1e-12) return payment * months;
  return payment * (1 - (1 + rate) ** -months) / rate;
}

export function validateAfford(source) {
  const read = (key, label, min, max) => {
    const value = Number(source[key]);
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label}必須介於 ${min} 與 ${max}`);
    return value;
  };
  return {
    cash: read('cash', '可動用自備款', 0, 100_000),
    annualIncome: read('annualIncome', '家庭年收入', 1, 100_000),
    otherMonthlyDebt: read('otherMonthlyDebt', '其他每月貸款', 0, 1_000),
    rate: read('rate', '房貸利率', 0, 0.15),
    years: read('years', '貸款年期', 5, 40),
    ltv: read('ltv', '貸款成數', 0.3, 0.9),
    feesRate: read('feesRate', '稅費與雜支', 0, 0.15),
    burden: read('burden', '負擔上限', 0.1, 0.6),
  };
}

// 以「貸足設定成數」計算（保守，剩下的現金當預備金）。
// 可負擔總價上限 = min(現金足以付頭期與稅費, 貸款月付不超過收入的負擔上限)。
export function affordability(source, price = null) {
  const plan = validateAfford(source);
  const monthlyIncome = plan.annualIncome / 12;
  const maxMonthly = Math.max(0, monthlyIncome * plan.burden - plan.otherMonthlyDebt);
  const maxLoan = loanForPayment(maxMonthly, plan.rate, plan.years);
  const byCash = plan.cash / (1 - plan.ltv + plan.feesRate);
  const byIncome = maxLoan / plan.ltv;
  const maxPrice = Math.min(byCash, byIncome);
  const result = { plan, monthlyIncome, maxMonthly, maxLoan, maxPrice, limitedBy: byCash < byIncome ? 'cash' : 'income' };
  if (!Number.isFinite(price) || price <= 0) return result;
  const fees = price * plan.feesRate;
  const loan = price * plan.ltv;
  const cashNeeded = price + fees - loan;
  const payment = monthlyPayment(loan, plan.rate, plan.years);
  const ratio = (payment + plan.otherMonthlyDebt) / monthlyIncome;
  const status = cashNeeded > plan.cash + 1e-9 ? 'cash-short' : ratio <= plan.burden + 1e-9 ? 'ok' : ratio <= 0.4 ? 'tight' : 'over';
  return { ...result, check: { price, fees, loan, cashNeeded, cashShort: Math.max(0, cashNeeded - plan.cash), payment, ratio, status } };
}
