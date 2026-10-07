# PLAN — Sincronización multi-dispositivo en tiempo real (PreciosAlDía Pro)

**Objetivo:** las sedes vinculadas a una cuenta en Supabase reflejan los mismos datos en cualquier dispositivo (abrir la cuenta en otro teléfono = ver todo), el jefe monitorea ventas en tiempo real, y un cambio hecho por el admin se propaga a todos los dispositivos.

**Restricción dura:** todo debe caber en el **tier gratis de Supabase**, sin pagar.

---

## 1. Límites del tier gratis (los que mandan en el diseño)

| Recurso | Límite gratis | Implicación |
|---|---|---|
| Base de datos | 500 MB | Sobra: el JSON de una bodega (productos, ventas, fiados) pesa KB–pocos MB |
| Ancho de banda | 2 GB/mes | Sobra si solo viajan deltas JSON; prohibido mandar imágenes por realtime |
| Realtime: conexiones concurrentes | 200 | Sobra: son 2–10 dispositivos por cuenta |
| Realtime: mensajes | 2 M/mes | Sobra con eventos livianos (~1 msg por ticket); prohibido emitir por cada tecla |
| Usuarios activos mensuales | 50.000 | Sobra |
| Edge Functions | 500.000 inv/mes | Evitarlas si se puede; todo con PostgREST + Realtime directo |
| Pausa por inactividad | el proyecto se duerme tras 1 semana sin uso | El primer sync tras días apagado tarda ~10–30 s en despertar; la app debe mostrar "conectando…" y seguir usable offline |

**Regla de oro:** la nube es espejo, no fuente de verdad. IndexedDB local sigue mandando para lectura y operación; si no hay red, todo funciona y se sincroniza después.

---

## 2. Arquitectura

### 2.1 Cuenta y dispositivos
- **Una cuenta = un dueño** (Supabase Auth, email + contraseña). El dueño es quien ve todas las sedes.
- **Vinculación por código de 6 dígitos** (tabla `device_pairings` ya existe): en el dispositivo principal el admin genera un código válido por 10 min; en el dispositivo nuevo se ingresa y queda emparejado a la cuenta. Sin escanear QR ni meter la contraseña en cada caja.
- **PIN local intacto:** desbloqueo rápido por rol (Administrador/Cajero) como hoy; la sesión de Supabase vive aparte y se renueva sola.

### 2.2 Modelo de datos (reusa lo que hay)
- `sync_documents`: un documento JSON por negocio/sede (`account_id`, `business_id`, `doc_type`, `data`, `updated_at`, `version`). Ya existe; solo se le agrega `account_id` + índice.
- RLS estricto: cada cuenta solo lee/escribe sus documentos (`auth.uid() = account_id`). El cajero nunca toca Supabase directo: sus cambios suben vía el documento de su sede.
- **Nada de tablas normalizadas** para el operativo: productos, ventas, fiados viajan dentro del JSON del negocio. (Las ventas del día también se resumen en un doc liviano `resumen_diario` para el monitor.)

### 2.3 Protocolo de sincronización (sin Edge Functions)
- **Push:** al guardar un cambio local, se marca el doc como "sucio" y se sube con debounce de ~5 s (no por cada tecla). Solo el doc cambiado, no toda la base.
- **Pull:** al abrir la app y al recibir notificación realtime, se bajan los docs con `updated_at` mayor al local.
- **Conflictos:** last-write-wins **por documento** con `updated_at` + `version`. Granularidad aceptada: dos cajas editando el mismo producto a la vez es rarísimo en bodega; si pasa, gana el último y queda en el log de auditoría.
- **Restore en dispositivo nuevo:** al vincular, baja todos los docs de la cuenta una sola vez (es el único momento donde viaja "todo").

### 2.4 Tiempo real (Modo Jefe)
- **Canal Realtime por cuenta** (`account:<id>`), con Postgres Changes sobre `sync_documents` filtrado por `account_id`.
- **Feed de ventas en vivo vía Broadcast** (mensajes efímeros, no tocan la DB ni gastan espacio): cada ticket emite `{sede, total_usd, total_bs, metodo_pago, ts}` (~200 bytes). El monitor del jefe los pinta en segundos.
- **Presencia:** el canal reporta qué dispositivos están en línea (para el "en línea" real del panel).
- **Lo que NO viaja en vivo:** detalle línea por línea del ticket en tiempo real (llega con el doc en el siguiente push), imágenes, ni estado de cada tecla del POS.

### 2.5 Costo estimado (peor caso razonable)
- 3 sedes × 300 tickets/día × 30 días = 27.000 mensajes Broadcast/mes → **1,3%** de los 2 M gratis.
- Docs JSON de ~200 KB por sede, push/pull unas 50 veces/día → ~300 MB/mes → **15%** de los 2 GB.
- Conclusión: el gratis aguanta con holgura incluso multiplicando por 5.

---

## 3. Fases

### Fase 1 — Vinculación + espejo en la nube (base de todo)
1. Auth con Supabase (email/contraseña del dueño) + sesión persistente.
2. Generar/canjear código de emparejamiento de 6 dígitos (`device_pairings`, expira en 10 min).
3. Subida inicial: todos los docs locales → `sync_documents` con `account_id`.
4. Restore: dispositivo nuevo vinculado descarga todo y reconstruye IndexedDB.
5. RLS: políticas owner-only en `sync_documents` y `device_pairings`.
6. Estado de conexión visible en la app ("nube al día / pendiente / sin conexión").

