# Plan de fix: ventas delta append-only (QUOTA-003)

**Fecha:** 2026-10-01 · **Repo:** `preciosaldia-multilocal` · **Estado:** PLAN (pendiente aprobación de luigi)

## 1. Problema verificado

Prueba determinista `estacion-2026/scripts/capacity_free_tier.mjs` (semilla `20261001`, MD5 estable entre corridas) con los números reales del cliente (200 ventas/día entre 2 locales, 100 por vendedor):

| Métrica | Hoy | Límite gratis | Estado |
|---|---|---|---|
| DB a 12 meses | 40 MB | 500 MB | ✅ 8% |
| Egress mensual realista | **46.6 GB** | 5 GB/mes | ⛔ 910% |
| Egress mensual peor caso | 111.8 GB | 5 GB/mes | ⛔ 2183% |

**Causa raíz:** cada venta re-sube la ventana completa de 90 días de `bodega_sales_v1` (~16 MB por push con 100 ventas/día). La poda a 90 días (`pruneSalesForSync`, QUOTA-002) acota la **DB** pero **no el tráfico**: el push sigue siendo O(ventana) en vez de O(delta).

Desglose del egress (realista): pushes vendedores 32 GB · arranques 6.5 GB · refresh supervisor 7.8 GB · catálogo 184 MB.

## 2. Solución: delta append-only de ventas

**Idea:** el vendedor solo sube los tickets **nuevos** desde el último push confirmado. El receptor fusiona por ID (`mergeSales` ya existe y funciona).

### 2.1 Nueva key de sync: `bodega_sales_delta_v1`

```js
// payload del delta (lo único que viaja en cada venta)
{
  date: '2026-10-01',       // día del negocio; al cambiar, el delta arranca vacío
  deviceId: 'PDA-V2-…',
  tickets: [ /* solo tickets NO confirmados en la nube */ ]
}
```

- **Push por venta:** ~2–6 KB (1–3 tickets nuevos) en vez de ~16 MB.
- **Al confirmar el push:** se vacía el delta local.
- **Si el push falla:** el delta se acumula y viaja en el próximo push (no se pierde nada).

### 2.2 Flujo del vendedor (equipos 1 y 2)

1. Se completa una venta → el ticket se agrega al array local completo (`bodega_sales_v1`, sin cambios) **y** al delta pendiente.
2. `queueCloudSync('bodega_sales_delta_v1')` con el debounce actual de 3000 ms.
3. El push sube **solo el delta**. Al confirmar, se limpia el delta local.
4. `bodega_stock_v1` sigue viajando igual (mapa liviano, ~30 KB — ya es delta).

### 2.3 Flujo del receptor / supervisor (equipos 5 y 6)

1. Al recibir un delta: `mergeSales(delta.tickets, ventasLocales)` — unión por ID, gana la más nueva. **Ya existe**, no se toca.
2. El monitor en vivo se suscribe a los deltas (realtime) en vez de al doc de 90 días: cada venta nueva llega en segundos y pesa KB, no MB.
3. El "refresh" del supervisor trae los deltas del día de cada vendedor (~180 KB al cierre del día), no la ventana de 90 días.

### 2.4 La ventana de 90 días no desaparece

`bodega_sales_v1` (podado a 90 días) **se sigue generando**, pero solo se sube:
- **1 vez al día** al cierre (batch nocturno), o
- **bajo demanda** cuando un supervisor pide ver historial completo.

El historial de largo plazo vive donde ya vive hoy: **respaldos manuales comprimidos** (`cloud_backups`).

## 3. Cambios por archivo

| Archivo | Cambio |
|---|---|
| `src/utils/syncDelta.js` | `buildSalesDelta(tickets)`, `clearSalesDelta()`, `isSalesDeltaKey()` |
| `src/hooks/useCloudSync.js` | En el push: si la key es `bodega_sales_v1`, subir el **delta** en `bodega_sales_delta_v1`; limpiar delta al confirmar; push nocturno/bajo demanda de la ventana completa |
| `src/hooks/useMonitorSync.js` | Suscribirse a `bodega_sales_delta_v1` para el feed en vivo; `mergeSales` al recibir (ya existe) |
| `src/utils/retentionPolicy.js` | Sin cambios (90 días sigue para la ventana) |
| `src/services/storageService.js` | Registrar la nueva key en el pipeline de sync si aplica |

**No hay migración de DB.** `sync_documents` acepta cualquier `doc_id`; el delta es una key nueva.

## 4. Casos borde

| Caso | Manejo |
|---|---|
| Push falla (sin internet) | El delta se acumula local; viaja completo en el próximo push exitoso |
| Cambio de día a mitad de turno | El delta lleva `date`; si cambia, se abre un delta nuevo (el viejo se sube antes) |
| Dos vendedores, mismo ticket ID | Imposible: los IDs llevan prefijo de equipo |
| Supervisor abre a mitad del día | Pull de deltas del día + ventana completa solo si pide historial |
| Vendedor reinstala la app | Restaura del respaldo (`cloud_backups`); los deltas perdidos se regeneran del array local |

## 5. Números con el fix (verificados en la prueba)

| Componente | Tráfico/mes |
|---|---|
| Delta vendedores (2) | 11 MB |
| Pull supervisor (2 × 4 refresh/día) | 86 MB |
| Stock maps | 57 MB |
| Catálogo (carga de productos) | 184 MB |
| **TOTAL** | **339 MB** ✅ (6.8% de 5 GB) |

**Reducción: 138x** vs los 46.6 GB actuales.

## 6. Validación

1. Re-ejecutar `capacity_free_tier.mjs` (ya incluye S7 con el modelo del fix) y confirmar MD5 estable.
2. Batería E2E nueva sobre el proyecto del cliente:
   - Vendedor A vende 5 tickets → delta sube solo esos 5.
   - Supervisor ve los 5 en el monitor en vivo.
   - Vendedor B vende 3 → el supervisor ve 8 (merge por ID, sin duplicados).
   - Corte de internet en A → vende 2 offline → al reconectar, el delta viaja con los 2.
   - Push nocturno: la ventana de 90 días se genera sin bloquear ventas.
3. Medir tamaño real de 10 pushes de delta en staging.

## 7. Rollout

1. Implementar en rama `fix/quota-003-sales-delta`.
2. E2E en el proyecto del cliente (sandbox contra `oshexsmweswzbwaksvra`).
3. Deploy a producción con autorización de luigi.
4. Monitorear `sync_documents` (tamaño de docs) los primeros 3 días.
5. Entrada en `bitacora.md` + aprendizaje en `inteligencia.md` (regla permanente del repo).

## 8. Lo que NO cambia

- El array local de ventas (fuente de verdad en el equipo).
- La poda a 90 días para la ventana.
- El mapa de stock (ya es delta).
- El tope de 6 equipos, licencias, CloudGate.
- Los respaldos manuales.
