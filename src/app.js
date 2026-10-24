import {
  CURRENCIES, SYMBOLS, parseAmount, parseRate, formatMinor, formatRate, formatScaled, minorToInput,
  convert, balances, totalIn, goalProgress, expensesByCategory,
} from "./money.js";
import { fetchRates } from "./rates.js";
import { load, save, uid, hasLocal, idbLoad, normalize } from "./store.js";

const REFRESH_MS = 60_000;
const STALE_MS = 15 * 60_000;
const CATEGORIES = {
  income: ["Sueldo", "Freelance", "Ventas", "Remesas", "Otro"],
  expense: ["Comida", "Transporte", "Servicios", "Vivienda", "Salud", "Ocio", "Deudas", "Otro"],
};
const RATE_CARDS = [
  { key: "bcvUsd", label: "BCV Dólar", sub: "Bs. por 1 USD", icon: "USD" },
  { key: "bcvEur", label: "BCV Euro", sub: "Bs. por 1 EUR", icon: "EUR" },
  { key: "binance", label: "Binance P2P", sub: "Bs. por 1 USDT", icon: "P2P" },
];

const hadLocal = hasLocal();
let state = load();
let tab = "rates";
let rateErrors = {};
let loading = false;
let chartPeriod = "month";
const CHART_COLORS = ["#0d9488", "#6366f1", "#f59e0b", "#ef4444", "#22c55e", "#a855f7", "#0ea5e9", "#94a3b8"];
const catsFor = (type) => [...new Set([...CATEGORIES[type], ...(state.settings.customCats?.[type] || [])])];
let convertForm = { amount: "100", from: "USD", to: "VES", source: "bcv", custom: "" };

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const persist = () => save(state);
const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD in local time

/* ---------- rates ---------- */
const rateVal = (key) => (state.rates[key] ? BigInt(state.rates[key].value) : null);

