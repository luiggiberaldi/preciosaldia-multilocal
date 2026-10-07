# Auditoría técnica y E2E — PreciosAlDía Multilocal

**Fecha de referencia:** 4 de octubre de 2026, zona Caracas (las evidencias UTC corresponden al 5 de octubre).  
**Versión declarada:** 2.1.56. **Estado:** auditoría terminada; fixes no implementados.  
**Producción consultada:** https://preciosaldiaoficial.vercel.app/ y Supabase `oshexsmweswzbwaksvra`.  
**Anexo ampliado de sync real:** [diagnóstico de producción](evidencias/sync-real-interpretacion.md). **Plan de remediación:** [PLAN-FIXEO.md](PLAN-FIXEO.md).

## 1. Dictamen ejecutivo

**No recomiendo certificar todavía el funcionamiento íntegro del POS multi-equipo ni aprobar un despliegue general basándose únicamente en el build.** Hay defectos reproducidos de doble ejecución, pérdida de persistencia, cambios que no se sincronizan y reconciliación incorrecta de stock. Además, la configuración real de pairing/RLS admite rutas de acceso sin comprobar adecuadamente la identidad del actor.

Esto **no significa que se haya observado una intrusión ni que todas las ventas actuales estén mal**. La prueba anónima de solo lectura devolvió cero pairings, tokens vigentes, documentos de sincronización y backups visibles en ese momento. En la prueba autenticada owner aparecen documentos históricos del equipo revocado dentro de RLS own-row; no se probó con un JWT de ese equipo ni se intentó escribir. Se confirmó una ruta de autorización potencialmente incompleta, no actividad post-revocación ni una extracción cross-account.

Prioridad inmediata:

1. Corregir la frontera de autorización del backend: pairing, RLS, registro de equipos y revocación.
2. Impedir la reejecución de operaciones financieras y la confirmación de escrituras fallidas.
3. Hacer atómicos venta/stock/cartera y sustituir la reconciliación de stock absoluto por movimientos idempotentes.
4. Reparar sincronización manual, recuperación, aislamiento de sede y confirmaciones de respaldo.
5. Cerrar la brecha de pruebas/reproducibilidad antes de desplegar.

El catálogo contiene **34 hallazgos agrupados**. Las advertencias de dependencias y de Supabase no se cuentan como otros tantos bugs independientes.

## 2. Alcance, método y límites

### Trabajo realizado

- Revisión de código de ventas, persistencia, locks, sincronización, cuentas, licencia, roles, nómina, backups, endpoints, despliegue y pruebas.
- Revisión del navegador compartido y del dashboard Supabase autenticado en la fase de recolección; comprobación manual del gate en un navegador local limpio.
- **15 consultas SQL del inventario inicial y 14 queries SQL agregadas de sync autenticado, cada una READ ONLY**; cuatro lecturas de Management API. Ningún SQL DML/migración de producción. El POST password-grant autenticó al dueño y creó la sesión Auth usada para los GET (Auth puede actualizar metadata de último acceso); no tocó datos de negocio.
- Lectura adicional de conteos bajo rol `anon` y comprobaciones agregadas de integridad. No se inspeccionaron valores de tickets, clientes ni backups. Excepción importante: el pull autenticado de 72 envelopes completos sí pasó temporalmente por RAM del navegador (descritos en la sección siguiente), sin inspección de campos individuales, aplicación al POS ni persistencia/exportación.
- Reproducciones ejecutando funciones del código real en contextos aislados con dependencias simuladas, sin red externa.
- Build, lint, typecheck, suite completa con cobertura y cuatro escenarios Playwright aislados sobre el build local.
- GET de raíz, manifest y tasas en producción; no se atacaron endpoints con payloads SSRF ni se probaron carreras contra la base real.

### Restricciones y precauciones

- No se modificó código funcional ni configuración de producción. Los nuevos archivos de trabajo están en esta carpeta de auditoría; instalar dependencias y compilar también generó los artefactos locales habituales.
- No hay metadatos Git disponibles en este checkout. No se puede fijar un commit auditado, reconstruir una diferencia fiable de todo el proyecto ni demostrar equivalencia exacta entre fuente local y producción.
- Una navegación normal de producción puede provocar efectos automáticos de la aplicación, por ejemplo una sesión anónima. **La garantía de solo lectura corresponde a nuestras consultas SQL/API de metadatos, no a todos los efectos internos posibles de abrir la app.** No se realizaron ventas reales, altas manuales, revocaciones ni cambios fiscales.
- Las credenciales suministradas no se guardaron en informes ni fixtures y no se usaron para registrar un dispositivo adicional. El build local no dispone de `VITE_DIRECTORY_ANON_KEY`; el login real licencia→cuenta no queda certificado.
- Los escenarios aislados tienen identidad y backend ficticios; bloquean service workers y solicitudes externas de página. **No prueban RLS real, Realtime real, offline instalado ni el acceso de un dueño real.** Un servidor de desarrollo puede tener sus propios fetch de tasas: las ejecuciones aisladas usan preview estático para no depender de ellos.
- No se completó una campaña de todos los casos financieros E2E, hardware, Android/Electron, Safari/Firefox, restauración real ni concurrencia real multi-equipo. La matriz pendiente figura más abajo.
- Los procesos de verificación se comprobaron por logs, salida final y existencia de artefactos después de interrupciones. Las ejecuciones incompletas se conservaron, pero no sustituyen al resultado final.

### Auditoría autenticada READ ONLY de sincronización (5 oct, ~03:54 UTC)

A solicitud del usuario se amplió el alcance a sync real. En navegador incógnito se autenticó el dueño vía Supabase Auth normal (único POST de autenticación a Supabase Auth; además, las 14 consultas agregadas se enviaron por POST a Management API dentro de transacciones READ ONLY). El login crea la sesión Auth estándar, pero no modifica filas POS. En esa captura había **4 equipos vinculados: 3 activos, 1 revocado**; el query filtrado a los IDs no revocados trajo **72/72**, y el pull cuenta-wide, **120/120**, 48 de fuentes fuera del conjunto activo. No se montó el POS ni se creó/vinculó equipo. El runtime del panel cargó temporalmente los 72 envelopes seleccionados en memoria (6,46 MB) para reproducir el pull completo y medir forma/tamaño; no abrió campos de negocio, no aplicó payload al POS, ni persistió/exportó los cuerpos. La consulta cuenta-wide de 120 filas fue metadata-only. El informe/evidencias contienen agregados, timestamps, tamaños y fingerprints, no payloads. Supabase respondió `SUBSCRIBED=ok` en canal Realtime durante un segundo, **sin eventos**; no prueba ida/vuelta live. Además, el bundle de producción difiere del build local y varios snapshots de la cuenta divergen. Las 14 consultas SQL agregadas (todas HTTP 201) se ejecutaron `BEGIN READ ONLY`; la sesión Auth sí se creó para consultar RLS con el dueño, pero no hubo registro de equipo ni mutación de negocio.

