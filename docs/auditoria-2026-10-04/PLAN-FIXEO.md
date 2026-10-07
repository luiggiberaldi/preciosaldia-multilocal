# Plan completo de fixeo — PreciosAlDía Multilocal

**Base:** [informe de auditoría](INFORME.md), versión declarada 2.1.56, 4/10/2026 Caracas; [anexo sync autenticado real](evidencias/sync-real-interpretacion.md), capturas 5/10 UTC.  
**Estado:** propuesta ejecutable por fases; **ningún fix ni cambio productivo aplicado**.  
**Meta:** aislar cuentas/sedes/equipos, garantizar operaciones financieras durables e idempotentes y certificar los flujos mediante pruebas reproducibles, no sólo build.

## 1. Orden de ejecución y reglas de trabajo

```text
F0: baseline, staging, respaldo verificado y contratos de negocio
 ├─ F1: frontera backend, pairing/RLS/registro/revocación/proxy
 ├─ F2: locks + persistencia + commit financiero + sync básico/contexto
 ├─ F6a: reproducibilidad y regresiones de los defects confirmados
 └─ F0-S: preservar/conciliar el estado sync real + proveniencia del bundle
       ↓
F3: cuenta/licencia/Storage/backup/contratos externos
       ↓
F4: sincronización durable y convergencia multi-equipo
       ↓
F5: nómina + sesión/UI + configuración + validación de módulos
       ↓
F6b: campaña E2E/performance/dispositivos + endurecimiento de despliegue
       ↓
F7: canary supervisado, reconciliación y rollout autorizado
```

F1/F2/F6a y la captura no mutadora F0-S se pueden preparar en paralelo con responsables separados; **no se deben mezclar migraciones, reparación de datos y nuevos protocolos de sync en un único despliegue**. F4 depende del modelo de operaciones de F2. F5 depende de persistencia/roles definidos y F3. Cada fase tiene su propia puerta de aceptación.

Reglas:

- Trabajar primero sobre una copia/staging con datos ficticios o anonimizados. No clonar PII innecesaria.
- Preservar los tests actuales y explicar cualquier cambio de contrato. No lograr verde desactivando assertions, lint ni controles de seguridad.
- Evitar overrides locales de roles/licencia como criterio de aceptación de una integración real; los fixtures sintéticos sólo sirven para aislar UI.
- Las migraciones deben ser versionadas, reversibles cuando sea seguro y ensayadas sobre instalación nueva **y** esquema actual con sus overloads/policies heredadas.
- La auditoría no autoriza por sí sola un deploy, mutación de producción, revocación masiva, reset, eliminación de filas ni rotación de claves. Esas acciones necesitan autorización explícita y ventana operativa.
- No restaurar una vulnerabilidad como rollback. La alternativa es un modo seguro temporal con funciones afectadas restringidas y datos pendientes conservados.
- Nunca borrar la cola de operaciones ni recalcular saldos destructivamente para ocultar discrepancias.

## 2. Decisiones de producto que deben cerrarse antes de certificar

Son decisiones pendientes, **no defaults que ya hayamos aplicado**:

| Decisión | Propuesta para revisar | Consecuencia |
|---|---|---|
| Sobreventa offline entre equipos | Elegir reserva online estricta o cuotas de stock por equipo; si se admite sobreventa eventual, mostrarla y reconciliarla explícitamente | No es posible garantizar globalmente stock no negativo con equipos desconectados que comparten todo el stock. |
| Operación tras revocación sin red | Acceso offline limitado por vigencia/capability y datos locales protegidos; toda operación remota rechazada inmediatamente | Revocación servidor no borra ni bloquea mágicamente un dispositivo offline. |
| Rol ADMIN y pestañas Control/Nómina | Una matriz de permisos aprobada por acción y sede; mantener sólo dueño para liquidar, según contrato vigente | Resolver contradicciones entre comentarios/tests/UI antes de cambiar permisos. |
| Recuperación del PIN maestro | Confirmar la decisión documentada del 2/10 de permitirla con clave de emergencia, confirmación y auditoría | Sustituir tests textuales obsoletos sin quitar seguridad efectiva. |
| Imágenes de productos públicas | Mantener públicas sólo las imágenes comerciales aprobadas; documentos privados fuera del bucket público | La policy de escritura debe aislar aunque se conserve lectura pública. |
| Respaldo y retención | Aprobar RPO/RTO, sedes incluidas, cifrado, caducidad y prueba periódica de restauración | El timer de 30 min no es una garantía de RPO de 30 min. |
| Compatibilidad legacy/anónima | Definir capacidades de POS anónimo, monitor y dueño; limitar el puente legado con plan de retiro | `authenticated` también incluye usuarios anónimos de Supabase. |

Responsables sugeridos: dueño de producto para reglas; backend para policies/RPC; frontend/datos para transacciones/sync; QA para campaña; operación para respaldo/rollout. No hacen falta nuevos proveedores para comenzar.

## 3. Contratos técnicos propuestos

Estas interfaces son objetivos del fixeo, **no esquemas ya existentes ni una migración lista para copiar**. La implementación debe adaptar el almacenamiento actual con los mínimos cambios seguros.

### 3.1 Contexto inmutable de operación