function ageText(ts) {
  if (!ts) return "—";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "hace segundos";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

/** Rate set {USD, EUR} for a source: 'bcv' | 'binance' | 'custom'. Missing pieces are omitted. */
function rateSet(source, custom) {
  const set = {};
  const usd = source === "binance" ? rateVal("binance") : source === "custom" ? parseRate(custom) : rateVal("bcvUsd");
  if (usd) set.USD = usd;
  const eur = rateVal("bcvEur");
  if (eur) set.EUR = eur;
  return set;
}

async function refreshRates() {
  if (loading) return;
  loading = true;
  renderStatus();
  try {
    const res = await fetchRates();
    rateErrors = {};
    for (const [key, r] of Object.entries(res)) {
      if (r.error) { rateErrors[key] = r.error; continue; }
      if (state.rates[key]?.manual) continue; // manual override wins until cleared
      state.rates[key] = { value: r.value.toString(), updatedAt: r.updatedAt, fetchedAt: Date.now(), source: r.source, approx: !!r.approx };
    }
    persist();
  } finally {
    loading = false;
    render();
  }
}

function renderStatus() {
  const el = $("#status");
  const fetched = Math.max(0, ...Object.values(state.rates).map((r) => r?.fetchedAt || 0));
  el.textContent = loading ? "Actualizando…" : navigator.onLine === false ? "Sin conexión" : fetched ? `Actualizado ${ageText(fetched)}` : "";
}

/* ---------- views ---------- */
function viewRates() {
  const bcv = rateVal("bcvUsd"), bin = rateVal("binance");
  let spread = "";
  if (bcv && bin) {
    const bp = ((bin - bcv) * 10000n) / bcv;
    spread = `<div class="card"><div class="muted">Brecha Binance vs BCV (USD)</div><div class="big">${bp > 0n ? "+" : ""}${formatScaled(bp, 2)}%</div></div>`;
  }
  const cards = RATE_CARDS.map(({ key, label, sub, icon }) => {
    const r = state.rates[key];
    const err = rateErrors[key];
    const stale = r && !r.manual && Date.now() - (r.fetchedAt || 0) > STALE_MS;
    const badges = [
      r?.manual ? '<span class="badge warn">manual</span>' : "",
      r?.approx ? '<span class="badge warn">aproximada</span>' : "",
      err ? '<span class="badge err">sin conexión</span>' : "",
      stale && !err ? '<span class="badge warn">desactualizada</span>' : "",
    ].join("");
    return `<div class="card" data-rate="${key}">
      <div class="row"><span class="chip">${icon}</span><div class="grow"><div><b>${label}</b>${badges}</div><div class="muted">${sub}</div></div>
      <div class="big">${r ? formatRate(BigInt(r.value)) : "—"}</div></div>
      <div class="row muted" style="margin-top:8px"><span>${r ? esc(r.source || "") + " · " + ageText(r.manual ? r.updatedAt : r.updatedAt || r.fetchedAt) : "Sin datos todavía"}</span>
      <span><button class="link" data-act="manual" data-key="${key}">Editar</button>${r?.manual ? `<button class="link" data-act="auto" data-key="${key}">Auto</button>` : ""}</span></div>
    </div>`;
  }).join("");
  return `${cards}${spread}
    <button class="primary" style="width:100%" data-act="refresh">Actualizar ahora</button>
    <p class="muted">Se actualizan solas cada minuto mientras la app está abierta.</p>`;
}

function monthKey(d) { return d.slice(0, 7); }

function viewChart(set) {
  const month = chartPeriod === "month" ? monthKey(today()) : null;
  const { rows, total, skipped } = expensesByCategory(state.transactions, set, month);
  const seg = `<div class="seg" style="margin-bottom:12px"><button data-period="month" aria-pressed="${chartPeriod === "month"}">Este mes</button><button data-period="all" aria-pressed="${chartPeriod === "all"}">Todo</button></div>`;
  if (!rows.length || total === 0n) return `<h2>Gastos por categoría</h2><div class="card">${seg}<div class="empty" style="padding:24px 8px">Sin gastos en este período.</div></div>`;
  const top = rows.slice(0, 7);
  const rest = rows.slice(7).reduce((a, r) => a + r.usd, 0n);
  const slices = rest > 0n ? [...top, { category: "Otras", usd: rest }] : top;
  let offset = 0;
  const arcs = slices.map((r, i) => {
    const pct = Number((r.usd * 10000n) / total) / 100;
    const el = `<circle r="15.9155" cx="21" cy="21" fill="none" stroke="${CHART_COLORS[i]}" stroke-width="6" stroke-dasharray="${pct} ${100 - pct}" stroke-dashoffset="${25 - offset}"/>`;
    offset += pct;
    return el;
  }).join("");
  const legend = slices.map((r, i) => {
    const pct = Number((r.usd * 1000n) / total) / 10;
    return `<div class="row legend"><span class="dot" style="background:${CHART_COLORS[i]}"></span><span class="grow">${esc(r.category)}</span><span class="muted">${pct.toFixed(1).replace(".", ",")}%</span><span class="num">${formatMinor(r.usd, "USD")}</span></div>`;
  }).join("");
  return `<h2>Gastos por categoría</h2><div class="card">${seg}
    <div class="donut"><svg viewBox="0 0 42 42" role="img" aria-label="Gastos por categoría">${arcs}</svg>
    <div class="donut-center"><div class="muted">Total</div><div class="num">${formatMinor(total, "USD")}</div></div></div>
    ${legend}${skipped ? `<p class="muted">${skipped} movimiento(s) no incluidos por falta de tasa.</p>` : ""}</div>`;
}

const BACKUP_DAYS = 7;
function backupBanner() {
  if (!state.transactions.length && !state.goals.length) return "";
  const last = state.settings.lastBackup;
  if (last && Date.now() - last < BACKUP_DAYS * 86400000) return "";
  return `<div class="card warnbox"><b>Protege tus datos</b><div class="muted">${last ? `Tu último respaldo fue ${ageText(last)}.` : "Aún no has hecho un respaldo."} Guárdalo en Archivos o iCloud Drive.</div>
    <div class="actions"><button class="primary" data-act="backup">Hacer respaldo</button></div></div>`;
}

async function exportBackup() {
  const json = JSON.stringify(state, null, 2);
  const name = `finanzas-ve-${today()}.json`;
  const file = new File([json], name, { type: "application/json" });
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: "Respaldo Finanzas VE" });
    else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(file); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  } catch (e) { if (e?.name === "AbortError") return false; throw e; }
  state.settings.lastBackup = Date.now();
  persist();
  return true;
}