El bundle público sí confirma un branch de producción que queda pausado si falta pairing monitor; checkout local usa además modo cuenta. Los SHA256 no coinciden. Por ello los defectos locales descritos a continuación NO se atribuyen automáticamente al build activo; origen/commit de producción pendiente.

Detalle completo, limitaciones y nuevos puntos SR-001–009: [anexo sync real](evidencias/sync-real-interpretacion.md), [snapshot autenticado](evidencias/sync-real-autenticado.json), [agregados (sólo metadatos)](evidencias/sync-real-agregados.json), [hash de bundle](evidencias/sync-real-bundle.json), [inspección estática del bundle](evidencias/sync-real-publicado.json), [script SQL seguro](auditar-sync-real.mjs), [panel browser read-only](sync-real.html), [reader](sync-real-browser.js). La solicitud real de licencia no fue ingresada en el directorio, y no se probó ninguna escritura de sync.

### Escala de evidencia y prioridad

- **R:** reproducción local ejecutada sobre la función real, con dependencias simuladas.
- **D:** definición/configuración extraída del backend real, sin explotación mutadora.
- **E:** ejecución E2E aislada en navegador.
- **S:** hallazgo de análisis estático; impacto condicionado pendiente de prueba integrada.
- **A:** acceso/snapshot autenticado READ ONLY contra producción (metadatos/cuentas reales pseudonimizadas).
- **P:** análisis de bundle JS público servido (sin ejecutar la app ni exponer secretos).
- **O:** observación de navegador/dashboard/logs. Las observaciones históricas no exportadas se identifican expresamente.

**Crítica:** puede comprometer aislamiento o integridad financiera. **Alta:** pérdida de datos, bloqueo de funciones o controles de acceso deficientes. **Media:** funcionalidad parcial, endurecimiento, operación o rendimiento. La prioridad no equivale a explotación observada ni a puntuación CVSS.

## 3. Resultados finales de verificación

| Verificación | Resultado | Interpretación |
|---|---|---|
| Instalación congelada | Falló: `lockfile had changes, but lockfile is frozen` | La instalación reproducible no está garantizada. |
| Instalación de diagnóstico | `bun install --no-save --ignore-scripts` terminó | Permite auditar; no valida el lock. Resultados condicionados a esa resolución. |
| Lint de producto, antes de los nuevos fixtures | **82 errores, 1.983 warnings; exit 1** | Gate fallido. Algunos son guardrails financieros; no todos prueban daño monetario. |
| Typecheck | Exit 0 | `checkJs:false`: no comprueba sustantivamente la mayoría JS/JSX ni descubre los `no-undef` descritos. |
| Build | Exit 0, advertencias | Compila, pero no acredita integridad de venta/sync. |
| Suite completa final | **934 pruebas: 910 aprobadas, 13 fallidas, 11 omitidas; exit 1** | 81 archivos: 73 aprobados, 7 fallidos, 1 omitido en el resumen de consola. |
| Cobertura final | Líneas **54,12%**, statements **53,99%**, funciones **65,23%**, ramas **52,73%** | Sólo `src/utils/**` y `src/core/**`; excluye JSX y no representa cobertura global de la aplicación. |
| E2E aislado final | **4/4 aprobados, 33,2 s** | Gate limpio, venta exacta, navegación ADMIN/restricción nómina, pull de arranque simulado. |
| E2E original de checkout, reintento acotado | 1 timeout en `page.goto`, 11 no ejecutados; exit 1 | No acredita fallo financiero del checkout: falla antes de operar. Timeout acotado a 20 s. |
| Reproducciones de defectos | 10 observaciones registradas, script exit 0 | El éxito del script demuestra que reproduce defectos; **no** que el producto esté corregido. |
| Supabase | Inventario: 15 consultas 201 + 4 endpoints 200; sync: 14 consultas agregadas READ ONLY HTTP 201 y GET autenticados 200 | Metadatos completos para el alcance definido. La sesión Auth de dueño se creó para probar RLS. |
| HTTP producción | raíz, manifest, tasas: 200 | Disponibilidad puntual, no SLA ni benchmark. |
| Sync autenticado real | Login Auth; GET devices/sessions/sync 200; 3 equipos activos/1 revocado; 72/72 subset activo, 120/120 owner-visible; Realtime subscribe `ok` sin eventos | Se descargaron 72 envelopes (6,46 MB) transitoriamente en RAM para reproducir el pull; no se inspeccionaron campos individuales, aplicaron al POS ni conservaron cuerpos. No hubo write de negocio. |
| Integridad por agregados reales | 120 docs/16 sources/49 doc_ids; 22 IDs multi-fuente, 7 hashes divergentes, 58 envelopes legacy | No resuelve qué snapshot es correcto; el query cuenta-wide fue metadata-only. |


Fuentes: [lint](evidencias/lint.log), [errores extraídos](evidencias/lint-errores.json), [typecheck](evidencias/typecheck.log), [build](evidencias/build.log), [suite final](evidencias/verificacion-final.log), [JSON final](evidencias/vitest-final.json), [cobertura](evidencias/coverage-final/coverage-summary.json), [HTML de cobertura](evidencias/coverage-final/index.html), [E2E final](evidencias/e2e-aislados-final.log), [E2E original](evidencias/e2e-original-final.log), [reproducciones](evidencias/reproducciones-locales.json).

El JSON de Vitest cuenta suites anidadas: su `numTotalTestSuites=343` **no significa 343 archivos**. El archivo omitido aparece con estado `passed` en el reporte JSON, mientras la consola lo separa; se usa el resumen de consola para archivos. La primera ejecución sufrió errores de workers y quedó parcial; no se suma a los 934 tests finales.

### Causas de las 13 pruebas fallidas

