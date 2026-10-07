# PLAN DE FIXEO Y MEJORA — MODO SUPERVISOR E2E

**Documento ejecutable.** Diseñado para que un agente o desarrollador pueda implementar el fixeo por fases, con pruebas primero, guardarraíles explícitos y criterios verificables.

- **Fecha:** 2026-08-09
- **Proyecto:** `preciosaldia-bodega`
- **Reporte de origen:** auditoría del Modo Supervisor E2E realizada sobre `main`
- **Estado inicial:** build pasa; tests y lint no están verdes; no existe suite E2E del supervisor
- **Prioridad:** seguridad y autorización antes que mejoras visuales
- **Regla de release:** no habilitar mutaciones remotas mientras exista un hallazgo P0/P1 abierto
- **Progreso:** Fases 0–6 implementadas localmente; Fase 7 tiene arnés Playwright aislado y protegido contra producción accidental, pero sus escenarios funcionales siguen omitidos sin staging; Fase 8 tiene typecheck real y scripts de verificación; contención, recuperación Auth y comandos aplicados/verificados en producción; el flag de mutaciones sigue desactivado; el release final permanece bloqueado hasta E2E funcional contra staging seguro.

---

## §0. DECISIÓN DE SEGURIDAD QUE GOBIERNA TODO EL PLAN

> **El Modo Supervisor debe ser una capacidad autorizada de lectura y operación remota, no un canal público de Supabase protegido solo por `device_id` en el frontend.**

El pairing, la lectura de datos y cada comando remoto deben ser autorizados server-side. Un ID guardado en `localStorage`, un `targetDeviceId` o un canal Realtime público **no son credenciales**.

### Consecuencias obligatorias

1. No se permite CRUD anónimo directo sobre `sync_documents`.
2. No se permite publicar comandos en un canal Broadcast público.
3. El token de pairing debe ser temporal, de un solo uso, con rate limit y almacenado de forma segura.
4. El monitor solo puede leer la caja que realmente lo vinculó.
5. `unpair_monitor` debe validar al caller y el vínculo activo.
6. Cada comando debe tener autorización, expiración, `commandId`, idempotencia, ACK y auditoría.
7. El monitor solo aplica claves y payloads incluidos en una allowlist validada.
8. Los tests de seguridad deben fallar si una migración vuelve a otorgar permisos anónimos.

---

## §1. ALCANCE

### Dentro del alcance

- Entrada al Modo Supervisor desde `LockScreen`.
- Generación, expiración, consumo y revocación del pairing.
- Descarga inicial y sincronización Realtime.
- Separación caja/monitor en el árbol de ejecución.
- Autorización de comandos remotos.
- Cambio remoto de tasa.
- Creación, edición y eliminación remota de productos.
- Gestión remota de usuarios sin exponer hashes/PINs.
- Cierre y reapertura remota de turno.
- Métricas, cierres, COP, costos y manejo de `null`.
- Desconexión, reconexión, refresh y duplicación de eventos.
- Tests unitarios, de integración, seguridad y E2E.
- Guardarraíles de lint, typecheck, SQL y CI.

### Fuera del alcance de este plan

- Rediseño completo del panel visual.
- Migración total de `priceUsdt` a `priceUsd` en todo el POS.
- Sustitución completa de Supabase.
- Cambios no relacionados en checkout, Cashea o inventario local.
- Eliminación de datos existentes sin una migración y backup aprobados.

---

## §2. HALLAZGOS QUE ESTE PLAN DEBE CERRAR

| ID | Severidad | Hallazgo | Ubicación principal |
|---|---|---|---|
| SUP-001 | P0 | `anon` puede leer/modificar `sync_documents` por una política amplia de pairing | `supabase_pairing_setup.sql:116-143` |
| SUP-002 | P0 | Se activa sync al generar QR, antes de que exista monitor | `useCloudSync.js:297-311` |
| SUP-003 | P0 | Broadcast global sin autorización server-side | `useRemoteCommands.js:13-178` |
| SUP-004 | P0 | `docs is not defined` rompe init de sync | `useCloudSync.js:337-363` |
| SUP-005 | P0 | `unpair_monitor` permite desvinculación no autorizada | `supabase_pairing_setup.sql:95-111` |
| SUP-006 | P1 | Se envían órdenes antes de `SUBSCRIBED` | componentes `Monitor/*`, `OwnerMonitorView.jsx` |
| SUP-007 | P1 | `bodega_users_catalog_v1` no está en `SYNC_KEYS` | `useCloudSync.js:6-18` |
| SUP-008 | P1 | Alta/cambio de PIN asíncrono tratado como síncrono | `useAuthStore.js:442-490` |
| SUP-009 | P1 | Métricas usan `costPrice` aunque el payload usa `costUsd` | `OwnerMonitorView.jsx:88-120` |
| SUP-010 | P1 | Cierre remoto no es idempotente ni reutiliza el cierre normal | `useRemoteCommands.js:130-168` |
| SUP-011 | P1 | Monitor aplica documentos sin schema/allowlist | `useMonitorSync.js:22-83` |
| SUP-012 | P1 | `declaredCop` puede ser `null` y romper el render | `OwnerMonitorView.jsx:550-570` |
| SUP-013 | P1 | Token corto, público y sin rate limit | `supabase_pairing_setup.sql:35-84` |
| SUP-014 | P1 | `device_id` de monitor es manipulable y no es credencial | `PairingScanScreen.jsx:190-208` |
| SUP-015 | P1 | El monitor monta listeners de comandos de la caja | `App.jsx:52`, `useRemoteCommands.js` |
| SUP-016 | P2 | Errores y estados de sync se silencian | `useCloudSync.js`, `useMonitorSync.js` |
| SUP-017 | P2 | Scanner QR tiene carreras de estado/cleanup | `PairingScanScreen.jsx:67-173` |
| SUP-018 | P2 | No existe ACK, replay protection ni historial de comandos | arquitectura transversal |

