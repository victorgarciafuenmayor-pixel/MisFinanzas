// Local persistence (localStorage). BigInt values are stored as strings.
// iOS can evict web storage for rarely-used sites, so export/import is provided.

const KEY = "vef.state.v1";

export const defaultState = () => ({
  rev: 0, // bumped on every save; lets us tell which of the two stored copies is newer
  transactions: [], // {id,type:'income'|'expense',amountMinor,currency,category,note,date}
  debts: [], // {id,type:'owe'|'owed',person,currency,principalMinor,dueDate|null,note,payments:[{id,date,amountMinor,txId|null}]}
  goals: [], // {id,name,targetMinor(USD),deadline|null,contributions:[{id,date,amountMinor}]}
  rates: { bcvUsd: null, bcvEur: null, binance: null }, // {value:string,updatedAt,source,manual?}
  settings: { valuation: "bcv", customCats: { income: [], expense: [] }, lastBackup: null, parallelAdjust: "" }, // which USD rate values the VES balance: 'bcv' | 'binance'
});

export function load(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return defaultState();
    return normalize(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

export function hasLocal(storage = globalThis.localStorage) {
  try { return storage.getItem(KEY) !== null; } catch { return false; }
}

export function save(state, storage = globalThis.localStorage) {
  state.rev = (state.rev || 0) + 1;
  const json = JSON.stringify(state);
  idbSet(json); // second copy: survives when localStorage alone is cleared
  try { storage.setItem(KEY, json); return true; } catch { return false; }
}

// --- IndexedDB mirror (best effort; every call resolves, never throws) ---
const idb = () => new Promise((resolve) => {
  try {
    const req = indexedDB.open("vef", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  } catch { resolve(null); }
});

// Writes are chained so a slow older write can never land after a newer one.
let idbChain = Promise.resolve();
export function idbSet(json) {
  idbChain = idbChain.then(() => idbWrite(json));
  return idbChain;
}

async function idbWrite(json) {
  const db = await idb();
  if (!db) return false;
  return new Promise((resolve) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(json, KEY);
    tx.oncomplete = () => { db.close(); resolve(true); };
    tx.onerror = tx.onabort = () => { db.close(); resolve(false); };
  });
}

export async function idbLoad() {
  const db = await idb();
  if (!db) return null;
  return new Promise((resolve) => {
    const req = db.transaction("kv").objectStore("kv").get(KEY);
    req.onsuccess = () => { db.close(); try { resolve(req.result ? normalize(JSON.parse(req.result)) : null); } catch { resolve(null); } };
    req.onerror = () => { db.close(); resolve(null); };
  });
}

export function normalize(obj) {
  const d = defaultState();
  const s = { ...d, ...obj, rates: { ...d.rates, ...(obj?.rates || {}) }, settings: { ...d.settings, ...(obj?.settings || {}) } };
  s.settings.customCats = { ...d.settings.customCats, ...(s.settings.customCats || {}) };
  s.transactions = Array.isArray(s.transactions) ? s.transactions.filter((t) => t && /^\d+$/.test(String(t.amountMinor))) : [];
  s.goals = Array.isArray(s.goals)
    ? s.goals.filter((g) => g && /^\d+$/.test(String(g.targetMinor))).map((g) => ({ ...g, contributions: Array.isArray(g.contributions) ? g.contributions : [] }))
    : [];
  s.debts = Array.isArray(s.debts)
    ? s.debts.filter((d) => d && /^\d+$/.test(String(d.principalMinor)) && ['owe', 'owed'].includes(d.type)).map((d) => ({ ...d, payments: Array.isArray(d.payments) ? d.payments.filter((p) => p && /^\d+$/.test(String(p.amountMinor))) : [] }))
    : [];
  return s;
}

export const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
