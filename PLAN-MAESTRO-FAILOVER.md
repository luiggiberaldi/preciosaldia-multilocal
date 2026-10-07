# Plan Maestro de Fixeo — Failovers y Sincronización
**Fecha:** 2026-10-02
**Autor:** Totono
**Objetivo:** Garantizar que ningún dato se pierda y que la nube sea un failover confiable.

## Problemas identificados

### P1 (CRÍTICO): Sin respaldo antes de resolver conflictos
Al elegir "Usar los de la Nube", los datos locales se reemplazan sin backup previo.
**Fix:** Snapshot automático en IndexedDB antes de aplicar cualquier dirección.

### P2 (ALTO): Diálogo de conflicto no informa
El usuario no sabe cuántos productos/ventas hay en cada lado antes de decidir.
**Fix:** Mostrar conteo y fecha de última modificación de ambos lados.

### P3 (MEDIO): Negocios con ID distinto no sincronizan
`isDocForActiveBusiness()` descarta documentos de negocios no registrados localmente.
**Fix:** Detectar y ofrecer "Importar negocio desde la nube".

### P4 (MEDIO): Backup .json no verificado
Existe el botón pero nunca se probó el ciclo export→import.
**Fix:** Probar en navegador y documentar.

### P5 (MEDIO): Sync a la nube no verificado
No se confirmó que los 2,423 productos + fotos suban correctamente.
**Fix:** Probar sync up y verificar en la nube.

## Orden de implementación

1. **Respaldo pre-conflicto** (P1) — `useCloudSync.js`
2. **Diálogo informativo** (P2) — componente de conflicto
3. **Importar negocio** (P3) — `negocioContext.js` + UI
4. **Pruebas** (P4, P5) — navegador

## Detalle técnico

### 1. Respaldo pre-conflicto
```js
// En useCloudSync.js, antes de _applyFromCloud o resolución:
async function crearSnapshotPreConflicto() {
    const timestamp = new Date().toISOString();
    const keys = ['bodega_products_v1', 'bodega_sales_v1', /* ... */];
    const snapshot = {};
    for (const key of keys) {
        snapshot[key] = await storageService.getItem(key);
    }
    await storageService.setItem(`snapshot_pre_conflicto_${timestamp}`, snapshot);
    // Mantener solo los últimos 3 snapshots
}
```

### 2. Diálogo informativo
Mostrar:
- Productos en dispositivo: X (actualizado: fecha)
- Productos en nube: Y (actualizado: fecha)
- Ventas en dispositivo: X
- Ventas en nube: Y

### 3. Importar negocio desde la nube
```js
// Detectar doc_ids con negocioId no en el registry
function detectarNegociosHuerfanos(docs) {
    const registryIds = getNegociosIds();
    const huerfanos = new Set();
    for (const doc of docs) {
        const { negocioId } = parseCloudDocId(doc.doc_id);
        if (negocioId && !registryIds.includes(negocioId)) {
            huerfanos.add(negocioId);
        }
    }
    return [...huerfanos];
}
```

## Criterios de aceptación
- [ ] Resolver un conflicto crea un snapshot recuperable
- [ ] El diálogo muestra conteos de ambos lados
- [ ] Se puede importar un negocio desde la nube
- [ ] Backup .json export→import funciona
- [ ] Los datos suben a la nube y se pueden descargar en otro dispositivo
- [ ] Todo documentado en bitacora.md