```ts
type OperationContext = {
  accountId: string;
  businessId: string;
  deviceId: string;
  schemaVersion: number;
};
```

Capturarlo al iniciar la acción, no al finalizar un timer o un await. Todo acceso físico, lock, movimiento, outbox y documento remoto utiliza este contexto. Un cambio de negocio no altera el destino de una operación en curso. Las claves globales se enumeran explícitamente y no se confunden con claves por sede.

### 3.2 Commit financiero y recibo durable

```ts
type CommitResult = {
  operationId: string;
  committedAt: string;
  durability: 'indexeddb';
  cloudStatus: 'pending' | 'confirmed';
};
```

- Una transacción IndexedDB real puede actualizar varias claves del mismo object store; no basta encadenar `localforage.setItem` ni envolverlas en un lock.
- Escribir juntos venta, movimientos de stock/cartera/caja, ID de idempotencia y outbox. Se permiten proyecciones reconstruibles con versión, pero no confirmaciones parciales.
- Los fallos de commit rechazan la promesa con error tipado. Si se ofrece almacenamiento alternativo, debe probar la misma durabilidad y consistencia; mientras no exista, bloquear confirmación y conservar la cesta, en vez de declarar venta exitosa.
- El recibo representa commit local, no confirmación de nube. La UI debe distinguir «guardado en este equipo» de «sincronizado».
- La red no participa dentro de una transacción IDB larga. El envío ocurre después desde outbox.

### 3.3 Movimiento de stock y cola durable

```ts
type StockMovement = {
  id: string;
  operationId: string;
  businessId: string;
  deviceId: string;
  productId: string;
  deltaBaseUnits: number;
  kind: 'sale' | 'void' | 'purchase' | 'adjustment' | 'payroll_consumption';
  occurredAt: string;
  schemaVersion: number;
};

type OutboxEntry = {
  id: string;
  context: OperationContext;
  docId: string;
  operationId: string;
  revision: string;
  payloadDigest: string;
  status: 'pending' | 'sending' | 'confirmed' | 'blocked';
  attempts: number;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
};
```

- ID único y deduplicación servidor/local por ámbito; origen de un movimiento inmutable. Una copia agregada nunca es una venta nueva.
- Baseline de inventario versionado y auditable; una anulación referencia la venta/movimiento original y no duplica la reversión.
- Unidades base y redondeo definidos para granel; dinero en unidades enteras/decimales controlados según moneda. `Number.isFinite` en todos los bordes.
- Digest sobre payload completo y serialización estable, o revisión explícita; no usar prefijo truncado como prueba de igualdad.
- Índice/constraint remoto que garantice unicidad; RLS derivada de membresía verificada, nunca de un `owner_id` libre del payload.
- Confirmar sólo la revisión enviada. Un ACK antiguo no limpia una modificación posterior.

### 3.4 Resultado honesto de sincronización

```ts
type SyncResult = {
  status: 'success' | 'partial' | 'failed' | 'offline';
  pulled: number;
  pushed: number;
  pending: number;
  failed: Array<{ docId: string; code: string }>;
};
```

Cursor estable compuesto por timestamp+desempate único, paginación completa y checkpoint sólo tras aplicación durable. Si un documento falla, conservar retry específico aunque otros puedan avanzar; no dejarlo perdido tras el watermark. Política explícita para registros inválidos/quarantined y alertas.

### 3.5 Backend y respaldo

- Backend valida UID, tipo de sesión, cuenta, sede, equipo activo y permiso de acción independientemente del frontend.
- Un monitor recibe capacidad limitada/read-only con expiración y revocación; un header identificador no es una credencial.
- Registro de equipo recibe identidad verificable y alias; límite comercial obtenido servidor. Un único contrato RPC, sin parámetro autoritativo de límite controlado por cliente.
- Reporte de equipos debe consumir `{ ok, devices }` y diferenciar error de lista vacía.
- Respaldo confirmado incluye ID, versión, contexto, digest completo, tamaño real en bytes y referencia recuperable; separar estado de archivo y estado de metadatos.
- `VITE_*` contiene configuración pública, nunca autoridad secreta de escritura. Las credenciales de usuario no forman parte de fixtures ni informes.

## 4. F0 — Base segura y checkpoint recuperable

**Cubre:** AUD-034 y preparación de todos. **Prioridad:** antes de cualquier despliegue.

### Trabajo

1. Inventariar build publicado, versión de fuente, runtime, lock y esquema realmente instalado; resolver ausencia de Git con baseline verificable sin sobrescribir trabajo ajeno.
2. Mapear Supabase cliente, directorio y Estación; confirmar qué backend sirve cada RPC/API. No apuntar staging a producción por defaults de URL.
3. Crear staging/cuentas ficticias A y B, sedes A1/A2/B1, equipos y monitor de prueba.
4. Exportar esquema/policies/grants y respaldos necesarios con acceso restringido; probar descarga/restauración **antes** de alterar datos o RLS.
5. Definir los contratos de negocio del apartado 2 y una matriz de roles/acciones.
6. Registrar baseline de saldos, cantidad/IDs de ventas, stock, ledger, nómina y pendientes; sin listar PII en logs de CI.

**Aceptación:** mapa de entornos y capacidades sin ambigüedad; staging aislado, sin peticiones a producción; respaldo restaurado con invariantes concordantes; baseline identificable.