function viewTx() {
  const bal = balances(state.transactions);
  const set = rateSet(state.settings.valuation);
  let totalUsd = null;
  try { totalUsd = totalIn("USD", bal, set); } catch { /* missing rate */ }
  const month = monthKey(today());
  let inc = 0n, exp = 0n, partial = false;
  for (const t of state.transactions) {
    if (monthKey(t.date) !== month) continue;
    try {
      const usd = convert(BigInt(t.amountMinor), t.currency, "USD", set);
      if (t.type === "income") inc += usd; else exp += usd;
    } catch { partial = true; }
  }
  const balRows = CURRENCIES.map((c) => `<div class="row"><span class="muted">${c}</span><span class="num">${formatMinor(bal[c], c)}</span></div>`).join("");
  const list = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const items = list.length
    ? list.map((t) => `<div class="card tx"><div class="row"><span class="chip ${t.type}">${t.type === "income" ? "↓" : "↑"}</span><div class="grow"><b>${esc(t.category)}</b><div class="muted">${esc(t.date)}</div>${t.note ? `<div class="desc">${esc(t.note)}</div>` : ""}</div>
      <div style="text-align:right"><div class="num ${t.type}">${t.type === "income" ? "+" : "−"}${formatMinor(BigInt(t.amountMinor), t.currency)}</div>
      <button class="link" data-act="edit-tx" data-id="${esc(t.id)}">Editar</button><button class="link danger" data-act="del-tx" data-id="${esc(t.id)}">Borrar</button></div></div></div>`).join("")
    : '<div class="empty">Aún no hay movimientos.<br>Toca + para registrar un ingreso o egreso.</div>';
  return `${backupBanner()}<div class="card hero"><div class="muted">Balance total (${state.settings.valuation === "binance" ? "tasa Binance" : "tasa BCV"})</div>
    <div class="big">${totalUsd === null ? "—" : formatMinor(totalUsd, "USD")}</div>
    ${totalUsd === null ? '<div class="muted">Faltan tasas para calcular el total.</div>' : ""}
    <div style="margin-top:10px">${balRows}</div></div>
    <div class="card row"><div><div class="muted">Ingresos del mes</div><div class="num income">${formatMinor(inc, "USD")}</div></div>
    <div style="text-align:right"><div class="muted">Egresos del mes</div><div class="num expense">${formatMinor(exp, "USD")}</div></div></div>
    ${partial ? '<p class="muted">Algunos movimientos no se incluyen por falta de tasa.</p>' : ""}
    ${viewChart(set)}
    <button class="primary" style="width:100%" data-act="add-tx">+ Agregar movimiento</button>
    <div class="row"><h2>Historial</h2><span><button class="link" data-act="cats">Categorías</button><button class="link" data-act="settings">Ajustes y respaldo</button></span></div>
    ${items}
`;
}

function conversionOutput(f) {
  const amt = parseAmount(f.amount);
  if (amt === null) return '<div class="muted">Escribe un monto válido.</div>';
  const set = rateSet(f.source, f.custom);
  try {
    const out = convert(amt, f.from, f.to, set);
    return `<div class="muted">${formatMinor(amt, f.from)} =</div><div class="big">${formatMinor(out, f.to)}</div>`;
  } catch {
    return '<div class="muted">Falta la tasa seleccionada. Actualiza las tasas o escribe una personalizada.</div>';
  }
}

function comparison(f) {
  const amt = parseAmount(f.amount);
  if (amt === null) return "";
  const rows = [["bcv", "BCV"], ["binance", "Binance"]].map(([src, name]) => {
    try { return `<div class="row"><span class="muted">${name}</span><span class="num">${formatMinor(convert(amt, f.from, f.to, rateSet(src)), f.to)}</span></div>`; }
    catch { return `<div class="row"><span class="muted">${name}</span><span class="muted">sin tasa</span></div>`; }
  }).join("");
  return `<h2>Comparar fuentes</h2><div class="card">${rows}</div>`;
}

