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