**Rollback:** no hay cambio funcional; detener preparación si el respaldo no se puede verificar o si hay mezcla de entornos. Artefacto de cierre: runbook y baseline firmados por responsable.

## 5. F1 — Cerrar la frontera de autorización

**Cubre:** AUD-001, 002, 021, 022, 027, 029, SR-001/002. **Prioridad:** P0/P1.

### Paquetes

| Paquete | Implementación requerida | Prueba de aceptación |
|---|---|---|
| F1.1 Pairing | Revocar EXECUTE innecesario; comprobar actor/propiedad; search_path seguro; token criptográfico, rate-limit y canje atómico de uso único | Anon/otra cuenta/ID ajeno no generan ni desparean; token vencido/reutilizado falla; dos canjes simultáneos sólo uno válido. |
| F1.2 RLS | Inventariar todas las policies efectivas y reemplazar rutas permisivas inseguras; header/payload no dan autoridad; SELECT/WRITE separados | Matriz DML completa A/B/monitor/anon/revocado, incluyendo headers falsos y owner_id falsificado. |
| F1.3 Equipos | Unificar overloads, límite servidor, serialización por cuenta, grants mínimos y estado de revocación integrado | Diez altas concurrentes cerca del límite no lo superan; INSERT directo falla; revocado no lee/escribe ni se reactiva solo. |
| F1.6 Revocación y retención | Separar derechos de autor actual y lectura histórica owner; comparar source ID con active-membership en SELECT, write y Realtime de cada consumidor | Token/sesión del equipo revocado rechazados; owner conserva histórico sólo por ruta explícita si se aprueba. Probar con JWT del dispositivo en staging. La consulta owner (no el dispositivo) vio 48 rows fuera de tres activos, incluidas 36 del único `account_devices.revoked=true`; esto **no** prueba lectura/escritura del equipo ni actividad posterior. |
| F1.7 Salida de release | Registrar deployment SHA, source commit, env/schema version y hash de artefacto; comparar branch esperado de modo cuenta con bundle de destino. | Build de candidato es trazable/reproducible; smoke comprueba branch correcto en canary antes de rollout. Una diferencia de SHA sola no se bloquea si la release declarada la explica. |
| F1.4 Privilegios/esquema | Revisar TRUNCATE/TRIGGER/REFERENCES; migración registrada sobre esquema actual; detectar drift | Snapshot schema/policies/ACL coincide con contrato; instalación limpia e upgrade pasan. |
| F1.5 Proxy | Restringir destinos/esquema/resolución/redirects, limitar bytes/tiempo/MIME y acceso | Pruebas locales para localhost/IP privada/IPv6/DNS/redirect prohibidos; HTML y cuerpos grandes rechazados; imagen permitida funciona. |

### Puerta de salida

- Negativos de seguridad fallan por rechazo intencional y no por fixture defectuoso o tabla inexistente.
- Positivos de dueño/monitor autorizado funcionan con sesiones reales de staging.
- No usar la prueba anon de cero filas como única evidencia: fixtures deben existir.
- Compatibilidad con cliente anterior documentada. Revisar que endurecer RLS no deje a todos los equipos sin servicio.

**Rollback:** export previo, migraciones transaccionales y canary; si se rompe pairing/sync, deshabilitar temporalmente esa función y mantener operaciones locales seguras. No reinstalar acceso anon ALL ni RPC mutadoras públicas. Cambiar políticas de producción sólo con autorización. Si se restringe `account_devices`/RLS, conservar separado el acceso owner-historical si producto lo exige, sin reaprovechar el permiso del equipo revocado.

## 6. F0-S — Estado real de sync: proveniencia y conciliación sin escrituras

**Cubre:** SR-001–009, prepara AUD-006/009/010/022/029/030. **Prioridad:** P0 antes de cualquier migración, snapshot backfill o rollout.

La captura autenticada muestra 4 equipos vinculados (3 no revocados/1 revocado): 72 documentos para los tres no revocados, 120 al consultar owner-wide; 48 filas fuera del filtro activo (36 del row revocado, 12 sin vínculo activo). Las policies own-row comprobadas dependen de `device_sessions.user_id`, no cruzan `account_devices.revoked`; **no** se probó con sesión/token de ese equipo ni se afirma escritura posterior a revocación. Una captura SQL agregada posterior observó `updated_at` 03:53:21Z en una fuente clasificada como revoked; al ser client-controlled y variar alias/estado según captura, no prueba actividad después de revocar. El `select=data` del subset filtrado cargó 6,46 MB en RAM del navegador para reproducir pull/shape; no se inspeccionaron valores de negocio, aplicó o guardó como evidencia. La cuenta tiene 22 doc IDs multi-fuente, 7 hashes divergentes y 58 envelopes legacy sin `schemaVersion/updatedAt`; algunos snapshots de producto 1,38–1,44 MB. El bundle público es distinto al local y conserva lógica de pairing en su rama de sync.

### Paquetes obligatorios