function viewConvert() {
  const f = convertForm;
  const opts = (sel) => CURRENCIES.map((c) => `<option ${c === sel ? "selected" : ""}>${c}</option>`).join("");
  const srcBtn = (v, t) => `<button data-src="${v}" aria-pressed="${f.source === v}">${t}</button>`;
  return `<div class="card">
    <label for="cv-amount">Monto</label><input id="cv-amount" inputmode="decimal" value="${esc(f.amount)}" autocomplete="off">
    <div class="row" style="align-items:flex-end;margin-top:4px">
      <div class="grow"><label for="cv-from">De</label><select id="cv-from">${opts(f.from)}</select></div>
      <button data-act="swap" aria-label="Intercambiar">⇄</button>
      <div class="grow"><label for="cv-to">A</label><select id="cv-to">${opts(f.to)}</select></div></div>
    <label>Tasa del dólar</label>
    <div class="seg">${srcBtn("bcv", "BCV")}${srcBtn("binance", "Binance")}${srcBtn("custom", "Otra")}</div>
    ${f.source === "custom" ? `<label for="cv-custom">Bs. por 1 USD</label><input id="cv-custom" inputmode="decimal" value="${esc(f.custom)}" placeholder="Ej: 45,50">` : ""}
    <div id="cv-out" style="margin-top:16px">${conversionOutput(f)}</div></div>
    <div id="cv-cmp">${comparison(f)}</div>
    <p class="muted">El euro siempre usa la tasa BCV Euro.</p>`;
}

function viewGoals() {
  const cards = state.goals.length
    ? state.goals.map((g) => {
        const p = goalProgress(g);
        const info = p.done ? "¡Meta lograda! 🎉"
          : p.daysLeft !== null && p.daysLeft <= 0 ? "La fecha límite ya pasó"
          : p.perMonthMinor !== null ? `Ahorra ${formatMinor(p.perMonthMinor, "USD")} al mes (${p.daysLeft} días restantes)` : "";
        return `<div class="card"><div class="row"><div class="grow"><b>${esc(g.name)}</b><div class="muted">${g.deadline ? "Para " + esc(g.deadline) : "Sin fecha límite"}</div></div>
          <div class="num">${p.pct.toFixed(0)}%</div></div>
          <div class="bar" role="progressbar" aria-valuenow="${p.pct.toFixed(0)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${p.pct}%"></i></div>
          <div class="row"><span class="num">${formatMinor(p.saved, "USD")}</span><span class="muted">de ${formatMinor(BigInt(g.targetMinor), "USD")}</span></div>
          ${info ? `<div class="muted" style="margin-top:6px">${esc(info)}</div>` : ""}
          <div class="actions"><button class="primary" data-act="contribute" data-id="${esc(g.id)}">Aportar</button>
          <button class="danger" data-act="del-goal" data-id="${esc(g.id)}">Eliminar</button></div></div>`;
      }).join("")
    : '<div class="empty">Crea tu primera meta de ahorro.<br>Ej: Fondo de emergencia, viaje, celular nuevo.</div>';
  return `<button class="primary" style="width:100%;margin-bottom:12px" data-act="add-goal">+ Nueva meta</button>${cards}`;
}

const TITLES = { rates: "Tasas", tx: "Movimientos", convert: "Convertir", goals: "Metas de ahorro" };
function render() {
  $("#title").textContent = TITLES[tab];
  document.querySelectorAll(".tabs button").forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  const views = { rates: viewRates, tx: viewTx, convert: viewConvert, goals: viewGoals };
  const keep = document.activeElement?.id;
  $("#view").innerHTML = views[tab]();
  if (keep && tab === "convert") { const el = document.getElementById(keep); if (el) { el.focus(); if (el.setSelectionRange && el.type !== "number") try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* n/a */ } } }
  renderStatus();
}

