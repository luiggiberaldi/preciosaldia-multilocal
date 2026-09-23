# PLAN DE FIXEO DEFINITIVO — PREVENCIÓN Y BLINDAJE DE `formatUsd` EN BÚSQUEDA DE VENTAS

**Documento ejecutable.** Escrito para ejecución paso a paso con Proof of Execution (PoE).
**Origen del problema:** `ReferenceError: formatUsd is not defined` en `SearchBar.jsx` al buscar productos con precio de referencia USD (`pricingMode === 'dual_usd'`).
**Fecha:** 2026-08-05
**Fases:** 4 · **Archivos tocados:** 3 · **Tests nuevos:** 1

---

## §0. OBJETIVO DEL PLAN

Garantizar a nivel de código, arquitectura y PWA que el error `ReferenceError: formatUsd is not defined` **nunca vuelva a ocurrir**, ni por falta de importación ni por problemas de caché de Service Worker en navegadores/dispositivos de los clientes.

---

## §1. FASES DE EJECUCIÓN

### FASE 1 — Blindaje Defensivo en `SearchBar.jsx` (Red de Seguridad)

En `src/components/Sales/SearchBar.jsx`:
1. Asegurar la importación explícita de `formatUsd` desde `../../utils/calculatorUtils`.
2. Declarar una función auxiliar defensiva `safeFormatUsd(val)` que use `formatUsd` si está disponible, o aplique un fallback `(Number(val) || 0).toFixed(2)` en caso extremo de descalce de chunks por caché.
3. Usar `safeFormatUsd` en el JSX del render de resultados de búsqueda.

```javascript
import { formatCop, formatUsd, getCop, getUsd } from '../../utils/calculatorUtils';

// Fallback ultra-seguro por resguardo de caché
const safeFormatUsd = (val) => {
    try {
        if (typeof formatUsd === 'function') return formatUsd(val);
    } catch (_) {}
    return (Number(val) || 0).toFixed(2);
};
```

---

### FASE 2 — Auditoría y Blindaje en Componentes de Ventas

Revisar y verificar los siguientes componentes de la vista de ventas para asegurar importaciones limpias y blindadas:
1. `src/components/Sales/CartPanel.jsx`
2. `src/components/Sales/CategoryBar.jsx`
3. `src/components/Sales/SalesHeader.jsx`

---

### FASE 3 — Test de Estrés y Regresión (`tests/formatUsdGuard.test.js`)

Crear una suite de pruebas en Vitest que valide:
1. `formatUsd` formatea correctamente números, strings numéricos, `null`, `undefined` y valores negativos.
2. La función de respaldo `safeFormatUsd` funciona limpiamente incluso si `formatUsd` fuera `undefined`.

---

### FASE 4 — Auto-Actualización de Caché PWA y Despliegue en `main`

1. Verificar que la configuración de Vite PWA revalide assets en segundo plano.
2. Ejecutar `npm run build` y la suite de tests.
3. Hacer commit y push a `main`.

---

## §2. INSTRUCCIONES PARA EL EJECUTOR

Ejecutar las 4 fases secuencialmente, validar con `npm run build` y tests, y notificar al usuario al finalizar.