1. **F0-S.1 Identidad y revocación:** bajo autorización del dueño mapear alias anonimizados a equipo físico; revisar si filas viejas se retienen intencionalmente, cuándo fue la última operación confirmada, qué sesiones están activas y quién conserva la sesión Auth. Separar read-owner histórico, auth-device vigente y monitor de lectura. **No** ejecutar revoke, borrar sesiones o eliminar sync docs durante el análisis.
2. **F0-S.2 Conciliación por negocio/producto:** tomar export read-only/backups del estado para coincidencias/diffs offline cifrados. Reconciliar IDs de productos, stock actual, ventas, compras, ajustes, anulaciones y cierres usando movimientos/tickets; revisar los 4 snapshots de stock de la sede que comparten la clave con auditor de negocio. No escoger máximo timestamp ni sumar los snapshots. Si falta ledger suficiente, dejar el producto en cuarentena y solicitar decisión del propietario, no auto-cambiar stock.
3. **F0-S.3 Venta/delta:** verificar que `ticketId` es único global o compuesto por negocio+equipo+contador seguro y que void/tombstone sea determinista. Cuatro tickets repetidos tenían payload igual: confirmar merge por ID en la versión desplegada y casos de colisión entre sedes/días.
4. **F0-S.4 Envelope legacy:** clasificar las 58 filas sin versión/timestamp y comparar con metadata de clientes, historial de release, timestamps de DB y backups. Definir cursor/tie-break antes del backfill. `updated_at` actual no certifica hora del evento porque el cliente la manda.
5. **F0-S.5 Proveniencia:** obtener Deployment ID/commit, configuración pública/flags del deployment, lockfile/schema compatibility y hash del release Vercel. Reproducir el branch de pairing vs modo cuenta del bundle servido. No asumir que el checkout es el mismo binario.
6. **F0-S.6 Realtime sólo staging:** sembrar equipo/sede ficticios autorizados; suscribir por sesión autenticada, hacer una escritura ficticia de `sync_documents`, medir recepción/aplicación y reconexión. Evitar cualquier write probe en producción.
7. **F0-S.7 Performance medida:** perfil de frío en device staging con 2.4k–3k productos/carga 1–7 MB, budgets aprobados, egress y retry/backoff; preservar evidencia/redactar tokens.

### Aceptación F0-S

- Cada device, namespace, fila de fuente legacy y revoked está mapeado, retenido o en cuarentena según decisión del dueño, sin operaciones borradas.
- Diferencias de inventario se pueden explicar por movimientos/cierres con balance revisable; residuos no explicados siguen señalados, no corregidos automáticamente.
- Source/build de producción identificable; feature mode del release claro; compatibilidad cliente/schema declarada.
- Legacy/watermark y key/id de venta tienen migración simulada y rollback probados.
- Realtime `join→write fixture→event→apply→reconnect` pasa en staging en 2+ clientes; las métricas de catálogo se basan en carga repetida reproducible, no en una sola llamada.

**Rollback:** fase diagnóstica sin DML. Una migración de filas no debe empezar hasta un snapshot restaurado. Si números/cuenta no concuerdan, suspender el backfill, dejar fuente y destino intactos, preservar hashes y escalar al dueño; no limpiar los 48 docs, volver a habilitar la cuenta de un revocado ni reemplazar stock.

## 7. F2 — Integridad local y reparación del sync inmediato

**Cubre:** AUD-003–012 y base de AUD-013. **Prioridad:** P0/P1.

### Paquetes y secuencia

1. **F2.1 Locks (AUD-004):** separar fallo de adquisición del error del callback; asegurar exactamente una ejecución. Revisar lease/renovación/fencing o mecanismo transaccional; sin exclusión garantizada no confirmar una operación financiera. Limpiar Map con la promesa realmente registrada.
2. **F2.2 Persistencia (AUD-003/011):** resolver scope de rkey y retorno/error explícito de escrituras; tratar cuota/denegación/corrupción; mantener namespace inmutable. Reintentos durables o error visible, no cola de memoria como única garantía.
3. **F2.3 Commit de venta (AUD-012):** transacción integral e idempotencia; revalidar stock dentro de commit, rechazar valores no finitos y aplicar regla de sobreventa. No imprimir recibo antes del commit; conservar cesta ante fallo.
4. **F2.4 Sync básico (AUD-005/007/008/009):** await de contexto manual, helpers bien scoped, hash/digest completo, errores parciales reflejados, retries sin avance que pierda datos. Añadir pruebas conductuales de la acción manual.
5. **F2.5 Namespace (AUD-010):** encolar docId/contexto completos y separar catálogo de usuarios por sede; transición de cuenta/sede espera/cancela de forma segura. Nunca resolver destino desde la sede activa tardíamente.
6. **F2.6 Stock (AUD-006):** parche de contención que no siga propagando snapshots ambiguos; diseñar movimientos y baseline de F4. No ajustar stock productivo con una resta estimada de snapshots históricos.

### Regresiones obligatorias

