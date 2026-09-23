# Respaldo y Restauración — Caminos, Estado Real y Solución de Problemas

> Estado documentado: 2026-09-09, tras la serie de fixes `b709d9e`…`5adf84d`.
> Todo lo aquí descrito fue verificado con pruebas automatizadas (423 tests)
> y un E2E en vivo contra el proyecto Supabase real (`sodgzkablshladvbtnes`).

---

## Resumen ejecutivo

| Camino | Estado en producción | Cuándo usarlo |
| :--- | :--- | :--- |
| **1. Archivo (export/import JSON)** | ✅ **Funciona hoy** — verificado round-trip completo | Respaldo diario del negocio, migración entre equipos, emergencia |
| **2. Nube directa (dispositivo ↔ `cloud_backups`)** | ⛔ **Bloqueado por RLS** — requiere aplicar la migración SQL `001_device_own_row_rls.sql` | Cuando la migración esté aplicada en Supabase |
| **3. Relay Estación Maestra** | 🟡 **Listo, pendiente de deploy** — endpoint creado en el repo, no desplegado a Vercel | Hoy como fallback automático; tras la migración queda como red de seguridad |

**Recomendación operativa hoy:** usa el camino 1 (archivo) como respaldo
regular del negocio. El botón "Sincronizar con la Nube" funciona vía relay en
cuanto se despliegue la Estación Maestra; el camino 2 se activa solo al
aplicar la migración SQL.

---

## Camino 1: Archivo (export / import JSON) — ✅ Funciona hoy

**UI:** Configuración → Sistema → *"Exportar Backup"* / *"Importar Backup"*.

### Flujo de exportación
1. `useDataImportExport.handleExport` recolecta el payload canónico
   (`IDB_KEYS` + `LS_KEYS` de `src/config/backupKeys.js`).
2. Descarga `backup_tasasaldia_completo_YYYY-MM-DD.json`.

### Flujo de importación
1. `handleFileChange` **valida antes de borrar** (BACKUP-002): rechaza JSON
   inválido, v2.0 sin `data.idb` o backups vacíos. Si la validación falla,
   el dispositivo **no** pierde nada.
2. Limpieza selectiva (`clearAppKeysForRestore`): solo claves del catálogo,
   preservando `PROTECTED_KEYS` y la sesión de Supabase.
3. Restauración directa a localforage/localStorage + flag
   `pda_backup_imported_flag` para re-sincronizar a la nube tras recargar.

### Verificación
- Round-trip probado en `tests/backupRestore.test.js` (export → clear →
  import → datos bit a bit, incluidos decimales de granel).
- Legado pre-2.0 compatible.

---

## Camino 2: Nube directa (dispositivo ↔ `cloud_backups`) — ⛔ Bloqueado por RLS

**UI:** Configuración → Sistema → *"Sincronizar con la Nube"*.

### Cómo funciona (una vez aplicada la migración)
1. `handleSyncCloud` establece sesión (`ensureSupervisorSession`) y registra
   la identidad del dispositivo en `device_sessions`
   (`ensureDeviceSessionRegistered`).
2. Lectura de `cloud_backups` para el `pda_device_id` propio:
   - Nube con datos + dispositivo vacío → **restauración automática**.
   - Ambos con datos → **resolutor de conflictos** (elegir nube o local).
   - Nube vacía → sube el payload completo comprimido (gzip+base64).
3. Escritura vía `buildCloudBackupsRow` (contrato de esquema con allowlist;
   una columna inexistente lanza en desarrollo, no produce PGRST204 en
   producción).

### Por qué está bloqueado hoy
E2E en vivo contra Supabase demostró:
- **INSERT/UPDATE → 42501** (`row-level security`).
- **SELECT → 0 filas silenciosamente** (no hay error: la app cree que la nube
  está vacía).

### Activarlo
Aplicar `supabase/migrations/001_device_own_row_rls.sql` (idempotente):
- Tabla puente `device_sessions` (`device_id` ↔ `user_id` de la sesión
  anónima, con reclaim si la sesión se regenera).
