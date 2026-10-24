# Mis Finanzas VE

PWA de finanzas personales para Venezuela, pensada para iPhone. Sin build, sin dependencias, sin servidor propio.

## Funciones

- **Tasas**: BCV dólar, BCV euro y Binance P2P (USDT/VES), con brecha Binance vs BCV, antigüedad del dato, actualización automática cada 60 s (y al volver a abrir la app) y edición manual.
- **Movimientos**: ingresos y egresos en USD, EUR o Bs., con categoría, nota y fecha; balance por moneda y total valorado en USD (con tasa BCV o Binance a elección).
- **Convertir**: cualquier combinación USD/EUR/Bs. con tasa BCV, Binance o personalizada, y comparación entre fuentes.
- **Deudas**: lo que debes y lo que te deben, con abonos, vencimientos y balance neto en USD; los abonos pueden registrarse también en Movimientos.
- **Metas de ahorro**: objetivo en USD, fecha límite opcional, aportes, progreso y cuánto ahorrar al mes.
- Funciona offline (service worker) y se puede exportar/importar un respaldo JSON.

## Instalar en el iPhone

1. Publica la carpeta en cualquier hosting estático con HTTPS (GitHub Pages, Netlify, Cloudflare Pages…). Los service workers y la instalación requieren HTTPS.
2. Abre la URL en **Safari** → Compartir → **Añadir a pantalla de inicio**.

Local: `npm start` (sirve en http://localhost:8080) y `npm test` para las pruebas.

## Fuentes de tasas — leer esto

Ninguna fuente fue verificada contra documentación oficial desde el entorno de desarrollo (sin acceso de red a esos hosts). El BCV no publica una API JSON oficial.

| Tasa | Fuente usada | Estado |
|---|---|---|
| BCV USD / EUR | `https://ve.dolarapi.com/v1/dolares` y `/v1/euros` (servicio comunitario, campo `fuente: "oficial"`) | **Sin verificar en vivo** |
| Binance | `POST https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search` (endpoint web no documentado; promedio de los 5 primeros anuncios de compra) | **No oficial; el navegador probablemente lo bloquee por CORS** |
| Binance (respaldo) | Tasa `paralelo` de DolarApi, marcada "aproximada" | Sin verificar |

Cada fuente falla por separado: si una cae, se muestra el último valor guardado con su antigüedad y el error, o puedes fijar la tasa a mano. Si el CORS de Binance bloquea la llamada (lo esperable), la solución robusta es un pequeño proxy propio (Cloudflare Worker) que consulte Binance y devuelva el JSON; está pendiente.

## Datos y privacidad

Los datos se guardan en el iPhone en dos copias (`localStorage` e IndexedDB); si iOS borra una, la app se recupera de la otra, y pide al navegador almacenamiento persistente. Instalada en la pantalla de inicio, iOS la trata mucho mejor que en una pestaña de Safari.

Eso **no** protege contra borrar la app, cambiar de teléfono o limpiar los datos del sitio. Para eso están el respaldo (se guarda en Archivos / iCloud Drive con la hoja de compartir) y un aviso cada 7 días. Sincronización automática entre dispositivos requeriría cuentas y backend; no existe todavía.

Los montos se guardan como enteros (centavos) y las tasas con 8 decimales usando `BigInt`; no se usa coma flotante para dinero.

## Pendiente / ideas

- Proxy propio para Binance P2P y para BCV (más fiable que servicios de terceros).
- Sincronización entre dispositivos y notificaciones push (requieren backend).
- Editar movimientos; categorías propias; gráficos.