---

## §3. LISTA DE GUARDARRAÍLES DUROS

Estos guardarraíles no son opcionales. Si una implementación necesita romper uno, se detiene la fase y se solicita decisión explícita.

| ID | Guardarraíl | Verificación |
|---|---|---|
| G1 | Nunca volver a otorgar CRUD anónimo sobre `sync_documents` | Test SQL + query de permisos |
| G2 | Nunca confiar en `targetDeviceId` como autorización | Test de comando sin firma/sesión |
| G3 | Nunca sincronizar `abasto-auth-storage`, hashes, PINs o passwords | Allowlist + test de payload |
| G4 | Nunca usar Broadcast público para una mutación autorizada | Revisión de arquitectura + test de canal privado |
| G5 | No activar sync por la mera existencia de una fila de pairing | Test de estados `pending/unpaired/paired/expired` |
| G6 | No modificar tests para ocultar errores | Test red primero y revisión de diff |
| G7 | No tocar `FinancialEngine` para corregir métricas del monitor si el problema está en el consumidor | Test de contrato de campos |
| G8 | Toda escritura remota usa lock y servicio de dominio existente | Test de concurrencia |
| G9 | Toda orden mutante tiene `commandId`, TTL, actor, target, schema y ACK | Test de replay y payload inválido |
| G10 | No ejecutar SQL destructivo en producción desde este plan | Staging primero, backup y checksum |
| G11 | No usar `git checkout --` sobre archivos con cambios ajenos | Rollback por patch/hunk propio |
| G12 | No hacer pasar `typecheck` con `|| true` | El comando debe fallar si hay errores |

### Campos que no se deben cambiar sin migración

- `bodega_sales_v1`
- `bodega_products_v1`
- `bodega_customers_v1`
- `bodega_accounts_v2`
- `abasto-auth-storage`
- `pda_pairing_mode`
- `pda_paired_device_id`
- `device_pairings.primary_device_id`

Si se necesita cambiar la forma de un documento persistido, primero se define versión, migración reversible y test de compatibilidad.

---

## §4. INVARIANTES DE NEGOCIO Y SEGURIDAD

1. Un pairing pendiente no autoriza lectura de datos.
2. Un pairing expirado no autoriza lectura ni comandos.
3. Un pairing desvinculado no autoriza lectura ni comandos.
4. Un monitor A no puede ver ni mutar la caja B.
5. Un monitor no puede convertirse en caja cambiando `localStorage`.
6. El primary device puede sincronizar solo su propio tenant/document set.
7. Una orden duplicada no puede duplicar un alta, cierre o eliminación.
8. Una orden aplicada debe poder confirmarse con `commandId`.
9. Un error de red nunca se presenta como éxito aplicado.
10. Los datos financieros del monitor deben coincidir con los datos de la caja usando los mismos tipos y campos.
11. Un cierre con COP faltante debe mostrarse como “sin declarar”, nunca romper el render.
12. La desvinculación debe detener acceso nuevo, pero no borrar datos locales de la caja.
13. El modo monitor no debe ejecutar listeners ni tareas propias de la caja.
14. Las claves sincronizadas deben tener schema explícito y versión.

---

## §5. CONVENCIONES DE EJECUCIÓN

1. Ejecutar fases en orden. Una fase roja bloquea la siguiente.
2. Antes de editar, revisar `git status --short` y conservar cambios ajenos.
3. No usar ediciones globales ni formatear todo el repositorio.
4. Cada fase debe incluir:
   - objetivo;
   - archivos propios;
   - tests red/green;
   - criterio de aceptación;
   - rollback focalizado.
5. Las ediciones de SQL se prueban en staging y se documenta el checksum de la migración aplicada.
6. Las funciones de Supabase se validan con un cliente anónimo y uno autorizado.
7. No se considera éxito una UI que muestra toast: se verifica el estado final en la caja y en la base de datos.
8. Toda orden remota se prueba con red lenta, pérdida de conexión y reintento.
9. Los tests no deben depender de datos reales ni de `.env` productivo.
10. Si el alcance cambia, actualizar este documento antes de implementar.

---

# FASE 0 — PRE-VUELO, CONTENCIÓN Y BASELINE

## Objetivo

Congelar el estado inicial, impedir que se agreguen nuevas mutaciones inseguras y registrar las fallas conocidas sin mezclarlas con los fixes.

## Acciones

