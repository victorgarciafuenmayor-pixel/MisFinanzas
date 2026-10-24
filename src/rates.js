// Exchange-rate sources. BCV has no official public JSON API, so BCV rates come
// from the community DolarApi Venezuela service, and so does the parallel-market
// rate used as the Binance reference (Binance blocks server-side and browser
// access to its P2P ads). NONE of these endpoints is officially guaranteed:
// every source fails independently and the UI falls back to the last cached
// value or a manual override. See README "Fuentes de tasas".

import { parseRate } from "./money.js";

export const SOURCES = {
  dolares: "https://ve.dolarapi.com/v1/dolares",
  euros: "https://ve.dolarapi.com/v1/euros",
};

/** Picks the entry whose `fuente` matches and returns {value, updatedAt}. */
export function parseDolarApi(list, fuente) {
  if (!Array.isArray(list)) throw new Error("respuesta inesperada");
  const item = list.find((x) => x && x.fuente === fuente);
  if (!item) throw new Error(`sin fuente "${fuente}"`);
  const value = parseRate(item.promedio ?? item.venta ?? item.precio);
  if (value === null) throw new Error("tasa inválida");
  return { value, updatedAt: item.fechaActualizacion ? Date.parse(item.fechaActualizacion) || Date.now() : Date.now() };
}

async function getJson(url, init, timeoutMs = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches all sources independently. Resolves to { bcvUsd, bcvEur, binance } where each is
 * {value, updatedAt, source} or {error}. `binance` is the parallel-market rate from DolarApi
 * plus a user-configured adjustment (bigint, scaled 1e8), because the P2P ads themselves are not reachable.
 */
export async function fetchRates({ parallelAdjust = 0n } = {}) {
  const [dol, eur] = await Promise.allSettled([getJson(SOURCES.dolares), getJson(SOURCES.euros)]);
  const wrap = (settled, parse, source) => {
    if (settled.status !== "fulfilled") return { error: settled.reason?.message || "sin conexión" };
    try { return { ...parse(settled.value), source }; } catch (e) { return { error: e.message }; }
  };
  const bcvUsd = wrap(dol, (j) => parseDolarApi(j, "oficial"), "BCV oficial");
  const bcvEur = wrap(eur, (j) => parseDolarApi(j, "oficial"), "BCV oficial");
  const par = wrap(dol, (j) => parseDolarApi(j, "paralelo"), "Paralelo · referencia de Binance");
  const binance = par.error ? par : { ...par, value: par.value + parallelAdjust };
  return { bcvUsd, bcvEur, binance };
}
