# Plan detallado — Fase B "Modo Jefe"

**Fecha:** 2026-09-29 · **Aprobado por:** luigi
**Objetivo:** la vista Supervisión se convierte en el monitor del dueño: lo más
detallado posible en lo monetario, con pulso en vivo de las ventas.

## B1. Renombre supervisor → administrador

**Motivo:** hoy conviven tres nombres para lo mismo — `ADMIN` guardado,
"supervisor" en código/docs y "Administrador" en la UI — y "supervisor" además
era el nombre del modo pairing congelado. Se unifica a la terna de luigi:
**dueño, administrador, cajero**.

- `src/utils/roles.js`: `ROL_SUPERVISOR`→`ROL_ADMINISTRADOR`,
  `isSupervisor`→`isAdministrador`, `TABS_DUENO_SUPERVISOR`→`TABS_DUENO_ADMIN`,
  docs actualizados. **Los valores `'ADMIN'`/`'CAJERO'` no cambian** (compat con
  datos guardados). Se dejan alias deprecated una versión.
- `src/views/SupervisionView.jsx`, `tests/roles.test.js`: actualizar imports.
- UI: `UsersManager.jsx` (label 'Supervisor'→'Administrador'),
  `UserCard.jsx` ('Supervisor'→'Administrador'), comentario en LockScreen.
- NO tocar: `services/supervisor*.js` y `tests/supervisorSync.test.js` (modo
  pairing congelado, otro concepto).

## B2. Motor monetario `src/utils/modoJefe.js` (puro, testeable)

Lee los mismos registros de `bodega_sales_v1`. Criterios heredados de
`useDashboardMetrics` (excluir `ANULADA` y `cajaCerrada`, mismos tipos).

| Función | Qué calcula |
|---|---|
| `resumenPlataHoy(sales, today)` | Total USD, # tickets, ticket prom., desglose por moneda de pago (USD/Bs/COP desde `payments[]`), desglose por método (`methodLabel`), descuentos (monto + #), anuladas (# + monto) |
| `fiadosHoy(sales, today)` | Otorgados (`VENTA_FIADA.fiadoUsd`) vs cobrados (`COBRO_DEUDA` + `COBRO_CASHEA`) |
| `movimientoCajaHoy(sales, today)` | Apertura + ingresos − egresos (`afectaCaja !== false`) = efectivo esperado |
| `feedVentas(sales, limit=10)` | Últimas ventas desc: hora, total, método principal, cliente, tipo |
| `resumenDia(sales, dateStr)` | Total + # para comparativas (ayer, hace 7 días) |
| `alertasJefe(sales, today)` | Anuladas hoy, descuento ≥15% o ≥$5 en un ticket, día sin apertura de caja |

**Límites honestos de Fase B:** sin vendedor por ticket (la venta no estampa
usuario; vive en el audit log — se evalúa en Fase C), sin multi-dispositivo en
vivo (requiere sync a nube; hoy el monitor lee el dispositivo local).

## B3. UI en `SupervisionView.jsx` (dueño y administrador)

Dentro de `SedePanel` (sirve a ambos: el dueño la ve por sede y el
administrador solo la suya):

1. **Plata de hoy** — total USD + tickets + ticket prom.; desglose por moneda
   (USD / Bs / COP) y por método de pago.
2. **En vivo** — feed de últimas 10 ventas con hora, monto, método y cliente.
3. **Ojo de jefe** — descuentos otorgados, anuladas, egresos, efectivo esperado.
4. **Fiados en movimiento** — otorgados vs cobrados hoy.
5. **Comparativas** — hoy vs ayer vs hace 7 días.
6. **Alertas** — lista de `alertasJefe`.

Consolidado del dueño: agrega los bloques 1, 3 y 4 sumando sedes + ranking.

**Railes (guardrails):**
- R1 Solo lectura: el monitor solo usa `readNegocioData` (`getItem`, jamás
  escritura). Ningún botón del Modo Jefe muta datos.
- R2 Polling con freno: refresco cada 10 s solo con la vista activa y la
  pestaña visible (`document.hidden` pausa); limpieza en unmount.
- R3 Números a prueba de NaN: helper `num()` (NaN→0), sin divisiones por cero.
- R4 Gate de rol: el cajero nunca recibe el tab `supervision`
  (`TABS_CAJERO`); el dueño ve todo, el administrador solo su sede.
- R5 Frescura visible: badge "actualizado hace Xs" en el feed.

**Reglas UI de luigi:** todo redondeado, sin `<select>` nativo, una sola señal
de foco, iconos lucide (sin emojis), sin alert/confirm/prompt.

## B4. Arneses (tests)

`tests/modoJefe.test.js` con ventas fixture: contado multi-método, fiada,
anulada, cobro de deuda, gasto interno (con y sin `afectaCaja`), apertura de
caja, descuento. Aserciones: totales, desgloses por moneda/método, fiados,
caja esperada, orden del feed, comparativas y cada tipo de alerta. El motor
debe quedar en 100% de ramas cubiertas por fixtures.

## B5. Cierre

- `bitacora.md`: entrada Fase B. `ROADMAP.md`: marcar Fase B.
- Build verde + suite vitest sin regresiones (el fallo preexistente de
  `receivablesDeterministic.test.js`, sensible a fecha, se deja documentado).
- Push a `main` + deploy a producción + verificación del bundle.

## Fuera de alcance (Fase C)

Vendedor por ticket (audit log), en vivo multi-dispositivo (Supabase realtime),
umbrales de alerta configurables por negocio.