1. Crear una rama de trabajo acordada con el equipo.
2. Ejecutar y guardar baseline:

```bash
bun run build
bun run test
bun run lint
bun run typecheck
```

3. Guardar el resultado en el issue/PR de implementación.
4. Marcar explícitamente como baseline conocido:
   - `useCloudSync.js:363` (`docs` indefinido);
   - tests con `queueCloudSync` no mockeado y OOM;
   - lint global con errores preexistentes;
   - typecheck inválido por ausencia de `tsconfig.json` y `|| true`.
5. Añadir feature flag de emergencia para dejar las mutaciones remotas deshabilitadas mientras se corrige la autorización.
6. No borrar ni modificar datos de Supabase todavía.

## Criterio de aceptación

- La aplicación sigue pudiendo operar localmente/offline.
- Las acciones remotas mutantes muestran “función temporalmente deshabilitada” o quedan detrás del flag.
- Existe un baseline guardado.
- `git status` contiene únicamente cambios propios de la fase.

## Rollback

Eliminar solo el feature flag creado en esta fase y revertir únicamente el hunk propio. No usar rollback global.

---

# FASE 1 — ARNÉS DE PRUEBAS UNITARIO Y DE CONTRATOS

**Estado:** base implementada en `src/services/supervisorContracts.js` y `tests/supervisor{Pairing,Sync,Commands,Metrics,Policy}.test.js`. Los contratos actuales pasan; faltan los tests de integración contra Supabase staging y los tests de UI/E2E.

## Objetivo

Construir la red de seguridad antes de corregir implementación. Los tests nuevos deben demostrar los fallos actuales o definir el comportamiento seguro objetivo.

## Archivos de tests propuestos

| Archivo | Responsabilidad |
|---|---|
| `tests/supervisorPairing.test.js` | máquina de estados, expiración, consumo único y validaciones del pairing |
| `tests/supervisorSync.test.js` | allowlist, schema, eco, estados de conexión y aplicación de documentos |
| `tests/supervisorCommands.test.js` | autorización, validación, TTL, idempotencia y ACK |
| `tests/supervisorMetrics.test.js` | costos, ventas, cierres, COP y paridad con la caja |
| `tests/supervisorSecurityContract.test.js` | guardarraíles de claves, acciones y payloads |

## Tests mínimos del pairing

- genera un token no predecible y suficientemente largo;
- no expone el token mediante `SELECT` público;
- rechaza token expirado;
- rechaza token ya consumido;
- rechaza segundo monitor si el producto permite uno solo;
- no activa sync en estado `pending`;
- permite lectura solo en estado `paired`;
- revocar pairing corta nuevas lecturas y comandos;
- monitor A no puede consultar device B;
- `unpair_monitor` rechaza caller no autorizado;
- IDs vacíos, excesivamente largos o con formato inválido son rechazados.

## Tests mínimos de sync

- solo aplica claves allowlisted;
- rechaza arrays donde se espera objeto y viceversa;
- descarta `abasto-auth-storage`, PINs y hashes;
- no re-emite un payload recibido desde la nube;
- conserva el último snapshot si falla un documento;
- retorna error verificable cuando falla el pull;
- `triggerRefresh()` no muestra éxito si el pull falló;
- `docs` queda definido en todas las ramas de inicialización.

## Tests mínimos de comandos

- rechaza comando sin actor autorizado;
- rechaza target diferente;
- rechaza `commandId` repetido;
- rechaza timestamp fuera de TTL;
- rechaza acción desconocida;
- rechaza payload parcial o con tipos incorrectos;
- no permite cambios de tasa `NaN`, negativos o modos no soportados;
- no permite borrar productos sin confirmación server-side;
- un cierre repetido no crea dos cierres;
- cada orden aplicada devuelve ACK con el mismo `commandId`;
- error de entrega queda como `failed`, no como `success`.

## Tests mínimos de métricas

- `costUsd` se usa como costo canónico;
- ventas Cashea/fiado no se cuentan como efectivo si no corresponde;
- apertura no se cuenta como venta;
- pagos de deuda y gastos siguen la semántica existente;
- cierre con `cashCop=null` no rompe el render ni produce `toLocaleString` sobre null;
- las métricas del monitor coinciden con el agregador usado por la caja.

## Criterio de aceptación

Los tests de seguridad deben fallar contra la implementación insegura actual o contra fixtures que violen el contrato. No se deben desactivar para que la fase pase.

## Rollback

Eliminar únicamente los archivos de tests nuevos si el contrato cambia antes de iniciar la implementación. Conservar los tests que capturen regresiones ya confirmadas.

---

# FASE 2 — HARDENING DE BASE DE DATOS Y PAIRING

**Estado:** diagnóstico completado. `supabase_supervisor_preflight.sql` queda como referencia; `supabase_supervisor_containment.sql` fue aplicada y verificada manualmente; Anonymous Auth está activo; `supabase_supervisor_auth_recovery.sql` fue aplicada en producción cuando se confirmó que no había usuarios activos del Supervisor. Debe desplegarse el frontend compatible antes de volver a probar pairing.

## Objetivo

Cerrar la exposición de datos y convertir el pairing en una capacidad autorizada.

## Diseño objetivo