**Criterio de aceptación:** vincular un segundo teléfono con el código y ver los mismos productos, ventas y fiados. Apagar el wifi en ambos y seguir vendiendo.

### Fase 2 — Sync bidireccional automático
1. Push con debounce (5 s) del doc modificado.
2. Pull al abrir la app + pull bajo demanda.
3. Resolución LWW por documento + entrada en auditoría cuando hay conflicto.
4. Reintento con backoff si la red falla; cola persistente de docs sucios.

**Criterio de aceptación:** cambiar un precio en el teléfono A y verlo en el teléfono B sin tocar nada (al abrir o en segundos con red).

### Fase 3 — Tiempo real Modo Jefe
1. Canal `account:<id>` + Broadcast de tickets desde el POS.
2. Monitor del jefe: feed en vivo, totales del día por sede, presencia ("caja 1 en línea").
3. Re-subscripción automática al recuperar red; manejo del "despertar" del proyecto pausado.

**Criterio de aceptación:** hacer una venta en caja y verla aparecer en el monitor del jefe en < 5 s con ambos en la misma red.

---

## 4. Lo que explícitamente NO se hace (para no romper el gratis ni el offline-first)
- Nada de realtime por cada interacción del POS (solo por ticket cerrado).
- Nada de imágenes ni PDFs por la nube en el operativo (solo JSON).
- Nada de Edge Functions: todo con PostgREST + Realtime del cliente.
- La app nunca se bloquea esperando la nube: sin red, todo local y se sincroniza después.
- Sin "resolución de conflictos" campo por campo: LWW por documento + auditoría.
- **Nada de polling**: sin intervalos que pregunten "¿hay algo nuevo?". El pull ocurre al abrir la app, al recibir notificación realtime o por refresh manual.
- **Los logs detallados no suben a la nube** (ver §7).

## 7. Presupuesto de egress y control de logs (el punto crítico)

El gratis da **2 GB/mes de egress** (todo lo que sale de Supabase: respuestas API, mensajes realtime, restores). El diseño se blinda así:

**7.1 Documentos fragmentados, no un solo blob.** `sync_documents` se parte por tipo: `catalogo`, `ventas_dia`, `fiados`, `config`, `resumen`. Cambiar un precio sube solo `catalogo` (~150 KB), no toda la base. Regla: ningún push sube más del shard modificado.

**7.2 Pull condicional.** Antes de bajar un doc se consulta solo su `updated_at` (unos bytes); el doc completo solo se descarga si cambió. Abrir la app 10 veces al día sin cambios = ~0 egress.

**7.3 Logs: locales por defecto.** La auditoría detallada (quién hizo qué, cada acción) vive en IndexedDB y **no se sincroniza**. A la nube sube únicamente:
- un digest diario compacto por sede (totales, # tickets, # cambios de precio),
- eventos críticos (vinculación/revocación de dispositivo, cambio de rol),
- tope: 100 eventos/día por dispositivo, < 500 bytes c/u.
El log completo se puede exportar manualmente si hace falta, nunca en automático.

**7.4 Realtime minimalista.** Broadcast por ticket: `{sede, total_usd, total_bs, metodo_pago, ts}` (~200 bytes). Prohibido mandar filas completas o detalle línea por línea por el canal en vivo (eso llega después con el push del shard `ventas_dia`).

**7.5 Restore solo explícito.** La descarga completa ocurre una sola vez al vincular un dispositivo nuevo, nunca en automático. Si un shard falla, se re-descarga solo ese shard.

**7.6 Gzip siempre.** `supabase-js` ya negocia compresión; el JSON típico se reduce 5–10×. No enviar nada sin compresión.

**7.7 Medidor en la app.** Contador local de bytes subidos/bajados por la capa de sync + estimado mensual visible en el panel del admin, con alerta al 70% de los 2 GB. Si una cuenta lo supera de forma sostenida, se evalúa el plan Pro ($25/mes) solo para ella.

**Estimación con estas reglas (3 sedes, 300 tickets/día):** ~25 MB/mes → **~1,2%** del límite. Incluso ×10 sigue sobrando.

## 5. Riesgos y mitigaciones
- **Proyecto pausado por inactividad (1 semana):** primer acceso lento; mitigación con mensaje "despertando nube…" y operación 100% local mientras tanto. Si un cliente lo sufre seguido, se evalúa el plan Pro de Supabase ($25/mes) solo para esa cuenta.
- **Dos dispositivos editando lo mismo a la vez:** LWW + auditoría; en bodega real casi no ocurre (cada caja toca sus tickets).
- **Cuenta del dueño comprometida:** RLS owner-only + códigos de emparejamiento de un solo uso y corta vigencia; revocar dispositivo desde el panel.

## 6. Orden de ejecución
Fase 1 → probar E2E con dos teléfonos reales → Fase 2 → probar → Fase 3 → probar. Cada fase se despliega y se valida con luigi antes de seguir (mockup primero para cualquier pantalla nueva del monitor).