| Grupo | Cantidad | Causa identificada / acción requerida |
|---|---:|---|
| cloudAccount | 6 | Mock desactualizado: falta `getCustomerProject`, con fallos derivados de registro/login. Completar el contrato del mock y comprobar los errores reales, no quitar assertions. |
| cloudGate y cloudGateRealConfig | 2 | Expectativas de objetos no contemplan nuevos campos del proyecto. Validar el contrato completo y su persistencia. |
| cloudGateFlows | 1 | Secuencia de cuenta llena afectada por contrato de configuración/mocks. |
| provisionContract | 2 | Dependencia de un checkout hermano `estacion-2026` ausente; ENOENT. Debe convertirse en contrato reproducible o fixture versionado. |
| roles | 1 | Expectativa ADMIN/supervisión contradice política actual. Resolver contrato de permisos y probar comportamiento. |
| securityFase1 | 1 | Exige excluir al dueño, pero el código documenta una decisión de permitir recuperación de PIN maestro desde el 2/10. Validar decisión y sustituir test textual por prueba de confirmación, límite y auditoría; no tratar automáticamente como regresión de seguridad. |

**Higiene de credenciales:** la sesión temporal se cerró y el secreto no se almacenó en informes/scripts/logs. Como la contraseña se compartió en este hilo y se usó para autenticarse, recomiendo al titular rotarla y no reutilizarla en otra cuenta; no la repetiré aquí.

### Navegación móvil realmente comprobada

Viewport **390×844**. Se esperó contenido de cada vista, no sólo la barra de navegación. Inicio, ventas, inventario, clientes, reportes, ajustes y control renderizan; Nómina muestra **«La Zona de Nómina es solo para el dueño»** bajo la sesión ADMIN de prueba. Las ocho pantallas observadas presentan overflow horizontal 0 y no registraron excepciones de página ni errores de aplicación en ese recorrido.

- [Matriz final de vistas](evidencias/pestanas-390-final.json).
- [Inicio](evidencias/vista-inicio.png), [Ventas](evidencias/vista-ventas.png), [Inventario](evidencias/vista-catalogo.png), [Clientes](evidencias/vista-clientes.png), [Reportes](evidencias/vista-reportes.png), [Ajustes](evidencias/vista-ajustes.png), [Control](evidencias/vista-supervision.png), [restricción de Nómina](evidencias/vista-nomina.png).
- [Venta exacta y recibo](evidencias/cobro-exacto.png): una VENTA persistida y stock de Cafe E2E 50→49, datos ficticios.
- [Gate sin directorio](evidencias/gate-sin-directorio.png): un código ficticio devuelve el error de configuración; no demuestra que una licencia real sea inválida.

La primera prueba de navegación era insuficiente y otra iteración tenía un selector incorrecto de Inicio y esperaba permisos de dueño con ADMIN. Se conservaron [log previo](evidencias/e2e-aislados-selectores-previos.log) y [matriz previa](evidencias/pestanas-390-selectores-previos.json). Se corrigieron **sólo los fixtures de auditoría**, se mantuvo la comprobación de contenido y se explicitó la restricción de nómina. Ninguna prueba funcional existente se debilitó.

## 4. Hallazgos de seguridad y backend

### AUD-001 — Pairing privilegiado sin autorización del actor
**Crítica · D · Fase F1.** [Funciones reales](evidencias/supabase-functions.json).

`generate_pairing_token`, `unpair_monitor` y `pair_monitor_device` son SECURITY DEFINER, ejecutables por PUBLIC/anon/authenticated y no comprueban `auth.uid()` ni propiedad del dispositivo. Generar un token reinicia el pairing del ID proporcionado. Token de seis caracteres hexadecimales mediante `md5(random())`, sin consumo atómico con lock en el pairing de monitor; tres funciones sin `search_path` fijado.

**Impacto:** creación/reemplazo/desvinculación no autorizados si se conoce un ID; adivinación/uso concurrente del token. No se invocaron estas mutaciones en producción. **Aceptación:** actor ajeno/anon rechazado, tokens criptográficos no enumerables, uso único atómico, grants mínimos y ruta fija.

### AUD-002 — Policies permisivas abren caminos alternativos de acceso
**Crítica · D · Fase F1.** [Policies](evidencias/supabase-policies.json), [lectura anon](evidencias/anon-rls-counts.json), [binding de header](evidencias/monitor-header-binding.json).

`device_pairings` permite lectura anon/auth de tokens vigentes o filas con monitor sin relacionarlos con el actor. `sync_documents_anon_access` concede ALL a anon si existe un pairing del primary: una policy más estricta no la cancela, porque las permisivas se combinan con OR. `current_device_id()` confía en un `x-device-id` existente sin vincularlo al UID del solicitante. Policies legacy también usan un `payload.owner_id` controlable por quien propone el documento como parte de la autorización.

**Impacto:** riesgo condicionado de lectura/escritura ajena, agravado por AUD-001. **Resultado real de lectura:** cero filas visibles en el snapshot; no se observó fuga efectiva ni se fabricó un pairing para explotarla. `device_sessions_reclaim USING true` debe revisarse, pero su SELECT propia puede impedir apropiarse de filas ajenas: **takeover por esa policy no demostrado**. **Aceptación:** matriz positiva/negativa de cuenta, sede, dispositivo, revocación y monitor aplicada a SELECT/INSERT/UPDATE/DELETE, sin confiar en headers o payloads autoafirmados.