### Estados de `device_pairings`

Definir explícitamente:

- `pending`: token emitido, sin monitor autorizado;
- `paired`: monitor autorizado y token consumido;
- `expired`: token vencido sin pairing;
- `revoked`: vínculo cancelado;
- `replaced`: vínculo sustituido por otro monitor, si el negocio lo permite.

### Migración SQL

Crear una migración nueva, versionada y reversible. No editar silenciosamente un SQL histórico ya usado en producción.

La migración debe:

1. revocar `SELECT/INSERT/UPDATE/DELETE` anónimo directo sobre `sync_documents`;
2. eliminar políticas `FOR ALL` que autoricen por mera existencia de `device_pairings`;
3. retirar la política pública que devuelve tokens o todos los pairings;
4. crear función/RPC segura para emitir pairing;
5. guardar hash del token, no el token en claro;
6. usar bytes aleatorios criptográficos;
7. aplicar expiración y consumo único;
8. limitar intentos por token/IP/dispositivo;
9. validar que el monitor recibido coincide con la capacidad emitida;
10. restringir `unpair_monitor` al primary o monitor autorizado;
11. impedir que `generate_pairing_token` active sync por sí solo;
12. registrar `paired_at`, `revoked_at`, `last_seen_at` y `token_used_at`;
13. dejar permisos mínimos para las RPC estrictamente necesarias.

### Decisión de autorización

Escoger una sola estrategia y documentarla antes de codificar:

- **Preferida:** Supabase Auth + claims/tabla de vínculo y RLS.
- **Alternativa:** Edge Function que emite una capacidad de monitor de corta duración y media todas las lecturas/comandos.

No mezclar “tabla pública + filtros del frontend” con RLS como si fueran equivalentes.

## Precondiciones antes de la migración de recuperación

1. Activar `Authentication > Providers > Anonymous` en Supabase Dashboard. **Completado vía Management API en `sodgzkablshladvbtnes`; verificado `external_anonymous_users_enabled=true`.**
2. Desplegar el frontend que usa `src/services/supervisorAuth.js` y mantiene la sesión de Supabase entre recargas. **Pendiente.**
3. Confirmar que ningún cliente pueda leer `sync_documents` mientras la migración esté pendiente. **Verificado después de la migración: `anon` sin grants y sin ejecución de RPC.**
4. Hacer backup de `device_pairings` y `sync_documents` en staging antes de migrar; en producción, se verificaron conteos previos: 15 pairings, 90 documentos y 2 backups.
5. Ejecutar `supabase_supervisor_auth_recovery.sql` solo después de la ventana aprobada. **Aplicada en producción con respuesta 201; se revocaron también TRUNCATE/REFERENCES/TRIGGER del rol authenticated.**
6. Re-vincular los monitores existentes: las filas se conservan, pero los vínculos antiguos no tienen identidad Auth y no deben reutilizarse automáticamente. **Pendiente del despliegue frontend.**

## Verificaciones staging

Ejecutar desde un cliente `anon`:

- no puede leer `sync_documents`;
- no puede insertar, actualizar ni borrar documentos;
- no puede listar tokens;
- no puede desvincular una caja;
- no puede ejecutar comandos no autorizados.

Ejecutar desde el primary y monitor autorizados:

- el pairing funciona una sola vez;
- solo se ve el tenant correcto;
- una revocación corta el acceso;
- renovar/revincular no expone snapshots anteriores de otro vínculo.

## Criterio de aceptación

No existe una combinación de políticas y grants que permita acceso anonimo a otra caja. Los tests de contrato SQL pasan y se conserva un backup verificable del staging antes de migrar producción.

## Rollback

Usar una migración inversa versionada. No restaurar permisos amplios `anon` como rollback. Si se detecta riesgo, mantener lectura remota deshabilitada y operar POS localmente.

---

# FASE 3 — SINCRONIZACIÓN CORRECTA Y SEGURA

**Estado:** implementación local completada; 23 tests de Supervisor verdes y build verificado. Falta validar con dos navegadores contra producción/staging después del despliegue.

## Objetivo

Reparar el motor de sync y garantizar que monitor y caja tengan estados explícitos, sin ecos ni falsos éxitos.

## Archivos principales

- `src/hooks/useCloudSync.js`
- `src/hooks/useMonitorSync.js`
- `src/utils/storageService.js`
- `src/config/backupKeys.js`
- `src/services/supervisorSyncService.js`

## Cambios requeridos

1. Declarar `docs` fuera del bloque condicional y asignarlo siempre.
2. Separar pull inicial, push local y suscripción Realtime.
3. Reemplazar booleanos globales ambiguos por un estado explícito:
   - `idle`;
   - `pending_pairing`;
   - `syncing`;
   - `connected`;
   - `degraded`;
   - `error`;
   - `revoked`.
4. Hacer que la función de push devuelva `{ok, error, updatedAt}`.
5. No actualizar hash local si el upsert no fue confirmado.
6. Añadir backoff con límite y reintento manual.
7. Reutilizar el schema validator del primary en el monitor.
8. Crear allowlist única de documentos del monitor.
9. Añadir versión de payload:

```js
{
  schemaVersion: 1,
  payload: ...,
  updatedAt: '...'
}
```

10. Ignorar documentos más viejos que el snapshot local, salvo refresh forzado autorizado.
11. No aplicar documentos de autenticación, sesión o credenciales.
12. Evitar que el monitor escriba de vuelta por listeners de la caja.
13. Cleanup completo de canales al cambiar de pairing o desmontar.
14. Usar un helper que espere explícitamente el estado `SUBSCRIBED`.
15. Reportar errores al panel y no solo a consola.

## Implementación realizada

- `supervisorSyncService.js` centraliza estados, envelope v1, watermark temporal y backoff.
- Primary y monitor comparten la allowlist de `supervisorContracts.js`.
- El push devuelve resultado verificable y solo guarda el hash después de un upsert confirmado.
- El monitor rechaza payloads viejos, repetidos, inválidos o de schema no soportado.
- La suscripción Realtime espera `SUBSCRIBED`, tiene timeout y cleanup por instancia.
- El monitor expone `syncState`/`syncError`; el refresh manual ya no muestra éxito cuando falla.
- El monitor no re-emite los documentos recibidos.

## Criterio de aceptación

- Pull inicial correcto.
- Actualización Realtime correcta.
- Refresh manual verificable.
- Reconexión sin duplicar listeners.
- No hay eco monitor → caja.
- Un fallo de red no se muestra como éxito.
- Los tests de concurrencia y schema pasan.

## Rollback

Revertir solo los cambios del servicio de sync y mantener el feature flag de mutaciones remotas deshabilitado. No reactivar las políticas SQL antiguas.

---

# FASE 4 — COMANDOS REMOTOS AUTORIZADOS

**Estado:** arnés local implementado; Broadcast público eliminado del frontend; 26 tests de Supervisor verdes y build verificado. La migración `supabase_supervisor_commands.sql` fue aplicada en producción y verificada; el flag de mutaciones sigue desactivado y faltan pruebas E2E antes de habilitarlo.

## Objetivo

Reemplazar el Broadcast público y no confiable por una entrega autorizada, validada y observable.

## Contrato de comando objetivo

```js
{
  commandId: 'uuid',
  type: 'supervisor.product.update',
  actor: {
    monitorDeviceId: '...',
    sessionId: '...'
  },
  targetDeviceId: '...',
  issuedAt: '2026-08-09T00:00:00.000Z',
  expiresAt: '2026-08-09T00:01:00.000Z',
  payload: {},
  schemaVersion: 1
}
```

## Requisitos

1. El servidor autentica actor y target.
2. El servidor valida el tipo y payload.
3. El servidor rechaza comandos vencidos.
4. El servidor registra `commandId` y no lo aplica dos veces.
5. El receptor responde ACK/NACK.
6. El supervisor muestra estado `pendiente/aplicado/fallido`.
7. El comando se audita sin guardar PINs ni secretos.
8. El canal Realtime, si se conserva, debe ser privado y solo para entregar eventos ya autorizados.
9. El comando no debe depender de que `subscribe()` haya “parecido” awaitable.
10. El receptor debe ignorar comandos sin target, actor o `commandId`.

## Matriz de comandos

| Comando | Validaciones | Idempotencia |
|---|---|---|
| `rate.set` | modo permitido, tasa finita y positiva | última versión o `commandId` |
| `product.create` | nombre, precio, stock, campos canónicos | `productId`/`commandId` |
| `product.update` | producto existente, patch permitido | versión optimista |
| `product.delete` | confirmación, producto existente | `productId`/`commandId` |
| `user.create` | rol permitido, PIN validado localmente y nunca emitido de vuelta | `commandId` |
| `user.pin.change` | usuario existente, PIN válido | `commandId` |
| `user.delete` | no borrar último ADMIN ni usuario activo | `commandId` |
| `shift.close` | turno activo, actor autorizado | `shiftId` |
| `shift.reopen` | cierre específico, motivo y autorización | `shiftId`/`commandId` |

## Cambios de frontend

- `SupervisorRateModal.jsx`
- `RemoteProductFormModal.jsx`
- `RemoteUsersManager.jsx`
- `OwnerMonitorView.jsx`
- `useRemoteCommands.js`

Eliminar las rutas directas que hacen `channel.send` sin confirmación. Centralizar el envío en un servicio con:

```js
const result = await supervisorCommandService.send(command);
if (!result.ok) showToast(result.error, 'error');
```

## Implementación realizada

- `supervisorCommandService.js` centraliza creación, TTL, validación, RPC y espera de ACK.
- `useRemoteCommands.js` ya no escucha `system_commands` ni Broadcast; escucha filas autorizadas de `supervisor_commands`.
- La caja valida target, tipo, TTL y replay antes de procesar.
- La caja responde `applied`, `rejected` o `failed` mediante RPC.
- Tasa, productos y turnos fueron migrados al servicio central; los usuarios siguen bloqueados hasta definir un flujo seguro para PINs.
- `supabase_supervisor_commands.sql` agrega RLS, RPC, idempotencia y Realtime; fue aplicada y verificada en producción con cero comandos.
- El feature flag continúa en `false`.

## Criterio de aceptación

