# Auditoría comparativa del Modo Supervisor

**Fecha:** 2026-08-09
**Proyecto destino:** `preciosaldia-bodega` — Precios al Día
**Proyectos auditados:**

1. `C:\Users\luigg\Desktop\sistemas personalizados\donde juancho\sistema pos\projects\donde juancho`
2. `C:\Users\luigg\Desktop\sistemas personalizados\jeremy\projects\el spot`

## 1. Resumen ejecutivo

Los dos proyectos son variantes relacionadas del mismo POS y contienen ideas valiosas para mejorar Precios al Día, pero **no conviene copiar ninguno completo**.

- **Precios al Día está por delante en seguridad estructural:** sesión Auth anónima persistente, pairing con token largo/hashado, RLS cerrada, RPC autorizadas, envelopes de sync versionados, ACK de comandos y flag de mutaciones desactivado.
- **El Spot está por delante en observabilidad y UX operativa:** heartbeat visible de la caja, historial de comandos, estados individuales de órdenes, notificación de cambios y almacenamiento durable de comandos aplicados.
- **Donde Juancho está por delante en amplitud funcional:** multisupervisor, lista/revocación de dispositivos, recuperación de imágenes, más acciones de inventario, normalización de métricas y controles financieros.
- **Los SQL de ambos proyectos no deben trasladarse a Precios al Día:** conservan autorización por `device_id`, acceso `anon`, escritura directa, tokens de seis caracteres y/o políticas demasiado amplias. En Donde Juancho además hay una lógica de “auto-healing” que puede seleccionar otra caja del sistema.
- **Las mutaciones remotas de Precios al Día deben continuar desactivadas** hasta adaptar las mejoras y ejecutar E2E con staging sintético.

### Decisión general

| Resultado | Cantidad aproximada | Decisión |
|---|---:|---|
| Adoptar | 6 grupos | Pasar a Precios al Día después de adaptar al contrato actual |
| Adaptar con mucha cautela | 7 grupos | Reutilizar la idea, no el código/SQL tal cual |
| Descartar | 8 grupos | Introducen riesgo de seguridad, corrupción o incompatibilidad |

---

## 2. Estado técnico comprobado

### Donde Juancho

- Tests del proyecto: **347 pasan, 10 omitidos**, 43 archivos.
- Build: **pasa**.
- Lint global: **falla** con **95 errores y 1.853 warnings**; la mayoría son de API/Desktop/configuración y deuda general, pero no existe un gate limpio específico del Supervisor comparable al de Precios al Día.
- `typecheck`: el script del proyecto contiene `|| true`; por tanto, **no es un typecheck bloqueante**.
- El árbol de trabajo ya tenía un cambio ajeno a esta auditoría en `src/hooks/useMonitorSync.js` — una limpieza de `presenceError` al recibir Realtime. No se modificó.

### El Spot

- Tests del proyecto: **176 pasan, 10 omitidos y 3 fallan**.
- Fallos relevantes:
  1. `financialEngine.test.js`: el reporte acumula ingresos como `0` cuando esperaba `10`.
  2. `security.test.js`: `verifyStoredFingerprint` acepta un ID arbitrario (`PDA-DEAD`).
  3. `security.test.js`: también acepta un string malformado (`not-a-pda-id`).
- Build: **pasa**.
- Lint global: **falla** con **73 errores y 1.663 warnings**.
- `typecheck`: también usa `|| true`, así que no es un gate real.
- Existe una auditoría propia muy completa (`SUPERVISOR_AUDIT.md`) con 58 problemas únicos: 6 críticos, 18 altos, 26 medios y 9 bajos.

### Precios al Día como referencia

La implementación actual de Precios al Día ya contiene, según el plan vigente:

- pairing Auth con token temporal de 24 caracteres y hash en servidor;
- RLS sin grants directos de `anon` sobre datos sensibles;
- `supervisorSyncService` con schema, allowlist, watermark temporal y reintentos;
- `supervisorCommandService` con `commandId`, TTL, validación, RPC, ACK/NACK e idempotencia;
- normalizador financiero compartido y manejo de COP nulo;
- `SUPERVISOR_REMOTE_MUTATIONS_ENABLED = false`;
- tests específicos del Supervisor, build y typecheck real.

Esta auditoría no cambia esas protecciones.

---

## 3. Comparación funcional de la interfaz

### 3.1 Donde Juancho — fortalezas de interfaz

El panel `OwnerMonitorView` ofrece un panel amplio orientado a operación:

- turno activo;
- cierres de caja agrupados por `cierreId`;
- inventario con búsqueda, paginación y filtros de stock;
- edición remota de productos;
- ajustes de stock;
- gestión de usuarios y PINs;
- cambio de tasa;
- vinculación de dispositivos;
- recuperación de imágenes;
- exportación de cierres y métricas financieras;
- soporte de COP y precios congelados en Bs.

`SupervisorPairingModal` añade una pestaña de dispositivos, etiqueta del monitor, última presencia y revocación individual. Es una buena referencia de experiencia para una futura pantalla de **Dispositivos vinculados** en Precios al Día.

### 3.2 El Spot — fortalezas de interfaz

El Spot tiene una experiencia más pulida para operación remota:

- indicador visible de conexión de la caja;
- texto “CAJA vista hace X segundos/minutos”;
- botón de auditoría de comandos;
- filtros de comandos aplicados, pendientes y fallidos;
- reintento visual de órdenes fallidas;
- notificación en la caja cuando el Supervisor modifica inventario;
- estados de heartbeat y órdenes enviados separados;
- botones críticos con tamaños táctiles de aproximadamente 44 px;
- `aria-label`, `role="dialog"`, `aria-modal`, `Escape` y grupos `radiogroup` en varias partes del flujo;
- `EmptyState` y `KpiCard` reutilizables.

Estas mejoras resuelven una necesidad real: el Supervisor debe saber si una orden fue **encolada**, **tomada por la caja**, **aplicada** o **fallida**.

### 3.3 Problemas visuales que no debemos importar

La auditoría de El Spot confirma problemas que deben evitarse:

- header permanentemente negro que rompe el modo claro;
- más de 20 clases Tailwind inexistentes (`slate-850`, `slate-650`, `slate-350`, `amber-955`, etc.);
- textos de 7–8 px con contraste insuficiente;
- tabla de arqueo que oculta la columna “Diferencia” en móviles pequeños;
- notificaciones, toasts y modales con z-index solapados;
- notificaciones oscuras en modo claro;
- botones icon-only sin accesibilidad en varias rutas;
- modales sin focus trap completo;
- header móvil con demasiados controles para pantallas estrechas.

**Conclusión UX:** tomar los componentes conceptuales de El Spot, pero construirlos con el design system existente de Precios al Día. No copiar clases Tailwind ni estilos de `OwnerMonitorView` completos.

---

## 4. Hallazgos de pairing y seguridad

### 🔴 P0 — SQL de ambos proyectos usa un modelo antiguo y no compatible

Los dos proyectos contienen variantes de `supabase_pairing_setup.sql` con problemas graves:

- tokens de solo **6 caracteres**;
- token guardado en claro en `device_pairings.pairing_token`;
- políticas y grants para `anon`;
- escritura directa o RPC autorizadas únicamente con IDs de dispositivo;
- el `device_id` guardado en `localStorage` funciona como secreto portador;
- el vínculo no está ligado de forma consistente a una identidad Auth.

En Donde Juancho, `PairingScanScreen` intenta primero el modelo multisupervisor y luego tiene fallback a `pair_monitor_device` legacy. En El Spot, el flujo incluso tiene una ruta de actualización directa de `device_pairings` cuando la RPC no devuelve el resultado esperado.

**Qué hacer en Precios al Día:** conservar el contrato actual de 24 caracteres, hash, consumo único, expiración y Auth. No reintroducir compatibilidad pública como camino normal.

