# Procedimiento: baseline de inventario en la nube

Objetivo: que la nube tenga un inventario verificado como única fuente de verdad, y que cada equipo lo adopte sin reintroducir stock viejo ni eco de deltas.

Respaldo de referencia: `backup_bodega_cierre_2026-10-08_stock_y_costos_ajustados_stock_sin_negativos.json` (exportado 2026-10-09 07:10 UTC).

## Corte

- `counted_at` = **2026-10-09T03:59:59Z** (fin del cierre del 8/10, hora Venezuela UTC-4).
- Las ventas del respaldo no tienen registros posteriores a ese corte (verificado: 0 ventas después de 03:59:59Z).
- Cualquier venta posterior al corte en cualquier equipo debe contarse **después** del baseline como movimiento, no reemplazarse.

## Fase 0: validar el respaldo (sin tocar la nube)

Se comprueba con un script de solo lectura antes de cargar nada.

| Control | Valor esperado | Resultado en el respaldo |
|---|---|---|
| Productos | 2433, ids únicos | 2433 ✅ |
| Stock no finito o desproporcionado | 0 | 0 ✅ |
| Stock negativo | 0 | 0 ✅ |
| Fraccionarios en productos no granel | 0 | 111 fraccionarios: **revisar** que sean granel |
| Suma de unidades | 36211.07 | 36211.07 ✅ |
| Valoración a precio de venta | igual a la del app | 37,336.82 calculado; el app muestra 37,272.82 → **diferencia de $64.00 sin explicar** |
| Nombres duplicados | revisar | 29 nombres repetidos con ids distintos |

**Gate 0:** no avanzar hasta explicar la diferencia de $64.00 (probablemente precio `priceUsdt` vs `priceUsd` en la fórmula) y revisar los 111 fraccionarios. La regla de valoración debe ser la misma que `inventoryMetrics` del dashboard.

## Fase 1: fijar el baseline en la nube

Requiere la migración `007_stock_ledger.sql` aplicada (hoy es borrador).

1. Aplicar 007 en Supabase local y validarla con dos dispositivos (pendiente).
2. Como **dueño de la cuenta**, llamar `set_stock_baseline(negocio_id, '2026-10-09T03:59:59Z', counts)` con `counts = [{product_id, qty}]` tomado del respaldo validado.
3. **Gate 1:** `get_stock(negocio_id)` debe devolver la suma 36211.07 y 1292 productos en cero, igual que el respaldo.

Si 007 aún no está lista, la alternativa interina es publicar el respaldo como catálogo y marcar una **época de stock** nueva. Esa vía reintroduce deltas y es menos segura; solo como puente.

## Fase 2: cada equipo adopta el baseline

Antes de adoptar, en cada equipo:

1. **Vaciar la cola offline del protocolo viejo** (`pda_cloud_sync_outbox_v1` entradas de stock). Esas entradas son mapas absolutos del protocolo anterior.
2. **Conservar las ventas locales posteriores al corte.** Exportarlas como movimientos con su `client_created_at` original. No descartarlas.
3. **Reiniciar el estado de deltas:** borrar `pda_stock_received_*` y `pda_stock_lastremote_*`.
4. **Adoptar el stock de la nube** por id de producto (`stockBaseAfterAdoption`): el stock propio queda en cero.
5. **Reenviar** las ventas posteriores al corte como movimientos con `movement_id` único.

**Gate 2 por equipo:** el total de unidades y la valoración del equipo deben coincidir con `get_stock`. Si no coinciden, no se marca como adoptado.

## Fase 3: verificación

- Dos equipos vendiendo a la vez: los totales convergen y no hay NaN ni valores absurdos.
- Desconectar un equipo, vender, reconectar: sus movimientos se suman una sola vez (idempotencia por `movement_id`).
- "Más vendidos" solo muestra productos del inventario actual (ya corregido en local, pendiente de desplegar).

## Rollback

- El ledger es append-only: el baseline anterior se puede restaurar fijando de nuevo los valores previos con `set_stock_baseline`.
- No borrar `stock_movements` en ningún caso.

## Pendiente antes de ejecutar

- Explicar la diferencia de $64.00 en la valoración.
- Revisar los 111 fraccionarios y los 29 nombres duplicados.
- Aplicar y probar la migración 007 en Supabase local.
- Confirmar que `account_devices.user_id` identifica al dueño.