/* ---------- dialogs ---------- */
function dialog(html, onSubmit) {
  const dlg = $("#dlg");
  dlg.innerHTML = `<form method="dialog" novalidate>${html}<div class="err-text" id="dlg-err" role="alert"></div>
    <div class="actions"><button type="button" data-close>Cancelar</button><button class="primary" type="submit">Guardar</button></div></form>`;
  const form = dlg.querySelector("form");
  dlg.querySelector("[data-close]").onclick = () => dlg.close();
  form.onsubmit = (e) => {
    e.preventDefault();
    const err = onSubmit(Object.fromEntries(new FormData(form)));
    if (err) { dlg.querySelector("#dlg-err").textContent = err; return; }
    dlg.close();
    persist();
    render();
  };
  dlg.showModal();
  return dlg;
}

function addTxDialog(existing = null) {
  let type = existing?.type ?? "expense";
  const dlg = dialog(`
    <div class="seg" id="tx-type"><button type="button" data-t="expense">Egreso</button><button type="button" data-t="income">Ingreso</button></div>
    <label for="f-amount">Monto</label><input id="f-amount" name="amount" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${existing ? esc(minorToInput(BigInt(existing.amountMinor))) : ""}">
    <label for="f-cur">Moneda</label><select id="f-cur" name="currency">${CURRENCIES.map((c) => `<option ${existing?.currency === c ? "selected" : ""}>${c}</option>`).join("")}</select>
    <label for="f-cat">Categoría</label><select id="f-cat" name="category"></select>
    <input id="f-newcat" name="newcat" maxlength="30" placeholder="Nombre de la nueva categoría" autocomplete="off" hidden style="margin-top:8px">
    <label for="f-note">Descripción (opcional)</label><input id="f-note" name="note" maxlength="120" autocomplete="off" placeholder="Ej: Mercado de la semana" value="${esc(existing?.note ?? "")}">
    <label for="f-date">Fecha</label><input id="f-date" name="date" type="date" value="${existing?.date ?? today()}">`, (d) => {
    const amountMinor = parseAmount(d.amount);
    if (amountMinor === null || amountMinor <= 0n) return "Escribe un monto mayor que cero.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return "Fecha inválida.";
    let category = d.category;
    if (category === "__new__") {
      category = (d.newcat || "").trim();
      if (!category) return "Escribe el nombre de la categoría.";
      const known = catsFor(type).find((c) => c.toLowerCase() === category.toLowerCase());
      if (known) category = known;
      else state.settings.customCats[type] = [...(state.settings.customCats[type] || []), category];
    }
    const tx = { id: existing?.id ?? uid(), type, amountMinor: amountMinor.toString(), currency: d.currency, category, note: (d.note || "").trim(), date: d.date };
    if (existing) Object.assign(existing, tx); else state.transactions.push(tx);
  });
  const sel = dlg.querySelector("#f-cat"), newcat = dlg.querySelector("#f-newcat");
  const fillCats = (pick) => {
    const cats = catsFor(type);
    if (pick && !cats.includes(pick)) cats.push(pick);
    sel.innerHTML = cats.map((c) => `<option ${c === pick ? "selected" : ""}>${esc(c)}</option>`).join("") + '<option value="__new__">+ Nueva categoría…</option>';
    newcat.hidden = true;
  };
  const paintType = () => dlg.querySelectorAll("#tx-type button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.t === type)));
  fillCats(existing?.category); paintType();
  sel.onchange = () => { newcat.hidden = sel.value !== "__new__"; if (!newcat.hidden) newcat.focus(); };
  dlg.querySelectorAll("#tx-type button").forEach((b) => (b.onclick = () => { type = b.dataset.t; paintType(); fillCats(); }));
}

function addGoalDialog() {
  dialog(`
    <label for="g-name">Nombre de la meta</label><input id="g-name" name="name" maxlength="50" autocomplete="off" placeholder="Fondo de emergencia">
    <label for="g-target">Monto objetivo (USD)</label><input id="g-target" name="target" inputmode="decimal" autocomplete="off" placeholder="1.000">
    <label for="g-date">Fecha límite (opcional)</label><input id="g-date" name="deadline" type="date" min="${today()}">`, (d) => {
    const name = (d.name || "").trim();
    const target = parseAmount(d.target);
    if (!name) return "Ponle un nombre a la meta.";
    if (target === null || target <= 0n) return "El objetivo debe ser mayor que cero.";
    state.goals.push({ id: uid(), name, targetMinor: target.toString(), deadline: d.deadline || null, contributions: [] });
  });
}

function contributeDialog(id) {
  const g = state.goals.find((x) => x.id === id);
  if (!g) return;
  dialog(`<p>Aportar a <b>${esc(g.name)}</b></p>
    <label for="c-amt">Monto (USD)</label><input id="c-amt" name="amount" inputmode="decimal" autocomplete="off" placeholder="0,00">
    <label for="c-date">Fecha</label><input id="c-date" name="date" type="date" value="${today()}">`, (d) => {
    const m = parseAmount(d.amount);
    if (m === null || m <= 0n) return "Escribe un monto mayor que cero.";
    g.contributions.push({ id: uid(), date: d.date || today(), amountMinor: m.toString() });
  });
}

function manualRateDialog(key) {
  const card = RATE_CARDS.find((c) => c.key === key);
  const cur = state.rates[key];
  dialog(`<p>Tasa manual: <b>${card.label}</b></p>
    <label for="m-rate">${card.sub}</label><input id="m-rate" name="rate" inputmode="decimal" autocomplete="off" value="${cur ? esc(formatScaled(BigInt(cur.value), 8, 2, 4).replace(/\./g, "")) : ""}">
    <p class="muted">Se usará en lugar de la automática hasta que toques "Auto".</p>`, (d) => {
    const r = parseRate(d.rate);
    if (r === null) return "Tasa inválida.";
    state.rates[key] = { value: r.toString(), updatedAt: Date.now(), fetchedAt: Date.now(), source: "Manual", manual: true };
  });
}

function categoriesDialog(type = "expense") {
  const dlg = $("#dlg");
  const paint = () => {
    const custom = state.settings.customCats[type] || [];
    const rows = catsFor(type).map((c) => {
      const isCustom = custom.includes(c);
      return `<div class="row legend"><span class="grow">${esc(c)}</span>${isCustom ? `<button type="button" class="link danger" data-del="${esc(c)}">Quitar</button>` : '<span class="muted">base</span>'}</div>`;
    }).join("");
    dlg.innerHTML = `<div class="seg"><button type="button" data-t="expense" aria-pressed="${type === "expense"}">Egresos</button><button type="button" data-t="income" aria-pressed="${type === "income"}">Ingresos</button></div>
      <div style="margin:12px 0;max-height:38vh;overflow:auto">${rows}</div>
      <form id="cat-form" class="row"><input id="cat-new" maxlength="30" placeholder="Nueva categoría" autocomplete="off"><button class="primary" type="submit">Agregar</button></form>
      <div class="err-text" id="dlg-err" role="alert"></div>
      <p class="muted">Quitar una categoría no borra los movimientos que ya la usan.</p>
      <div class="actions"><button type="button" id="cat-done" class="primary">Listo</button></div>`;
    dlg.querySelectorAll(".seg button").forEach((b) => (b.onclick = () => { type = b.dataset.t; paint(); }));
    dlg.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => {
      state.settings.customCats[type] = custom.filter((c) => c !== b.dataset.del);
      persist(); render(); paint();
    }));
    dlg.querySelector("#cat-form").onsubmit = (e) => {
      e.preventDefault();
      const name = dlg.querySelector("#cat-new").value.trim();
      if (!name) return;
      if (catsFor(type).some((c) => c.toLowerCase() === name.toLowerCase())) { dlg.querySelector("#dlg-err").textContent = "Esa categoría ya existe."; return; }
      state.settings.customCats[type] = [...custom, name];
      persist(); render(); paint();
      dlg.querySelector("#cat-new").focus();
    };
    dlg.querySelector("#cat-done").onclick = () => dlg.close();
  };
  paint();
  dlg.showModal();
}

