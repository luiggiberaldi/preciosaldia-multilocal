# Plan de Fixeo — PreciosAlDía Pro: Fotos y Sincronización
**Fecha:** 2026-10-02
**Autor:** Totono (agente)
**Estado:** Fotos verificadas end-to-end. Fixes de sincronización pendientes.

## Resumen ejecutivo

Las fotos de Bodega están funcionando: 2.423 productos importados, 1.498 fotos vinculadas desde Supabase Storage, verificadas visualmente en navegador con capturas como evidencia.

Durante el proceso se detectaron **bugs reales de sincronización** que deben corregirse antes de producción:
1. El conflicto "Usar los de la Nube" borra datos locales sin respaldo previo.
2. El sync filtra por ID de negocio, impidiendo recuperar datos de un negocio con ID distinto.
3. No hay forma de ver o forzar el ID interno de un negocio desde la UI.

## Lo que se hizo (2026-10-02)

### 1. Botón "Vincular fotos" (VINCULAR-FOTOS-001) — COMPLETADO
- **Commit:** `10c9b05`
- **Archivos:**
  - `src/utils/vincularFotos.js` (nuevo)
  - `public/barcode_to_photo.json` (nuevo, 1.498 códigos → filenames)
  - `src/components/Products/ProductsToolbar.jsx` (botón en menú herramientas)
  - `src/views/ProductsView.jsx` (handler `handleVincularFotos`)
- **Cómo funciona:** Lee el mapeo barcode→filename, construye URLs de Supabase Storage (`product-images` bucket), actualiza el campo `image` de cada producto.
- **Verificado:** 1.498 fotos vinculadas, visibles en tarjetas de productos.

### 2. Importación de Bodega — COMPLETADO
- Excel `bodega_limpio_2026-10-01.xlsx` → 2.423 productos importados vía "Importar Excel".
- Fotos vinculadas vía el nuevo botón.

## Bugs de sincronización detectados

### BUG-1: "Usar los de la Nube" borra datos locales sin advertencia adecuada
**Severidad:** ALTA
**Descripción:** Al resolver un conflicto de datos eligiendo "Usar los de la Nube", la app reemplaza TODOS los datos locales con la versión de la nube, sin crear un respaldo local previo ni advertir claramente sobre la pérdida.
**Evidencia:** Se perdieron 2 ventas de prueba ($25,65) al elegir esta opción.
**Fix propuesto:**
- Antes de aplicar "Usar los de la Nube", crear un respaldo automático local (backup en IndexedDB con timestamp).
- Mejorar el diálogo de conflicto para mostrar: cuántos productos/ventas hay en cada lado, fecha de última modificación.
- Agregar opción "Descargar respaldo" en el diálogo.

### BUG-2: Sync filtra estrictamente por ID de negocio activo
**Severidad:** MEDIA
**Descripción:** `isDocForActiveBusiness()` en `src/utils/negocioContext.js` descarta documentos cuyo `negocioId` no coincide con el activo. Si un dispositivo tiene un negocio con ID distinto al de la nube (ej. nube tiene `neg-1`, dispositivo tiene `neg-abc123`), los datos nunca se sincronizan.
**Evidencia:** La nube tenía `nb_neg-1:bodega_products_v1` pero el navegador con negocio de ID aleatorio nunca lo descargó.
**Fix propuesto:**
- Opción A (recomendada): Al detectar documentos de negocios no registrados localmente, ofrecer "Importar negocio desde la nube" que crea el negocio con el ID correcto.
- Opción B: Permitir al usuario ver y editar el ID interno del negocio (solo para casos de recuperación, con advertencia).
- Opción C: Cambiar el sync para descargar TODOS los negocios de la cuenta, no solo el activo.

### BUG-3: No se puede ver el ID interno del negocio
**Severidad:** BAJA
**Descripción:** La UI muestra nombres de negocios pero no sus IDs internos (`neg-1`, `neg-xxx`). Esto dificulta el diagnóstico cuando hay problemas de sincronización.
**Fix propuesto:** En Ajustes → Negocios, mostrar el ID interno en texto pequeño junto al nombre (solo visible para el dueño).

## Plan de implementación

### Fase 1: Seguridad de datos (prioridad máxima)
1. **Respaldo automático pre-conflicto** (BUG-1)
   - Modificar el flujo de resolución de conflictos en `useCloudSync.js` o donde se maneje.
   - Antes de aplicar cualquier dirección, guardar snapshot local con timestamp.
   - Estimación: 2-3 horas.

2. **Diálogo de conflicto informativo** (BUG-1)
   - Mostrar conteo de productos/ventas en dispositivo vs nube.
   - Mostrar fecha de última sincronización de cada lado.
   - Estimación: 2 horas.

### Fase 2: Recuperación de negocios (prioridad media)
3. **Importar negocio desde la nube** (BUG-2, Opción A)
   - Detectar doc_ids con negocioId no registrado.
   - Ofrecer crear el negocio con ese ID.
   - Estimación: 3-4 horas.

4. **Mostrar ID interno** (BUG-3)
   - Cambio menor en `SettingsTabNegocio.jsx`.
   - Estimación: 30 minutos.

### Fase 3: Verificación end-to-end
5. Probar el flujo completo en navegador:
   - Crear conflicto intencional.
   - Verificar que el respaldo se crea.
   - Verificar que el diálogo muestra información útil.
   - Verificar que "Importar negocio" funciona.
6. Documentar en bitacora.md.

## Archivos fuente (no tocar sin autorización de Luigi)
- `~/workspace/inventarios-limpios/bodega_limpio_2026-10-01.xlsx` (2.423 productos)
- `~/workspace/inventarios-limpios/cosmeticos_limpio_2026-10-01.xlsx` (2.988 productos)
- `~/workspace/inventarios-limpios/mapeo_fotos_bodega.json` (1.505 fotos → productos)
- `~/workspace/inventarios-limpios/mapeo_fotos_cosmeticos.json` (si existe)

## Notas
- La app NO está en producción todavía (nadie la usa), por lo que hay margen para estos fixes.
- El importador Excel de un tercero sigue sin commitear — NO TOCARLO.
- Todos los commits deben documentarse en `bitacora.md` (regla permanente).
- Nunca `git add -A` en este repo (regla permanente).