### 🔴 P0 — “Auto-healing” de Donde Juancho puede cruzar cajas

En `supabase_multisupervisor_setup.sql`, `generate_monitor_token` y `pair_additional_monitor` pueden buscar la caja más reciente desde `sync_documents` cuando la caja solicitante no se considera activa. La selección usa el documento `bodega_sales_v1` más recientemente actualizado.

Eso significa que, ante una presencia vieja o inconsistente, el sistema puede elegir la caja de **otro comercio**. Es un riesgo de aislamiento de tenant y no es aceptable para Precios al Día.

**Decisión:** descartar totalmente el auto-healing por “último documento activo”. Si no se conoce el vínculo exacto, se debe fallar y pedir un pairing nuevo.

### 🔴 P0 — Revocación multisupervisor insuficientemente ligada al actor

En Donde Juancho, `revoke_monitor` valida principalmente `p_requester_id` y la existencia de una relación activa. En combinación con IDs manipulables, no es una credencial fuerte.

La RPC de listado (`list_monitors`) es mejor que un `SELECT` público, pero sigue dependiendo del ID portador en el diseño antiguo.

**Decisión:** adoptar la interfaz de revocación, no el SQL. En Precios al Día, la revocación debe validar `auth.uid()` contra `owner_auth_id` o `monitor_auth_id`, y todos los comandos/lecturas deben quedar anulados por `revoked_at`.

### 🟠 P1 — Pairing no debe activar sync por generar un QR

El SQL multisupervisor de Donde Juancho genera o actualiza registros de pairing mientras emite tokens. La creación de un token no debe dar permiso para leer datos ni debe cambiar el estado de sincronización.

Precios al Día ya sigue la separación correcta: emitir token, consumir token y autorizar lectura son pasos distintos.

---

## 5. Hallazgos de comandos remotos

### 5.1 Donde Juancho

Implementa:

- `rate_change`;
- `inventory_update`;
- `user_update`;
- `void_sale` y otras variantes en SQL;
- deduplicación local de hasta 200 IDs;
- lock de escritura;
- sincronización diferida de productos;
- estados `applied`, `applied_with_warnings`, `failed`;
- coalescing de comandos pendientes en el catch-up.

Pero mantiene problemas importantes:

1. `APPLIED_IDS_MAX = 200`: la idempotencia desaparece cuando se expulsan IDs viejos.
2. `applyRateChange` usa import dinámico y, si falla, puede aplicar localmente sin propagar correctamente a nube.
3. Existe lógica legacy de `newPin` en claro en `user_update`.
4. `updateCommandStatus` tiene fallback a una actualización mínima; puede ocultar que la auditoría no se escribió completa.
5. La autorización `is_authorized_monitor` tiene ramas demasiado amplias; en particular, una existencia genérica de `device_pairings` puede terminar autorizando más de lo debido.
6. El estado de comando y la confirmación no están tan estrictamente ligados a una sesión Auth como en Precios al Día.

### 5.2 El Spot

Tiene avances interesantes:

- `claimCommand` para pasar de `pending` a `processing`;
- `inFlight Map` para evitar dos promesas simultáneas del mismo comando;
- `coalesceCommands` para agrupar órdenes pendientes;
- `appliedCommandsStore` en IndexedDB con TTL de 7 días;
- `useSentCommandsStatus` para mostrar estado por comando;
- `CommandAuditModal`;
- `device_heartbeats` para saber si la caja está viva;
- carga de comandos después de `SUBSCRIBED` y polling cada 12 segundos.

La auditoría también encontró fallos que deben corregirse antes de tomar ese código:

1. La deduplicación antigua elimina un ID persistido si todavía figura `pending`; si el ACK falló aunque la operación local sí se aplicó, puede repetirse una operación no idempotente.
2. `claim_command` no comprueba de forma efectiva que `p_claimer_id` sea el dispositivo que debe aplicar la orden.
3. Si el claim falla, el código tiene un fallback que consulta si sigue `pending` y procede; eso reabre la carrera que el claim debía cerrar.
4. `catchUpPending` y Realtime pueden volver a competir si no se mantiene un estado único por comando.
5. El modal de auditoría vuelve a modificar comandos directamente desde el cliente y hasta puede quitar `expectedStock` al reintentar; eso debilita el control de concurrencia.
6. El SQL usa `anon` para insertar, leer y actualizar comandos basándose en un pairing, no en Auth.

### Decisión para Precios al Día

Adoptar:

- estado individual por comando;
- historial de auditoría de solo lectura;
- heartbeat visible;
- almacenamiento durable de IDs aplicados;
- coalescing únicamente para acciones matemáticamente acumulables, como ajustes de stock.

No adoptar:

- actualización directa de estados desde la UI;
- fallback que procesa sin claim confirmado;
- eliminación de IDs aplicados para “permitir reintento”;
- comandos de usuarios/PINs con datos sensibles.

El servicio actual `supervisorCommandService` de Precios al Día debe seguir siendo la única puerta de salida y las RPC actuales deben seguir siendo la única autorización.

---

## 6. Sincronización y resiliencia

### Donde Juancho — lo mejor para reutilizar

`useMonitorSync` tiene varias mejoras de ingeniería:

- allowlist amplia derivada de lo que el monitor realmente consume;
- `schemaVersion` y watermark por documento;
- rechazo de documentos viejos/repetidos;
- cola por documento para serializar aplicaciones;
- presencia de la caja diferenciada de error de consulta;
- `useRef` por instancia en vez de suscripción global;
- recuperación de imágenes locales cuando llega el catálogo cloud;
- backoff/polling controlado.

Estas ideas son compatibles con la Fase 3 de Precios al Día y algunas ya están implementadas allí.

### El Spot — lo mejor para reutilizar

- Validación de `deviceId` antes de construir filtros Realtime.
- `useDeviceHeartbeat` para el estado humano “Caja vista hace X”.
- `useSentCommandsStatus` para el estado de las órdenes.
- `appliedCommandsStore` en IndexedDB con TTL.
- Separación explícita de `processing` y `pending`.

### Riesgos comunes de los dos proyectos

- filtros Realtime basados en interpolación de IDs; la validación ayuda, pero no sustituye RLS;
- consultas de catch-up que pueden traer filas viejas indefinidamente;
- fallback a APIs legacy si falla la RPC nueva;
- estados de UI que dicen “enviado con éxito” sin ACK final;
- uso directo de `localStorage` para datos que deberían pasar por el servicio de almacenamiento/sync.

---

## 7. Inventario, imágenes y egress

Este es uno de los aportes más valiosos para Precios al Día.

### Implementación observada

Donde Juancho y El Spot ya consideran el problema de enviar imágenes dentro de comandos:

- determinan el `productId` antes de construir el payload;
- comprimen/redimensionan la imagen;
- suben base64 a Storage antes de enviar el comando;
- usan una ruta determinística por producto;
- dejan base64 como fallback offline cuando no hay red;
- aplican un guard de tamaño antes de `FileReader`;
- procesan el fallback en la caja fuera del lock de escritura;
- evitan que el blob grande viaje dentro de `supervisor_commands` cuando hay conexión.

### Qué añadir a Precios al Día

**Prioridad alta, después de mantener el flag mutante apagado:**

1. `imageUpload` compartido para la caja y el monitor.
2. Límite temprano de imagen, por ejemplo 8 MB crudos.
3. Ruta Storage determinística por `productId` y `upsert` seguro.
4. Payload remoto con URL de Storage, no base64, cuando hay conexión.
5. Fallback offline limitado y probado en la caja.
6. Test que confirme que `sync_documents` y `supervisor_commands` no contienen base64 grande.
7. Preservación de imagen existente cuando un patch no incluye imagen.
8. Mensaje de conflicto que incluya el nombre del producto.

