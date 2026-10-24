import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAmount, parseRate, convert, expensesByCategory, debtProgress, debtTotals, balances, totalIn, goalProgress, formatMinor, formatRate, minorToInput,
} from "../src/money.js";
import { parseDolarApi, parseBinanceP2P } from "../src/rates.js";
import { normalize, defaultState } from "../src/store.js";

const R = (x) => parseRate(x);

test("parseAmount handles VE and US formats and rounding", () => {
  assert.equal(parseAmount("1.234,56"), 123456n);
  assert.equal(parseAmount("1,234.56"), 123456n);
  assert.equal(parseAmount("12,5"), 1250n);
  assert.equal(parseAmount("0.005"), 1n);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("abc"), null);
  assert.equal(parseAmount("1.2.3"), null);
});

test("convert is exact: 0.1 + 0.2 style traps", () => {
  const rates = { USD: R("36.5"), EUR: R("40.25") };
  assert.equal(convert(10000n, "USD", "VES", rates), 365000n); // $100 -> Bs. 3.650,00
  assert.equal(convert(365000n, "VES", "USD", rates), 10000n);
  assert.equal(convert(10000n, "EUR", "VES", rates), 402500n);
  assert.equal(convert(10000n, "USD", "EUR", rates), 9068n); // 36.5/40.25*100 = 90.6832 -> 90.68
  assert.equal(convert(5n, "USD", "USD", rates), 5n);
  assert.throws(() => convert(1n, "USD", "VES", {}));
});

test("balances and total", () => {
  const tx = [
    { type: "income", amountMinor: "100000", currency: "USD" },
    { type: "expense", amountMinor: "2500", currency: "USD" },
    { type: "income", amountMinor: "365000", currency: "VES" },
  ];
  const b = balances(tx);
  assert.equal(b.USD, 97500n);
  const total = totalIn("USD", b, { USD: R("36.5"), EUR: R("40") });
  assert.equal(total, 107500n);
});

test("goal progress and monthly suggestion", () => {
  const g = { targetMinor: "100000", deadline: "2026-12-31", contributions: [{ amountMinor: "25000" }] };
  const p = goalProgress(g, new Date("2026-10-01T00:00:00"));
  assert.equal(p.saved, 25000n);
  assert.equal(p.pct, 25);
  assert.equal(p.perMonthMinor, 25000n); // 750 USD over 3 months
  assert.equal(goalProgress({ ...g, contributions: [{ amountMinor: "100000" }] }).done, true);
});

test("formatting", () => {
  assert.equal(formatMinor(123456789n, "VES"), "Bs. 1.234.567,89");
  assert.equal(formatMinor(-5n, "USD"), "$ -0,05");
  assert.equal(formatRate(R("36.5")), "36,50");
  assert.equal(minorToInput(123456n), "1234.56");
});

test("DolarApi parsing picks the right fuente and rejects junk", () => {
  const json = [{ fuente: "oficial", promedio: 36.5, fechaActualizacion: "2026-10-24T12:00:00.000Z" }, { fuente: "paralelo", promedio: 40 }];
  assert.equal(parseDolarApi(json, "oficial").value, R("36.5"));
  assert.equal(parseDolarApi(json, "paralelo").value, R("40"));
  assert.throws(() => parseDolarApi(json, "otra"));
  assert.throws(() => parseDolarApi({}, "oficial"));
});

test("Binance parsing picks the lowest ad price exactly", () => {
  const json = { data: ["40.20", "40.00", "40.10", "oops"].map((price) => ({ adv: { price } })) };
  assert.equal(parseBinanceP2P(json).value, R("40"));
  assert.throws(() => parseBinanceP2P({ data: [] }));
});

test("store normalize drops corrupt records", () => {
  const s = normalize({ transactions: [{ amountMinor: "10" }, { amountMinor: "x" }, null], goals: "bad" });
  assert.equal(s.transactions.length, 1);
  assert.deepEqual(s.goals, []);
  assert.deepEqual(normalize({}).settings, defaultState().settings);
});

test("expensesByCategory groups, converts to USD and filters by month", () => {
  const rates = { USD: R("36.5"), EUR: R("40") };
  const tx = [
    { type: "expense", amountMinor: "1000", currency: "USD", category: "Comida", date: "2026-10-02" },
    { type: "expense", amountMinor: "36500", currency: "VES", category: "Comida", date: "2026-10-05" },
    { type: "expense", amountMinor: "500", currency: "USD", category: "Ocio", date: "2026-09-30" },
    { type: "income", amountMinor: "9999", currency: "USD", category: "Sueldo", date: "2026-10-01" },
  ];
  const oct = expensesByCategory(tx, rates, "2026-10");
  assert.deepEqual(oct.rows, [{ category: "Comida", usd: 2000n }]);
  assert.equal(oct.total, 2000n);
  assert.equal(expensesByCategory(tx, rates).rows.length, 2);
  assert.equal(expensesByCategory(tx, { USD: R("36.5") }, null).skipped, 0);
  assert.equal(expensesByCategory([{ ...tx[0], currency: "EUR" }], { USD: R("36.5") }).skipped, 1);
});

test("debt progress, overdue and USD totals", () => {
  const rates = { USD: R("36.5"), EUR: R("40") };
  const d1 = { type: "owe", currency: "USD", principalMinor: "10000", dueDate: "2026-01-01", payments: [{ amountMinor: "2500" }] };
  const p = debtProgress(d1, "2026-10-24");
  assert.equal(p.remaining, 7500n);
  assert.equal(p.pct, 25);
  assert.equal(p.overdue, true);
  assert.equal(debtProgress({ ...d1, payments: [{ amountMinor: "10000" }] }, "2026-10-24").settled, true);
  assert.equal(debtProgress({ ...d1, payments: [{ amountMinor: "10000" }] }, "2026-10-24").overdue, false);
  const d2 = { type: "owed", currency: "VES", principalMinor: "365000", dueDate: null, payments: [] }; // Bs. 3.650 = $100
  const t = debtTotals([d1, d2], rates);
  assert.equal(t.owe, 7500n);
  assert.equal(t.owed, 10000n);
  assert.equal(t.net, 2500n);
  assert.equal(debtTotals([{ ...d2, currency: "EUR" }], { USD: R("36.5") }).skipped, 1);
});

test("store normalize keeps valid debts only", () => {
  const s = normalize({ debts: [{ type: "owe", principalMinor: "5" }, { type: "x", principalMinor: "5" }, { type: "owed", principalMinor: "z" }] });
  assert.equal(s.debts.length, 1);
  assert.deepEqual(s.debts[0].payments, []);
});
