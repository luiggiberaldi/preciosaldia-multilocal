# AGENT.md — Guía Completa del Proyecto `preciosaldia-bodega`

> **Versión del documento:** 1.2.0 (estado operativo Supervisor y despliegue actualizado)
> **Última actualización:** 2026-08-10
> **Estado verificado:** 130 IDs de issues registrados · 262 tests pasan · 11 omitidos explícitamente · build de producción OK
>
> **Producción actual:** Vercel → `https://preciosaldiaoficial.vercel.app/`
> **Rama operativa:** `m5-supervisor-canary` · último commit productivo: `a059185` · guía actualizada en `2e7220e`

---

## Tabla de contenidos

1. [Visión general](#1-visión-general)
2. [Stack tecnológico](#2-stack-tecnológico)
3. [Estructura del proyecto](#3-estructura-del-proyecto)
4. [Arquitectura](#4-arquitectura)
5. [Infraestructura compartida (post-auditoría)](#5-infraestructura-compartida-post-auditoría)
6. [Guardrails y calidad de código](#6-guardrails-y-calidad-de-código)
7. [Testing](#7-testing)
8. [Configuración de desarrollo](#8-configuración-de-desarrollo)
9. [Build y despliegue](#9-build-y-despliegue)
10. [SQLs pendientes de ejecutar](#10-sqls-pendientes-de-ejecutar)
11. [Seguridad — políticas y operación](#11-seguridad--políticas-y-operación)
12. [Lógica financiera — reglas de oro](#12-lógica-financiera--reglas-de-oro)
13. [Sincronización cloud y offline-first](#13-sincronización-cloud-y-offline-first)
14. [Mapa de issues (ISSUES.md)](#14-mapa-de-issues-issuesmd)
15. [Deuda técnica conocida](#15-deuda-técnica-conocida)
16. [Próximos pasos operacionales](#16-próximos-pasos-operacionales)
17. [Comandos rápidos](#17-comandos-rápidos)

---

## 1. Visión general

**TasasAlDía Bodega** es un Sistema Integral de Punto de Venta (POS) y Gestión Administrativa para bodegas venezolanas. Arquitectura **offline-first** con sincronización cloud bidireccional vía Supabase. Funciona como **PWA** instalable y como app nativa Android vía Capacitor.

**Monedas soportadas:** USD, Bolívares (Bs) al tasa BCV, Pesos Colombianos (COP). Multi-tasa (BCV oficial, paralelo/USDT, euro).

**Modelo de licenciamiento:** Demo (15 días) → Premium (permanente o por días). Validación con tokens RSA firmados por el servidor (Estación Maestra).

---

## 2. Stack tecnológico

| Capa | Tecnología | Versión |
|---|---|---|
| Framework | Vite + React | 7.x + 19.x |
| Lenguaje | JavaScript (ES2022) | — |
| Estilos | Tailwind CSS + PostCSS | 3.4 |
| Estado | Zustand (con persist) | 5.x |
| Backend BaaS | Supabase (Auth + Postgres + Realtime) | 2.97+ |
| Storage local | localforage (IndexedDB) | 1.10 |
| PWA | vite-plugin-pwa (Workbox) | 1.2 |
| Móvil | Capacitor 8 (Android) | 8.2 |
| PDF | jsPDF + html2canvas | 4.x + 1.4 |
| IA | Groq SDK (llama-3.3-70b) | 0.37 |
| Iconos | Lucide React | 0.575 |
| Edge | Cloudflare Workers + Durable Objects | — |
| Testing | Vitest + jsdom + @vitest/coverage-v8 | 4.1 |
| Linting | ESLint 9 + eslint-plugin-react-hooks 7 | 9.39 |
| Package manager | **bun** (lockfile v1) | 1.x |

---

## 3. Estructura del proyecto

```
preciosaldia-bodega/
├── src/
│   ├── core/                    # FinancialEngine, store (Zustand), supabaseClient
│   ├── utils/                   # dinero.js, withLock, deepFreeze, crypto, securityConstants,
│   │                            # envGuard, syncFlags, checkoutProcessor, voidSaleProcessor,
│   │                            # ticketGenerator, dailyCloseGenerator, etc.
│   ├── config/                  # backupKeys, supabaseCloud, tenant, categories, paymentMethods
│   ├── security/                # tokenCrypto (RSA license verify), deviceFingerprint
│   ├── services/                # auditService, RateService, CurrencyService, PrinterSerial, MessageService
│   ├── hooks/                   # useSecurity, useAuthStore, useAutoLock, useCloudSync, useRates,
│   │                            # useCheckoutFlow, useDashboardMetrics, useProductForm, etc.
│   ├── context/                 # ProductContext, CartContext
│   ├── components/              # Sales/, Products/, Dashboard/, Settings/, security/, Reports/, etc.
│   ├── views/                   # DashboardView, SalesView, ProductsView, CustomersView, ReportsView, etc.
│   └── testing/                 # SystemTester, deterministicInjector
├── public/                      # PWA icons, robots.txt
├── tests/                       # Vitest: dinero, financialEngine, withLock, deepFreeze, crypto,
│                                # securityConstants, security, hooks
├── scripts/                     # rotate-secrets.md, purge-history.sh
├── worker.js                    # Cloudflare Worker (/api/rates, /api/share)
├── wrangler.jsonc               # Deploy config Cloudflare
├── capacitor.config.json        # App Android
├── *.sql                        # 3 SQLs de schema Supabase (ver §10)
├── vite.config.js               # Vite + PWA + Vitest + dev proxy
├── eslint.config.js             # Guardrails (ver §6)
├── ISSUES.md                    # 129 issues auditados con ID
├── CHANGES.md                   # Log de fixes v1.0 → v1.1
└── AGENT.md                     # Este documento
```

---

## 4. Arquitectura

```
┌──────────────────────────────────────────────────────────────┐
│                        CLIENTE (PWA / Android)                 │
│                                                                │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ React Views │→ │ Hooks        │→ │ Servicios            │ │
│  │ (lazy)      │  │ (useSecurity,│  │ (auditService,       │ │
│  │             │  │  useRates,   │  │  RateService,        │ │
│  │             │  │  useCheckout)│  │  PrinterSerial)      │ │
│  └─────────────┘  └──────┬───────┘  └──────────┬───────────┘ │
│                          │                      │             │
│  ┌───────────────────────┴──────────────────────┴───────────┐ │
│  │           INFRAESTRUCTURA COMPARTIDA                      │ │
│  │  dinero.js · withLock · deepFreeze · securityConstants    │ │
│  │  crypto · envGuard · syncFlags · backupKeys               │ │
│  └───────────────────────┬───────────────────────────────────┘ │
│                          │                                     │
│  ┌───────────────────────┴───────────────────────────────────┐ │
│  │  FinancialEngine (pure) · checkoutProcessor · voidSale    │ │
│  └───────────────────────┬───────────────────────────────────┘ │
│                          │                                     │
│  ┌───────────────────────┴───────────────────────────────────┐ │
│  │  storageService (localforage/IndexedDB) ← offline-first   │ │
│  │  Zustand persist (auth, config)                           │ │
│  └───────────────────────┬───────────────────────────────────┘ │
└──────────────────────────┼──────────────────────────────────────┘
                           │
                    ┌──────┴──────┐
                    │ Supabase    │ ← Auth + Realtime + Postgres
                    │ Cloud Sync  │   (RLS estricta post-fix)
                    └──────┬──────┘
                           │
                    ┌──────┴──────┐
                    │ Cloudflare  │ ← /api/rates (BCV cache)
                    │ Worker      │   /api/share (backups cifrados)
                    └─────────────┘
```

**Principios clave:**
- **Offline-first:** toda escritura va a IndexedDB primero; la sync cloud es best-effort.
- **Single source of truth para finanzas:** `FinancialEngine` + `dinero.js` son la ÚNICA puerta para cálculos monetarios. ESLint prohíbe `Math.round`/`toFixed` en `src/utils/**` y `src/core/**`.
- **Locks para writes críticos:** `withLock('pos_write_lock')` envuelve todo read-modify-write de ventas, stock y audit log.
- **Inmutabilidad:** sales se `deepFreeze` antes de retornar de `checkoutProcessor`/`voidSaleProcessor`.
- **RLS estricta:** cada fila en Supabase se filtra por `auth.uid()::text = device_id`. No hay `USING(true)`.

---

## 5. Infraestructura compartida (post-auditoría)

Estos módulos fueron creados durante la implementación de fixes y son la base que todos los demás archivos usan:

### `src/utils/dinero.js` — Aritmética financiera segura
- `round2(n)` — 2 decimales, round-half-away-from-zero con epsilon (2.005 → 2.01)
- `round3(n)` — 3 decimales (gramos/kg)
- `round4(n)` — 4 decimales (tasas de cambio)
- `round0(n)` — entero (scores, Bs)
- `ceilR(n)` — ceil a entero (política Bs del POS)
- `mulR(a,b)`, `divR(a,b)`, `sumR(...arr)`, `subR(a,b)` — operaciones redondeadas
- **Regla de ORO:** NUNCA uses `Math.round`/`toFixed`/`parseFloat` para dinero. Usa estas funciones.

### `src/utils/withLock.js` — Wrapper para `navigator.locks`
- Feature detection: si `navigator.locks` no existe (Safari < 16.4, HTTP), cae a mutex en memoria.
- Recuperación: si el mecanismo nativo falla, usa el fallback.
- Uso: `await withLock('pos_write_lock', async () => { ... })`

### `src/utils/deepFreeze.js` — Congelación profunda
- `deepFreeze(obj)` — recursiva, detecta plain objects/arrays, evita loops circulares.
- `isDeepFrozen(obj)` — para tests.
- Uso: `const sale = deepFreeze({ items: [...], payments: [...] })`

### `src/utils/securityConstants.js` — Política centralizada
- `PIN_POLICY`: 6 dígitos mín, PBKDF2 250k iter, salt 128 bits, blacklist de 20 PINs.
- `LOGIN_RATE_LIMIT`: backoff exponencial, tope 15 min, reset 1h.
- `AUTOLOCK_POLICY`: 5 min inactividad, 2 min ADMIN.
- `FINANCIAL_EPSILON`: `PAYMENT_ZERO` (0.009), tolerancias USD/BS/COP, umbral anomalía vuelto.
- `validatePin(pin)` — valida contra toda la política.

### `src/utils/crypto.js` — PBKDF2 PIN hashing
- `hashPin(pin)` → `pbkdf2$<iter>$<saltB64>$<hashB64>`
- `verifyPin(pin, stored)` — soporta PBKDF2 y legacy SHA-256 (migración automática con `needsRehash`).
- `constantTimeEqual(a, b)` — anti timing attack.

### `src/config/backupKeys.js` — Listas canónicas
- `IDB_KEYS`, `LS_KEYS`, `LOCAL_KEYS` congeladas. Una sola fuente para `useCloudBackup`, `useAutoBackup`, `useRemoteBackupListener`.

### `src/utils/envGuard.js` / `src/utils/syncFlags.js`
- `assertEnv(varName)` — lanza si falta env var crítica en boot.
- `isSyncingFromCloud` + `runWithoutEco(fn)` — previene eco cloud en backups restaurados.

---

## 6. Guardrails y calidad de código

### ESLint (`eslint.config.js`)

**Reglas de error (bloquean `lint` pero NO `build`):**
- `no-eval`, `no-new-func` — anti inyección de código.
- `no-restricted-syntax` en `src/utils/**` + `src/core/**` + hooks financieros: prohíbe `Math.round`, `Math.ceil`, `Math.floor`, `toFixed`, `parseFloat`. Fuerza `dinero.js`.
- `no-restricted-syntax`: prohíbe `document.write` (SEC-020).

**Reglas de warn (visibles, no bloquean):**
- `no-unused-vars` — imports muertos (legacy tiene ~800, se corrigen con `--fix` gradual).
- `no-console` — permite `warn`/`error`/`info`, marca `log`.
- `no-empty` — catches vacíos (algunos intencionales en legacy del Agente B).
- `react-hooks/exhaustive-deps` — ~30 violaciones preexistentes.
- `react-hooks/rules-of-hooks` — reglas del React Compiler v7 muy estrictas.
- `react-refresh/only-export-components` — fast refresh.

**Exclusiones:**
- `src/utils/dinero.js` se excluye del guardrail financiero (ES la implementación de `round2`).
- Tests tienen reglas relajadas.
- `vite.config.js`, `worker.js`, `*.config.js` se excluyen del linting de `src/`.

### TypeScript (check opcional)
- `typescript@^5.6.0` en devDependencies.
- `bun run typecheck` ejecuta `tsc --noEmit --allowJs --checkJs --skipLibCheck`.
- No es migración completa a TS; es un check incremental disponible.

---

## 7. Testing

### Vitest — estado verificado el 2026-08-10

La suite actual contiene **27 archivos de test**:

```text
26 archivos pasan
1 archivo omitido por estar protegido detrás del E2E de staging
262 tests pasan
11 tests omitidos explícitamente
```

La suite del Supervisor incluye pairing, contratos de comandos, ACK/replay/TTL, inventario por lote, guardas SQL, sincronización, reportes, responsive y E2E sintético de staging.

Comandos principales:

```bash
bun run test                 # suite completa
bun run test:supervisor      # tests Supervisor
bun run verify:supervisor   # lint + typecheck + tests Supervisor + build
bun run test:e2e             # Playwright, si se configuran sus credenciales
```

**Setup:** `tests/setup.js` polyfilla `navigator.locks` para jsdom y silencia `console.warn` salvo `VITEST_VERBOSE=1`.

**Cobertura:** `bun run test:coverage` genera reporte en `coverage/` (configurado para `src/utils/**` y `src/core/**`).

---

## 8. Configuración de desarrollo

### Requisitos
- **Bun** 1.x (gestor de paquetes + runtime)
- Node.js 20+ (para compatibilidad con Vite 7)

### Variables de entorno

Copia `.env.example` a `.env` y rellena. **NUNCA commitear `.env`** (está en `.gitignore`).

```bash
# Obligatorias
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ... (anon key, RLS debe proteger)
VITE_SUPABASE_CLOUD_URL=https://tu-cloud.supabase.co
VITE_SUPABASE_CLOUD_KEY=eyJ... (anon key cloud, RLS debe proteger)
VITE_GOOGLE_SCRIPT_URL=https://script.google.com/.../exec?token=TU_TOKEN
VITE_LICENSE_SALT=string_unico_por_tenant

# Opcionales
GROQ_API_KEY=gsk_...           # Solo dev server proxy
VITE_EXCHANGERATE_KEY=...      # Si se usa exchangerate.host
VITE_ALLOWED_ORIGINS=https://app.tudominio.com  # CORS whitelist del Worker
```

### Iniciar dev server

```bash
cd preciosaldia-bodega
bun install
bun run dev
# → http://localhost:5173
```

El dev server incluye:
- Proxy `/api/rates` → Google Script (con fallback a ve.dolarapi.com)
- Proxy `/api/analyze` → Groq (CORS restringido + token efímero + validación de prompt)
- HMR con React Fast Refresh
- PWA en modo `prompt` (avisa antes de actualizar)

---

## 9. Build y despliegue

### Build de producción

```bash
bun run build
# → dist/ (Vite bundle + PWA service worker)
```

**Output verificado el 2026-08-10:**
- `dist/index.html` — generado correctamente por Vite
- chunk principal aproximado: 954 KB sin comprimir
- `dist/sw.js` + `dist/workbox-*.js` — Service Worker PWA
- Precache: 40 entradas, aproximadamente 3 MB
- Las advertencias de chunks grandes no bloquean el build, pero deben considerarse deuda de rendimiento.

### Despliegue actual: Vercel

La producción vigente se sirve desde Vercel:

```text
Proyecto: preciosaldia2026
Dominio: https://preciosaldiaoficial.vercel.app/
Rama: m5-supervisor-canary
```

Las variables `VITE_*` se incorporan durante el build; cambiar una variable en Vercel requiere un nuevo deployment.

Flags actuales de Production:

```env
VITE_SUPERVISOR_REMOTE_INCOME_ENABLED=true
VITE_SUPERVISOR_REMOTE_RATE_ENABLED=true
VITE_SUPERVISOR_REMOTE_EGRESS_ENABLED=false
```

### Cloudflare — configuración secundaria

`wrangler.jsonc` y `worker.js` siguen en el repositorio para los endpoints/servicios que se decida mantener en Workers. **No asumir que `wrangler deploy` publica la PWA productiva actual** sin confirmar el proyecto y el dominio objetivo.

```bash
wrangler secret put ALLOWED_ORIGINS
wrangler secret put BACKUP_ENCRYPTION_KEY
wrangler deploy
```

**Security headers aplicados automáticamente** por el Worker (INFRA-011):
- `Content-Security-Policy` estricta
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Strict-Transport-Security` (HSTS)

### Android (Capacitor)

```bash
bun run build
npx cap sync android
npx cap open android
# → Android Studio para compilar APK
```

---

## 10. SQLs y estado de migraciones

> ⚠️ **IMPORTANTE:** El repositorio contiene 15 archivos SQL. No ejecutar un archivo a ciegas en producción: primero confirmar proyecto, estado actual, backup y si la migración ya fue aplicada.

Las migraciones base (`supabase_cloud_schema.sql`, `supabase_rls_hardening.sql` y `db_estacion_maestra_setup.sql`) deben verificarse por ambiente. Durante M5 se aplicaron y verificaron migraciones específicas del Supervisor en los proyectos correspondientes, incluyendo comandos, pairing/auth, ingreso por lote, guardas de pairing y tasas remotas.

**Producción Cloud actual:** `https://sodgzkablshladvbtnes.supabase.co`

**Regla operativa:** una migración aplicada no se repite manualmente sin revisar su definición, el estado de las funciones/triggers y los comandos `pending`. Mantener rollback y evidencia de la consulta posterior.

### Orden de ejecución de la base

Los SQL base son **idempotentes en gran parte** (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS`), pero la idempotencia no sustituye la verificación del ambiente. Se recomienda este orden:

#### Paso 1: `supabase_cloud_schema.sql` — Schema canónico

**Dónde ejecutar:** Supabase Dashboard → SQL Editor → Proyecto de **Sync Cloud** (`VITE_SUPABASE_CLOUD_URL`)

**Qué hace:**
- Crea `sync_documents` (P2P realtime entre dispositivos)
- Crea `cloud_backups` (backup completo por dispositivo) — schema canónico: `id UUID PK + device_id TEXT UNIQUE`
- Habilita RLS en ambas tablas
- Marca `password_hash` como DEPRECATED (usar Supabase Auth)

**Issues cubiertos:** INFRA-002, SEC-002, INFRA-014, INFRA-015

#### Paso 2: `supabase_rls_hardening.sql` — RLS estricta + RPC

**Dónde ejecutar:**
- **Sección A** → Proyecto de **Sync Cloud** (`VITE_SUPABASE_CLOUD_URL`)
- **Sección B** → Proyecto de **Licencias** (`VITE_SUPABASE_URL` / Estación Maestra)

**Qué hace:**
- **Sección A (Sync Cloud):**
  - `sync_documents`: política `device_isolation` con `auth.uid()::text = device_id`
  - `cloud_backups`: política `device_isolation` con `auth.uid()::text = device_id`
  - `REVOKE` acceso `anon` a ambas tablas (solo `authenticated` y `service_role`)
- **Sección B (Licencias):**
  - `licenses`: elimina `SELECT USING(true)` (SEC-003), solo `service_role` puede leer
  - Crea RPC `verify_activation_code(p_device_id, p_code) RETURNS boolean` — `SECURITY DEFINER`, valida sin exponer la tabla

**Issues cubiertos:** INFRA-002, SEC-002, SEC-003, SEC-010, INFRA-015

#### Paso 3: `db_estacion_maestra_setup.sql` — Setup Estación Maestra

**Dónde ejecutar:** Proyecto de **Licencias** (`VITE_SUPABASE_URL`)

**Qué hace:**
- Crea `cloud_backups` (alineado con schema canónico del Paso 1)
- Crea `cloud_licenses` (gestión de licencias desde la Estación Maestra)
- Crea `account_devices` (registro de dispositivos por cuenta)
- RLS estricta en las 3 tablas
- Crea índice en `email` (INFRA-015)

**Issues cubiertos:** INFRA-002, SEC-002, SEC-003, SEC-010, INFRA-014, INFRA-015

### Verificación post-ejecución

```sql
-- Verificar que RLS está habilitada
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN ('sync_documents', 'cloud_backups', 'licenses', 'cloud_licenses', 'account_devices');

-- Verificar que no hay políticas USING(true)
SELECT polname, polqual, polwithcheck
FROM pg_policy
WHERE polqual::text = 'true' OR polwithcheck::text = 'true';

-- Verificar que anon no tiene SELECT
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_name IN ('sync_documents', 'cloud_backups', 'licenses')
  AND grantee = 'anon';
-- Debe devolver 0 filas.
```

### Rotación de secretos (post-SQL)

Después de aplicar los SQLs, ejecuta `scripts/rotate-secrets.md` para rotar:
1. Supabase anon key (ambos proyectos)
2. Google Script token
3. Exchangerate key

Y luego `scripts/purge-history.sh` para limpiar el historial de git de secretos comprometidos.

---

## 11. Seguridad — políticas y operación

### PINs
- **Política:** 6 dígitos mínimos, PBKDF2-HMAC-SHA-256 con 250.000 iteraciones y salt aleatorio de 128 bits.
- **Blacklist:** 20 PINs triviales prohibidos (`123456`, `000000`, `111111`, etc.).
- **Primer arranque:** PINs aleatorios generados automáticamente. La UI debe escuchar el evento `initial-pins-ready` (o leer `window.__INITIAL_PINS__`) para mostrarlos una vez al operador.
- **Migración legacy:** hashes SHA-256 sin salt (64 hex) se detectan y migran a PBKDF2 en el primer login exitoso (`needsRehash: true`).

### Rate-limiting de login
- 5 intentos fallidos → lockout 30s.
- Backoff exponencial: 30s × 2^(n-1), tope 15 min.
- Reset tras 1h sin intentos.
- **Persistido** en `partialize` (sobrevive recarga de página).

### Licencias
- **Tokens RSA:** solo se aceptan tokens con firma RSA (`payload.signature`). Los tokens XOR legacy se rechazan.
- **Validación server-side:** `checkLicense` valida contra la fila `licenses` del servidor (exige `active === true`).
- **Demo:** expira por `Date.now() >= expiresAt` del cliente. **Pendiente:** cron server-side para marcar `active=false` (HOOK-002).
- **Heartbeat:** cada 15 min (configurable en `LICENSE_POLICY.HEARTBEAT_MS`).

### Auto-lock
- 5 min de inactividad → lock.
- 2 min para ADMIN.
- Lock al minimizar app (background).
- `handleUnlock(pin)` re-valida el PIN contra el store antes de desbloquear.

### Audit log
- `logEvent(cat, action, desc, user, meta)` — serializado con `withLock('audit_log_lock')`.
- `MAX_ENTRIES = 15000`, `MAX_AGE_DAYS = 1825` (5 años).
- **Categorías fiscales** (`VENTA`, `CLIENTE`, `PAGO`) **NUNCA se purgan**.
- `clearAuditLog(user)` exige `user.rol === 'ADMIN'`; intentos denegados se loguean.

### RLS Supabase
- Toda fila se filtra por `auth.uid()::text = device_id`.
- Rol `anon` no tiene `SELECT` en tablas sensibles.
- `abasto-auth-storage` (hashes de PIN) **NO se sincroniza** a la nube.

### Worker (Cloudflare)
- CORS whitelist desde `ALLOWED_ORIGINS` (no `*`).
- `/api/share`: códigos de 10 chars alfanuméricos vía `crypto.getRandomValues`, rate-limit 5 POST/h/IP, `X-Device-Id` exigido, blob cifrado con AES-GCM-256.
- `/api/rates`: cache 14 min en Durable Object.

---

## 12. Lógica financiera — reglas de oro

### dinero.js es la ÚNICA puerta
```js
// ✅ CORRECTO
import { round2, mulR, divR, sumR, subR } from '../utils/dinero';
const total = mulR(priceUsd, qty);
const inBs = mulR(total, rate);

// ❌ PROHIBIDO (ESLint error en src/utils/** y src/core/**)
const total = Math.round(priceUsd * qty * 100) / 100;
const str = priceUsd.toFixed(2);
const parsed = parseFloat(str);
```

### Redondeo
- **USD:** 2 decimales (`round2`)
- **Bs:** entero, política ceil (`ceilR`) — los precios en Bs siempre redondean hacia arriba
- **COP:** entero (via `toLocaleString` con 0 decimales)
- **Gramos/kg:** 3 decimales (`round3`)
- **Tasas de cambio:** 4 decimales (`round4`)

### Concurrencia
Todo read-modify-write de `bodega_sales_v1`, `bodega_products_v1`, `bodega_customers_v1`, `abasto_audit_log_v1` DEBE estar dentro de `withLock('pos_write_lock', ...)` (o `withLock('audit_log_lock', ...)` para audit).

### Inmutabilidad
Sales se `deepFreeze` antes de retornar de `checkoutProcessor` y `voidSaleProcessor`. Mutar un item post-freeze lanza `TypeError` en strict mode.

### Breakdown de pagos (FinancialEngine.calculatePaymentBreakdown)
- `APERTURA_CAJA`: suma `openingUsd`/`openingBs`/`openingCop` a los buckets de efectivo (no es revenue).
- `VENTA_FIADA`: bucket `fiado` recibe `sale.fiadoUsd` (no `sale.totalUsd`); los pagos reales se procesan normalmente.
- `COBRO_DEUDA`: resta del bucket `fiado`; los pagos reales se procesan.
- Anomalías de vuelto (`changeUsd > total*5`) se devuelven en array `anomalies` y se bloquean en `checkoutProcessor`.

### Validaciones de checkout (checkoutProcessor)
- `cart.length > 0`
- `cartTotalUsd > 0.01` y no NaN
- `effectiveRate > 0`
- `|cartTotalBs - mulR(cartTotalUsd, effectiveRate)| <= FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_BS`
- `changeUsd <= totalUsd * 5` (anti anomalía)

---

## 13. Sincronización cloud y offline-first

### Flujo de escritura
```
UI → Hook → storageService.setItem(key, value)
                ↓
          localforage (IndexedDB) ← offline-first, síncrono desde la perspectiva del caller
                ↓
          pushCloudSync(key, value) ← asíncrono, best-effort, no bloquea la UI
                ↓
          Supabase sync_documents (upsert) ← RLS filtra por device_id
                ↓
          Realtime broadcast → otros dispositivos del mismo device_id
```

### Eco cloud
`useCloudBackup.applyCloudBackup` setea `isSyncingFromCloud = true` (en `src/utils/syncFlags.js`) antes de escribir, para que `pushCloudSync` no re-envíe los datos restaurados.

### QuotaExceededError
Si IndexedDB y localStorage están llenos:
1. `storageService.setItem` dispara `window.dispatchEvent(new CustomEvent('quota_exceeded', { detail: { key } }))`.
2. La operación se encola en `_retryQueue` para reintento automático.
3. `clearAllData()` o `flushRetries()` procesa la cola.

### Claves sincronizadas
Definidas en `src/config/backupKeys.js` (`IDB_KEYS`, `LS_KEYS`, `LOCAL_KEYS`). **`abasto-auth-storage` NO está en `LOCAL_KEYS`** (SEC-002 — los hashes de PIN no viajan a la nube).

### Modo Supervisor — estado operativo

El Supervisor funciona con un pairing por QR entre una caja principal y un monitor.

```text
Lectura, inventario y reportes: activos
Ingreso remoto por lotes: activo para pairings válidos
Tasas remotas: activas y notificadas sin confirmación manual en la caja
Egreso remoto: bloqueado en frontend y backend
Productos, cierres, usuarios y PIN: bloqueados
```

Flags de cliente:

```env
VITE_SUPERVISOR_REMOTE_INCOME_ENABLED=true
VITE_SUPERVISOR_REMOTE_RATE_ENABLED=true
VITE_SUPERVISOR_REMOTE_EGRESS_ENABLED=false
```

El cambio de tasa se envía como notificación: la caja procesa automáticamente el comando y muestra su aviso local; el Supervisor no espera un ACK visible ni muestra un timeout por falta de confirmación manual. Los ACK técnicos y la auditoría permanecen server-side.

El header del Supervisor es sticky, respeta `safe-area-inset-top` y reorganiza sus acciones en pantallas estrechas. Después de actualizar una PWA, cerrar y abrir la aplicación o aceptar la actualización del Service Worker antes de validar la UI.

---

## 14. Mapa de issues (ISSUES.md)

Ver `ISSUES.md` en la raíz del proyecto para el detalle completo de los 130 IDs de issues auditados:

| Dominio | Prefix | Total | Cerrados |
|---|---|---:|---:|
| Seguridad | `SEC-*` | 23 | 23 ✅ |
| Financiero | `FIN-*` | 34 | 34 ✅ |
| Hooks/Servicios | `HOOK-*` | 43 | 43 ✅ |
| Infra/Config | `INFRA-*` | 30 | 30 ✅ |
| **Total** | | **130** | **130** ✅ |

Cada issue tiene: ID único, severidad (CRÍTICO/ALTO/MEDIO/BAJO), ubicación (archivo:línea), impacto, recomendación y esfuerzo estimado (XS/S/M/L/XL).

---

## 15. Deuda técnica conocida

### React Compiler v7 (no bloqueante)
El plugin `eslint-plugin-react-hooks` v7 introduce reglas del React Compiler (`Cannot call impure function during render`, `Cannot create components during render`, `Cannot access variable before it is declared`) que marcan ~5 errores en código legacy. Estas reglas se desactivaron en `eslint.config.js` porque son advertencias de compatibilidad futura, no bugs de runtime. Para activar el React Compiler real, se requiere migrar el código afectado (futuro proyecto).

### Catches vacíos en archivos del Agente B
`useAuthStore.js` y `printerUtils.js` (propiedad del Agente B) tienen ~7 `catch {}` vacíos marcados como `warn` por ESLint. Son intencionales (silencian errores de parsing de sesión) pero deberían tener un comentario `/* no-op: ... */`.

### `priceUsdt` typo histórico (FIN-030)
14 archivos usan `priceUsdt` (con "t") en vez de `priceUsd`. Se añadió alias `priceUsd` para migración gradual. Renombrar todos requiere un refactor coordinado.

### UI pendientes
- **Modal "PINs iniciales"** (SEC-005): debe escuchar evento `initial-pins-ready` para mostrar PINs aleatorios al primer arranque.
- **`CheckoutModal` consumir `copRateError`/`rateError`** (FIN-009/033): bloquear botón Confirmar si la tasa es inválida.
- **Componentes con `blue-/purple-/indigo-`** (INFRA-020): migrar a `brand-*` (los aliases se eliminaron de Tailwind).

### Cron server-side para demos (HOOK-002)
La expiración de demos se valida con `Date.now()` del cliente (bypassable manipulando el reloj). Pendiente: cron server-side + RPC `heartbeat_device` que compare `expires_at` con `now()`.

---

## 16. Próximos pasos operacionales

1. **Mantener una matriz de estado de SQLs** por proyecto y no repetir migraciones aplicadas.
2. **Rotar secretos** (`scripts/rotate-secrets.md`) y no guardar tokens de Vercel/Supabase en el repositorio.
3. **Purgar git history** solo después de revisar backups y referencias (`scripts/purge-history.sh`).
4. **Mantener producción en Vercel** y confirmar el proyecto antes de cualquier deployment.
5. **UI: modal PINs iniciales** (escuchar `initial-pins-ready`).
6. **UI: `CheckoutModal` bloquear si tasa inválida**.
7. **Cron server-side para expirar demos**.
8. **Migración gradual `priceUsdt` → `priceUsd`**.
9. **Reducir el chunk principal y resolver los warnings heredados de ESLint**.

---

## 17. Comandos rápidos

```bash
# ── Desarrollo ──
bun install              # Instalar dependencias
bun run dev              # Dev server (http://localhost:5173)

# ── Calidad ──
bun run lint             # ESLint
bun run lint:fix         # ESLint --fix
bun run typecheck        # tsc --checkJs (opcional)
bun run format:check     # Prettier check

# ── Tests ──
bun run test             # Vitest run (one-shot)
bun run test:watch       # Vitest watch
bun run test:coverage    # Vitest + coverage report

# ── Build ──
bun run build            # Vite build → dist/
bun run preview          # Servir dist/ localmente

# ── Deploy ──
# Vercel: el deployment productivo se realiza desde el proyecto conectado a Git.
# No promover Production sin validar Preview y el commit objetivo.
wrangler deploy          # Solo para el Worker/Pages si ese target está autorizado
npx cap sync android     # Sincronizar build con Android Studio

# ── Mantenimiento ──
bash scripts/purge-history.sh   # Purgar binarios/secretos del git history
# Ver scripts/rotate-secrets.md para rotación de keys
```

---

*Documento mantenido por el equipo de auditoría. Última revisión: 2026-08-10. Para detalles de los fixes aplicados, ver `CHANGES.md`; para el estado operativo del Supervisor, ver `M5-PRODUCTION-CANARY.md` y `M5-VERCEL-PREVIEW.md`; para el reporte completo, ver `ISSUES.md`.*