| Caso | Resultado requerido |
|---|---|
| Callback falla después de un efecto | Una ejecución, mismo error; no éxito por retry automático. |
| Lock retenido >8/10 s y dos pestañas | No solapamiento de commits ni degradación silenciosa a ejecución sin exclusión. |
| IDB falla, fallback legible | Recuperación de la misma sede o error explícito, sin ReferenceError. |
| IDB y LS fallan/quota | Sin recibo de venta, sin éxito falso y cesta recuperable. |
| Corte en cada escritura del commit | Todo o nada; al recargar no hay ticket/stock/cartera parcialmente actualizados. |
| Doble clic/replay de operationId | Una venta, un decremento y un movimiento de caja/cartera. |
| Cambio después del carácter 5.000 | Se sincroniza y respalda, incluso con igual longitud. |
| Legacy sin `schemaVersion/updatedAt`, previo con watermark y documentos empatados | Migración/lectura no descarta cambio legítimo; tie-break es determinista y no convierte dato viejo en newest sólo por importación. |
| Sync manual con cambio de otro equipo | Realiza pull y muestra el cambio, no sólo `ok:true`. |
| Cinco pushes rechazados | Resultado failed/partial y pendientes conservados. |
| Cambio A→B durante debounce | A sólo escribe A, B sólo B; ningún usuario ajeno se aplica al store activo. |
| Stock 10, ventas de 2 y 3 | Resultado 5; repeticiones/eco no cambian el resultado. |

**Aceptación:** pruebas nuevas fallan con la implementación antigua y pasan con la reparada; unitarias/servicios afectados y E2E checkout pasan. No se aprueba F2 únicamente con la cobertura porcentual existente.

**Rollback:** migración local expand/contract y respaldo antes de actualizar. Si una versión ya escribió operaciones nuevas, no reinstalar cliente que sólo entiende snapshots y pueda recontarlas: conservar modo compatible/read-only o hacer roll-forward. Las transacciones ya confirmadas no se «deshacen» borrando registros; cualquier corrección es un movimiento auditable.

## 9. F3 — Cuenta, licencia, Storage y respaldos verificables

**Cubre:** AUD-018–026, 028, 029 y componentes backup de AUD-005. **Prioridad:** P1/P2.

### Paquetes

- **F3.1 Cuenta/licencia:** máquina de estados `unconfigured → license_verified → account_authenticated → device_authorized → ready`, con estados offline/blocked explícitos. Resolver errores de registro no-limit, sesión cacheada, flags residuales y revocación antes de habilitar operaciones remotas. No confundir autenticación cloud de dueño con rol local de usuario.
- **F3.2 Registro/reporte:** consumir correctamente `{ok,devices}`; reportar fallo y last_seen confirmado; identidad idempotente sin apropiación de ID ajeno. No resolver duplicate key sólo con update indiscriminado.
- **F3.3 Auth:** Site URL/allow-list por entorno, recuperación de contraseña en cuenta de ensayo, altas/anónimos/CAPTCHA según política, protección de contraseñas y MFA evaluados. No enviar correos a usuarios reales de prueba.
- **F3.4 Imágenes:** policies write propias, path por cuenta/sede, MIME/tamaño coherentes y validación servidor; distinguir base64 local de upload confirmado. URLs versionadas para invalidar caches.
- **F3.5 Backup:** separar intento y confirmado; no actualizar hash/fecha hasta archivo y metadatos verificables; incluir configuración LS, todas las sedes previstas, archivos versionados y retries. Probar restauración sin activar eco de sync ni pisar otra sede/cuenta.
- **F3.6 Autorización de Estación:** retirar secreto compartido VITE de la frontera de escritura; negociar contrato con backend de Estación. No declarar arreglado con cambios sólo del cliente. Si se confirmó publicación de una clave con autoridad, preparar rotación autorizada coordinada, sin imprimir su valor.
- **F3.7 Capacidades:** declarar ausencia/presencia de comandos/backup_requests por versión de servidor; UI muestra «no disponible» y nunca éxito cuando falta backend.
- **F3.8 Chat:** identidad/capacidad o política explícita de endpoint público, rate-limit compartido y presupuesto; abortar petición y stream por deadline/desconexión, limitar input y no revelar sufijos de claves innecesariamente.

### Aceptación E2E staging

1. Licencia válida/inválida/vencida, cuenta correcta/incorrecta, registro denegado, límite alcanzado, equipo revocado y cambio de cuenta.
2. Revocado no vuelve a hacer pull/push; offline aplica la vigencia aprobada, no un fail-open indefinido.
3. Upload/upsert/delete de imagen propia funcionan; otra cuenta/sede no escribe; MIME y size se rechazan correctamente.
4. Backup falla con 401/403/timeout, permanece pendiente y el siguiente intento sin cambios sí reintenta.
5. Backup descargado/restaurado conserva IDs/conteos, stock, cartera, gastos, nómina y metadatos esperados de todas las sedes incluidas.
6. Chat cancela trabajo remoto al desconectar o expirar; presupuestos se verifican en más de una instancia/worker.

**Rollback:** versiones compatibles de RPC/API durante transición; revocar sólo la autoridad de tokens de prueba. Un backup fallido no elimina el último confirmado. Ante integración rota, mantener copia local y mostrar pendiente, no fingir sync/backup. No reinstalar secretos compartidos públicos como mecanismo único.

## 10. F4 — Convergencia y operación multi-equipo

**Cubre:** AUD-006, 009, 010, 012; extiende F2. **Prioridad:** P1.

### Implementación