**No copiar:** cualquier flujo que permita que una imagen base64 grande permanezca indefinidamente en el documento sincronizado.

---

## 8. Métricas, dinero, COP y cierres

### Donde Juancho

Tiene una capa de normalización más cercana a la necesidad de Precios al Día:

- productos actuales y legacy;
- `costUsd` con fallback controlado;
- agrupación por `cierreId`;
- COP no declarado;
- FinancialEngine como referencia;
- cierre/reapertura con `shiftId` y `cierreId`.

Es una buena fuente de casos de negocio, pero no debe sustituir el `supervisorFinancials.js` ya creado en Precios al Día.

### El Spot

Tiene buenos patrones de redondeo con `sumR`, `mulR` y `subR`, pero su suite actual muestra un fallo de paridad en reportes: un conjunto de ventas que debería sumar 10 termina en 0. Por eso sus agregadores no se deben copiar sin comparar contra `FinancialEngine` y los tests de caja.

### Recomendación financiera

Adoptar solamente:

- casos de prueba de COP inicial, COP nulo, fiado, Cashea, gastos internos y pagos de deuda;
- uso sistemático de `dinero.js`;
- etiqueta visible “Estimado” versus “Conciliado”;
- filtros de cierre por `cierreId` y `shiftId`.

Mantener como fuente de verdad de Precios al Día:

- `FinancialEngine`;
- `supervisorFinancials.js`;
- contratos de `costUsd`, `priceUsd`, `totalUsd`, `totalBs` y `cashCop`.

---

## 9. Qué añadir exactamente a Precios al Día

### A. Adoptar en la siguiente iteración

| Prioridad | Mejora | Origen | Motivo |
|---|---|---|---|
| P1 | Heartbeat de caja y texto “vista hace X” | El Spot | Evita enviar órdenes a una caja aparentemente apagada y mejora la confianza del usuario |
| P1 | Estado individual de comandos | El Spot | El Supervisor deja de confundir “encolado” con “aplicado” |
| P1 | Historial de auditoría solo lectura | El Spot | Permite investigar fallos sin abrir la base de datos |
| P1 | Egress de imágenes a Storage | Ambos | Evita payloads enormes, egress innecesario y bloqueos de IndexedDB |
| P1 | Guard de tamaño de imagen | Donde Juancho | Evita congelar la interfaz antes de FileReader |
| P1 | Preservación de imagen/barcode en patch parcial | Donde Juancho | Evita perder datos al editar solo nombre/precio |
| P2 | Applied-command store en IndexedDB con TTL | El Spot | Más durable que un array de 200 IDs en localStorage |
| P2 | EmptyState/KpiCard y accesibilidad de modales | El Spot | Mejora móvil, teclado y lector de pantalla |
| P2 | Lista de dispositivos con etiqueta y última presencia | Donde Juancho | Base para multisupervisor seguro |

### B. Adaptar, no copiar

| Idea | Adaptación obligatoria en Precios al Día |
|---|---|
| Multisupervisor | Usar `monitor_auth_id` por dispositivo, no IDs portadores ni `device_pairings.monitor_device_id` como único registro |
| Heartbeat | Tabla/RPC con RLS Auth y solo lectura del tenant vinculado |
| Claim de comando | RPC atómica que valide actor/target y el estado; si el claim no confirma, no procesar |
| Reintentar comando | RPC dedicada; nunca `UPDATE` directo desde el modal ni quitar `expectedStock` automáticamente |
| Cierre remoto | Mantener `shiftId`, `cierreId`, idempotencia y auditoría del actor |
| Notificaciones | Un único stack accesible, con auto-cierre, `aria-live` y z-index centralizado |
| Métricas | Usar el normalizador/FinancialEngine de Precios, no los agregadores de Donde Juancho o El Spot |

### C. Descartar

