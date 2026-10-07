# Auditoría E2E de Flujos (AUDIT-E2E-001)

**Fecha**: 2026-09-20 · **Alcance**: recorrido de los flujos reales de la app en móvil
(360×740, offline, estado sembrado) con captura de errores, respuestas HTTP y
desbordes horizontales.

**Cómo reproducirla**

```bash
bunx playwright test tests/e2e/auditoria-flujos.e2e.spec.js   # o: bun run test:e2e:auditoria
```

Evidencia cruda: `test-results/auditoria-flujos.json` (una fila por verificación),
más capturas/traza de Playwright cuando algo falla.

## Resultado global

| Métrica | Valor |
|---|---|
| Flujos auditados | **14** (F1–F12 + F3b y F12b) |
| Verificaciones registradas | 45 |
| Flujos verdes | 14/14 |
| Excepciones no capturadas (pageerror) | 0 |
| Respuestas locales ≥ 400 | 0 |
| Desbordes horizontales a 360 px | 0 (6 vistas + 5 secciones de Ajustes + cesta + resumen de cierre) |
| Hallazgos | **2 reales** (1 bug de React **corregido**, 1 decisión de semántica de cartera) + 1 falso hallazgo retirado + 1 nota de infra del arnés |

## Matriz de cobertura

| Flujo | Qué se verificó | Evidencia |
|---|---|---|
| **F1** Arranque + Inicio | La app levanta sin red, dashboard operativo, «Cerrar Caja» disponible, sin desborde | «Cerrar Caja» visible; 1 registro sembrado; 0 errores |
| **F2** Vender (cobro exacto) | Producto por búsqueda, cesta, cobro en USD, recibo y persistencia de la venta | `VENTA` de $3 con 2 ítems y 1 pago; recibo «Bs 120,00» (tasa 40) |
| **F3** Cliente nuevo + fiado + abono | Alta de cliente por UI, venta fiada con `fiadoUsd` correcto, deuda en cartera, abono en Bs que salda, ledger | deuda $0 → **$3** → **$0**; 1 movimiento `VENTA_FIADA` y 1 `COBRO_DEUDA` |
| **F3b** Fiado con saldo a favor | Semántica de cartera neta (ver hallazgo H2) | favor $18,50 → **$15,50**, deuda $0, ledger −$3 |
| **F4** Cesta viva | Editar el precio en Inventario se refleja en la cesta ya cargada, sin re-agregar el ítem | FAB «Ver Cesta» pasa de **$2,00 → $4,00** |
| **F5** Inventario | Alta de producto, persistencia real (recarga sin re-siembra) | producto $7,25 en IndexedDB (4 productos) y visible tras `reload()` |
| **F6** Reportes | Cuentas por cobrar con neto negativo + descarga del PDF real | sección `reporte-cuentas-por-cobrar` con neto **−$15,00** (fiado $10 / cobranzas $25); PDF **161,9 KB** |
| **F7** Cierre de caja | Wizard completo, arqueo coherente, registro del cierre y PDF | espera **$102,00** (apertura $100 + venta $2) y **Bs 4.000,00**; PDF **167,6 KB** con «RESUMEN DEL DÍA»; `REGISTRO_CIERRE #1` con `reconData`; 3 registros `cajaCerrada` |
| **F8** Ajustes | 5 secciones abren sin error ni desborde; flags de escape presentes | Negocio/Ventas/Usuarios/Licencia/Sistema ✅; flags «Fiados y cobranzas en el reporte», «Cesta viva», «Reparar cartera desde el ledger» |
| **F9** Navegación | Las 6 vistas de la barra inferior responden y ninguna desborda | Inicio/Vender/Inventario/Clientes/Reportes/Ajustes: 0 px de desborde |
| **F10** Anular venta + reciclaje | Anulación desde el historial de Reportes, stock devuelto, oferta de reciclaje del carrito | venta marcada **ANULADA**; stock 49 → **50**; oferta de reciclaje del ítem anulado |
| **F11** Gasto interno que afecta caja | Gasto de Bs 200 desde el dashboard y su efecto en el arqueo del cierre | bolsillo USD intacto ($100,00); bolsillo Bs **4.000 → 3.800** esperados por el sistema |
| **F12** Saldo a favor en checkout básico | Aplicar el favor del cliente como pago en el modal móvil (sección «Crédito interno») | venta de $5 pagada con saldo a favor; favor **$18,50 → $13,50**, deuda $0; pago interno `saldo_favor` registrado |
| **F12b** Saldo a favor en modo POS | Pago real de una venta de $5 con saldo a favor en el checkout POS | favor **$18,50 → $13,50**; venta con pago interno `saldo_favor` de $5 y **0** pagos en efectivo; sin desborde a 360 px |

## Hallazgos

### H1 · P2 — Hooks después de un `return` condicional (React) — ✅ CORREGIDO

`src/views/CustomersView.jsx` — `CustomerDetailSheet`:

```
function CustomerDetailSheet({ customer, isOpen, ... }) {
    if (!isOpen || !customer) return null;   // ← salida temprana
    const [historyPage, setHistoryPage] = useState(1);   // ← hook DESPUÉS
    useEffect(() => { setHistoryPage(1); }, [customer.id]);
```

Es una violación de las Reglas de los Hooks: al pasar de cerrado a abierto cambia la
cantidad de hooks entre renders. En runtime se manifiesta como error de consola
**«Internal React error: Expected static flag was missing. Please notify the React team.»**
en cuanto se abre el detalle del cliente (reproducido en el rastreo: Clientes → lista OK,
detalle → error). No rompe la pantalla hoy, pero es un desajuste de reconciliación: el
estado de la mini-paginación del historial puede quedar desincronizado.

