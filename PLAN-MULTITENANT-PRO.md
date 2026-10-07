# Plan Maestro: Multi-tenant Pro — Estación + App

**Fecha:** 2026-10-01
**Estado:** Plan aprobado por luigi, pendiente implementación por fases

---

## 1. Arquitectura

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Estación  │────▶│ customer_    │◀────│  App Pro    │
│ (control)   │     │ projects     │     │ (1 deploy)  │
└─────────────┘     │ (directorio) │     └─────────────┘
                    └──────────────┘            │
                           │                    │ lookup por código
                           ▼                    ▼
                    ┌─────────────┐     ┌─────────────┐
                    │ Supabase    │     │ Supabase    │
                    │ Cliente A   │     │ Cliente B   │
                    │ (datos A)   │     │ (datos B)   │
                    └─────────────┘     └─────────────┘
```

**Principios:**
- **Un** repo GitHub, **un** deploy Vercel para la app Pro.
- **Un** proyecto Supabase por cliente (aislamiento total de datos).
- La Estación es el plano de control; `customer_projects` es la fuente de verdad.
- La app nunca hardcodea un Supabase de cliente; lo resuelve por código LIC.

### Variables Vercel (app Pro)
| Variable | Propósito |
|---|---|
| `VITE_DIRECTORY_URL` | Supabase de la Estación (directorio) |
| `VITE_DIRECTORY_ANON_KEY` | Key del directorio |
| `VITE_LICENSE_SALT` | Validación de licencias |
| `VITE_LICENSE_PUBLIC_KEY` | Verificación de licencias |

El Supabase del cliente **NO** es variable de entorno: llega vía `lookup_customer_project(code)`.

---

## 2. Flujo código-primero (el protocolo)

### 2.1 Generar licencia (Estación → pestaña Pro)
1. Luigi pulsa **"Generar licencia"**, selecciona **Pro**, llena datos del cliente (nombre, teléfono).
2. **NO pide ID de dispositivo.** Genera `LIC-XXXXXX` aleatorio.
3. Muestra el código en grande con botón **Copiar**.
4. Estado inicial: `pendiente` (sin Supabase asociado aún).

### 2.2 Provisionar Supabase (Estación)
1. En la ficha del código, botón **"Provisionar"**.
2. La Estación crea el proyecto Supabase vía Management API:
   - Nombre: `pro-<cliente>-<codigo>`
   - Región: `sa-east-1`
   - Corre migraciones del schema Pro (tablas, RLS, RPCs).
3. Guarda en `customer_projects`: `code`, `supabase_url`, `supabase_anon_key`, `client_name`, `status='activo'`.
4. El código queda listo para entregar.

**Alternativa manual:** si la API falla, Luigi crea el proyecto a mano en el dashboard de Supabase y pega URL + anon key en la Estación.

### 2.3 Activar (App Pro → CloudGate)
1. Cliente abre la app, mete el `LIC-XXXXXX`.
2. `lookup_customer_project(code)` → devuelve `{ url, key }` del Supabase del cliente.
3. App se conecta a ese Supabase (`setCustomerProject`).
4. Cliente crea cuenta (email + password).
5. **La app pide el nombre del equipo** (ej: "Caja 1").
6. `registerCurrentDevice(alias)` → equipo vinculado al instante.
7. **Auto-sync inmediato** (pull + push) sin pulsar nada.

### 2.4 Gestión de equipos (App Pro → Ajustes → Equipos)
- Pestaña **"Equipos"** (reemplaza "Licencia").
- Muestra: código LIC, lista de equipos vinculados (nombre, ID corto, "este equipo").
- Contador: X/6 equipos.
- Botón desvincular por equipo (menos el propio).
- Al desvincular, el equipo deja de sincronizar.

### 2.5 Ver en Estación (pestaña Pro)
- Lista de códigos LIC con: cliente, estado, Supabase URL asociada, equipos vinculados, última actividad.
- Click en un código → detalle: Supabase URL, key (oculta, botón revelar), equipos, acciones (revocar, re-provisionar).

---

## 3. Guardarraíles

### Datos
- **NUNCA mezclar datos entre clientes.** Cada cliente tiene su Supabase; la app solo habla con el suyo.
- **NUNCA exponer** `service_role`, Management tokens, ni anon keys de clientes en el frontend o logs.
- RLS en cada proyecto de cliente: un dispositivo solo lee/escribe sus propios `doc_id`.

### Códigos
- Formato `LIC-XXXXXX` (6 chars, sin 0/O/1/I/L para evitar confusión).
- Un código = un cliente = un Supabase. No reutilizar códigos entre clientes.
- Un código admite hasta **6 equipos** (límite por cuenta).

### Provisionamiento
- Idempotente: si falla a mitad, reintentar no duplica.
- Migraciones versionadas; el schema Pro vive en el repo de la Estación.
- El `lookup_customer_project` RPC solo expone `url` + `anon_key` (nunca `service_role`).

### App
- Si el `lookup` falla, mensaje claro ("código inválido o sin provisionar"), no crash.
- El auto-sync no debe bloquear la UI; corre en background.
- Al desvincular un equipo, limpiar su sesión local.

### Estación
- El token de Management vive en variable de entorno del servidor, nunca en el frontend.
- Toda acción destructiva (revocar, eliminar) pide confirmación.

---

## 4. Fases de implementación

### Fase 1 — Estación: generación de códigos (HECHO)
- [x] Device ID opcional; genera `LIC-XXXXXX` aleatorio.
- [x] Muestra el código con botón copiar.
- [x] Desplegado.

### Fase 2 — Estación: panel Pro con Supabase asociado (PENDIENTE)
- [ ] Columna "Supabase" en la lista de licencias Pro.
- [ ] Detalle de licencia: muestra Supabase URL + equipos vinculados.
- [ ] Botón "Provisionar" (manual: pegar URL + key; automático: vía Management API).

### Fase 3 — App: flujo código-primero (HECHO parcial)
- [x] CloudGate pide nombre del equipo al activar.
- [x] Pestaña "Equipos" en Ajustes (ver/desvincular).
- [x] Auto-sync al vincular + periódico cada 5 min.
- [x] Desplegado.
- [ ] Verificar en equipo real que el nombre se guarda y aparece.

### Fase 4 — Provisionamiento automático (PENDIENTE)
- [ ] Endpoint en Estación que crea el proyecto Supabase vía Management API.
- [ ] Corre migraciones automáticamente.
- [ ] Guarda en `customer_projects`.
- [ ] Requiere: `SUPABASE_MANAGEMENT_TOKEN` en env del servidor de la Estación.

### Fase 5 — Endurecimiento (PENDIENTE)
- [ ] Tests del flujo completo (generar → provisionar → activar → sincronizar → desvincular).
- [ ] Auditoría de RLS en proyecto cliente nuevo.
- [ ] Documentar el protocolo en `inteligencia.md` de ambos repos.

---

## 5. Protocolo para registrar un cliente nuevo (checklist)

1. [ ] Estación → Pro → "Generar licencia" → datos del cliente → **copiar el LIC-XXXXXX**.
2. [ ] En la ficha del código → **"Provisionar"** → esperar "Activo".
3. [ ] Entregar el código al cliente (WhatsApp).
4. [ ] Cliente: abre la app → mete el código → crea cuenta → **nombra su equipo** → listo.
5. [ ] Verificar en Estación que el equipo aparece vinculado.
6. [ ] (Opcional) Cliente sincroniza catálogo inicial.

---

## 6. Decisiones pendientes de luigi
- [x] Manual por ahora (decisión luigi 2026-10-01). El automático se monta con volumen.
- [ ] ¿El código LIC es de un solo uso o el cliente lo reusa para sus 6 equipos? (Propuesta: reuso hasta 6 equipos).
- [ ] ¿Precio / planes? (No bloquea lo técnico).
