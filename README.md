# Tasas Al Día — Bodega (Punto de Venta)

**Tasas Al Día — Bodega** es un Sistema Integral de Punto de Venta (POS) y Gestión Administrativa diseñado para operar de manera fluida y multiplataforma. Construido con una arquitectura "Offline-First", garantiza la continuidad del negocio sin importar la conectividad, con sincronización en la nube bidireccional cuando la conexión está disponible.

Este módulo forma parte de la suite corporativa integrada y está preparado para funcionar como una **Progressive Web App (PWA)** y como una aplicación nativa para **Android** a través de Capacitor.

> **Deploy target:** Cloudflare Workers + Pages (ver [Deploy](#-deploy)). **No** uses Vercel — `vercel.json` fue eliminado (INFRA-010).

---

## 🚀 Características Principales

- **📦 Gestión de Punto de Venta (POS)**: Interfaz rápida y responsiva para procesar transacciones de clientes eficientemente, compatible con métodos de pago customizados e importes personalizados.
- **☁️ Sincronización en la Nube y Offline-First**: Utiliza `localforage` para almacenamiento local robusto, permitiendo operar sin internet, y sincroniza automáticamente con **Supabase** al recuperar conectividad.
- **🔐 Autenticación y Seguridad en la Nube**: Integración nativa con Supabase Auth. Datos completamente encriptados y segmentados por rol (Administrador, Empleado).
- **🖨️ Impresión de Tickets Térmicos**: Generación y exportación de recibos térmicos diseñados con soporte para hardware POS físico y exportación a PDF vía `html2canvas` y `jsPDF`.
- **📱 PWA & Android App**: Preparado para escritorio, navegador, e instalable localmente con iconos adaptativos. Empaquetado nativo usando `@capacitor/android`.
- **🤖 Integración de Inteligencia Artificial**: Incluye capacidades inteligentes (con `groq-sdk`) integradas directamente en el flujo de trabajo para automatización y reportes.
- **⚙️ Respaldos Integrales y Configuración**: Permite realizar backups de todo el estado de la aplicación, configuraciones y reportes históricos.

---

## 🛠️ Stack Tecnológico

- **Core Frontend**: React 19 + Vite
- **Estilos**: Tailwind CSS + PostCSS (`postcss-import` + `autoprefixer`) + Autoprefixer
- **Manejo de Estado**: Zustand
- **Backend as a Service (BaaS)**: Supabase (Auth & Realtime Database)
- **Persistencia de Datos Local**: LocalForage
- **Plataforma Nativa PWA/Móvil**: Vite PWA Plugin + Capacitor 8
- **Íconos y UI**: Lucide React
- **Exportación de Documentos**: jsPDF + html2canvas
- **Inteligencia Artificial**: Groq SDK
- **Deploy**: Cloudflare Workers + Pages (`wrangler`)
- **Package manager**: Bun (lockfile v2). **No** uses `npm` ni `package-lock.json` (INFRA-009).

---

## 💻 Desarrollo e Instalación

### Requisitos Previos

- [Bun](https://bun.sh/) ≥ 1.3 (gestor de paquetes canónico; `packageManager: "bun@1.1.0"` en `package.json`)
- [Node.js](https://nodejs.org/) 20+ (algunos scripts de Wrangler lo requieren)
- Un proyecto en [Supabase](https://supabase.com/) (para sincronización y licencias)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`bun add -g wrangler` o `npx wrangler`)
- [Android Studio](https://developer.android.com/studio) (solo si compilarás para Android nativo)

### Configuración inicial

1. **Clonar el repo**:
   ```bash
   git clone <repo-url>
   cd preciosaldia-bodega
   ```

2. **Instalar dependencias** (INFRA-009):
   ```bash
   bun install
   ```
   Esto regenera `bun.lock` en formato v2. **No** generes `package-lock.json`.

3. **Variables de entorno** (INFRA-001 / SEC-002):
   ```bash
   cp .env.example .env
   ```
   Edita `.env` con tus valores reales. **NUNCA** commitear `.env`.
   - `.env.example` solo contiene placeholders vacíos; si ves secretos reales,
     reportar y rotar siguiendo `scripts/rotate-secrets.md`.

4. **`VITE_GOOGLE_SCRIPT_URL` es OBLIGATORIO** (INFRA-003):
   El dev server `/api/rates` no tiene fallback hardcoded. Si la variable no
   está definida, `/api/rates` cae al fallback de `ve.dolarapi.com` pero
   registrará un warning en consola. En producción, el Worker usa dolarapi
   directamente y NO requiere Google Script.

5. **Iniciar servidor de desarrollo** (HMR):
   ```bash
   bun run dev
   ```
   El dev server expone:
   - `/api/rates` — proxy a Google Script o dolarapi (CORS restringido, INFRA-012).
   - `/api/analyze` — proxy a Groq (CORS restringido + token efímero, SEC-011).
     Requiere header `X-Dev-Token: $DEV_ANALYZE_TOKEN` y solo acepta prompts
     de máximo 4000 chars.

### Scripts disponibles

| Script              | Descripción                                            |
| ---                 | ---                                                    |
| `bun run dev`       | Servidor de desarrollo Vite con HMR.                   |
| `bun run build`     | Build de producción a `dist/`.                         |
| `bun run preview`   | Sirve el build localmente para pruebas.                |
| `bun run lint`      | ESLint con guardrails financieros y de seguridad.      |
| `bun run lint:fix`  | ESLint con `--fix`.                                    |
| `bun run prettier`  | Formatea todo el código.                               |
| `bun run format:check` | Verifica formato sin escribir.                      |
| `bun run test`      | Vitest en modo run-once.                               |
| `bun run test:watch`| Vitest en modo watch.                                  |
| `bun run test:coverage` | Vitest con coverage (V8).                          |
| `bun run test:e2e` | Suite e2e completa de Playwright (`tests/e2e`).        |
| `bun run test:e2e:checkout` | Solo la suite e2e del checkout móvil (11 casos). |
| `bun run typecheck` | TypeScript sin emitir (JS con `--checkJs`).            |
| `bun run hooks:install` | Reactiva el gate de git hooks (`core.hooksPath`).  |

### Gate de calidad en git (pre-commit / pre-push)

Los hooks versionados en `githooks/` se activan automáticamente al correr
`bun install` (script `prepare`) — o manualmente con `bun run hooks:install`.

| Hook       | Qué corre                                        | Cuándo conviene saltarlo |
| ---        | ---                                              | ---                      |
| `pre-commit` | ESLint sobre los archivos staged + `tsc --noEmit` | Nunca — tarda segundos y detecta identificadores eliminados, imports rotos y errores de tipos (p. ej. un estado React borrado por una edición que esbuild compila feliz y explota en runtime). |
| `pre-push` | `bun run test:e2e:checkout` (11 casos, ~2 min)   | Emergencias — cubre la zona de cobro en móvil de punta a punta. |

Para saltar un gate puntual: `git commit --no-verify` / `git push --no-verify`.
Para desactivar el gate por completo: `git config --unset core.hooksPath`.

### Auditoría de dependencias (INFRA-026)

```bash
bun audit            # Lista vulnerabilidades conocidas.
bun audit --fix      # Aplica fixes automáticos cuando es posible.
```

Recomendado ejecutar semanalmente y antes de cada release. Las dependencias
actuales no tienen CVEs críticas conocidas (al cierre de esta auditoría).

---

## 📦 Deploy (INFRA-010)

El deploy es **Cloudflare Workers + Pages** vía Wrangler. `vercel.json` fue
eliminado; ignorar cualquier referencia a Vercel en documentación vieja.

### Configuración de secretos del Worker

```bash
# CORS whitelist (INFRA-005): orígenes permitidos, separados por coma.
wrangler secret put ALLOWED_ORIGINS
# Ejemplo: https://app.preciosaldia.com,https://bodega.preciosaldia.com

# Master key para AES-GCM de backups compartidos (INFRA-004).
# Genera con: openssl rand -hex 32  (hex 64 chars)
wrangler secret put BACKUP_ENCRYPTION_KEY

# Opcionales (si el Worker necesita llamar a Google Script o Exchangerate):
wrangler secret put VITE_GOOGLE_SCRIPT_URL
wrangler secret put VITE_EXCHANGERATE_KEY
```

### Build + deploy

```bash
bun run build
wrangler deploy
```

### Migraciones de Durable Objects

`wrangler.jsonc` define la migración `v1` para `ShareStorage`. Si cambias el
schema del DO (columnas nuevas), añade una nueva entrada bajo `migrations`
con un `tag` distinto (ej: `v2`) y los `new_sqlite_classes` o `new_classes`.

---

## 🔐 Seguridad — Endurecimiento aplicado

### Worker (`worker.js`)

| Issue      | Fix aplicado |
| ---        | --- |
| INFRA-004  | `/api/share` POST exige header `X-Device-Id` (8-128 chars). Rate-limit 5 POST/hora/IP. Códigos de 10 chars alfanuméricos vía `crypto.getRandomValues`. Blob cifrado con AES-GCM (HKDF-SHA256 desde `BACKUP_ENCRYPTION_KEY` + device_id). GET exige código + device_id matching. |
| INFRA-005  | CORS whitelist desde `ALLOWED_ORIGINS` (CSV). Nunca `*`. `Origin` header validado. |
| INFRA-011  | Security headers (CSP estricta, X-Frame-Options: DENY, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS) en TODAS las responses, incluidas las de `env.ASSETS.fetch`. |
| INFRA-030  | `console.error` capturado por `observability.enabled: true` en `wrangler.jsonc`. |

### Supabase (SQLs)

| Issue      | Fix aplicado |
| ---        | --- |
| INFRA-002 / SEC-002 | RLS estricta con `auth.uid()::text = device_id` en `sync_documents`, `cloud_backups`. `sync_documents` también permite `payload->>'owner_id'`. |
| SEC-003    | `licenses` ya no tiene `SELECT USING(true)`. Solo `service_role` lee la tabla. RPC `verify_activation_code(p_device_id, p_code) RETURNS boolean` para validar sin exponer la tabla. |
| INFRA-014  | Schema canónico de `cloud_backups`: `id UUID PRIMARY KEY` + `device_id TEXT NOT NULL UNIQUE`. Documentado en `supabase_cloud_schema.sql`. |
| INFRA-015  | `password_hash` marcado como DEPRECATED. Recomendación: usar Supabase Auth. Índice en `email` descomentado. |

### Vite (`vite.config.js`)

| Issue      | Fix aplicado |
| ---        | --- |
| INFRA-006  | `cacheId: 'preciosaldia-bodega-v' + package.json.version` (estable, no `Date.now()`). |
| INFRA-007  | `registerType: 'prompt'`, `skipWaiting: false` (no recargas abruptas). |
| INFRA-008  | `manualChunks` incluye `groq: ['groq-sdk']`. |
| INFRA-012 / SEC-011 | Dev server CORS restringido a localhost. `/api/analyze` exige `X-Dev-Token` y validación de prompt. |

### Capacitor (`capacitor.config.json`)

| Issue      | Fix aplicado |
| ---        | --- |
| INFRA-019  | `androidScheme: "https"` (necesario para Service Worker y WebCrypto en WebView). `appName` consistente con el manifest PWA. |

---

## 🗑️ Limpieza del repositorio

### Binarios y PII en el historial (INFRA-023)

El repo tenía ~13 MB de binarios y PII en commits antiguos (PDFs de cierres,
`.xls` con inventarios reales, video, `verify_financials.py` con 102 ventas
reales). Los archivos están ahora en `.gitignore` pero **siguen en el
historial**. Para purgarlos:

```bash
./scripts/purge-history.sh /path/to/preciosaldia-bodega
```

El script:
1. Hace un backup completo.
2. Ejecuta `git filter-repo --invert-paths` para eliminar los paths.
3. Redacta strings de secretos comprometidos en cualquier archivo conservado.
4. Hace `git gc --aggressive`.
5. Verifica que no queden secretos ni binarios.

**⚠️ AVISO:** Reescribe todos los hashes. Coordina con el equipo para hacer
`git fetch && git reset --hard origin/main` después del force-push.

### Rotación de secretos (INFRA-001)

Si las anon keys de Supabase, el token de Google Script o la key de
Exchangerate fueron comprometidas, seguir `scripts/rotate-secrets.md`.
Incluye comandos `git filter-repo` para purgar el historial.

---

## 🎨 Iconos PWA (INFRA-029)

Los PNGs en `public/` están ahora en `.gitignore` (excepto los referenciales
en `vite.config.js` → `includeAssets`). Para regenerarlos desde un SVG
fuente:

```bash
# Opción 1: pwa-asset-generator
bunx pwa-asset-generator ./public/logo.svg ./public \
  --icon-only --opaque false \
  --maskable true --type png \
  --manifest ./dist/manifest.webmanifest

# Opción 2: sharp-cli manual
bunx sharp -i ./public/logo.svg -o ./public "pwa-192x192.png" resize 192 192
bunx sharp -i ./public/logo.svg -o ./public "pwa-512x512.png" resize 512 512
bunx sharp -i ./public/logo.svg -o ./public "apple-touch-icon-180x180.png" resize 180 180
```

Estándares:
- `apple-touch-icon-180x180.png` (180×180, iOS).
- `pwa-192x192.png` y `pwa-512x512.png` (manifest).
- `favicon.ico` (16×16, 32×32, 48×48 multi-resolución).

Iconos obsoletos (`pwa-144x144.png`, `apple-touch-icon.png` sin dimensión):
eliminarlos del `public/` si no se referencian.

---

## 🎨 Tailwind CSS — Migración de paleta (INFRA-020)

Se eliminaron los aliases `blue`, `purple`, `indigo` que apuntaban al color
de marca (verde). Si tu código usa `bg-blue-500`, `text-purple-600`, etc.,
migrar a:

- **Para color de marca** → `bg-brand-500`, `text-brand-600`, etc.
- **Para azul/púrpura reales** → importar la paleta estándar de Tailwind
  (sin override) o definir colores propios en `tailwind.config.js`.

```bash
# Buscar usos a migrar:
rg 'bg-(blue|purple|indigo)-|text-(blue|purple|indigo)-|border-(blue|purple|indigo)-' src/
```

---

## 📂 Estructura del Proyecto

```text
preciosaldia-bodega/
├── api/                 # (en .gitignore) serverless functions legacy
├── future_plans/        # Docs de roadmap (sin rutas file:// — sanitizado)
├── public/              # Archivos estáticos e iconos PWA
│   ├── apple-touch-icon-180x180.png
│   ├── pwa-192x192.png
│   ├── pwa-512x512.png
│   ├── favicon.ico
│   └── robots.txt       # Sin sitemap fijo (INFRA-028)
├── scripts/
│   ├── purge-history.sh # INFRA-023: git filter-repo de binarios/PII
│   └── rotate-secrets.md # INFRA-001: rotación de Supabase/GScript/Exchangerate
├── src/
│   ├── components/      # Componentes reutilizables de React
│   ├── config/          # Configuraciones globales
│   ├── context/         # Contextos de React
│   ├── core/            # Lógica de negocio (FinancialEngine, store, etc.)
│   ├── hooks/           # Custom React Hooks
│   ├── services/        # Integración con APIs externas
│   ├── utils/           # Utilidades (dinero, ticketGenerator, etc.)
│   ├── views/           # Páginas principales
│   ├── App.jsx          # Root Router
│   └── main.jsx         # Punto de entrada de React
├── tests/               # Vitest (setup + specs)
├── worker.js            # Cloudflare Worker (/api/rates, /api/share)
├── wrangler.jsonc       # Config de Cloudflare (observability, nodejs_compat)
├── capacitor.config.json # Android (androidScheme: https)
├── supabase_cloud_schema.sql        # Schema canónico (INFRA-014)
├── supabase_rls_hardening.sql       # RLS + RPC verify_activation_code
├── db_estacion_maestra_setup.sql    # Licencias + account_devices
├── tailwind.config.js   # Sin aliases blue/purple/indigo (INFRA-020)
├── postcss.config.js    # postcss-import + tailwindcss + autoprefixer
├── eslint.config.js     # Guardrails financieros y de seguridad
├── vite.config.js       # PWA prompt, cacheId estable, dev server seguro
├── index.html           # theme-color #10B981, manifest, apple-touch-icon 180
└── package.json         # packageManager: bun@1.1.0, scripts completos
```

---

## 🤝 Buenas Prácticas y Metodología

Este proyecto implementa protocolos estables que garantizan alta disponibilidad, interfaz profesional y código limpio:

- **Clean Architecture** y principios **SOLID**.
- Validaciones estandarizadas estilo Producción.
- Optimización de Rendimiento Frontend (Performance UX).
- ESLint con guardrails: `Math.round`/`toFixed` prohibidos en código financiero
  (usar `round2`/`mulR`/`divR` de `src/utils/dinero.js`); `localStorage.setItem`
  solo permitido vía `storageService`.

El proyecto fue desarrollado y estructurado siguiendo principios avanzados de
optimización y responsividad UI/UX con enfoque corporativo.