function settingsDialog() {
  const dlg = dialog(`
    <label for="s-val">Valorar el balance con</label>
    <select id="s-val" name="valuation"><option value="bcv" ${state.settings.valuation === "bcv" ? "selected" : ""}>Tasa BCV</option><option value="binance" ${state.settings.valuation === "binance" ? "selected" : ""}>Tasa Binance</option></select>
    <h2>Respaldo</h2>
    <p class="muted">Tus datos se guardan en este iPhone con doble copia interna. Último respaldo: ${state.settings.lastBackup ? ageText(state.settings.lastBackup) : "nunca"}. Guarda un respaldo en Archivos o iCloud Drive para no perderlos si borras la app.</p>
    <div class="actions" style="margin-top:0"><button type="button" id="s-exp">Exportar</button><button type="button" id="s-imp">Importar</button></div>
    <input type="file" id="s-file" accept="application/json" hidden>`, (d) => { state.settings.valuation = d.valuation; });
  dlg.querySelector("#s-exp").onclick = () => exportBackup().then((ok) => ok && render()).catch(() => { dlg.querySelector("#dlg-err").textContent = "No se pudo crear el respaldo."; });
  const file = dlg.querySelector("#s-file");
  dlg.querySelector("#s-imp").onclick = () => file.click();
  file.onchange = async () => {
    try {
      const next = normalize(JSON.parse(await file.files[0].text()));
      if (!confirm("Esto reemplazará todos los datos actuales. ¿Continuar?")) return;
      state = next; persist(); dlg.close(); render();
    } catch { dlg.querySelector("#dlg-err").textContent = "Archivo de respaldo inválido."; }
  };
}