Un payload fabricado desde DevTools, un canal anónimo o un `targetDeviceId` manipulado no puede mutar la caja.

## Rollback

Desactivar el feature flag de comandos y conservar solo lectura. No volver a activar el canal público como fallback.

---

# FASE 5 — CORRECCIÓN DE DATOS, CIERRES Y MÉTRICAS

**Estado:** implementación local completada; 32 tests de Supervisor verdes; FinancialEngine existente sin cambios; build y pruebas financieras principales verificadas. El flag de mutaciones remotas continúa en `false` y no se ejecutó SQL nuevo.

## Objetivo

Asegurar que el panel supervisor muestre la misma verdad financiera y operativa que la caja.

## Cambios requeridos

1. Corregir métricas de costo para usar `costUsd` y mantener fallback explícito solo para datos legacy.
2. Crear un normalizador de producto compartido para el panel.
3. Reutilizar el servicio normal de cierre de caja en el cierre remoto.
4. Pasar `shiftId`/`cierreId` explícito; no usar “último cierre global”.
5. Evitar marcar transacciones de otros turnos como cerradas.
6. Hacer cierre y reapertura idempotentes.
7. Persistir quién autorizó la operación remota y cuándo.
8. Corregir `declaredCop=null` y todos los casos similares de `null`.
9. Sustituir cálculos financieros directos del monitor por helpers existentes (`dinero.js`, `FinancialEngine`, formateadores canónicos).
10. Alinear filtros de ventas, cobros, gastos, apertura y Cashea con los agregadores del POS.
11. No cambiar la lógica del `FinancialEngine` sin test de regresión específico.
12. Definir si el supervisor ve datos estimados o conciliados y rotular la diferencia en UI.

## Implementación realizada

- `supervisorFinancials.js` normaliza productos, ventas, cierres y valores COP sin mutar documentos persistidos.
- Las métricas de margen usan `FinancialEngine` cuando existen precios de los items y conservan fallback explícito para fixtures/datos legacy incompletos.
- El historial de cierres se agrupa por `cierreId` explícito, sin mezclar turnos; el desglose canónico conserva apertura, pagos, vuelto y COP.
- El monitor reutiliza el normalizador para margen, flujo de caja y cierres.
- COP no declarado se presenta como `Sin declarar` y no se llama `toLocaleString` sobre `null`.
- El cierre remoto preparado exige `shiftId` y `cierreId`, reutiliza el vínculo de apertura activo, evita cerrar toda la base y hace no-op ante un cierre/reapertura repetidos.
- `supabase_supervisor_commands.sql` valida ambos identificadores; el flag de mutaciones no se habilitó.

## Criterio de aceptación

Para un fixture idéntico de ventas, productos, pagos y cierre:

- caja y supervisor muestran los mismos totales;
- el costo y margen coinciden;
- COP faltante no rompe la vista;
- cerrar dos veces no duplica cierre;
- reabrir afecta exactamente el cierre seleccionado;
- los tests financieros existentes siguen pasando.

## Rollback

Revertir solo el normalizador/métricas/comando propio. No revertir migraciones financieras existentes ni cambiar datos persistidos manualmente.

---

# FASE 6 — UX, CICLO DE VIDA Y RESILIENCIA

**Estado:** implementación local completada; scanner, polling y Realtime tienen cleanup/reintentos controlados; 36 tests de Supervisor verdes tras añadir guardarraíles de ciclo de vida. La validación funcional con dos navegadores queda pendiente de staging seguro.

## Objetivo

Eliminar falsos estados de éxito y carreras de cámara/suscripciones.

## Cambios requeridos

1. `PairingScanScreen`:
   - `scanInFlightRef` para impedir doble lectura;
   - cancelación de timers al desmontar;
   - espera real de stop antes de iniciar otra cámara;
   - estado de error accionable;
   - no reiniciar scanner si el método cambió.
2. `PairingManager`:
   - detener polling cuando hay error definitivo;
   - mostrar expiración y pairing confirmado por server;
   - no usar `select('*')` si no es necesario.
3. `OwnerMonitorView`:
   - deshabilitar acciones si no hay conexión o pairing válido;
   - indicar último sync y estado degradado;
   - no mostrar “en vivo” antes de confirmar canal.
4. `useMonitorSync`:
   - re-suscribirse después de reconexión;
   - no duplicar `monitorSubscription` global;
   - limpiar subscription por instancia/pairing.
5. Todos los toasts de éxito deben depender de respuesta confirmada.
6. Añadir botón de reintento y diagnóstico no sensible.

## Criterio de aceptación

Los escenarios de red lenta, offline, refresh y cambio de pairing no dejan listeners duplicados ni órdenes huérfanas.

---

# FASE 7 — ARNÉS E2E REAL

**Estado:** arnés Playwright añadido con Chromium, dos contextos aislados, trazas y protección que impide ejecutar contra una URL no localhost/staging. La ejecución final produjo 2 casos omitidos porque no existe `SUPERVISOR_E2E_ENABLED=true` con una URL staging/local explícita; no se falsifica cobertura Realtime/RLS contra producción.

## Objetivo

Probar el flujo completo con dos dispositivos de navegador aislados y una base de staging.