1. Outbox local durable ligada a contexto y operationId; estados, reintentos con backoff+jitter, recuperación al reiniciar y ACK por revisión.
2. Protocolo de movimientos idempotentes de stock/cartera/caja y snapshots únicamente como proyecciones/baselines. Contrato de operaciones corregibles, tombstones y retención definido.
3. Cursor compuesto/paginación; checkpoint de aplicación durable; rechazo/quarantine explícitos sin perder reintentos. Equidad de cola de deltas por día.
4. Sincronización por cuenta/sede basada en autorización servidor, sin consultas globales que dependan de filtrado sólo frontend.
5. Catálogo y edición concurrente con revisión/control de conflicto visible; no usar LWW ciego para contabilidad.
6. UI de estado por equipo/sede: última confirmación, pendientes, error accionable y conflictos. Observabilidad sin payloads privados.
7. Migración de snapshots a movimientos con baseline por producto/sede: export, conciliación, corte de protocolo y canary. No inventar ventas a partir de diferencias de stock.

### Campaña determinista

- Dos cuentas, tres sedes, varios equipos y monitor, con red real de staging.
- Online, offline, reinicio, mensajes duplicados, orden inverso, pérdida temporal de ACK, reloj adelantado/atrasado y sesión expirada.
- 10−2−3=5; ventas/voids/consumos/compra/ajustes repetidos una sola vez.
- Más de 2.000 documentos, más de 500 documentos multi-sede y más de siete días pendientes; ninguno queda postergado permanentemente.
- Cambiar sede/cuenta mientras hay timers, commit y push; aislamiento invariante.
- Digest/IDs/proyecciones finales iguales tras replay; conciliación entre ledger y saldos.

**Aceptación:** pérdida y duplicación cero para operaciones confirmadas dentro de los escenarios definidos; convergencia reproducible y latencia/pending medidos. La política de sobreventa offline se verifica tal como fue aprobada, sin prometer una garantía imposible.

**Rollback:** protocolo versionado, no mezclar productores antiguos de stock agregado con nuevos de movimientos sin adaptador ensayado. Si hay discrepancia, pausar proyección/envíos afectados, conservar logs y hacer roll-forward auditable. Nunca purge automático de movimientos de producción.

## 11. F5 — Nómina, sesión, UI y contratos funcionales

**Cubre:** AUD-013–017 y coherencia de roles de AUD-031. **Prioridad:** P1/P2.

### Nómina

- Consumo: commit conjunto de documento, movimiento de stock, período/limite y outbox; permisos revalidados dentro de la operación.
- Liquidación: ID estable por empleado/período/secuencia, consumos asignados una vez, estado PAID, gasto y cierre de período atómicos; importes negativos/deudas/tratamiento de adelantos explícitos.
- Anulación: reversión idempotente y rastro auditable, no borrado silencioso.
- Migrar pruebas de `.tests` a suite portable y cubrir periodos semanal/quincenal/mensual, moneda/tasa congelada, consumo posterior a liquidación y dos liquidaciones concurrentes.
- Aceptación: una liquidación genera exactamente un gasto; suma de consumos y neto coinciden con período/caja; fallo intermedio no deja consumos marcados sin liquidación.

### Sesión/roles

- Conectar `isLocked`/unlock al shell y a comandos sensibles; bloqueo no es sólo ocultar UI.
- Pruebas de inactividad/minimizar, PIN errado/correcto, usuario retirado/revocado y vuelta del background; política especial de cajero documentada.
- Aplicar matriz aprobada a tabs y acciones; resolver tests contradictorios de recuperación de dueño sin quitar confirmación/auditoría/rate-limit.

### UI/configuración

- Hooks antes de returns condicionales; teclado virtual en Android/iOS y resize/visualViewport.
- Definir hasSecondaryPrice desde el contrato de moneda/COP y comprobar PDFs reales en moneda única/mixta.
- Datos fiscales actualizan registro canónico por sede y espejos derivados; reload/cambio de sede/sync no los revierte.
- Inventariar y retirar rutas legacy redundantes del modal si ya no se usan, evitando mantener dos handlers incompatibles.
- Revisar atributo JSX duplicado, errores de consola, estados loading/error/vacío y focus/accesibilidad de modales.

**Puerta de salida:** dueño/admin/cajero reales de staging, flujos de nómina completos, ticket/PDF inspeccionados y prueba de persistencia fiscal. La restricción ADMIN observada en la auditoría no sustituye esta campaña.

**Rollback:** UI puede volver a versión previa sólo si sus contratos de persistencia/protocolo siguen siendo compatibles. No revertir auto-lock a no bloquear; mantener modo seguro. Nómina confirmada sólo se corrige por movimientos auditables.

## 12. F6 — Reproducibilidad, gates, performance y despliegue

**Cubre:** AUD-028–034. **Prioridad:** F6a temprano; resto antes del rollout.

### F6a — Entorno y pruebas

- Unificar versión de Bun/Node y `packageManager`; regenerar lock de manera revisada, instalación frozen en limpio y CI; evitar varios gestores modificando locks sin política.
- Deduplicar advisories por GHSA/versión/cadena y determinar explotación runtime vs herramientas. Actualizar paquetes por grupos compatibles; verificar importación Excel con inputs malformados y revisar XLSX por separado, no darlo por seguro porque no apareció en audit.
- Alinear Remotion y plugins; retirar dependencias/runtime no usados sólo tras análisis.
- Completar mocks con contratos actuales y validar todos los campos relevantes; separar contrato de Estación de checkout hermano ausente mediante fixture versionado o job de integración explícito.
- Typecheck gradual efectivo de módulos críticos JS mediante checkJs/JSDoc o migración acotada; no usar ts-ignore para ocultar no-undef.
- Incorporar los defectos reproducidos como tests de regresión del producto. Test con backend falso debe declarar su límite.

