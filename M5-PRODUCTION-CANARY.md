# M5 — Producción general del Supervisor

**Fecha:** 2026-08-10
**Proyecto:** `sodgzkablshladvbtnes`
**Alcance:** ingreso remoto para cualquier par caja/Supervisor vinculado; egreso remoto bloqueado.

## Resultado del preflight

Consultas y migraciones ejecutadas mediante Management API en producción. No se modificaron ventas ni stock fuera del ingreso canary ya validado.

| Control | Resultado |
|---|---|
| `device_pairings` existe | ✅ |
| `sync_documents` existe | ✅ |
| `supervisor_commands` existe | ✅ |
| RLS en las tres tablas | ✅ habilitada |
| RLS forzada | ⚠️ no forzada; no se modifica en este preflight |
| Permisos directos para `anon` | ✅ ninguno en las tres tablas |
| RPC críticas con `SECURITY DEFINER` | ✅ |
| RPC críticas con `search_path` fijo | ✅ `public, extensions` |
| RPC críticas ejecutables por `anon` | ✅ bloqueadas |
| Comandos pendientes | ✅ 0 |
| Pairings totales | 15 |
| Pairings activos | 12 |
| Realtime | ✅ `device_pairings`, `sync_documents`, `supervisor_commands` |

## Bloqueo crítico encontrado y resuelto server-side

En el primer preflight la RPC de producción no permitía:

```text
supervisor.inventory.batch.adjust
```

Con la autorización explícita recibida, se aplicó únicamente en producción la migración income-only:

```text
supabase_supervisor_inventory_income_production.sql
```

La migración permite únicamente `direction=ingreso`. El egreso sigue fuera de la allowlist productiva.

Verificación posterior:

- `supervisor.inventory.batch.adjust` aparece en el `CHECK`;
- la RPC valida `direction=ingreso`;
- `SECURITY DEFINER` conservado;
- `search_path=public, extensions` conservado;
- `anon` sin `EXECUTE`;
- `authenticated` con `EXECUTE`;
- comandos pendientes: 0.

No se creó ningún comando de producción ni se modificaron movimientos de stock.

## Estado de producción general

```text
Backend income-only: ACTIVO
Autorización: pairing activo + identidad Auth del Supervisor
SUPERVISOR_REMOTE_MUTATIONS_ENABLED: false
SUPERVISOR_REMOTE_INCOME_ENABLED: true en Production
SUPERVISOR_REMOTE_RATE_ENABLED: false hasta completar Fase 6
SUPERVISOR_REMOTE_EGRESS_ENABLED: false
```

La política server-side ya no depende de la tabla temporal del canary. Cualquier Supervisor puede enviar un ingreso únicamente si:

1. existe un pairing activo para la caja objetivo;
2. `monitor_auth_id` coincide con la sesión Auth que crea el comando;
3. caja y Supervisor son dispositivos distintos;
4. el comando es exclusivamente `supervisor.inventory.batch.adjust` con `direction=ingreso`;
5. el ACK, TTL e idempotencia son válidos.

La tabla `supervisor_canary_allowlist` se conserva por compatibilidad y rollback, pero sus filas no autorizan ni bloquean la política general. El egreso continúa bloqueado en frontend y backend.

## Procedimiento de operación general

### A. Vinculación por negocio

- la caja genera un QR;
- el Supervisor lo escanea;
- la sesión Auth del monitor queda ligada al pairing;
- cada caja mantiene como máximo un Supervisor;
- desvincular revoca inmediatamente el acceso.

### B. Ingreso remoto

- seleccionar ingreso, unidad y cantidad;
- exigir motivo;
- comprobar stock anterior y esperado;
- esperar ACK real;
- registrar delta, stock posterior y auditoría;
- no aplicar cambios si hay timeout, conflicto o NACK;
- observar errores y reconexiones.

### C. Rollback inmediato

1. Apagar el flag de ingreso.
2. Impedir nuevos comandos.
3. Confirmar que no quedan comandos `pending`.
4. Revisar el último ACK y el movimiento generado.
5. Si el movimiento fue aplicado incorrectamente, usar movimiento inverso auditado; nunca borrar filas.
6. Volver el Supervisor a solo lectura.

### D. Egreso

El egreso requiere una aprobación separada. No se activa junto con el ingreso. Debe conservar:

- categoría obligatoria;
- `expectedStock`;
- rechazo de stock insuficiente;
- ACK/NACK;
- replay idempotente;
- rollback auditable.

## Allowlist histórica del canary — retirada de la autorización

Se aplicó únicamente en producción:

```text
supabase_supervisor_canary_allowlist.sql
```

La tabla conserva RLS forzada y permisos directos bloqueados. Sus filas históricas se dejaron desactivadas para que no exista una autorización temporal residual.

El guardia productivo vigente es:

```text
supervisor_income_pairing_guard
```

La autorización se obtiene exclusivamente desde `device_pairings`; no requiere insertar IDs manualmente en una allowlist. El egreso continúa bloqueado.

## Decisión actual

M5 queda **habilitada para todos los Supervisores vinculados**:

1. cualquier usuario puede vincular un único Supervisor mediante QR;
2. el Supervisor puede consultar inventario, ventas, caja y reportes;
3. el ingreso remoto por lotes está habilitado para todos los pairings activos;
4. ACK, TTL, idempotencia, pairing y Auth se validan server-side;
5. el egreso remoto continúa rechazado;
6. usuarios, tasas, productos remotos y cierres remotos permanecen bloqueados por política.

Se validó la transición con staging sintético: pairing activo autorizado aunque la allowlist esté deshabilitada, ACK, replay, conflicto, NACK, timeout y egreso rechazado.

`VITE_SUPERVISOR_REMOTE_EGRESS_ENABLED` no debe configurarse como `true`.