## Estado actual

Playwright y las specs base ya están en el repositorio. La ejecución por defecto queda protegida y omitida porque no existe una URL staging segura configurada; el arnés no usa el proyecto real sin `SUPERVISOR_E2E_ENABLED=true` y `SUPERVISOR_E2E_BASE_URL` explícitos.

## Harness propuesto

Adoptar un runner E2E de navegador en `tests/e2e/` — preferiblemente Playwright por soporte de múltiples contextos y trazas— después de aprobar la nueva dependencia.

El harness debe crear:

- contexto `primary` para la caja;
- contexto `monitor` para el supervisor;
- almacenamiento local/IndexedDB aislado;
- fixtures de productos, usuarios y ventas sintéticas;
- Supabase staging o mocks de red controlados;
- captura de consola, red, screenshot y trace ante falla.

## Flujos E2E obligatorios

### E2E-01 — Pairing exitoso

1. Caja genera pairing.
2. Monitor introduce código manual.
3. Token se consume una sola vez.
4. Monitor entra al panel.
5. Caja queda en estado `paired`.

### E2E-02 — Pairing inválido/expirado/replay

1. Código incorrecto.
2. Código expirado.
3. Código usado dos veces.
4. Exceso de intentos.
5. No se crea acceso ni se suben datos antes del pairing.

### E2E-03 — Pull y Realtime

1. Cargar fixture en caja.
2. Vincular monitor.
3. Verificar productos, ventas y métricas.
4. Crear una venta en caja.
5. Verificar actualización del monitor.
6. Verificar que el monitor no re-emite el documento.

### E2E-04 — Desconexión/reconexión

1. Cortar red del monitor.
2. Registrar cambios en caja.
3. Verificar estado degradado.
4. Restaurar red.
5. Verificar convergencia sin duplicados.

### E2E-05 — Comandos autorizados

Probar tasa, producto, usuario y cierre. Cada flujo debe verificar:

- comando creado;
- ACK recibido;
- estado final en caja;
- auditoría;
- persistencia después de refresh.

### E2E-06 — Ataques

1. Publicar comando sin sesión.
2. Cambiar `targetDeviceId`.
3. Repetir `commandId`.
4. Alterar payload.
5. Usar pairing de otra caja.
6. Llamar `unpair_monitor` desde anon.
7. Leer `sync_documents` desde anon.
8. Intentar inyectar `abasto-auth-storage`.

Todos deben ser rechazados.

### E2E-07 — Cierre y COP

1. Cerrar turno remoto.
2. Verificar un solo registro de cierre.
3. Confirmar totales USD/Bs/COP.
4. Probar COP no declarado.
5. Repetir comando.
6. Reabrir el cierre seleccionado, no otro.

### E2E-08 — Dos monitores y revocación

Según la decisión de producto:

- si solo se permite uno, el segundo es rechazado;
- si se permiten varios, cada uno tiene capacidad independiente y revocable.

Tras revocar uno, ese monitor no debe leer ni mutar, mientras el otro sigue funcionando.

## Criterio de aceptación

La suite E2E pasa en Chromium en staging con datos sintéticos y falla correctamente en cada escenario de ataque.

---

# FASE 8 — GUARDARRAÍLES DE CI Y CALIDAD

**Estado:** typecheck real configurado en `tsconfig.json`; scripts `test:supervisor`, `test:e2e`, `lint:supervisor` y `verify:supervisor` añadidos; guardarraíles SQL y de ciclo de vida activos. `typecheck`, tests, build y `lint:supervisor` pasan sin errores; el lint global conserva 69 errores legacy fuera del gate Supervisor y 1.638 warnings.

## Objetivo

Evitar que los hallazgos vuelvan a entrar por una modificación futura.

## Cambios de tooling

1. Crear un `tsconfig.json` válido para el check incremental de JavaScript/JSX.
2. Eliminar `|| true` del script `typecheck`.
3. Corregir el mock de `queueCloudSync` en tests.
4. Ejecutar Vitest con configuración estable de workers para evitar OOM.
5. Añadir script dedicado:

```json
{
  "test:supervisor": "vitest run tests/supervisor*.test.js",
  "test:e2e": "playwright test tests/e2e",
  "lint:supervisor": "eslint src/App.jsx src/components/PairingScanScreen.jsx src/components/Settings/PairingManager.jsx src/hooks/useCloudSync.js src/hooks/useMonitorSync.js src/hooks/useRemoteCommands.js src/views/OwnerMonitorView.jsx src/components/Monitor",
  "verify:supervisor": "bun run lint:supervisor && bun run test:supervisor && bun run build"
}
```

6. Añadir guardrail que falle si aparecen:
   - `GRANT ... TO anon` sobre tablas de datos;
   - `channel('system_commands')` sin helper autorizado;
   - `pushCloudSync` con claves fuera de allowlist;
   - sincronización de `abasto-auth-storage`;
   - `targetDeviceId` usado como único control de autorización;
   - `catch` silencioso en flujos de pairing/comandos.
7. Añadir validación SQL estática en CI.
8. Hacer que tests de seguridad no requieran secretos productivos.

## Gates obligatorios

