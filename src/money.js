// Exact money math. Amounts are integer minor units (cents) as BigInt;
// rates are BigInt scaled by 1e8. No binary floating point touches the values.

export const CURRENCIES = ["USD", "EUR", "VES"];
export const SYMBOLS = { USD: "$", EUR: "€", VES: "Bs." };
const RATE_SCALE = 8;
const RATE_ONE = 10n ** BigInt(RATE_SCALE);

/** Parse "1.234,56" / "1,234.56" / "12.5" / 12.5 into a BigInt scaled by `scale`. Returns null if invalid. */
export function parseDecimal(input, scale) {
  let s = typeof input === "number" ? (Number.isFinite(input) ? input.toFixed(scale) : "") : String(input ?? "").trim();
  if (!s) return null;
  s = s.replace(/\s/g, "");
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // the later separator is the decimal one
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    s = s.replace(",", ".");
  }
  if (!/^\d*\.?\d*$/.test(s) || s === ".") return null;
  let [int = "0", frac = ""] = s.split(".");
  if (int === "") int = "0";
  const roundUp = frac.length > scale && frac[scale] >= "5";
  frac = frac.slice(0, scale).padEnd(scale, "0");
  let v = BigInt(int + frac);
  if (roundUp) v += 1n;
  return v;
}

export const parseAmount = (x) => parseDecimal(x, 2);
export const parseRate = (x) => {
  const v = parseDecimal(x, RATE_SCALE);
  return v !== null && v > 0n ? v : null;
};

function group(intStr, sep) {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/** Format a scaled BigInt with es-VE style: 1.234,56 */
export function formatScaled(v, scale, minFrac = scale, maxFrac = scale) {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const str = abs.toString().padStart(scale + 1, "0");
  const int = str.slice(0, str.length - scale);
  let frac = str.slice(str.length - scale);
  while (frac.length > minFrac && frac.endsWith("0")) frac = frac.slice(0, -1);
  frac = frac.slice(0, Math.max(maxFrac, minFrac));
  return (neg ? "-" : "") + group(int, ".") + (frac ? "," + frac : "");
}

export const formatMinor = (m, cur) => `${SYMBOLS[cur] ?? ""} ${formatScaled(m, 2)}`.trim();
export const formatRate = (r) => formatScaled(r, RATE_SCALE, 2, 4);

/** Plain decimal string for <input> values: 1234.5 → "1234.50" */
export const minorToInput = (m) => formatScaled(m, 2).replace(/\./g, "").replace(",", ".");

function divRound(n, d) {
  if (d === 0n) throw new Error("division by zero");
  const neg = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n, ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (ad * 2n); // round half up on magnitude
  return neg ? -q : q;
}

/**
 * rates: { USD: bigint (VES per 1 USD), EUR: bigint (VES per 1 EUR) }.
 * Converts minor units between any two supported currencies via VES.
 */
export function convert(minor, from, to, rates) {
  if (from === to) return minor;
  const r = (c) => (c === "VES" ? RATE_ONE : rates[c]);
  const rf = r(from), rt = r(to);
  if (!rf || !rt) throw new Error(`missing rate for ${!rf ? from : to}`);
  return divRound(minor * rf, rt);
}

/** Signed sum of transactions per currency. */
export function balances(transactions) {
  const out = { USD: 0n, EUR: 0n, VES: 0n };
  for (const t of transactions) {
    const m = BigInt(t.amountMinor);
    out[t.currency] += t.type === "income" ? m : -m;
  }
  return out;
}

export function totalIn(target, bal, rates) {
  let sum = 0n;
  for (const c of CURRENCIES) if (bal[c] !== 0n) sum += convert(bal[c], c, target, rates);
  return sum;
}

/** Savings goal progress. Amounts in USD minor units. */
export function goalProgress(goal, now = new Date()) {
  const target = BigInt(goal.targetMinor);
  const saved = goal.contributions.reduce((a, c) => a + BigInt(c.amountMinor), 0n);
  const remaining = target > saved ? target - saved : 0n;
  const pct = target === 0n ? 0 : Number((saved * 10000n) / target) / 100;
  let perMonthMinor = null, daysLeft = null;
  if (goal.deadline) {
    const end = new Date(goal.deadline + "T23:59:59");
    daysLeft = Math.ceil((end - now) / 86400000);
    if (remaining > 0n && daysLeft > 0) {
      const months = Math.max(1, Math.round(daysLeft / 30.44));
      perMonthMinor = divRound(remaining, BigInt(months));
    }
  }
  return { saved, remaining, pct: Math.min(100, pct), done: saved >= target && target > 0n, perMonthMinor, daysLeft };
}

/**
 * Expenses grouped by category, valued in USD. `month` is "YYYY-MM" or null for all time.
 * Returns { rows: [{category, usd}] sorted desc, total, skipped } — `skipped` counts
 * movements left out because a needed rate is missing.
 */
export function expensesByCategory(transactions, rates, month = null) {
  const sums = new Map();
  let total = 0n, skipped = 0;
  for (const t of transactions) {
    if (t.type !== "expense" || (month && !t.date.startsWith(month))) continue;
    let usd;
    try { usd = convert(BigInt(t.amountMinor), t.currency, "USD", rates); } catch { skipped++; continue; }
    sums.set(t.category, (sums.get(t.category) ?? 0n) + usd);
    total += usd;
  }
  const rows = [...sums].map(([category, usd]) => ({ category, usd })).sort((a, b) => (b.usd > a.usd ? 1 : b.usd < a.usd ? -1 : 0));
  return { rows, total, skipped };
}