### F6b — Gates de release

Orden obligatorio:

1. Frozen install limpio.
2. Lint sin errores y presupuesto de warnings que no encubra seguridad/dinero/hooks.
3. Typecheck efectivo sobre módulos críticos.
4. Unitarias/servicios completos, sin fallos; skips justificados por entorno y **ningún skip de una garantía crítica requerida**.
5. Matriz RLS/RPC staging y pruebas de contrato API.
6. Build de producción sin warnings funcionales pendientes.
7. E2E de UI + offline/reconexión + restauración + concurrencia con fuente y esquema versionados.
8. Pruebas de dispositivos y smoke del artefacto final servido como se desplegará.

No modificar tests de producción a propósito sólo para conseguir verde. Si el contrato aprobado cambió, actualizar test y explicación juntos y añadir comportamiento positivo/negativo equivalente.

### Rendimiento y PWA

Baseline y medición posterior en las mismas condiciones:

| Escenario | Medir |
|---|---|
| Android de gama baja y escritorio, red limitada | Carga fría/caliente, LCP/INP cuando sea medible, JS transferido/parseado, memoria. |
| 1.000 y 10.000 productos con/sin imágenes | Búsqueda, filtro, cambio de vista, p50/p95 y corrección de resultados. |
| Historial grande y múltiples sedes | Cálculo de reportes, render, memoria, consultas/bytes/latencia. |
| Sync con pendientes numerosos | Tiempo a convergencia, throughput, fairness y errores; exactitud de stock/saldos. |
| App instalada/offline/update | Arranque sin red, fotos cacheadas, datos durables, update sin perder cesta/pending. |

Luego aplicar lazy loading, división de chunks, virtualización o proyecciones cuando la medición lo justifique. Presupuesto exacto de p95/memoria/bundle se acuerda con baseline y dispositivos; no se promete speedup antes de medir.

Corregir `lang`, validar shortcuts, versionar imágenes y ensayar política de actualización PWA. Alinear cabeceras reales Vercel: nosniff, framing, referrer, permisos y CSP primero report-only; confirmar PDF/cámara/impresión/fonts/Supabase/PWA.

### Operación

Documentar arquitectura/hosts/env pública vs secreta, versión/schema, alertas de commit fallido, pendientes envejecidos, backup no confirmado, RLS denegada y revocación. Eliminar ruido de identidad sólo arreglando idempotencia/ownership. Logs nunca incluyen password, tokens completos ni payloads de clientes.

**Aceptación:** pipeline completo reproducible y artefacto servido verificado; ninguna cifra de cobertura se presenta como 100% E2E. Mediciones antes/después conservadas con inputs/entorno y corrección comprobada.

**Rollback:** conservar build anterior compatible y caches/versiones identificables; si nuevas cabeceras rompen capacidad, ajustar la policy sin retirar todas las protecciones. Dependencias se revierten por grupo sólo si no reintroducen riesgo crítico; de ser necesario, restringir la funcionalidad vulnerable y hacer roll-forward.

## 13. F7 — Release y operación inicial

**No ejecutar sin aprobación de despliegue y ventana operativa.**

1. Confirmar backup restaurable, fuente/esquema versionados, gates aprobados y responsables presentes.
2. Migraciones expand antes del cliente dependiente; verificar health y RLS con cuentas de ensayo.
3. Canary en una sede/equipos acordados, con datos reales sólo bajo autorización. Mantener cesta/pending y capacidad de recuperación.
4. Comparar conteos/IDs de operaciones, stock, saldos, caja, nómina y backlog contra baseline. Los históricos inconsistentes se investigan, no se «arreglan» automáticamente por borrado.
5. Probar desde la interfaz final login, venta aprobada de ensayo, recibo, sync, imagen y backup según alcance autorizado.
6. Ampliar gradualmente; no agregar protocolo viejo a la flota por accidente. Registrar versión por dispositivo y esquema.
7. Ejercicio de restauración y revisión de alertas posteriores; calendario y objetivos aprobados por operación.

**Criterios de stop:** escritura confirmada no durable, duplicado financiero, acceso entre cuentas, stock/saldo que no reconcilia, revocado con acceso, backlog sin progreso o backup que no se puede recuperar.

**Rollback seguro:** detener mutaciones remotas/función afectada, preservar outbox y evidencia, volver sólo a build/esquema compatibles. Para cambios irreversibles de datos/protocolo, recuperación controlada o roll-forward; nunca reset general ni restauración que sobrescriba ventas confirmadas nuevas.

## 14. Trazabilidad completa

