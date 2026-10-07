# PreciosAlDía Multi — Roadmap

> Principio base: **repo nuevo + proyecto Supabase nuevo**, 100% separados del
> producto original (`preciosaldia2026`). No se comparte código evolutivo, ni
> base de datos, ni deploy. Lo que se aprenda aquí puede portarse al producto
> como funcionalidad, pero este repo manda sobre su propio destino.

Cliente inicial: dueño con 2 negocios separados (bodega + cosméticos).
Ambos usan el vertical BODEGA por ahora — los verticales no se tocan.

---

## Fase 0 — Fundación
- [x] Repo `luiggiberaldi/preciosaldia-multilocal` (creado por luigi) creado (clon de preciosaldia2026)
- [ ] Push inicial del código base al repo
- [ ] Proyecto Supabase nuevo: crear proyecto, aplicar `supabase_cloud_schema.sql`
      + `supabase/migrations/001_device_own_row_rls.sql` (tablas `cloud_backups`,
      `sync_documents`, `device_sessions`)
- [ ] `.env`: `VITE_SUPABASE_CLOUD_URL` / `VITE_SUPABASE_CLOUD_KEY` del proyecto
      nuevo + `VITE_LICENSE_SALT` único por cliente (nunca reutilizar el del producto)
- [ ] Proyecto Vercel nuevo apuntando a este repo (preview para pruebas)
- [ ] Verificar sync E2E contra el Supabase nuevo (backup + restore desde un teléfono)

## Fase 1 — Multi-negocio (core, requerimiento principal)
1. **Registro de negocios** — store zustand `useNegociosStore` (clave global, sin
   namespacing): `{id, nombre, rif, direccion, telefono, createdAt}` + `negocioActivoId`.
2. **Router de storage** — `storageService` antepone `nb_<id>:` a cada clave.
   Globales (sin prefijo): registro de negocios, identidad del dispositivo, caché de tasas.
3. **Migración** — primer arranque: claves existentes se MUEVEN a `Mi negocio` (`neg-1`).
4. **Selector en header** — cambiar de negocio activo + crear/editar/eliminar
   (con `ConfirmModal`, sin `confirm()` nativo). Al cambiar se rehidratan los stores.
5. **Usuarios PIN por negocio** — cada local tiene su personal; la sesión guarda el negocio activo.
6. **Sync cloud por negocio** — `doc_id` = `<negocioId>:<collection>:<doc>` en `sync_documents`.
7. **Recibos** — encabezado con los datos fiscales del negocio activo.
- **Salida de fase:** 2 negocios con inventario, ventas, fiados y dashboard 100% aislados;
  `npm run build` verde; prueba manual en teléfono.

## Fase 1.5 — Roles y vista supervisor (aprobado por luigi 2026-09-29)
**Estado: implementado 2026-09-29** (commits `5527c5b`–`ad00819`; build verde;
suite 682/689 — 1 fallo preexistente no relacionado en `receivablesDeterministic`;
pendiente prueba manual en teléfono de luigi).
Evolución del "modo supervisor" por pairing (congelado: no se elimina, no se le
invierte más) hacia un modelo de roles. El dueño abre su sesión y ve todo; los
empleados ven solo su negocio con permisos según su rol.

1. **PIN maestro global del dueño** — no pertenece a ningún negocio; vive como
   clave global (hash PBKDF2, igual que los PIN actuales). Migración: si no
   existe, al arrancar se pide crearlo una vez ("Crea tu PIN maestro de dueño").
   En el login hay opción "Soy el dueño" → sesión global, no atada a negocio.
2. **Roles por negocio** — campo `rol` en usuarios: `supervisor` | `cajero`
   (el dueño ya es global, no necesita rol por negocio). Migración: usuarios
   existentes quedan como `supervisor`.
   - `cajero`: POS y sus ventas. Sin dashboard financiero, sin ajustes de
     inventario, sin tasas, sin gestión de usuarios, sin ajustes del negocio.
   - `supervisor`: lo del cajero + dashboard de su sede, ajustes de inventario,
     tasas, gestión de usuarios cajero. Sin datos fiscales ni crear/eliminar
     negocios.
3. **Vista Supervisión** (adelanta la Fase 2) — visible para dueño (global) y
   supervisor (su sede). Selector: Bodega / Cosméticos / Consolidado.
   - Por sede: ventas hoy/semana/mes, ticket promedio, top productos, alertas
     de stock bajo, fiados pendientes.
   - Consolidado: comparativa por negocio (día/semana/mes), **solo lectura**.
   - Lectura cross-negocio: lee namespaces `nb_*` directo, sin pasar por el
     router del negocio activo (solo lectura). Acciones se hacen entrando a
     cada sede.
4. **Sync**: el teléfono del dueño hace pull de todos los negocios (ya funciona
   por negocio); la vista lee en local.
- **Salida de fase:** roles enforced en UI, PIN maestro crea/sesión global,
  vista Supervisión con las 3 pestañas y datos correctos por sede,
  `npm run build` verde, tests, push a `main` y redeploy.

## Fase B — Modo Jefe (aprobado por luigi 2026-09-29)
**Estado: implementado 2026-09-29** (plan en `docs/PLAN-FASE-B-MODO-JEFE.md`).
La vista Supervisión se convierte en el monitor del dueño: lo más detallado
posible en lo monetario, con pulso en vivo.

1. **Renombre supervisor → administrador** — terna final: dueño, administrador,
   cajero. Valores guardados `'ADMIN'`/`'CAJERO'` intactos (compat); alias
   deprecated en `utils/roles.js` (`ROL_SUPERVISOR`, `isSupervisor`,
   `TABS_DUENO_SUPERVISOR`).
2. **Motor `utils/modoJefe.js`** (puro, testeable): plata de hoy (total,
   tickets, ticket prom., desglose por moneda USD/Bs/COP desde `payments[]`,
   desglose por método de pago, descuentos, anuladas, mejor hora), fiados en
   movimiento (otorgados vs cobrados), movimiento de caja (apertura + cobradas
   + cobros − egresos = esperado), feed en vivo, comparativas (ayer / hace 7
   días), alertas (anuladas, descuento ≥15% o ≥$5, caja sin apertura),
   `combinarPlata` para el consolidado.
3. **UI `views/ModoJefePanel.jsx`** — por sede (dueño y administrador) y
   `ConsolidadoJefe` (dueño: agregados + ranking de sedes + alertas de todas).
4. **Railes:** R1 solo lectura (ningún botón muta), R2 refresco 10 s solo con
   vista activa y pestaña visible, R3 `num()` anti-NaN, R4 cajero sin tab
   supervisión, R5 badge "actualizado hace Xs".
5. **Arneses:** `tests/modoJefe.test.js` (23 tests, fixtures completas).
- **Límites honestos:** sin vendedor por ticket (vive en audit log) y sin en
  vivo multi-dispositivo (requiere sync nube) — Fase C.

## Fase 2 — Experiencia del dueño (upsell)
- Resumen consolidado de solo lectura: ventas del día por negocio en una pantalla.
- Reportes comparativos por negocio (semana/mes).
- (Opcional) monitor remoto separado por negocio.

## Fase 3 — Futuro (no comprometido)
- Vertical COSMÉTICOS (variantes/tonos, marca, vencimientos, SKU).
- Sucursales con traslados de mercancía (si un negocio crece a multi-sede).

---

## Reglas del repo
- Ningún commit sin su entrada en `bitacora.md`.
- Todo redondeado, sin `<select>` nativo, sin `alert()/confirm()/prompt()`.
- El producto original no se toca desde aquí.
