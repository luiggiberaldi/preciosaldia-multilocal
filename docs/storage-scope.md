# Alcance del storage — Fase 1 multi-negocio

Este documento define qué claves viven **por negocio** y cuáles son
**globales** en PreciosAlDía. Regla de oro: **ningún dato operativo de un
negocio puede leerse ni escribirse desde otro**.

## Namespacing

- **IndexedDB / localStorage (contingencia):** `nb_<negocioId>:<clave>`.
- **Supabase `sync_documents.doc_id`:** `nb_<negocioId>:<clave>`
  (la columna `collection` —`store`/`local`— ya existía y no se duplica).
- Las claves globales viajan **sin prefijo**, igual que antes.

## Claves GLOBALES (compartidas por todos los negocios)

| Clave | Por qué es global |
|---|---|
| `pda-negocios-registry` | El registro de negocios en sí (quién existe, cuál está activo) |
| `pda-pairing-*`, identidad del dispositivo | El dispositivo es uno, no por negocio |
| `monitor_rates_v12`, `bodega_custom_rate`, `bodega_rate_mode`, `bodega_use_auto_rate` | Las tasas son del mercado, no del negocio |
| `pda_license_*`, preferencias de dispositivo | Licencia por instalación |
| `business_*` | **Espejo fiscal** del negocio activo (compatibilidad con recibos/impresora que ya leían estas claves) |
| `pda_terms_accepted`, flags de migración | Estado del dispositivo |

## Claves POR NEGOCIO (todo lo demás)

Productos, ventas, fiados/clientes, caja, inventario, gastos, usuarios PIN,
sesión (`abasto-auth-storage`), sombras de backup, metadata de sync
(`sync_metadata_*`, hash de último push por `doc_id`), cola de reintentos.

**Excepción de seguridad (SEC-002):** `abasto-auth-storage` nunca sale a la
nube; el monitor rechaza sus documentos aunque lleguen.

## Reglas de sync cloud

- Push: `doc_id = nb_<negocioId>:<clave>`; globales sin prefijo.
- Pull/aplicar: solo documentos del negocio activo o globales
  (`isDocForActiveBusiness()`). Los documentos legacy sin prefijo (pre-Fase 1)
  que no sean globales se ignoran; el push local los re-publica namespaced.
- **Monitor:** acepta documentos de *cualquier* negocio del primario pareado
  (es su única fuente) y los escribe con el `doc_id` completo para no
  mezclarlos con los datos propios del monitor. Limitación Fase 1: muestra bien
  los datos cuando ambos dispositivos usan el mismo id de negocio
  (caso común: `neg-1` en instalaciones frescas).

## Reglas de backup / restauración

- Exportar: solo el negocio activo (las lecturas ya van enrutadas).
- Restaurar (archivo, P2P, nube): escribe vía `appForage` → namespace activo.
- Restaurar **nunca** toca otros negocios.
- Desvincular monitor: borra solo claves `nb_*` (datos del primario),
  preserva el registro de negocios y las globales.

## Datos fiscales

- Fuente de verdad: el **registro de negocios** (`nombre`, `rif`, `direccion`,
  `telefono`).
- `business_*` es un **espejo** refrescado por `syncFiscalMirror()` al
  activar/actualizar un negocio. Los recibos, la impresora y los reportes
  siguen leyendo el espejo sin cambios.
- Los formularios (Ajustes, términos iniciales) escriben en el registro, no en
  el espejo directamente.