| Hallazgos | Paquete principal | Evidencia de cierre exigida |
|---|---|---|
| AUD-001–002 | F1.1–F1.2 | Policies/RPC instaladas y matriz real positiva/negativa, sin fixture vacío. |
| SR-001/SR-002/SR-009 | F0-S/F1.6/F1.7 | Entitlement/release evidence preservado, source contra producción trazado y revocación separada de retención. |
| SR-003/SR-005 | F0-S.2–F0-S.3/F2/F4 | Variantes de stock y venta/delta reconciliadas por movimientos/tickets; snapshot no seleccionado automáticamente. |
| SR-004 | F0-S.4/F2.4/F4 | Envelope legacy/watermark y tie-break probados con rollback. |
| SR-006 | F0-S.1/F0-S.2 | Fuentes/namespaces antiguos mapeados o en cuarentena antes de merge/purge. |
| SR-007/SR-008 | F0-S.6/F0-S.7/F6b | Suscripción+evento en staging y benchmark catálogo reproducible, con datos ficticios. |
| SR-003/SR-005 | F0-S.2–F0-S.3/F2/F4 | Variantes de stock/snapshot y ventas-deltas reconciliadas por movimientos/tickets; ningún snapshot fusionado como venta nueva. |
| SR-004 | F0-S.4/F2.4/F4 | Envelope legacy/watermark y tie-break probados con rollback. |
| SR-006 | F0-S.1/F0-S.2 | Fuentes/namespaces legacy asignados o en cuarentena antes de merge/purge. |
| SR-003 | F0-S/F2.6/F4 | Variantes de stock/catálogo reconciliadas por movimientos; ningún snapshot seleccionado automáticamente. |
| SR-004 | F0-S/F2.4/F4 | Backfill legacy/watermark y tie-break probados con rollback. |
| SR-005 | F0-S/F4/F7 | Deltas idempotentes por sede+ticket, recuperación/anulación, snapshot no sumado dos veces. |
| SR-006 | F0-S/F4/F7 | Fuente/negocio legacy mapeado, archivado o explicado antes de merge/purge. |
| SR-007/SR-008 | F4/F6b | Query/event streaming real medido en staging con operación ficticia; bundle/carga y reconexión validados. |
| AUD-003–004 | F2.1–F2.2 | Tests de excepción/fallback/concurrencia y callback una vez. |
| AUD-005 | F2.4/F3.5 | Cambio tardío igual tamaño enviado/respaldado; LS-only incluido. |
| AUD-006 | F2.6/F4 | Replay/reorden/eco convergen y migración de baseline ensayada. |
| AUD-007–009 | F2.4/F4 | Sync manual, recuperación, fallos/cursores/colas con datos reales staging. |
| AUD-010 | F2.5/F4 | Cambio de sede/cuenta con trabajo pendiente sin contaminación. |
| AUD-011–012 | F2.2–F2.3 | Fault injection/quota/idempotencia/commit integral desde UI. |
| AUD-013 | F5 Nómina | Consumo/void/liquidación concurrente, caja/stock reconciliados. |
| AUD-014–015 | F5 Sesión/UI | Bloqueo real y teclado físico/virtual sin crash. |
| AUD-016–017 | F5 UI/config | PDFs por moneda/medida y datos fiscales tras reload/switch. |
| AUD-018–020 | F3.1–F3.2 | Estados cuenta/licencia/registro/reporte verificables. |
| AUD-021–022 | F1.3/F3.1 | Límite concurrente y revocación sin ruta alternativa. |
| AUD-023–024 | F3.3–F3.4 | Storage write aislado y recuperación Auth por entorno. |
| AUD-025–026 | F3.5–F3.6 | Backup restaurable/retry y autorización sin secreto VITE. |
| AUD-027–028 | F1.5/F3.8/F6 | Proxy restringido y abuso/cancelación del chat medidos. |
| AUD-029 | F1.4/F3.7 | Instalación nueva/upgrade reproducibles y capacidades explícitas. |
| AUD-030–031 | F6a/F6b | Frozen install y gates reales completos en verde. |
| AUD-032–033 | F6b | Baseline/performance/PWA/cabeceras finales comprobadas. |
| AUD-034 | F0/F6 operación | Runbook, versión/esquema trazables y registro idempotente seguro. |

## 15. Definición de terminado

El plan se considera cerrado cuando **cada fila de trazabilidad tiene evidencia posterior al último cambio**, no sólo un check anterior; no hay críticos/altos abiertos sin contención aprobada; y se cumplen las invariantes:

- Un actor no autorizado no accede a otra cuenta/sede ni escribe como monitor.
- Un equipo revocado no recupera acceso remoto por otra policy/RPC.
- Una operación confirmada tiene commit durable, ID estable y exactamente un efecto financiero.
- Stock/caja/cartera/nómina se pueden reconciliar y reconstruir a partir de movimientos auditables.
- Sync conserva y confirma pendientes sin perderlos al cambiar sede, caer la red, superar límites o repetir mensajes.
- Backup puede descargarse/restaurarse y no presenta éxito falso.
- El sistema funciona a través de la interfaz y dispositivos previstos, incluidas las condiciones offline aprobadas.
- Build, fuente, esquema y configuración pública son trazables; pruebas y rollback son reproducibles sin secretos en los artefactos.

**Primer lote recomendado:** F0 mínimo + F1 frontera backend y F2.1/F2.2 locks/persistencia, con regresiones. No comenzar por cosmética ni por eliminar warnings masivamente antes de proteger aislamiento y dinero.