/* ---------- events ---------- */
document.addEventListener("click", (e) => {
  const tabBtn = e.target.closest(".tabs button");
  if (tabBtn) { tab = tabBtn.dataset.tab; render(); return; }
  const per = e.target.closest("[data-period]");
  if (per) { chartPeriod = per.dataset.period; render(); return; }
  const src = e.target.closest("[data-src]");
  if (src) { convertForm.source = src.dataset.src; render(); return; }
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const { act, key, id } = b.dataset;
  if (act === "refresh") refreshRates();
  else if (act === "manual") manualRateDialog(key);
  else if (act === "auto") { delete state.rates[key]; persist(); refreshRates(); }
  else if (act === "add-tx") addTxDialog();
  else if (act === "edit-tx") addTxDialog(state.transactions.find((t) => t.id === id));
  else if (act === "del-tx") { if (confirm("¿Borrar este movimiento?")) { state.transactions = state.transactions.filter((t) => t.id !== id); persist(); render(); } }
  else if (act === "add-goal") addGoalDialog();
  else if (act === "contribute") contributeDialog(id);
  else if (act === "del-goal") { if (confirm("¿Eliminar esta meta y sus aportes?")) { state.goals = state.goals.filter((g) => g.id !== id); persist(); render(); } }
  else if (act === "swap") { [convertForm.from, convertForm.to] = [convertForm.to, convertForm.from]; render(); }
  else if (act === "settings") settingsDialog();
  else if (act === "cats") categoriesDialog();
  else if (act === "backup") exportBackup().then((ok) => ok && render()).catch(() => alert("No se pudo crear el respaldo."));
});

document.addEventListener("input", (e) => {
  const t = e.target;
  if (tab !== "convert") return;
  if (t.id === "cv-amount") convertForm.amount = t.value;
  else if (t.id === "cv-custom") convertForm.custom = t.value;
  else return;
  $("#cv-out").innerHTML = conversionOutput(convertForm); // live update without losing focus
  $("#cv-cmp").innerHTML = comparison(convertForm);
});

document.addEventListener("change", (e) => {
  if (e.target.id === "cv-from") { convertForm.from = e.target.value; render(); }
  else if (e.target.id === "cv-to") { convertForm.to = e.target.value; render(); }
});

setInterval(() => { if (document.visibilityState === "visible") refreshRates(); }, REFRESH_MS);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshRates(); });
window.addEventListener("online", refreshRates);
window.addEventListener("offline", renderStatus);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
render();
refreshRates();

// Ask the browser not to evict our storage, and restore from the IndexedDB copy
// if localStorage was wiped while the app still has its second copy.
navigator.storage?.persist?.().catch(() => {});
idbLoad().then((saved) => {
  if (!saved) return;
  const hasData = saved.transactions.length || saved.goals.length;
  // localStorage wiped -> restore; both present -> keep whichever copy is newer
  if (hadLocal ? (saved.rev || 0) > (state.rev || 0) : hasData) { state = saved; persist(); render(); }
});