- Políticas own-row (insert/update/select) para `cloud_backups` y
  `sync_documents`; el monitor del dueño conserva lectura vía
  `device_pairings`; DELETE queda solo para service_role.

```bash
supabase db push          # o pegar el SQL en el SQL Editor del proyecto
```

No hay que cambiar nada en la app: el camino directo es primario y el relay
pasa a ser red de seguridad inactiva.

---

## Camino 3: Relay Estación Maestra — 🟡 Listo, pendiente de deploy

**Endpoint (lado Estación Maestra):** `src/app/api/backup/relay/route.ts`
- `POST { deviceId, backup_data }` → upsert en `cloud_backups` con
  service-role (bypasea RLS), mismo patrón que `api/backup/complete`.
- `GET ?deviceId=...` → devuelve `backup_data` de la fila.
- CORS abierto (`*`), normalización y validación de `deviceId`.

**Cliente (lado bodega):** `src/utils/backupRelay.js`
- URL base: `VITE_ESTACION_API_URL`. El default `https://estacion-2026.vercel.app`
  **solo aplica en builds de producción**: en dev/pruebas sin env configurado la URL
  queda vacía y el relay se salta (ningún entorno de prueba toca el backend real).

### Cuándo entra en juego
`useCloudBackup` lo usa **automáticamente** como fallback:
- **Escritura:** si la directa falla con 42501 → reintenta por relay.
- **Lectura:** si la directa devuelve error RLS **o 0 filas** (bloqueo
  silencioso) → sondea el relay antes de concluir que la nube está vacía.

> El sondeo por lectura vacía es deliberado: un SELECT bloqueado por RLS no
> lanza error, y sin el sondeo la app sobrescribiría un respaldo real de la
> nube creyendo que no existe.

### Activarlo
Desplegar la Estación Maestra a Vercel (el route viaja con el build). Nada
más: la app lo detecta y registra en consola
`[CloudBackup] Escritura realizada vía relay de Estación Maestra (RLS).`

---

## Diagnóstico de errores (UI)

Todo error de nube se clasifica en `src/utils/cloudError.js` y se muestra en
**Configuración → Sistema** con título, causa, acción recomendada y detalle
técnico (además del toast):

| Código | Significado | Acción sugerida |
| :--- | :--- | :--- |
| `42501` | RLS bloquea al dispositivo | Exportar archivo como respaldo inmediato; aplicar migración o usar relay |
| `PGRST204` | Columna inexistente (drift de esquema) | Actualizar app / migración en la base |
| `NETWORK` | Sin conexión con Supabase | Revisar internet |
| `401/403` | Sesión/credenciales inválidas | Reiniciar app para renovar sesión |

## Herramientas de verificación

```bash
npx vitest run tests/backupRestore.test.js     # round-trips de ambos caminos
npx vitest run tests/cloudSchemaContract.test.js  # contrato de columnas (PGRST204)
node scripts/check_cloud_schema.mjs            # drift real vs allowlist (OpenAPI)
node scripts/e2e_upload.mjs                    # arnés E2E (requiere .env de Estación Maestra)
```

## Preguntas frecuentes

**¿El backup local automático (`bodega_autobackup_v1`) sirve para restaurar?**
Sí — `restoreFromBackup()` (emergencias) valida, aplica con anti-eco y activa
la re-sincronización. Se guarda cada 30 min en el propio dispositivo.

**¿Compartir por código de 6 dígitos es un backup?**
Es transferencia puntual (24 h, `api/share` en Vercel + Upstash), no
respaldo histórico. Al importar activa la re-sincronización a la nube.

**¿Qué pasa si dos dispositivos suben con el mismo `device_id`?**
Se sobrescriben entre sí por diseño (una fila por dispositivo,
`onConflict: device_id`). El dispositivo es la unidad de respaldo, no el
usuario.