1. `DROP TABLE public.device_pairings CASCADE` de El Spot.
2. `GRANT SELECT, INSERT, UPDATE, DELETE TO anon` en tablas de pairing, sync o comandos.
3. Políticas `USING (true)` / `WITH CHECK (true)` sobre documentos POS.
4. Tokens de seis caracteres almacenados en claro.
5. Fallback que actualiza directamente `device_pairings` desde el cliente.
6. Auto-healing que escoge la caja más reciente de `sync_documents`.
7. El bypass `monitor_web` como autorización.
8. PINs en claro o hashes enviados como comando remoto.
9. Reintentos que eliminan la protección `expectedStock`.
10. Mantener una ruta legacy pública “por compatibilidad” después de cerrar RLS.

---

## 10. Plan de integración recomendado

### Fase A — Extracción segura

- Crear fixtures sintéticos a partir de los tests, no copiar datos reales.
- Extraer únicamente componentes/contratos, no SQL ni `.env`.
- Mantener `SUPERVISOR_REMOTE_MUTATIONS_ENABLED = false`.

### Fase B — Egress de imágenes

- Implementar Storage URL + límite de tamaño + fallback offline.
- Añadir tests de tamaño, URL, fallback y ausencia de base64 en comandos.
- Verificar que una edición parcial conserve barcode e imagen.

### Fase C — Observabilidad

- Añadir heartbeat de caja.
- Añadir estados por comando y auditoría de solo lectura.
- Añadir expiración visual, reintento seguro y mensajes de error accionables.

### Fase D — Multisupervisor seguro

- Decidir si Precios permite uno o varios monitores.
- Si permite varios, crear vínculo Auth por monitor y revocación individual.
- No reutilizar `device_pairings.monitor_device_id` como modelo principal.
- Probar monitor A, monitor B, revocar A y comprobar que B sigue operativo.

### Fase E — E2E staging

- Caja y dos monitores en contextos Playwright separados.
- Pairing, sync, offline/reconnect, imagen, heartbeat, ACK/NACK, replay, revocación y cierres.
- Ataques anónimos, target spoofing, payload alterado y command replay.

### Fase F — Producción

- Solo aplicar SQL nuevo si una consulta de preflight demuestra que falta una tabla/RPC.
- Ejecutar migración aditiva e idempotente con backup y rollback.
- Mantener mutaciones desactivadas hasta tener E2E verde.
- Activar por etapas y vigilar ACK, latencia, egress y errores Realtime.

---

## 11. Riesgos de copiar sin adaptar

| Riesgo | Consecuencia |
|---|---|
| Copiar SQL de pairing | Acceso cruzado entre cajas o exposición pública de datos |
| Copiar comandos legacy | Cambios remotos no autorizados o doble aplicación de stock |
| Copiar agregadores financieros | Diferencias entre caja y Supervisor en ventas/COP/cierres |
| Copiar `localStorage` de otra variante | Monitor que no limpia sesión, no sincroniza o mezcla IDs `dj_*`/`pda_*` |
| Copiar `OwnerMonitorView` completo | Clases Tailwind inválidas, regresiones visuales y dependencia de campos que no existen en Precios |
| Copiar fallbacks legacy | Reapertura de canales públicos después de haber endurecido RLS |
| Ejecutar el SQL de El Spot | `DROP TABLE ... CASCADE` potencialmente destructivo |

---

## 12. Conclusión

**Sí hay mejoras valiosas que añadir a Precios al Día**, especialmente:

1. heartbeat visible de la caja;
2. estados/auditoría de comandos;
3. egress correcto de imágenes;
4. almacenamiento durable de IDs aplicados;
5. accesibilidad y estados de UI;
6. lista de dispositivos preparada para multisupervisor.

**No hay que importar el pairing ni la autorización SQL de ninguno de los dos proyectos.** Precios al Día ya tiene una base de seguridad superior y debe conservarla como contrato central.

La recomendación es avanzar primero con **Egress de imágenes + heartbeat + auditoría de comandos**, después ejecutar E2E en staging y solo al final decidir si se habilitan mutaciones. No se requiere ejecutar SQL de los proyectos donantes para esta integración.
