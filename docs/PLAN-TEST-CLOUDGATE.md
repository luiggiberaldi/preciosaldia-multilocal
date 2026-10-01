# Plan de tests deterministas — Pro CloudGate + Supabase por cliente

**Fecha:** 2026-09-30 · **Objetivo:** que cada flujo del plan Pro-nube-propia
funcione a la perfección, probado de forma determinista (mismos inputs →
mismos outputs, sin red en los unitarios, datos sembrados).

**Regla del plan:** ningún test toca la red salvo los marcados LIVE, que usan
infraestructura real y se corren a mano, no en CI.

---

## Matriz de flujos

| # | Flujo | Tipo | Cómo se prueba | Estado |
|---|-------|------|----------------|--------|
| F1 | Código inválido/vacío → error claro, sin red | unit (mock) | `tests/cloudGate.test.js` | ✅ |
| F2 | Código válido → normaliza, resuelve proyecto, formato apto para `setCustomerProject` | unit (mock) | `tests/cloudGate.test.js` | ✅ |
| F3 | Directorio sin configurar → error claro | unit (mock) | `tests/cloudGate.test.js` | ✅ |
| F4 | Proxy perezoso: lanza sin proyecto, no lanza resuelto, `clear` lo revierte | unit | `tests/cloudGate.test.js` | ✅ |
| F5 | Login ok → registra equipo → sesión de dueño (no anónima) | unit (mock) | `tests/cloudAccount.test.js` | ✅ |
| F6 | Cuenta llena (6/6) → `limitReached`, cierra sesión a medias | unit (mock) | `tests/cloudAccount.test.js` | ✅ |
| F7 | Límite → revocar un equipo → reintentar registro → entra (secuencia CloudGate) | unit (mock) | `tests/cloudGateFlows.test.js` | ✅ |
| F8 | Offline con proyecto+sesión guardados → entra sin red | unit (mock) | `tests/cloudGateFlows.test.js` | ✅ |
| F9 | "Usar otro código" → olvida proyecto y sesión | unit (módulo real) | `tests/cloudGateRealConfig.test.js` | ✅ |
| F10 | Directorio LIVE: RPC con código inexistente → `[]` (200) | live | verificado 2026-09-30 | ✅ |
| F11 | Directorio LIVE: RLS — anon no lee la tabla directa, solo el RPC | live | verificado 2026-09-30 | ✅ |
| F12 | Migración 003 aplicada en producción (tabla + función existen) | live | verificado 2026-09-30 | ✅ |
| F13 | Provisionamiento: los 7 SQL en orden exacto, `pairing` antes de `001` | static | `tests/provisionContract.test.js` | ✅ |
| F14 | Provisionamiento: cada SQL existe e idempotente (`IF NOT EXISTS`/`OR REPLACE`) | static | `tests/provisionContract.test.js` | ✅ |
| F15 | Keepalive: directorio vacío → exit 0, sin alertas, sin escribir estado | unit (mock) | `scripts/test_keepalive_fleet.py` | ✅ |
| F16 | Keepalive: ping ok → resetea fallos, actualiza `last_keepalive` | unit (mock) | `scripts/test_keepalive_fleet.py` | ✅ |
| F17 | Keepalive: 2 fallos seguidos → `status='error'`, exit 1, alerta | unit (mock) | `scripts/test_keepalive_fleet.py` | ✅ |
| F18 | Keepalive: `--dry-run` nunca escribe ni parchea | unit (mock) | `scripts/test_keepalive_fleet.py` | ✅ |
| F19 | Keepalive LIVE: `--dry-run` contra la Estación real | live | verificado 2026-09-30 | ✅ |
| F20 | Estación UI: sin pestaña Mensuales; Pro solo Permanente; Lite Permanente+Demo | static | `scripts/test_ui_rules.py` | ✅ |
| F21 | Estación UI: sin plantillas de mensualidad en mensajes | static | `scripts/test_ui_rules.py` | ✅ |
| F22 | Pro sin demo: cero símbolos (`isDemo`, `activateDemo`, …) en `src/` | static | grep (verificado 2026-09-30) | ✅ |
| F23 | `tsc --noEmit` limpio en la Estación | static | verificado 2026-09-30 | ✅ |
| F24 | `npm run build` limpio en el Pro | static | verificado 2026-09-30 | ✅ |

## Fuera de alcance determinista (honesto)

| # | Flujo | Por qué no es determinista aún |
|---|-------|--------------------------------|
| X1 | Provisionamiento real en Supabase | Requiere proyecto desechable + token rotado de luigi |
| X2 | Límite real de 6 equipos contra servidor | Requiere 6 dispositivos/sesiones reales o proyecto de prueba |
| X3 | Flujo visual completo en navegador | El sandbox no alcanza localhost ni tiene pantalla; QA final en el teléfono de luigi o deploy preview |
| X4 | `keepalive()` evita la pausa del free tier | No confirmado en documentación oficial de Supabase |

## Hallazgos de la primera corrida (2026-09-30)

Los tests encontraron y se corrigieron 3 cosas reales:

1. **Keepalive escribía `state.json` vacío** con el directorio sin proyectos
   (F15). Fix: solo guarda estado si hay filas.
2. **Plantilla `pago_recibido`** hablaba de "suscripción" y "pago de
   mensualidad" (F21). Fix: confirma licencia permanente, pago único.
3. **Diálogo "cambiar tipo"** ofrecía Mensual/Demo para Pro y reactivaba como
   mensual (F20). Fix: opciones por producto (`clampTypeForProduct`: Pro →
   solo permanente; Lite → permanente + demo3), expiración con
   `isDemo(newLicType)`, reactivar como permanente.

## Comandos

```bash
# Pro: todos los unitarios + estáticos del gate
cd ~/workspace/preciosaldia-multilocal && npx vitest run tests/cloudGate.test.js tests/cloudAccount.test.js tests/cloudGateFlows.test.js tests/cloudGateRealConfig.test.js tests/provisionContract.test.js

# Pro: suite completa (2 fallos preexistentes ajenos: supervisorLifecycle, receivablesDeterministic)
npx vitest run

# Estación: keepalive + reglas UI
cd ~/workspace/estacion-2026 && python3 scripts/test_keepalive_fleet.py
python3 scripts/test_ui_rules.py

# Estación: tipos
npx tsc --noEmit
```