### AUD-021 — Límite de dispositivos eludible y no serializado
**Alta · D/S · Fase F1–F3.** [RPC y overloads](evidencias/supabase-functions.json), [policies](evidencias/supabase-policies.json), [cloudAccount](../../src/services/cloudAccount.js#L131-L169).

Hay dos overloads de `register_account_device`; el de tres argumentos acepta `p_max_devices` del cliente. `account_devices_owner_all` permite insertar/actualizar directamente y evitar la RPC. Los conteos no serializan altas concurrentes. Comprobar UID no excluye por sí solo usuarios anónimos autenticados; falta un contrato explícito para ellos.

**Aceptación:** límite obtenido del servidor, un único contrato RPC, altas concurrentes serializadas y grants que impidan INSERT directo; prueba de cuenta al límite y reactivación de un revocado según política aprobada.

### AUD-022 — Revocación no corta todas las rutas de acceso
**Alta · D/S · Fase F1–F3.** [integridad](evidencias/integrity-summary.json), [is_own_device_row](evidencias/supabase-functions.json), [revocación cliente](../../src/services/cloudAccount.js#L370).

Revocar en `account_devices` no invalida la autorización own-row basada sólo en `device_sessions.user_id`. Una RPC puede reactivar un equipo revocado. El cliente consulta revocación después de sincronizar y acepta fallos de directorio como no revocado.

Snapshot: **1 dispositivo revocado, 13 device_sessions sin vínculo activo de cuenta**; no demuestra que las 13 sean intrusiones u orfandad ilegítima, pues también existen sesiones anónimas/legacy. **Aceptación:** una revocación impide lecturas y escrituras remotas inmediatamente según contrato; reconexión no reactiva sin aprobación, con política offline explícita.

### AUD-023 — Storage de imágenes sin policies de escritura
**Alta · D/O · Fase F3.** [bucket](evidencias/supabase-buckets.json), [policies](evidencias/supabase-policies.json).

RLS habilitada y **cero policies en Storage**. Bucket `product-images` público, límite 2 MB, tipos MIME no restringidos; el cliente limita a 1 MB. En el dashboard revisado antes de reiniciar se observaron `new row violates row-level security policy for table objects`; esa observación histórica no tiene export estructurado propio. El fallback base64 oculta la falta de subida y aumenta el tamaño de los datos sincronizados.

**Aceptación:** upload/upsert/delete propios autorizados por cuenta/sede, escritura ajena rechazada, MIME/tamaño alineados, objetos versionados y fallback explícito. Mantener lectura pública sólo si el negocio la desea.

### AUD-024 — Configuración Auth incompatible con recuperación productiva segura
**Alta · D/O · Fase F3.** [Auth config, valores sensibles redactados](evidencias/supabase-auth-config.json), [resumen](evidencias/supabase-auth_summary.json).

Site URL `http://localhost:3000`, allow-list de redirecciones vacía; altas y auth anónima activas, CAPTCHA deshabilitado, SMTP no configurado y protección de contraseñas filtradas deshabilitada. Resumen: cinco usuarios, cuatro anónimos, uno con email confirmado; cero MFA observado. No se envió correo ni se probó recuperación de contraseña de producción.

**Aceptación:** redirects de producción/staging explícitos, recuperación real en cuenta de ensayo, política de altas/anónimos documentada, MFA para dueño cuando corresponda y controles de abuso. Una configuración sin MFA no prueba compromiso de la cuenta.

### AUD-029 — Deriva entre esquema instalado, migraciones y contratos
**Alta · D/S · Fase F1–F3.** [tablas](evidencias/supabase-tables.json), [migraciones](evidencias/supabase-migrations.json), [funciones](evidencias/supabase-functions.json), [migraciones locales](../../supabase/migrations/004_device_limit.sql).

Nueve tablas public con RLS, 20 policies, ninguna policy Storage ni trigger observado. Sin historial `supabase_migrations` en el alcance consultado y una fila de `schema_version`; overload RPC de tres argumentos no reflejado en la migración local auditada. Tablas/RPC de comandos de supervisión y solicitudes remotas de backup no están instaladas en este proyecto cliente; cero Edge Functions. Estas ausencias pueden ser funciones deshabilitadas por diseño: deben declararse como capacidades, no ocultarse con éxitos falsos.

Además, roles anon/authenticated tienen privilegios TRUNCATE/REFERENCES/TRIGGER excesivos en public. **No** implica que PostgREST exponga TRUNCATE directamente.

Advisor API: **29 alertas de seguridad** (3 search_path, 18 exposiciones SECURITY DEFINER por rol, 7 accesos de usuarios anónimos, 1 protección de contraseñas) y **24 de rendimiento** (2 FK sin índice, 10 initplan, 11 policies múltiples, 1 índice sin uso). Son categorías repetidas por objeto/rol, no 53 vulnerabilidades únicas. **Aceptación:** esquema reconstruible, capacidades explícitas, migraciones registradas, grants mínimos y tests sobre instalación nueva/actualización.

### Hallazgos de backend sincronizador adicionales

El anexo verifica en la cuenta Supabase real —sin resolver el código de licencia ni registrar equipo— los resultados anteriores. **SR-001–009 están ampliados en el anexo**, y forman parte del mismo catálogo priorizado (34 grupos iniciales más nueve diagnósticos de sync, algunos afinan AUD-009/010/022/029/030).

- **SR-001:** el owner obtiene 120 docs cuenta-wide; 72 corresponden a los tres equipos no revocados y 48 quedan fuera, 36 vinculados al row actualmente revoked y 12 a sources sin vínculo activo. Las policies own-row miran `device_sessions.user_id`, no `account_devices.revoked`. Puede ser la explicación de por qué la consulta como owner ve histórico, no prueba que el token del equipo siga válido, lo haya leído o haya escrito tras revocarse. Una agregación posterior mostró `updated_at` máximo 03:53Z para el source que clasificó como revoked; como es timestamp enviado por cliente y los aliases son por consulta, **no establece cronología de actividad post-revocación**. Revisar contra una sesión de equipo en staging y separar lectura archivada del derecho actual de sincronización.
- **SR-002/SR-009:** producción y build local difieren en artefacto/hash. El bundle público muestra branch pairing monitor (sin pairing baja el estado sync); checkout local intenta `getAccountSyncContext`. Sin deployment SHA/commit no se sabe qué source exacto corre. Las conclusiones estáticas del repo no se deben atribuir a la flota automáticamente.
- **SR-003:** 22 `doc_id` namespaced son multi-origen y 7 muestran hashes de payload diferentes; el stock compartido tenía hasta 4 fuentes. El subset de 72 envelopes en RAM no tuvo inspección humana de valores de negocio; no se calculó stock canónico. Los tests locales de delta no justifican restar/añadir a producción sin reconciliar ledger/backup.
- **SR-004:** 58/120 envelopes carecen de `updatedAt` interno y `schemaVersion`; aceptados como legacy. Su interacción con watermark hace importante probar orden/actualización, no purgar ni re-timestamp masivamente.
- **SR-005:** 74 apariciones en documentos de tickets delta corresponden a 68 ID negocio+día distintos; 4 aparecen en productores múltiples con contenido idéntico. El merge por ID puede tolerar esa re-publicación, pero validar constraint y voids.
- **SR-007:** algunos catálogos JSON 1,38–1,44MB y consulta de 72 docs con datos 6,46MB en esa lectura. Puede agravar carga/egress, no se midió impact/benchmark.
- **SR-008:** miembro Realtime acepta JOIN en channel filtrado; ningún evento generado. No equivale a probar sincronización en vivo.

El total base de **34** hallazgos del catálogo general no se aumenta mecánicamente contando subcasos. El anexo separa hechos de hipótesis y evita presentar una fuga cross-account o una venta duplicada como observada.

## 5. Integridad, persistencia y sincronización

Evidencia ejecutable común: [script](reproducciones-locales.mjs), [resultados](evidencias/reproducciones-locales.json). Los subcasos `b/c` pertenecen al mismo hallazgo, no aumentan el conteo de 34.

### AUD-003 — La contingencia de lectura rompe con ReferenceError
**Alta · R/S · Fase F2.** [storageService](../../src/utils/storageService.js#L29-L95).

`rkey` está declarada dentro del try y se usa fuera en catch. Al fallar IndexedDB, la contingencia lanza **`ReferenceError: rkey is not defined`**, incluso teniendo datos de respaldo. **Aceptación:** fallo de IDB recupera la clave física correcta o comunica error explícito; nunca cruza sede ni lanza ese ReferenceError.

### AUD-004 — withLock reejecuta el callback que falló
**Crítica · R/S · Fase F2.** [withLock](../../src/utils/withLock.js#L191-L211).

El catch de `navigator.locks.request` también captura el error del callback y ejecuta `_memoryMutex(name, fn)`. Reproducción: **dos ejecuciones**; un fallo tras efectos parciales puede transformarse en éxito en la segunda. Adicionalmente, el fallback cross-tab tiene lease de 8 s sin renovación y tras 10 s degrada a mutex de una pestaña; el Map en memoria compara una promesa encadenada con otra distinta y no limpia como pretende.

**Aceptación:** callback exactamente una vez, errores de negocio propagados sin retry automático; exclusión mantenida durante operaciones largas y fallo seguro cuando no se puede garantizar. No prometer atomicidad entre dispositivos con un lock de navegador.

### AUD-005 — Hash parcial omite cambios válidos de sync y backups
**Alta · R · Fase F2/F3.** [sync](../../src/hooks/useCloudSync.js#L69-L76), [backup](../../src/hooks/useAutoBackup.js#L45-L52).

Ambos hashes combinan longitud y los primeros 5.000 caracteres. Dos documentos de 5.125 caracteres con stock 10→11 posterior al prefijo dan **el mismo hash** `5125_2745888544`. **Aceptación:** cambios en cualquier posición alteran revisión/digest completo; tests con documentos grandes y cambios de configuración local.

### AUD-006 — El mapa de stock no puede reconciliar fuentes nuevas ni ecos agregados
**Crítica · R · Fase F2/F4.** [syncDelta](../../src/utils/syncDelta.js).

Prueba diferencial del helper real: con baseline conocido 10 por dispositivo, fuente A vende 2 (8) y B vende 3 (7); ambos deltas sí convergen correctamente a **5**. Pero si A republica el agregado 5, B compara contra el último mapa propio de A (8) y aplica −3 otra vez: queda **2**. En primera recepción sin baseline, el helper asigna absoluto por contrato; si dos fuentes nuevas parten de 10 y se reciben 8 y 7, queda 7, no 5. El código actual no dispone de historial para distinguir un snapshot inicial de un agregado.

**Aceptación:** 10−2−3=5 en cualquier orden, repetición, reconexión y eco; anulación revierte una vez; movimientos con origen/ID únicos y una estrategia explícita para sobreventa offline. Tests puros confirman el delta con baseline; sigue pendiente resolver e2e el snapshot inicial y la republicación agregada.

### AUD-007 — Sincronización manual omite el pull de cuenta
**Alta · R/S · Fase F2.** [syncNow](../../src/hooks/useCloudSync.js#L534-L563).

`const accountCtx = getAccountSyncContext()` carece de await. Al ser una Promise, `userId` no está presente y no entra al bloque de pull de documentos de cuenta. En reproducción de la función real con contexto válido: **cero consultas de cuenta** y mensaje «todo al día». Esto no niega que `pullBusinessRegistry()` se invoque previamente ni que el arranque use await correctamente.

**Aceptación:** la acción manual espera el contexto, descarga y aplica cambios de otro equipo y distingue modo owner/linked/sin cuenta; test del botón real y no sólo del arranque.

### AUD-008 — Recuperación y push periódico usan un helper fuera de scope
**Alta · S, corroborada por lint · Fase F2.** [useCloudSync](../../src/hooks/useCloudSync.js#L1132), [errores](evidencias/lint-errores.json).

`nsGet` sólo existe dentro de `_applyFromCloud`, pero se usa en init/import/autorecuperación/force push en líneas 1132, 1227 y 1276. Esos ReferenceError pueden quedar absorbidos por catch y dejar datos sin subir. **Aceptación:** helper con ámbito/contexto válido, rutas de recuperación ejecutadas y cero no-undef; mantener aislamiento por sede.

### AUD-009 — Éxito falso y cursores no fiables en sync
**Alta · R/S · Fase F2/F4.** [syncNow](../../src/hooks/useCloudSync.js#L607-L677).

Reproducción: cinco pushes críticos devuelven `ok:false`, pero syncNow retorna `ok:true` y «todo al día». En lectura/aplicación, se capturan errores de documentos y puede avanzarse watermark igualmente. Límites 2.000/500 sin paginación ni desempate estable para timestamps crean riesgo de omisiones. La cola de días de ventas revisa los primeros siete sin una progresión robusta, con riesgo de postergar días posteriores.

**Aceptación:** pendientes durables, confirmación por documento/revisión, resultados parciales honestos, cursor compuesto y paginación; ninguna actualización perdida al reconectar o superar límites. La starvation de días se identificó estáticamente, no con carga real.

### AUD-010 — Contexto de sede mutable durante trabajo pendiente
**Crítica por impacto potencial · S · Fase F2/F4.** [debounce](../../src/hooks/useCloudSync.js#L140-L156), [aplicación remota](../../src/hooks/useCloudSync.js#L745).

La cola indexa por clave lógica y resuelve el namespace al ejecutar tras hasta 3 s. Cambiar de sede durante el timer puede publicar datos de A con ID de B. Al aplicar el catálogo de usuarios remoto de una sede no activa, se utiliza el auth store activo en vez de mantener una proyección aislada.

**Aceptación:** todo trabajo captura cuenta+sede+docId+dispositivo al encolarse; cambiar sede/cuenta cancela o conserva correctamente operaciones. Catálogos de otra sede no modifican permisos/usuarios activos. El escenario integrado está pendiente; no se observó contaminación real en producción.

### AUD-011 — Escrituras sin persistencia pueden resolver como exitosas
**Crítica · R/S · Fase F2.** [storageService](../../src/utils/storageService.js#L105-L202).

Con fallos de IDB y localStorage, `setItem` registra error pero resuelve sin throw ni estado de confirmación. Reproducción: un intento por medio, **`writeRejected:false`**. Una cola de memoria no es un recibo durable y puede desaparecer al recargar; además se descartan reintentos tras límite.

**Aceptación:** contrato explícito de durabilidad, failure propagado y UI sin recibo/éxito hasta commit; recuperación posterior identificable, sin pérdida silenciosa ni duplicación.

### AUD-012 — Venta, stock y cartera no forman una transacción integral
**Crítica · S · Fase F2.** [checkoutProcessor](../../src/utils/checkoutProcessor.js).

La venta se escribe antes de productos/ledger mediante operaciones separadas. Un corte intermedio puede dejar ticket sin decremento o cartera incoherente; AUD-004 y AUD-011 agravan el riesgo. La lógica clamp de stock a cero no equivale a rechazar stock insuficiente revalidado dentro del commit. Revisar valores no finitos en todas las entradas: aquí no se demostró un caso Infinity desde la UI.

**Aceptación:** una operación idempotente persiste venta, movimientos, stock derivado, cartera y outbox juntos; fault injection en cada paso, rechazo de entradas no finitas y política de sobreventa documentada. El E2E exacto de camino feliz pasó, no certifica fallos parciales.

### AUD-013 — Nómina permite estados parciales y carreras
**Alta · S · Fase F5.** [payrollService](../../src/services/payrollService.js).

Registrar consumo, descontar stock, marcar consumos, liquidar y crear GASTO_INTERNO son efectos separados. Liquidar usa lectura-modificación-escritura de ventas sin lock integral/idempotencia atómica y actualiza período después. Riesgo de doble liquidación, gasto perdido o consumos descontados sin liquidación completa. Los scripts de nómina localizados en `.tests` tienen imports absolutos Linux y no participan de la suite canónica.

**Aceptación:** consumo y liquidación con IDs estables, commit integral y ledger reconciliable; doble clic/concurrencia/corte producen exactamente una liquidación y un gasto. Nómina como dueño no fue comprobada en navegador real.

## 6. UI, sesión, licencia y configuración

### AUD-014 — El estado de auto-lock no se conecta al bloqueo de la aplicación
**Alta · S · Fase F5.** [App](../../src/App.jsx#L105), [useAutoLock](../../src/hooks/useAutoLock.js), [LockScreen](../../src/components/security/LockScreen.jsx).

App llama `useAutoLock()` sin consumir su `isLocked`/unlock. El hook marca un estado local sin hacer logout, mientras LockScreen decide por usuarioActivo. Puede seguir permitiendo operar tras el bloqueo registrado. **Aceptación:** minimizar/inactividad realmente bloquean vista y acciones; sólo PIN validado desbloquea, con pruebas de reloj y navegador. No probado con una cuenta real.

### AUD-015 — Hooks condicionales al abrir el teclado móvil
**Alta · S · Fase F5.** [BottomNav](../../src/App.jsx#L802-L813).

Return por `isKeyboardOpen` antes de `useCart`/`useMemo`: cambia la cantidad/orden de hooks y puede romper al abrir/cerrar teclado. El recorrido de Chromium a 390 px no emula el teclado virtual de un teléfono. **Aceptación:** hooks incondicionales y pruebas en dispositivo con resize/visualViewport y retorno al POS.

### AUD-016 — Preview de etiquetas falla en moneda única
**Media · S, corroborada por lint · Fase F5.** [SettingsTabNegocio](../../src/components/Settings/tabs/SettingsTabNegocio.jsx#L124-L138).

`hasSecondaryPrice` no está declarada. El modo mixto evita la expresión por cortocircuito; USD/Bs único la evalúa. **Aceptación:** previews/export en Bs, USD, mixto, COP y anchos 56/58/80 sin ReferenceError; PDF real legible y dimensiones correctas. No se ensayó impresión física.

### AUD-017 — Guardado fiscal tiene contratos incoherentes
**Media · S · Fase F5.** [SettingsModal](../../src/components/SettingsModal.jsx#L44), [SettingsView](../../src/views/SettingsView.jsx#L213-L229), [negocioContext](../../src/utils/negocioContext.js#L274).

El modal usa `useNegociosStore` sin import. La vista principal escribe espejos `business_name/rif`, no el registro canónico de sedes; boot/cambio de sede puede restaurar datos previos. **Aceptación:** una única actualización canónica, persistente tras reload/switch, con ticket y reporte coherentes por sede. Ruta legacy del modal necesita inventario de uso.

### AUD-018 — El reporte de equipos al directorio falla por forma de respuesta
**Media · S · Fase F3.** [cloudAccount](../../src/services/cloudAccount.js#L328-L367).

`getMyDevices()` devuelve `{ok,devices}`, pero `reportDevicesToDirectory()` llama `.map` sobre el objeto; TypeError capturado en silencio, sin reporte. **Aceptación:** contrato tipado/validado, reporte verificable y error observable; timestamps actuales reales.

### AUD-019 — Login puede dejar pasar un equipo no registrado
**Alta · S · Fase F3.** [signInOwner](../../src/services/cloudAccount.js#L100-L120), [CloudGate](../../src/components/security/CloudGate.jsx).

Errores de registro distintos de LIMIT_REACHED devuelven login `ok:true,deviceRegistered:false`; el gate puede entrar sin registro válido. Una sesión cacheada puede evitar la revalidación de equipo/revocación. **Aceptación:** credenciales correctas no bastan: pertenencia, estado del equipo y licencia válidos antes de habilitar sync; fallos de registro muestran recuperación segura.

### AUD-020 — Flags locales sustituyen verificaciones de licencia y estado
**Alta · S/E · Fase F3.** [useSecurity](../../src/hooks/useSecurity.jsx), [supabaseCloud](../../src/config/supabaseCloud.js).

Flags como `pda_pro_activated`, linked o un código almacenado permiten activar rutas premium sin revalidar licencia. La limpieza de proyecto no armoniza todos los indicadores. El fixture sintético permite recorrer el producto, pero **no es una prueba de bypass del backend real** ni certifica validez de licencia.

**Aceptación:** máquina de estados coherente, caché offline verificable y con vigencia/política explícita, limpieza completa al cambiar cuenta; backend independiente de flags manipulables.

## 7. Backups, APIs, dependencias y operación

### AUD-025 — Respaldo fallido queda marcado y puede no reintentarse
**Alta · S/R para hash · Fase F3.** [useAutoBackup](../../src/hooks/useAutoBackup.js#L131-L232).

Se guardan hash/fecha antes de confirmar éxito de metadatos. Un rechazo puede inhibir el siguiente backup sin cambios. Se hashea sólo IDB, por lo que un cambio exclusivamente de configuración local puede pasar inadvertido. Comentarios mencionan fallback Supabase que la ruta ejecutada no materializa. HTTP 2xx de metadatos no verifica por sí solo un archivo recuperable; tres filas reales no vacías de backups no certifican restauración.

**Aceptación:** intento/confirmado separados, reintentos con backoff, digest completo incluyendo LS, descarga+restauración en sandbox y checks de cantidades/saldos/stock/schema por sede.

### AUD-026 — Un secreto VITE no es una credencial servidor
**Alta · S · Fase F3.** [backupRelay](../../src/utils/backupRelay.js), [useAutoBackup](../../src/hooks/useAutoBackup.js#L197).

`VITE_ESTACION_BACKUP_SECRET` se incorpora al cliente y se envía como `x-backup-secret`. Por diseño puede extraerse del bundle si se configura. No se dispone del backend de Estación para evaluar su verificación y no se explotó el endpoint. **Aceptación:** autorización por sesión/capability limitada validada servidor; ninguna clave compartida con autoridad de escritura dentro del frontend. Rotar sólo si se confirma que fue distribuida.

### AUD-027 — Proxy de imágenes admite destinos arbitrarios
**Alta · S · Fase F1/F3.** [image-proxy](../../api/image-proxy.js).

Fetch de `req.query.url` sin allow-list, control de esquemas/IP privada/redirects, timeout, máximo de bytes ni verificación de MIME; responde contenido remoto con CORS abierto. Riesgo SSRF/open proxy, consumo de memoria y contenido activo en origen propio. **Aceptación:** destinos aprobados y resoluciones/redirects validados, sólo imágenes, descarga acotada y autorización/límites. Sin pruebas ofensivas contra producción.

### AUD-028 — Chat necesita un contrato de abuso y cancelación duradero
**Media · S · Fase F3/F6.** [api/chat](../../api/chat.js).

Endpoint sin autorización de usuario; CORS no es autenticación. Rate-limit por IP con fallback en memoria no es compartido entre instancias. Revisar que deadline/desconexión aborten fetch/reader incluso con el body bloqueado en stream. **Aceptación:** presupuesto por actor/cliente, límites consistentes, cancelación medida y errores sin revelar claves. No se midió ataque de carga ni consumo real del proveedor.

### AUD-030 — Instalación no reproducible y alertas de dependencias pendientes
**Alta · ejecución/S · Fase F6.** [dependencias](evidencias/dependencias.json), [instalación congelada](evidencias/install.log), [instalación de diagnóstico](evidencias/install-no-save.log), [package](../../package.json).

`bun audit` devuelve **15 paquetes y 75 entradas de avisos**, con posibles duplicados/versiones múltiples; `tar` incluye aviso crítico en cadena de herramientas. Separar dependencias ejecutadas en navegador/servidor, herramientas locales y alcance del input antes de decidir urgencia. XLSX no figura en ese resultado: **no significa que sea seguro ni que se haya auditado satisfactoriamente**.

Resolución de diagnóstico: Bun 1.3.14/Node 24.13.0, Vite 7.3.5, Vitest 4.1.9, Supabase 2.108.2, React 19.2.7; Remotion 4.0.507 y google-fonts 4.0.502 desalineados. `packageManager` declara Bun 1.1.0. **Aceptación:** una versión de gestor, lock consistente, frozen install en limpio, SBOM/advisories deduplicados con alcance y versiones de Remotion alineadas.

### AUD-031 — Gates de calidad no garantizan comportamiento crítico
**Alta · ejecución/S · Fase F6.** [resultados](evidencias/verificacion-final.log), [tsconfig](../../tsconfig.json), [config pruebas](../../vite.config.js).

Lint rojo, typecheck sin checkJs, 13 tests fallidos y 11 omitidos; los bugs reproducidos conviven con pruebas verdes de locks/deltas. Tests de texto y mocks pueden acreditar la presencia de una cadena en vez de seguridad/efecto real. Pruebas de contrato dependen de un proyecto hermano no disponible; nómina fuera de suite. **Aceptación:** gates reproducibles, regresiones conductuales para AUD-003–013, ningún skip de invariantes críticas, E2E reales en staging y cobertura de hooks/servicios, no sólo utils/core.

### AUD-032 — Tamaño y cache de recursos requieren medición antes de optimizar
**Media · build/S · Fase F6.** [build](evidencias/build.log), [PWA config](../../vite.config.js).

Chunk principal **725,89 kB (gzip 211,67)** y Products **519,28 kB (gzip 159,46)**; precache 44 entradas, **3.410,15 KiB**. Imágenes con rutas estables y CacheFirst por 90 días pueden quedar antiguas tras upsert. Manifest de producción declara `lang:en` en app española. Shortcuts `?view=` requieren prueba de navegación, no se declara aquí que fallen.

**Aceptación:** baseline en Android de gama baja, carga/cambio de vista/búsqueda con 1k/10k productos, memoria y bundle; imágenes versionadas, idioma correcto y shortcuts comprobados. No se afirma mejora de velocidad ni timings representativos a partir de un GET puntual.

### AUD-033 — Faltan cabeceras de endurecimiento en Vercel
**Media · O · Fase F6.** [HTTP producción](evidencias/produccion-http.json), [vercel.json](../../vercel.json).

HSTS presente; CSP, X-Frame-Options, nosniff, Referrer-Policy y Permissions-Policy ausentes en respuestas consultadas. `worker.js` no configura el host Vercel real. **Aceptación:** política de framing, MIME y permisos en el despliegue; CSP primero report-only y luego enforcement sin romper Supabase, PDF, cámara, impresión ni PWA.

### AUD-034 — Operación y documentación sin una fuente verificable
**Media · S/O · Fase F0/F6.** [AGENT](../../AGENT.md), [README](../../README.md).

Documentación contiene referencias de entorno/despliegue contradictorias u obsoletas. No hay commit verificable en este checkout ni una prueba de equivalencia del bundle publicado. Se observaron históricamente errores repetidos de identidad `device_sessions_pkey` en dashboard; la ruta insert→duplicate→update del arranque genera ruido y debe revisarse sin eliminar el control de pertenencia. Esa observación no tiene export histórico propio.

**Aceptación:** mapa cliente/directorio/Estación/hosts, versiones/esquema trazables, runbook de restauración y alertas operativas sin secretos; registro de identidad idempotente y seguro, no sólo silenciar errores.

## 8. Matriz de cobertura pendiente para certificar el sistema

| Área | Comprobado | Pendiente obligatorio |
|---|---|---|
| Instalación/licencia/login | Gate limpio local y configuración; revisión del código | Código real en staging, dueño, registro fallido, cuenta llena, caché offline, logout/cambio de cuenta. |
| Venta/stock | Venta exacta USD persistida localmente; unitarias existentes | Bs/COP/multipago/vuelto/fiado/granel/descuento/Cashea, doble clic, stock agotado concurrente, corte/quota y recarga. |
| Caja/cartera | Vistas, suite utils/core y revisión | Apertura/cierre, gastos/abonos/cobranza/anulación, conciliación y dos pestañas en staging. |
| Multi-sede/multi-equipo | Producción real: 4 equipos vinculados (3 activos/1 revocado), lectura subset 72/72 y cuenta-wide 120/120; divergencia 7/22 multi-source; subscription aceptada sin cambios; en local bugs hash/stock/syncNow reproducidos | Aclarar equipos revocados/legados y namespaces con dueño; identificar bundle+commit exactos; inventariar diferencias reales de stock contra ledger/cierres; luego ida/vuelta con equipos ficticios en staging, cambio durante debounce, desconexión/reorden/replay/eco y carga. |
| Usuarios/seguridad | Policies/RPC reales y lectura anon negativa | Matriz DML staging, revocación efectiva, permisos dueño/admin/cajero, recuperación, auto-lock y teclado real. |
| Nómina | Revisión, restricción ADMIN observada | UI dueño, alta/consumo/anulación/liquidación, concurrencia, efectos de caja/stock y periodos. |
| Productos/imágenes/PDF | Inventario/ajustes renderizan; bucket/policies inspeccionados | CRUD/importación, moneda única, uploads RLS y cache, PDF/ticket/impresión física. |
| Backup/restore | Metadatos y revisión de errores | Backup confirmado, rechazo+retry, restauración sandbox de todas las sedes, migración de versión y rollback. |
| PWA/dispositivos | Build/manifest y viewport 390 px | Instalada offline, actualización sin perder cesta, iOS/Safari, Android/Capacitor, Electron, lector/impresora. |
| API/rendimiento | GET básicos y revisión de endpoints | Tests de seguridad locales, deadlines, límites concurrentes, benchmarks y accesibilidad teclado/lector. |

La entrega es una auditoría amplia con evidencia y un plan completo de remediación, **no una certificación de 100% de flujos**. La validación restante debe usar staging/datos ficticios y ventanas explícitas para cualquier cambio de producción.

## 9. Evidencias y reproducción

- [Manifest de recolección Supabase](evidencias/supabase-manifest.json), [consultas utilizadas](consultas-solo-lectura.json), [recolector](auditar-supabase.mjs), [verificador de acceso READ ONLY](verificar-acceso-lectura.mjs).
- [Security advisors](evidencias/supabase-security-advisors.json), [performance advisors](evidencias/supabase-performance-advisors.json), [integridad](evidencias/integrity-summary.json).
- [Escenarios Playwright aislados](flujos-aislados.spec.js), [configuración](playwright.audit.config.js), [reporte JSON](evidencias/e2e-aislados-final.json), [pull de arranque simulado](evidencias/sync-requests-final.json).
- [Anexo de sync real](evidencias/sync-real-interpretacion.md), [conteos autenticados](evidencias/sync-real-autenticado.json), [SQL agregado](evidencias/sync-real-agregados.json), [bundle comparado](evidencias/sync-real-bundle.json), [análisis de artefacto público](evidencias/sync-real-publicado.json).

Desde la raíz del workspace, con dependencias instaladas:

```bash
# Reproduce defectos, sin peticiones externas; código de salida 0 indica reproducción lograda.
node docs/auditoria-2026-10-04/reproducciones-locales.mjs

# Build local y preview para los cuatro flujos aislados.
bun run build
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4181 --strictPort
# En otra terminal:
node node_modules/@playwright/test/cli.js test --config docs/auditoria-2026-10-04/playwright.audit.config.js

# Diagnóstico de sync real (READ ONLY, Management API + bundle público).
# Revisa scripts y .env/proyecto antes de cualquier ejecución futura.
node docs/auditoria-2026-10-04/auditar-sync-real.mjs
node docs/auditoria-2026-10-04/inspeccionar-sync-publicado.mjs

# Panel de lectura PostgREST autenticada; el usuario ingresa credenciales manualmente.
# Precaución: select=data carga envelopes de la cuenta a RAM del browser para un pull controlado.
# Ejecutar sólo con autorización, en equipo confiable; nunca publicar tráfico/DevTools sin redacción.
node docs/auditoria-2026-10-04/sync-real-server.mjs
# Abrir http://127.0.0.1:4182/ en navegador incognito.
# No ingresa código de licencia; sesión in-memory; consulta IDs/doc metadata/sizes.

# Suite completa utilizada; staging mutador deshabilitado expresamente en la auditoría.
SUPERVISOR_STAGING_COMMANDS_E2E=false node node_modules/vitest/vitest.mjs run \
  --pool=threads --maxWorkers=1 --coverage --coverage.reportOnFailure \
  --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=html \
  --coverage.reportsDirectory=docs/auditoria-2026-10-04/evidencias/coverage-final
```

No ejecutar los recolectores remotos por costumbre ni publicar estos metadatos internos. Una futura auditoría debe reautorizar su alcance, usar credenciales locales sin imprimir valores y repetir el protocolo READ ONLY. No se entrega SQL de reparación listo para producción: primero hacen falta migraciones revisadas y ensayadas.