*Corrección*: mover la salida temprana **debajo** de los hooks y usar `customer?.id` en la
dependencia. Es el único caso del repo (barrido sobre `components/` y `views/`).

> **Estado**: corregido y verificado con el arnés — F3 vuelve a correr sin errores de
> consola (el `finding` desapareció de la evidencia).

### H2 · P1 (semántica) — Un fiado a un cliente con saldo a favor no crea deuda

La cartera es un **saldo neto** (`favor − deuda`). Al fiar $3 a un cliente con $18,50 a
favor, el sistema **consume el saldo a favor** en vez de aumentar la deuda:

| | Antes | Después |
|---|---|---|
| `customer.favor` | 18,50 | **15,50** |
| `customer.deuda` | 0 | **0** |
| Ledger | — | movimiento `VENTA_FIADA` −$3, saldo 15,50 |

Ledger y snapshot **cuadran** (la posición neta es la misma), así que no hay descuadre
financiero. El riesgo es de lectura: cualquier superficie que sume `customer.deuda` como
«crédito otorgado» (cartera por cliente, listados de deudores) **no verá ese fiado**,
mientras el reporte de fiados sí lo cuenta. Es una decisión de producto: ¿fiar debe
ampliar la deuda bruta, o está bien que consuma primero el saldo a favor?

*Estado*: documentado y con test que lo reproduce; la **matemática no cambió**. Como
mitigación de UX, la venta congela la cartera previa (`walletSnapshot`) y el recibo ahora
muestra **«Saldo a favor aplicado: $X»** con la explicación, para que el fiado consumido
sea evidente en caja (verificado en F3b).

### H3 · RETIRADO — falso hallazgo: el checkout básico SÍ aplica el saldo a favor

El F12 original buscaba el texto de la wallet del POS («Saldo a Favor · Método de pago»)
para decidir si el modo básico ofrecía la función. No lo encontró y concluyó —mal— que
el checkout móvil no permitía usar el favor. En realidad el modal básico lo expone de
otra manera: como **sección «Crédito interno»** de las barras de pago
(`CheckoutPaymentBars`), con el método virtual `saldo_favor` y tope
`min(favor, pendiente)` ya implementados en `useCheckoutCalculations`.

El F12 corregido **usa la función de verdad**: aplica $5, confirma la venta y audita el
estado persistido (favor 18,50 → 13,50, deuda $0, pago interno registrado). F12b conserva
la cobertura del camino POS. Lección para el arnés: un «no aparece X» solo es hallazgo
después de descartar que la función viaje con otro nombre.

> **Estado**: retirado como hallazgo; sin cambio de producto. El test quedó como
> verificación e2e del pago con saldo a favor en modo básico.

### Nota de infra — el auto-backup apunta a producción desde cualquier entorno

Durante F4 el arnés capturó una llamada real del auto-backup a
`https://estacion-2026.vercel.app/api/backup/complete` **desde el entorno de prueba local**
(fallida por CORS, que es lo único que la contuvo). No es un bug de la app — es su
comportamiento configurado — pero implica que cualquier caja con el flag de auto-backup
activo habla con producción sin distinción de entorno, y que un E2E sin red neutralizada
podría escribir en el backend real. El arnés de auditoría ahora intercepta ese dominio;
valdría la pena un `VITE_BACKUP_API_URL` por entorno.

## Lo que esta auditoría NO cubre

- **Anulación de ventas con reciclaje de carrito**: cubierto (F10).
- **Egresos restantes**: pago a proveedores y autoconsumo (el gasto interno que afecta caja
  sí está cubierto en F11).
- **Avance de efectivo** y comisiones; **Cashea** con cliente y remesa (flag apagado en la siembra).
- **Vuelto complejo en el checkout** (el vuelto simple está cubierto por
  `checkout-movil.e2e.spec.js`, 12 casos; el pago con saldo a favor por F12b).
- **Respaldo/restauración**, wallet, licencia online, notificaciones y **sincronización con
  el Supervisor** (sus 4 specs exigen `SUPERVISOR_E2E_ENABLED=true` contra staging y quedan
  *skipped*: 11 casos).
- **Escritorio ≥1024 px**: la auditoría es mobile-first a 360 px.
- **Impresión física**: se valida el PDF generado, no la salida por impresora.

## Suites e2e ya existentes (contexto)

| Suite | Casos | Estado |
|---|---|---|
| `checkout-movil.e2e.spec.js` | 12 | ✅ verdes |
| `reportes-fiado.e2e.spec.js` | 2 | ✅ verdes |
| `auditoria-flujos.e2e.spec.js` (nueva) | 14 | ✅ verdes |
| `supervisor*.e2e.spec.js` | 11 | ⏭️ skipped (requieren staging) |

## Notas del arnés

- La siembra se apoya en `tests/e2e/helpers/seedBrowserState.js` y añade
  `tests/e2e/helpers/auditHarness.js` (colectores, medición de desborde, `readIdb`,
  registro del informe).
- Los errores de consola **del propio arnés** (fuentes/imágenes remotas que el test aborta
  a propósito) se filtran para que el informe solo traiga defectos del producto.
- `seedAudit(page, { reseedOnReload: false })` desactiva la re-siembra al recargar: sin eso,
  un `reload()` borraría los datos del flujo y la prueba de persistencia (F5) sería falsa.
- La medición de desborde ignora elementos `position: fixed` y los que viven dentro de un
  ancestro con scroll horizontal (carruseles/tablas), para no reportar falsos positivos.
- El dominio del auto-backup (`estacion-2026.vercel.app`) se intercepta: la auditoría no
  debe tocar producción jamás, ni siquiera de incognito.
