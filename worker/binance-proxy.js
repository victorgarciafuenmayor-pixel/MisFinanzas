// Cloudflare Worker: consulta los anuncios de COMPRA de USDT/VES en Binance P2P
// y devuelve el JSON con CORS abierto para que la app pueda leerlo.
// Endpoint web de Binance no documentado oficialmente: puede cambiar o bloquear.
const URL_BINANCE = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS" };

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      const res = await fetch(URL_BINANCE, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0" },
        body: JSON.stringify({
          fiat: "VES", asset: "USDT", tradeType: "BUY", page: 1, rows: 10,
          publisherType: null, payTypes: [], countries: [], proMerchantAds: false, shieldMerchantAds: false,
        }),
      });
      return new Response(res.body, {
        status: res.status,
        headers: { ...CORS, "content-type": "application/json", "cache-control": "public, max-age=20" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: "upstream" }), { status: 502, headers: { ...CORS, "content-type": "application/json" } });
    }
  },
};
