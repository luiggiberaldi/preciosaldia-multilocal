# M5 — Preview Vercel del canary income-only

## Configuración del proyecto Vercel

Usar un **Preview Deployment**, no Production, para la primera prueba.

Variables de entorno del Preview:

```env
VITE_SUPERVISOR_REMOTE_INCOME_ENABLED=true
VITE_SUPERVISOR_REMOTE_RATE_ENABLED=false
VITE_SUPERVISOR_REMOTE_EGRESS_ENABLED=false
VITE_SUPABASE_CLOUD_URL=https://sodgzkablshladvbtnes.supabase.co
VITE_SUPABASE_CLOUD_KEY=<anon-key-de-producción>
```

Mantener las demás variables actuales del proyecto Vercel. No usar la anon key de staging en este Preview si se quiere probar el canary contra la migración income-only de producción.

## Build

```text
Framework: Vite
Build command: bun run build
Output directory: dist
Install command: bun install
```

La variable `VITE_SUPERVISOR_REMOTE_INCOME_ENABLED` se incorpora durante el build. No basta con agregarla después del despliegue.

## Validación antes de promover

1. Abrir la URL Preview en una ventana nueva.
2. Confirmar que el Supervisor aparece vinculado a la caja autorizada.
3. Abrir Inventario.
4. Confirmar que aparece únicamente la acción de ingreso remoto.
5. Confirmar que egreso, tasa, productos, usuarios y turnos no se habilitan por estas variables.

### Fase 6 — tasas remotas aisladas

Para probar únicamente tasas, usar un Preview separado con:

```env
VITE_SUPERVISOR_REMOTE_INCOME_ENABLED=true
VITE_SUPERVISOR_REMOTE_RATE_ENABLED=true
VITE_SUPERVISOR_REMOTE_EGRESS_ENABLED=false
```

Verificar BCV, Euro, USDT y manual; ACK, replay, timeout, pairing incorrecto y que productos, cierres y egresos continúen rechazados.
6. Enviar un ingreso pequeño y reversible.
7. Esperar ACK real.
8. Confirmar stock anterior, unidades agregadas y stock posterior.
9. Confirmar el movimiento `AJUSTE_ENTRADA`.
10. Probar doble clic y replay.
11. Desconectar la caja y confirmar timeout/degradado.
12. Confirmar que ventas, precios, usuarios y cierres no cambian.

## Rollback Vercel

Si falla cualquier comprobación:

1. Promover el deployment anterior en Vercel, o crear un nuevo deployment con:

```env
VITE_SUPERVISOR_REMOTE_INCOME_ENABLED=false
```

2. Confirmar que el Supervisor vuelve a solo lectura.
3. Verificar que no quedan comandos `pending`.
4. Revisar el último ACK y el movimiento auditado.
5. No habilitar `VITE_SUPERVISOR_REMOTE_EGRESS_ENABLED`.

## Estado desde este checkout

- Migración income-only de producción: aplicada y verificada.
- Build canary: compilado localmente.
- Preview Vercel: pendiente de acceso al proyecto Vercel.
- Producción frontend: no modificada desde este checkout.
