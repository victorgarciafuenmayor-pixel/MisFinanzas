import test from "node:test";
import assert from "node:assert/strict";
import { createAccountsPdf } from "../src/report.js";

test("account PDF contains only the selected accounts and their movements", async () => {
  const accounts = [
    { name: "Banesco", currency: "VES", balanceMinor: "150000", history: [
      { date: "2026-11-28", kind: "out", amountMinor: "5000", note: "Mercado" },
    ] },
  ];
  const pdf = await createAccountsPdf(accounts, { date: new Date("2026-11-28T12:00:00Z") });
  const content = await pdf.text();
  assert.equal(pdf.type, "application/pdf");
  assert.match(content, /^%PDF-1\.4/);
  assert.match(content, /Banesco/);
  assert.match(content, /Mercado/);
  assert.doesNotMatch(content, /Efectivo/);
  assert.match(content, /\/Count 1/);
});

test("account PDF keeps every movement across pages", async () => {
  const history = Array.from({ length: 45 }, (_, i) => ({
    date: "2026-11-28", kind: "out", amountMinor: "100",
    note: `Movimiento de prueba ${i + 1} con una descripción que ocupa más de una línea en el documento`,
  }));
  const pdf = await createAccountsPdf([{ name: "Cuenta ejemplo", currency: "USD", balanceMinor: "10000", history }]);
  const content = await pdf.text();
  assert.match(content, /Movimiento de prueba 1/);
  assert.match(content, /Movimiento de prueba 45/);
  assert.match(content, /\/Count [2-9]/);
});