| Gate | Debe cumplir |
|---|---|
| Unit | 0 fallos, 0 errores no manejados |
| Supervisor integration | sync, schemas y comandos pasan |
| Security | RLS/anon attack tests pasan |
| E2E | pairing, realtime, offline, commands y replay pasan |
| Build | producción compila sin errores |
| Lint supervisor | 0 errores; warnings nuevos justificados |
| Typecheck | comando real, sin `|| true` |
| Data contract | métricas caja/monitor coinciden |

---

# FASE 9 — RELEASE, MIGRACIÓN Y OPERACIÓN

**Estado:** no hay SQL adicional necesario para Fases 6–8. En producción se verificaron de forma read-only las migraciones de recuperación Auth y comandos: tablas/RLS presentes, 15 pairings, 90 documentos, 0 comandos, `anon` sin grants ni EXECUTE de RPC y `search_path` fijado en las 5 RPC. No se reejecutaron migraciones destructivas ni se habilitaron mutaciones. El release final sigue bloqueado hasta E2E staging y decisión explícita sobre el flag.

## Checklist antes de producción

- [x] Feature flag mutaciones remotas permanece desactivado durante la validación.
- [ ] Feature flag mutaciones remotas solo se activa después de E2E P0/P1 verdes.
- [x] Migración SQL de comandos aplicada de forma idempotente en producción y verificada; staging E2E sigue pendiente.
- [ ] Backup de `device_pairings` y `sync_documents` validado.
- [ ] RLS verificada desde cliente anon.
- [ ] No hay grants anon de CRUD sobre datos POS.
- [ ] Tokens antiguos invalidados o migrados.
- [ ] Clientes antiguos no pueden mutar mediante el canal anterior.
- [ ] `commandId` e idempotencia comprobados.
- [ ] Logs de pairing, revocación, comando y error activos.
- [ ] Alertas para picos de pairing fallido, comandos rechazados y errores Realtime.
- [ ] Tests unitarios, integración, seguridad, build y E2E verdes.
- [ ] Plan de rollback documentado para frontend y SQL.
- [ ] No se incluyeron secretos, datos reales ni backups PII.

## Métricas operativas recomendadas

- pairings emitidos/consumidos/expirados;
- intentos fallidos por token;
- tiempo hasta primer snapshot;
- latencia de actualización Realtime;
- porcentaje de ACK/NACK;
- comandos repetidos/rechazados;
- reconexiones por monitor;
- divergencias de totales caja/monitor;
- cierres remotos duplicados evitados;
- monitores revocados activos.

---

# §10. ORDEN DE IMPLEMENTACIÓN RESUMIDO

1. **Fase 0:** contener mutaciones y capturar baseline.
2. **Fase 1:** escribir arneses y contratos de seguridad.
3. **Fase 2:** corregir RLS, pairing, tokens y revocación.
4. **Fase 3:** reparar sync, schemas, estados y cleanup.
5. **Fase 4:** implementar comandos autorizados, ACK e idempotencia.
6. **Fase 5:** corregir métricas, cierres y COP.
7. **Fase 6:** endurecer UX, red y ciclo de vida.
8. **Fase 7:** ejecutar E2E real con dos contextos.
9. **Fase 8:** cerrar CI, lint, typecheck y guardrails.
10. **Fase 9:** staging, migración, observabilidad y release.

**No saltar directamente a Fase 5 o 6:** una UI correcta sobre autorización insegura no es una mejora aceptable.

---

# §11. DEFINICIÓN DE TERMINADO

El Modo Supervisor se considera terminado únicamente cuando:

1. no existe acceso anon a datos de otra caja;
2. el pairing es temporal, verificable y revocable;
3. todos los comandos tienen autorización server-side;
4. replay, payload tampering y target spoofing son rechazados;
5. la sincronización converge tras offline/reconnect;
6. no hay falsos éxitos de UI;
7. las métricas coinciden con la caja;
8. cierres y reaperturas son idempotentes;
9. no se exponen credenciales ni PINs;
10. la suite E2E cubre el flujo normal y ataques;
11. lint, typecheck, tests y build son gates reales;
12. existe rollback de frontend y base de datos.

**Resultado esperado:** Supervisor funcional, observable y seguro, con una ruta de degradación a solo lectura/offline cuando la conectividad o autorización no estén disponibles.

---

# §12. CIERRE DE LA EJECUCIÓN ACTUAL

La implementación local de las Fases 0–8 quedó validada con:

```text
Tests completos: 228 pasan, 10 omitidos
Tests Supervisor: 36 pasan
Typecheck: pasa
Build: pasa
Lint Supervisor: 0 errores, warnings legacy
Lint global: falla por 69 errores legacy fuera del gate Supervisor
E2E Playwright: 2 omitidos por falta de staging seguro
```

No se aplicó SQL nuevo en este cierre porque las migraciones requeridas ya existen en producción y la verificación read-only confirmó su estado. No se modificaron filas de ventas, productos, clientes, usuarios ni documentos. El único bloqueo pendiente de la definición de terminado es configurar un staging sintético y ejecutar los E2E funcionales; hasta entonces `SUPERVISOR_REMOTE_MUTATIONS_ENABLED` debe permanecer en `false`.
