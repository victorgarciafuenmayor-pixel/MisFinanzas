// Exchange-rate sources. BCV has no official public JSON API, so BCV rates come
// from the community DolarApi Venezuela service; Binance P2P uses the public
// (undocumented) web endpoint. NONE of these endpoints is officially guaranteed:
// every source fails independently and the UI falls back to the last cached
// value or a manual override. See README "Fuentes de tasas".

import { parseRate } from "./money.js";

export const SOURCES = {
  dolares: "https://ve.dolarapi.com/v1/dolares",
  euros: "https://ve.dolarapi.com/v1/euros",
  binance: "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search",
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

/** Average of the first `n` advert prices (exact BigInt math). */
export function parseBinanceP2P(json, n = 5) {
  const ads = json && Array.isArray(json.data) ? json.data : null;
  if (!ads || !ads.length) throw new Error("sin anuncios");
  const prices = ads.slice(0, n).map((a) => parseRate(a?.adv?.price)).filter((p) => p !== null);
  if (!prices.length) throw new Error("precios inválidos");
  const sum = prices.reduce((a, b) => a + b, 0n);
  return { value: sum / BigInt(prices.length), updatedAt: Date.now() };
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

const BINANCE_BODY = JSON.stringify({
  fiat: "VES", asset: "USDT", tradeType: "BUY", page: 1, rows: 5,
  publisherType: null, payTypes: [], countries: [], proMerchantAds: false, shieldMerchantAds: false,
});

/**
 * Fetches all sources independently. Resolves to
 * { bcvUsd, bcvEur, binance } where each is {value, updatedAt, source} or {error}.
 * Binance falls back to the DolarApi "paralelo" rate if the P2P endpoint is unreachable
 * (browsers may block it by CORS); the fallback is labelled in `source`.
 */
export async function fetchRates() {
  const [dol, eur, bin] = await Promise.allSettled([
    getJson(SOURCES.dolares),
    getJson(SOURCES.euros),
    getJson(SOURCES.binance, { method: "POST", headers: { "content-type": "application/json" }, body: BINANCE_BODY }),
  ]);
  const wrap = (settled, parse, source) => {
    if (settled.status !== "fulfilled") return { error: settled.reason?.message || "sin conexión" };
    try { return { ...parse(settled.value), source }; } catch (e) { return { error: e.message }; }
  };
  const bcvUsd = wrap(dol, (j) => parseDolarApi(j, "oficial"), "BCV oficial");
  const bcvEur = wrap(eur, (j) => parseDolarApi(j, "oficial"), "BCV oficial");
  let binance = wrap(bin, (j) => parseBinanceP2P(j), "Binance P2P");
  if (binance.error && dol.status === "fulfilled") {
    const alt = wrap(dol, (j) => parseDolarApi(j, "paralelo"), "Mercado paralelo");
    if (!alt.error) binance = { ...alt, approx: true };
  }
  return { bcvUsd, bcvEur, binance };
}
