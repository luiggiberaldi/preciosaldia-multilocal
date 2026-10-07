# ISSUES — Auditoría `preciosaldia-bodega`

> Repositorio: `preciosaldia-bodega` (POS "TasasAlDía Bodega" — Vite + React 19 + Zustand + Supabase + Capacitor + Cloudflare Worker)
> Fecha de auditoría: 2026-03-30
> Total de issues: **84** — CRÍTICO: 23 · ALTO: 39 · MEDIO: 40 · BAJOS: 22 (algunos hallazgos se agrupan por patrón)

Este documento usa el formato de issues rastreables. Cada entrada tiene un **ID único** (`SEC-001`, `FIN-001`, `HOOK-001`, `INFRA-001`) para facilitar la gestión en GitHub/GitLab.

**Leyenda de severidad**
- 🔴 **CRÍTICO** — explotable hoy, pérdida de dinero/datos o bypass de control. Acción inmediata (24-48 h).
- 🟠 **ALTO** — bug funcional grave o riesgo de seguridad alto. Semana 1-2.
- 🟡 **MEDIO** — deuda técnica con impacto real. Semana 2-4.
- 🟢 **BAJO** — calidad de código, DX, inconsistencias menores. Backlog.

**Leyenda de esfuerzo** (S = story points, 1 pt ≈ ½ día-dev)
- `XS` (1pt) · `S` (2pt) · `M` (3pt) · `L` (5pt) · `XL` (8pt+)

---

## 📊 Resumen ejecutivo

| Dominio | 🔴 CRÍT | 🟠 ALTO | 🟡 MED | 🟢 BAJ | Total |
|---|---:|---:|---:|---:|---:|
| Seguridad (`SEC-*`) | 5 | 8 | 5 | 3 | 21 |
| Financiero (`FIN-*`) | 9 | 10 | 10 | 5 | 34 |
| Hooks/Servicios (`HOOK-*`) | 4 | 10 | 16 | 14 | 44 |
| Infra/Config (`INFRA-*`) | 5 | 11 | 9 | 5 | 30 |
| **Total** | **23** | **39** | **40** | **27** | **129*** |

\* Algunos hallazgos se listan en más de un dominio por superposición (ej: `navigator.locks` sin polyfill es a la vez financiero y de hooks).

### Patrones sistémicos (transversales)
1. **`dinero.js` existe pero no es la única puerta** — 15+ archivos usan `Math.round`/`toFixed`/`parseFloat` para cálculos financieros. La "integridad matemática declarada" es una ilusión.
2. **Concurrencia parcial** — solo 2 de 4 procesadores usan `navigator.locks`; ninguno hace feature detection.
3. **Dos bugs de "dinero gratis"** — void de `COBRO_DEUDA` y vuelto-digital-a-favor no revertidos.
4. **Inconsistencia COP** — 4 fallbacks distintos (`||1`, `||4150`, `Math.round`, `mulR`) según el archivo.
5. **Estado duplicado en 3 capas** — `store.js` (cart+user) ↔ `CartContext` (cart) ↔ `useAuthStore` (usuarioActivo).
6. **Secretos + RLS abierto** — anon key pública + `USING(true)` = dataset multi-tenant expuesto.
7. **`catch {}` silenciados** — 11+ instancias ocultan fallos en producción.
8. **Auto-lock es dead code** — `useAutoLock` depende de `adminEmail/adminPassword` que nunca se definen.
9. **Deploy contradictorio** — `vercel.json` + `wrangler.jsonc` incompatibles; dual lockfile.
10. **Sin security headers** — CSP, X-Frame-Options, etc. ausentes en todos los targets.

---

## 🔴 ISSUES CRÍTICOS (23)

### Seguridad

#### SEC-001 · Bypass de licencia vía token XOR "legacy"
- **Severidad:** 🔴 CRÍTICO · **Esfuerzo:** M
- **Ubicación:** `src/security/tokenCrypto.js:11-33` + `src/hooks/useSecurity.js:172-228, 365-447`
- **Descripción:** `encodeToken/decodeToken` usa XOR con `XOR_KEY='PDA_SEC_2026'` (constante pública en el bundle). `checkLicense` acepta tokens sin firma RSA (los que no contienen `.`) y solo revoca si el servidor dice `active === false`. Si no hay fila en `licenses` (o `active != false`), el token se acepta como permanente.
- **Impacto:** Un atacante con acceso a DevTools ejecuta `localStorage.setItem('pda_premium_token', encodeToken(JSON.stringify({deviceId, type:'permanent'})))` y recarga → **premium gratis indefinidamente**.
- **Recomendación:** Eliminar la rama legacy. Rechazar todo token que no pase `verifyLicenseToken` (RSA). Validar SIEMPRE contra la fila del servidor (exigir `active === true` y `code` firmado por el backend); nunca confiar en un token local solo.

#### SEC-002 · RLS abierto + anon key Supabase pública en `.env.example`
- **Severidad:** 🔴 CRÍTICO · **Esfuerzo:** L
- **Ubicación:** `supabase_cloud_schema.sql:30-33, 46-49` + `.env.example:9-10`
- **Descripción:** Las tablas `sync_documents` y `cloud_backups` tienen políticas `FOR ALL USING (true) WITH CHECK (true)`. La `VITE_SUPABASE_CLOUD_KEY` real del proyecto `fgzwmwrugerptfqfrsjd` está publicada en `.env.example`.
- **Impacto:** Cualquiera con esa key puede leer/escribir TODOS los documentos P2P de TODOS los dispositivos: hashes de PIN (`abasto-auth-storage`), audit logs, productos, ventas, clientes, etc.
- **Recomendación:** Rotar la anon key. Eliminar `.env.example` del repo (o usar placeholders vacíos). Implementar RLS real basado en `auth.uid()` o JWT firmado por dispositivo. Dejar de sincronizar `abasto-auth-storage` y claves sensibles vía `sync_documents`.

#### SEC-003 · Tabla `licenses` legible mundialmente (`SELECT USING(true)`)
- **Severidad:** 🔴 CRÍTICO · **Esfuerzo:** S
- **Ubicación:** `supabase_rls_hardening.sql:50-52`
- **Descripción:** La política `licenses_device_read` permite a cualquier cliente anónimo hacer `SELECT * FROM licenses` y leer `device_id`, `code`, `type`, `expires_at`, `active` de TODOS los dispositivos. El `code` es el código de activación **reutilizable**.
- **Impacto:** Un atacante lista todas las licencias permanentes y reutiliza el `code` en el `device_id` correspondiente (ya que `unlockApp` valida `license.code === cleanCode`).
- **Recomendación:** La política SELECT debe filtrar por `device_id` provisto por un JWT firmado. Idealmente, mover la validación a una RPC `verify_activation_code(p_device_id, p_code)` que solo devuelva booleano.

#### SEC-004 · `setAdminCredentials` no existe en el store → auto-lock muerto
- **Severidad:** 🔴 CRÍTICO · **Esfuerzo:** S
- **Ubicación:** `src/hooks/store/useAuthStore.js` (sin la acción) + `src/views/ResetPasswordView.jsx:166,188` + `src/hooks/useAutoLock.js:7-12`
- **Descripción:** `ResetPasswordView` llama `useAuthStore(s => s.setAdminCredentials)` y luego `setAdminCredentials(email, password)`, pero esa acción NUNCA se define en el store. En runtime es `undefined` → `TypeError` capturado por try/catch (el usuario ve "Correo o contraseña incorrectos"). Consecuencia: `adminEmail/adminPassword` nunca se setean → `isCloudConfigured` siempre `false` → `isLoginRequired` siempre `false` → **`useAutoLock` NUNCA bloquea**.
- **Impacto:** El control de auto-lock por inactividad y por minimizar app está completamente inerte en producción.
- **Recomendación:** Implementar la acción `setAdminCredentials` (sin persistir la password en localStorage; usar sessionStorage o solo la sesión de Supabase). Testear el flujo de reseteo end-to-end.

#### SEC-005 · PINs por defecto `123456`/`0000` con hashes sin salt embebidos en el bundle
- **Severidad:** 🔴 CRÍTICO · **Esfuerzo:** M
- **Ubicación:** `src/hooks/store/useAuthStore.js:85-88`
- **Descripción:** `DEFAULT_USERS` incluye `Administrador` con PIN `123456` y `Cajero` con PIN `0000`, hashes SHA-256 sin salt pre-computados y embebidos. Además el SHA-256 del auth store es ASCII-only (`if (j >> 8) return ''`) — PINs con caracteres no ASCII colisionan a cadena vacía.
- **Impacto:** Cualquiera con el bundle conoce las credenciales por defecto. Si el operador no las cambia, el POS queda abierto. Rainbow tables contra los hashes sin salt son triviales.
- **Recomendación:** Forzar cambio de PIN en el primer arranque. Exigir PINs ≥6 dígitos para todos los roles. Usar PBKDF2/bcrypt/argon2 con salt aleatorio. No embeber hashes por defecto en el bundle (derivarlos en runtime desde un secreto del servidor).

### Financiero

#### FIN-001 · Void de `COBRO_DEUDA` no revierte deuda del cliente
- **Severidad:** 🔴 CRÍTICO · **Esfuerzo:** S
- **Ubicación:** `src/utils/voidSaleProcessor.js:50-63`
- **Descripción:** `fiadoAmountUsd = sale.fiadoUsd || (sale.tipo === 'VENTA_FIADA' ? sale.totalUsd : 0) || 0` resulta en 0 para `COBRO_DEUDA`, y `favorUsed` también es 0. La condición `fiadoAmountUsd > 0 || favorUsed > 0` es `false` y NO se actualiza el cliente.
- **Impacto:** El abono ya redujo `cliente.deuda` (o sumó a `favor`); al anular, el cliente queda con deuda reducida pero el dinero "desaparece". **Dinero gratis para el cliente.**
- **Recomendación:** Detectar `sale.tipo === 'COBRO_DEUDA'` y revertir sumando `sale.totalUsd` a `deuda` (o restando de `favor` si quedó en favor).

#### FIN-002 · Apertura de caja COP no se suma al breakdown
- **Severidad:** 🔴 CRÍTICO · **Esfuerzo:** XS
- **Ubicación:** `src/core/FinancialEngine.js:104-115`
- **Descripción:** El bloque `APERTURA_CAJA` añade `openingUsd` a `efectivo_usd` y `openingBs` a `efectivo_bs`, pero ignora `openingCop`.
- **Impacto:** El `expectedCop` en `CierreCajaWizard` siempre será menor al real por exactamente el monto aperturado, generando "faltante" sistemático.
- **Recomendación:** Añadir bloque `if (sale.openingCop > 0) { breakdown['efectivo_cop'] += sale.openingCop; }`.

#### FIN-003 · `tasaCop || 1` en breakdown para ventas legacy
- **Severidad:** 🔴 CRÍTICO · **Esfuerzo:** S
- **Ubicación:** `src/core/FinancialEngine.js:182`
- **Descripción:** `mulR(amountUsd, (sale.tasaCop || 1))` convierte 1 USD = 1 COP cuando la venta no tiene `tasaCop` (ventas viejas o mal persistidas).
- **Impacto:** Subestima COP por factor ~4000x. Reportes de cierres históricos incorrectos.
- **Recomendación:** Usar la tasa COP actual del contexto, o excluir la venta del bucket COP y marcarla como `_tasaCopMissing: true`.

#### FIN-004 · Bucket `fiado` suma `sale.totalUsd` en vez de `sale.fiadoUsd`
- **Severidad:** 🔴 CRÍTICO · **Esfuerzo:** S
- **Ubicación:** `src/core/FinancialEngine.js:118-124`
- **Descripción:** Para ventas parcialmente fiadas (ej: $10 cash + $5 fiado en venta de $15), el bucket fiado recibe $15 (deuda sobreestimada) y el `return` impide que los $10 cash aparezcan en `efectivo_usd`. La deuda contable del cliente vía `procesarImpactoCliente` sí usa `fiadoUsd` correctamente, pero el breakdown de cierres la sobreestima.
- **Impacto:** Descuadre entre el detalle de pagos del cierre y la deuda real de clientes. Caja "faltante" ficticia.
- **Recomendación:** Usar `sale.fiadoUsd || sale.totalUsd` (para V1 sin `fiadoUsd`) y NO hacer `return`; procesar los pagos reales normalmente.

#### FIN-005 · Detección de anomalía de vuelto solo hace `console.warn`
- **Severidad:** 🔴 CRÍTICO · **Esfuerzo:** M
- **Ubicación:** `src/core/FinancialEngine.js:194-208`
- **Descripción:** El bloque detecta `changeUsd > total*5 && > 100` pero solo loguea a consola. No se persiste en `sale._changeAnomaly` (el comentario admite que "may be frozen"), no se bloquea la venta, no se muestra en UI. Ningún componente consume el flag.
- **Impacto:** Vuelto fraudulento o glitch no detectado. Un cajero podría generar vuelto enorme sin alerta.
- **Recomendación:** Devolver un array `anomalies` desde `calculatePaymentBreakdown` y mostrarlo en `CierreCajaWizard`. Bloquear ventas con `changeUsd > total*5` en `checkoutProcessor`.

#### FIN-006 · `processCustomerTransaction` sin `navigator.locks.request`
- **Severidad:** 🔴 CRÍTICO · **Esfuerzo:** S
- **Ubicación:** `src/utils/customerTransactionProcessor.js:42-97`
- **Descripción:** A diferencia de `checkoutProcessor` y `voidSaleProcessor`, este procesador (ABONO/CREDITO manual) lee `bodega_sales_v1`, calcula `nextSaleNumber`, y escribe sin lock. No hay protección contra doble submit.
- **Impacto:** Dos abonos rápidos consecutivos pueden generar el mismo `saleNumber` y sobrescribirse. Pérdida de registro de pago.
- **Recomendación:** Envolver en `navigator.locks.request('pos_write_lock', ...)` y deshabilitar el botón durante el await.

#### FIN-007 · `navigator.locks.request` sin feature detection ni fallback
- **Severidad:** 🔴 CRÍTICO · **Esfuerzo:** S
- **Ubicación:** `src/utils/checkoutProcessor.js:101`, `src/utils/voidSaleProcessor.js:16`
- **Descripción:** Llamada directa sin verificar `if (navigator.locks)`. En Safari < 16.4 (2023), iOS WebView antiguos y contextos no seguros (HTTP), `navigator.locks` es `undefined` → `TypeError` no capturado.
- **Impacto:** La venta se pierde sin persistir en navegadores sin soporte. Crash silencioso del checkout.
- **Recomendación:** Wrapper `withLock(name, fn)` que detecte soporte y ejecute `fn()` directo si no hay locks (con advertencia) o use polyfill `navigator-locks`.

#### FIN-008 · `Object.freeze(sale)` es shallow
- **Severidad:** 🔴 CRÍTICO · **Esfuerzo:** S
- **Ubicación:** `src/utils/checkoutProcessor.js:99,104`
- **Descripción:** `Object.freeze` no recursa: `sale.items[0].priceUsd = 999` sigue siendo posible, al igual que `sale.payments.push(...)`. Además `updatedProducts` y `updatedCustomers` se retornan sin freeze.
- **Impacto:** Mutaciones accidentales o maliciosas de items/pagos después de persistida la venta. Inconsistencia entre lo mostrado y lo guardado.
- **Recomendación:** Deep-freeze manual para `items`, `payments` y los objetos retornados; o usar `immer`/`Object.deepFreeze`.

#### FIN-009 · `tasaCop` fallback mágico a `4150`
- **Severidad:** 🔴 CRÍTICO · **Esfuerzo:** XS
- **Ubicación:** `src/hooks/useCheckoutCalculations.js:20`, `src/views/SalesView.jsx:488`, `src/components/Sales/CustomAmountModal.jsx:16`
- **Descripción:** `safeTasaCop = tasaCop > 0 ? tasaCop : 4150`. Si COP está activo pero la tasa se perdió (ej: usuario borró localStorage), los cálculos COP usan 4150 silenciosamente.
- **Impacto:** Discrepancias de miles de pesos en tickets y reportes sin aviso.
- **Recomendación:** Si `tasaCop <= 0 && copEnabled`, bloquear ventas COP y forzar configuración.

### Hooks/Servicios

#### HOOK-001 · `useAutoLock` es dead code
- **Severidad:** 🔴 CRÍTICO · **Esfuerzo:** S
- **Ubicación:** `src/hooks/useAutoLock.js:7-12`
- **Descripción:** Lee `adminEmail` y `adminPassword` de `useAuthStore`, pero esas propiedades NUNCA se definen en el store (verificado con grep). `isCloudConfigured` siempre es `false` → `isLoginRequired` siempre es `false` → el auto-lock por inactividad y por minimizar app NUNCA se dispara.
- **Impacto:** Función de seguridad crítica inerte. Cualquier sesión queda abierta indefinidamente.
- **Recomendación:** Eliminar la dependencia de `adminEmail/adminPassword` (vestigio de un flujo cloud email/password anterior) y basar `isLoginRequired` únicamente en `requireLogin && usuarioActivo`. (Duplicado de SEC-004 desde el ángulo de hooks.)

#### HOOK-002 · Demo expirable por manipulación de reloj
- **Severidad:** 🔴 CRÍTICO · **Esfuerzo:** L
- **Ubicación:** `src/hooks/useDemoCountdown.js:14`, `src/hooks/useSecurity.js:146`, `src/hooks/useLicenseMonitoring.js:40`
- **Descripción:** Todas las verificaciones de expiración usan `Date.now()` del cliente. El servidor solo marca `active=true` pero no hay job/cron que ponga `active=false` al expirar.
- **Impacto:** Un usuario retrocede el reloj del sistema y mantiene la demo activa indefinidamente. **Bypass del modelo de negocio.**
- **Recomendación:** (1) Cron server-side que marque `active=false` al pasar `expires_at`. (2) Comparar `expires_at` con `server_now()` en la RPC `heartbeat_device`. (3) Almacenar `last_heartbeat_at` y detectar saltos temporales sospechosos.

#### HOOK-003 · `supabaseClient.js` con URL y placeholder hardcoded
- **Severidad:** 🔴 CRÍTICO · **Esfuerzo:** XS
- **Ubicación:** `src/core/supabaseClient.js:5-6`
- **Descripción:** `const supabaseUrl = ... || 'https://jjbzevntreoxpuofgkyi.supabase.co'` y `supabaseAnonKey = ... || 'REEMPLAZAR_CON_TU_ANON_KEY_VERDADERA'`.
- **Impacto:** Si las variables de entorno faltan en build, el cliente se crea con un URL real de Supabase (leak de proyecto) y una key inválida → todas las llamadas fallan con 401 silenciosamente.
- **Recomendación:** Lanzar error en build-time si `VITE_SUPABASE_URL` o `VITE_SUPABASE_ANON_KEY` faltan. No hardcodear URLs de proyectos reales.

#### HOOK-004 · `navigator.locks` sin polyfill ni feature detection
- **Severidad:** 🔴 CRÍTICO · **Esfuerzo:** S
- **Ubicación:** `src/utils/checkoutProcessor.js:101`, `src/utils/voidSaleProcessor.js:16`
- **Descripción:** (Duplicado de FIN-007 desde el ángulo de robustez de hooks.) `navigator.locks.request('pos_write_lock', ...)` sin verificar `'locks' in navigator`. En Firefox sin flag, Safari < 16.4 y HTTP, `navigator.locks` es `undefined` → `TypeError` no capturado → checkout se cae.
- **Recomendación:** Añadir polyfill (`navigator-locks`) o wrapper con feature detection + fallback a Promise sin lock (aceptando la race condition) con warning.

### Infra/Config

#### INFRA-001 · Secretos reales committed en `.env.example`
- **Severidad:** 🔴 CRÍTICO · **Esfuerzo:** M
- **Ubicación:** `.env.example:5-14`
- **Descripción:** JWT Supabase ANON real y vigente para `fgzwmwrugerptfqfrsjd` (iat 2026-03-28, exp 2036-04-06), URL Google Script con token `Lvbp1994`, `VITE_EXCHANGERATE_KEY=F1a3af26247a97a33ee5ad90`.
- **Impacto:** Acceso total a la base de datos cloud y a los servicios de terceros con las credenciales del dev.
- **Recomendación:** **Rotar todas las keys** (Supabase, Google Script, Exchangerate). Purgar git history con `git filter-repo` o BFG. Reemplazar `.env.example` por placeholders vacíos.

#### INFRA-002 · RLS `USING(true)` en tablas con PII
- **Severidad:** 🔴 CRÍTICO · **Esfuerzo:** L
- **Ubicación:** `supabase_cloud_schema.sql` + `db_estacion_maestra_setup.sql`
- **Descripción:** `sync_documents`, `cloud_backups`, `cloud_licenses`, `account_devices` se crean con `FOR ALL USING (true) WITH CHECK (true)`. `cloud_backups` guarda `password_hash` en texto plano.
- **Impacto:** Combinado con la anon key committed (INFRA-001), cualquiera puede leer y modificar respaldos cloud, hashes de password, licencias y el registro de dispositivos de todos los negocios.
- **Recomendación:** Aplicar RLS estricta con `auth.uid()`. Migrar `password_hash` a Supabase Auth. Revocar anon key y pasar a email/password. (Duplicado de SEC-002 desde el ángulo de SQL.)

#### INFRA-003 · Token `Lvbp1994` + URL Google Script hardcodeados como fallback
- **Severidad:** 🔴 CRÍTICO · **Esfuerzo:** XS
- **Ubicación:** `vite.config.js:93`
- **Descripción:** `vite.config.js` incluye como fallback la URL completa `https://script.google.com/.../exec?token=Lvbp1994`. Ese `token` es un secreto compartido con el Apps Script (probablemente controla acceso a la hoja de tasas BCV).
- **Impacto:** Cualquiera con el repo consume la cuota del dev o (si el script es escribible) manipula datos.
- **Recomendación:** Rotar el token. Moverlo a un secreto del servidor. Eliminar el fallback hardcoded.

#### INFRA-004 · Worker `/api/share` sin rate-limit ni auth, códigos `Math.random()` de 6 dígitos
- **Severidad:** 🔴 CRÍTICO · **Esfuerzo:** M
- **Ubicación:** `worker.js:135-251`
- **Descripción:** POST acepta hasta 10 MB de cualquier origen sin autenticación. GET devuelve el backup completo (productos, clientes, `ls` entero con `abasto-auth-storage`, audit log) a quien adivine un código de 6 dígitos generado con `Math.random()` (no criptográficamente seguro) y sin rate-limiting.
- **Impacto:** Con 1M de combinaciones y sin throttle, brute-force trivial en minutos. Exposición total de datos de cualquier negocio.
- **Recomendación:** Exigir auth/JWT para POST. Aplicar rate-limit por IP (Cloudflare WAF o KV). Generar códigos con `crypto.getRandomValues`. Exigir el código Y el `device_id` para GET. Cifrar el blob del backup con una clave que solo el dispositivo conozca.

#### INFRA-005 · CORS `Access-Control-Allow-Origin: '*'` en `/api/rates` y `/api/share`
- **Severidad:** 🔴 CRÍTICO · **Esfuerzo:** S
- **Ubicación:** `worker.js:71-75, 135-140`
- **Descripción:** Ambos endpoints del Cloudflare Worker usan `Access-Control-Allow-Origin: '*'`.
- **Impacto:** Cualquier sitio web malicioso puede consumir los endpoints desde el navegador de un usuario legítimo, exponiendo tasas o (peor) facilitando brute-force de códigos share.
- **Recomendación:** Reemplazar por whitelist de orígenes permitidos (dominios de producción). Validar `Origin` header.

---

## 🟠 ISSUES ALTOS (39)

### Seguridad

#### SEC-006 · Rate-limiting de PINs trivialmente bypaseable
- **Severidad:** 🟠 ALTO · **Esfuerzo:** S
- **Ubicación:** `src/hooks/store/useAuthStore.js:101-138`
- **Descripción:** `failedAttempts` y `lockUntil` se guardan en estado Zustand PERO `partialize` solo persiste `usuarios` y `requireLogin`. Recargar la página resetea el contador y el bloqueo.
- **Impacto:** Un atacante prueba 5 PINs, recarga, repite. El bloqueo de 30 s tras 5 fallos no sirve de nada.
- **Recomendación:** Persistir `failedAttempts`/`lockUntil` (con timestamp absoluto) y/o validar el PIN contra el servidor con rate-limit real por `device_id`/IP.

#### SEC-007 · "Encriptación" XOR presentada como ofuscación de seguridad
- **Severidad:** 🟠 ALTO · **Esfuerzo:** M
- **Ubicación:** `src/security/tokenCrypto.js:10-33`
- **Descripción:** Aunque ya existe RSA verification, el fallback XOR con clave pública todavía se usa para acuñar/leer tokens de licencia (SEC-001) y para `_pda_s` en sessionStorage (`useSecurity.js:294-299`). XOR no es criptografía: reversible en milisegundos.
- **Recomendación:** Eliminar toda referencia a `encodeToken/decodeToken`. Usar WebCrypto AES-GCM con clave derivada por dispositivo (PBKDF2 sobre fingerprint + sal del backend), o mejor, no almacenar nada sensible en localStorage.

#### SEC-008 · Fingerprint débil, sin salting y spoofable
- **Severidad:** 🟠 ALTO · **Esfuerzo:** L
- **Ubicación:** `src/security/deviceFingerprint.js:1-34`
- **Descripción:** Combina userAgent, language, hardwareConcurrency, deviceMemory, screen, tz en SHA-256 y toma solo 8 hex chars (32 bits → colisión por birthday ~65k intentos). No hay sal ni nonce. Peor: `useSecurity.initDeviceId` lee `localStorage.getItem('pda_device_id')` y si existe lo usa SIN re-verificar el fingerprint.
- **Impacto:** Un atacante hace `localStorage.setItem('pda_device_id', 'PDA-DEAD')` para fijar un deviceId arbitrario y luego solicitar/activar licencias para ese ID.
- **Recomendación:** Usar FingerprintJS Pro o similar. Mezclar con un nonce del backend al registrar el dispositivo. Re-verificar el fingerprint periódicamente. Aumentar el largo del hash a 32+ hex chars.

#### SEC-009 · `localStorage.setItem` monkey-patched globalmente
- **Severidad:** 🟠 ALTO · **Esfuerzo:** M
- **Ubicación:** `src/hooks/useCloudSync.js:38-44`
- **Descripción:** Se reemplaza `localStorage.setItem` por una versión que intercepta TODAS las escrituras (incluyendo las de extensiones y devtools) y, si la clave está en `LOCAL_KEYS`, empuja el valor a Supabase Cloud. Como la tabla `sync_documents` está abierta (SEC-002), cada escritura a `abasto-auth-storage` termina legible por el mundo.
- **Recomendación:** No monkey-patchear APIs globales. Usar el adapter de Zustand para persistencia selectiva. NUNCA sincronizar `abasto-auth-storage` a una tabla pública.

#### SEC-010 · CORS `*` + sin auth en `/api/share`
- **Severidad:** 🟠 ALTO · **Esfuerzo:** M
- **Ubicación:** `worker.js:135-251`
- **Descripción:** (Ver INFRA-004.) POST sin auth, GET con códigos débiles.
- **Recomendación:** Exigir auth/JWT, rate-limit, `crypto.getRandomValues`, cifrar blob.

#### SEC-011 · CORS `*` en endpoints del dev server con API key de Groq
- **Severidad:** 🟠 ALTO · **Esfuerzo:** S
- **Ubicación:** `vite.config.js:90, 129-160`
- **Descripción:** `/api/rates` y `/api/analyze` en el dev server tienen `Access-Control-Allow-Origin: '*'`. `/api/analyze` lee `process.env.GROQ_API_KEY` server-side (no se filtra al bundle, bien), pero cualquier sitio web malicioso puede hacer `fetch('http://localhost:5173/api/analyze', {method:'POST', body:JSON.stringify({prompt:'...'})})` si el dev está corriendo. El `prompt` se pasa sin sanitización.
- **Impacto:** Abuso de la cuota de Groq del desarrollador. Inyección de prompt. En producción el `worker.js` NO expone `/api/analyze`, así que la feature Groq del `SystemTester` está rota en prod.
- **Recomendación:** Limitar CORS a los orígenes del propio dev server. Exigir un token efímero para `/api/analyze`. Mover la feature de IA a una Cloudflare Function o Edge Function con auth real.

#### SEC-012 · Secreto de Google Script URL + token `Lvbp1994` hardcodeado
- **Severidad:** 🟠 ALTO · **Esfuerzo:** XS
- **Ubicación:** `vite.config.js:93` + `.env.example:14`
- **Descripción:** (Ver INFRA-003.) `vite.config.js` incluye como fallback la URL completa con token.
- **Recomendación:** Rotar el token, moverlo a secreto del servidor, eliminar el fallback.

#### SEC-013 · Sesión de usuario persistida con hash de PIN en localStorage
- **Severidad:** 🟠 ALTO · **Esfuerzo:** S
- **Ubicación:** `src/hooks/store/useAuthStore.js:129, 160, 204`
- **Descripción:** `localStorage.setItem('abasto-device-session', JSON.stringify(userEncontrado))` guarda el objeto completo, incluyendo `pin` (hash SHA-256 sin salt). Combinado con la sincronización P2P (SEC-009), el hash viaja a Supabase Cloud abierto.
- **Impacto:** Con un hash sin salt, un atacante prueba `123456`/`0000` offline en milisegundos.
- **Recomendación:** Nunca persistir el hash del PIN en la sesión. Guardar solo `id`, `nombre`, `rol`. Re-validar el PIN en cada acción sensible.

#### SEC-014 · `db_estacion_maestra_setup.sql` con RLS `USING(true)` en tablas con `password_hash`
- **Severidad:** 🟠 ALTO · **Esfuerzo:** M
- **Ubicación:** `db_estacion_maestra_setup.sql:42-46, 61-62`
- **Descripción:** Las tablas `cloud_backups`, `cloud_licenses`, `account_devices` se crean con `FOR ALL USING (true) WITH CHECK (true)`. `cloud_backups` guarda `password_hash` en texto (anti-patrón: deberías usar Supabase Auth).
- **Recomendación:** Usar Supabase Auth en vez de `password_hash` propio. RLS estricta con `auth.uid()`.

### Financiero

#### FIN-010 · `buildCartTotals.totalCop` mezcla `Math.round` con `mulR`
- **Severidad:** 🟠 ALTO · **Esfuerzo:** S
- **Ubicación:** `src/core/FinancialEngine.js:279-283`
- **Descripción:** Rama con `priceCop`: `Math.round(sumR(...) * (1 - discountAmountUsd / subtotalUsd))` (raw division + `Math.round`). Rama sin `priceCop`: `mulR(totalUsd, copRate)` (`round2`). Política de redondeo inconsistente. El `discountAmountUsd / subtotalUsd` debería ser `divR`.
- **Recomendación:** Factorizar el descuento proporcional con `divR` y usar `round2` consistentemente (o `Math.round` si COP es siempre entero).

#### FIN-011 · `calculateSaleProfit` fallback O(n²)
- **Severidad:** 🟠 ALTO · **Esfuerzo:** S
- **Ubicación:** `src/core/FinancialEngine.js:62`
- **Descripción:** `products.find(...)` por cada item sin `costUsd`/`costBs`. `calculateAggregateProfit` lo llama por cada venta → O(K·N·M).
- **Impacto:** Reportes lentos con historial grande.
- **Recomendación:** Construir `Map<id, product>` una vez y pasar a `calculateSaleProfit`, o cachear el lookup.

#### FIN-012 · Vuelto digital a favor NO se revierte al anular
- **Severidad:** 🟠 ALTO · **Esfuerzo:** S
- **Ubicación:** `src/utils/voidSaleProcessor.js:50-63`
- **Descripción:** Si durante la venta `vueltoParaMonedero` añadió saldo a `favor` (vía `procesarImpactoCliente`), al anular solo se revierte `fiadoUsd` y `saldo_favor` usado. El favor generado por vuelto queda "regalado".
- **Recomendación:** Guardar `vueltoParaMonedero` en el `sale` y restarlo de `favor` al anular.

#### FIN-013 · `weekData` (chart) excluye `VENTA_FIADA`; `todayTotalUsd` la incluye
- **Severidad:** 🟠 ALTO · **Esfuerzo:** XS
- **Ubicación:** `src/hooks/useDashboardMetrics.js:83` vs `:23`
- **Descripción:** La gráfica semanal filtra `s.tipo === 'VENTA_FIADA'` pero el total del día la incluye. La suma de la gráfica nunca cuadra con el total mostrado.
- **Recomendación:** Unificar criterio (probablemente incluir fiado en ambos, ya que es venta realizada).

#### FIN-014 · `allow_negative_stock` en localStorage sin auth/auditoría
- **Severidad:** 🟠 ALTO · **Esfuerzo:** S
- **Ubicación:** `src/utils/checkoutProcessor.js:127`, `src/views/SalesView.jsx:293,410`
- **Descripción:** Cualquiera con DevTools puede `localStorage.setItem('allow_negative_stock','true')` y vender stock negativo sin trazabilidad. No hay `logEvent` al cambiar el flag.
- **Recomendación:** Mover a settings persistentes con `logEvent('CONFIG', 'allow_negative_stock_changed', ...)` y validar permiso admin.

#### FIN-015 · `procesarImpactoCliente` no usa `round2` en operaciones intermedias
- **Severidad:** 🟠 ALTO · **Esfuerzo:** XS
- **Ubicación:** `src/utils/financialLogic.js:12, 17, 33, 35`
- **Descripción:** `cliente.favor = Math.max(0, (cliente.favor || 0) - usaSaldoFavor)` y `cliente.deuda = (cliente.deuda || 0) + deudaGenerada` no redondean intermedios. Solo al final. Drift posible en cadenas largas.
- **Recomendación:** Envolver cada operación con `subR`/`sumR`/`round2`.

#### FIN-016 · `useCheckoutCalculations` usa `toFixed` y multiplicación raw
- **Severidad:** 🟠 ALTO · **Esfuerzo:** S
- **Ubicación:** `src/hooks/useCheckoutCalculations.js:58, 60, 103, 104, 112, 127`
- **Descripción:** `Number(remainingUsd.toFixed(2))`, `(remainingUsd * safeTasaCop).toFixed(2)`, `val / safeTasaCop`, `val / safeRate`, `(cartTotalUsd * safeRate)`, `(cartTotalUsd * safeTasaCop)`. Bypasses `dinero.js`.
- **Recomendación:** Reemplazar con `round2`, `mulR`, `divR`.

#### FIN-017 · `productProcessor.buildProductPayload` usa `Math.round(...)/100`
- **Severidad:** 🟠 ALTO · **Esfuerzo:** XS
- **Ubicación:** `src/utils/productProcessor.js:24-29`
- **Descripción:** `Math.round(parseFloat(priceBs)/safeRate * 100) / 100` — bypasses `dinero.js`. Drift en precios guardados.
- **Recomendación:** Usar `divR(parseFloat(priceBs), safeRate)` y `round2`.

#### FIN-018 · `reportsProcessor` acumula revenue sin `sumR`
- **Severidad:** 🟠 ALTO · **Esfuerzo:** XS
- **Ubicación:** `src/utils/reportsProcessor.js:40`
- **Descripción:** `productMap[key].revenue += mulR(item.priceUsd, item.qty)` acumula sin re-redondeo. Mismo patrón en `useDashboardMetrics.js:112, 132`.
- **Recomendación:** `productMap[key].revenue = round2(productMap[key].revenue + mulR(...))`.

#### FIN-019 · `useDashboardMetrics.totalDeudas` y `topProducts` usan raw reduce/multiplicación
- **Severidad:** 🟠 ALTO · **Esfuerzo:** XS
- **Ubicación:** `src/hooks/useDashboardMetrics.js:100, 112, 132`
- **Descripción:** `deudores.reduce((sum, c) => sum + (c.deuda || 0), 0)` y `productSalesMap[item.name].revenue += item.priceUsd * item.qty`.
- **Recomendación:** Envolver con `sumR`/`mulR`.

### Hooks/Servicios

#### HOOK-005 · `ProductContext.Provider value` sin `useMemo`
- **Severidad:** 🟠 ALTO · **Esfuerzo:** XS
- **Ubicación:** `src/context/ProductContext.jsx:198-221`
- **Descripción:** El objeto `value={{...}}` se recrea en cada render del provider, causando que TODOS los consumidores de `useProductContext` se re-rendericen aunque ningún campo haya cambiado. Con catálogos de 1000+ productos y `rates` cambiando cada 15 min, esto genera renders masivos.
- **Recomendación:** Envolver en `useMemo` con deps `[products, categories, isLoadingProducts, streetRate, useAutoRate, customRate, effectiveRate, copEnabled, autoCopEnabled, tasaCopManual, copPrimary, tasaCop]`.

#### HOOK-006 · Estado de carrito duplicado
- **Severidad:** 🟠 ALTO · **Esfuerzo:** M
- **Ubicación:** `src/core/store.js:14-17` vs `src/context/CartContext.jsx:6`
- **Descripción:** `useAppStore` (Zustand) define `cart`, `addToCart`, `clearCart`; `CartContext` (React Context) define su propio `cart`, `setCart`, `loadCart`, `clearCart`. Dos fuentes de verdad paralelas.
- **Recomendación:** Eliminar `cart` de `useAppStore` (parece legacy no usado) o consolidar todo en Zustand.

#### HOOK-007 · `storageService.setItem` no maneja `QuotaExceededError`
- **Severidad:** 🟠 ALTO · **Esfuerzo:** S
- **Ubicación:** `src/utils/storageService.js:92-113`
- **Descripción:** Si `localforage.setItem` lanza `QuotaExceededError` (IndexedDB lleno), el fallback intenta `localStorage.setItem` que también fallará (5MB). El catch interno (línea 110) solo loguea. La venta/dato se pierde silenciosamente.
- **Recomendación:** Detectar `error.name === 'QuotaExceededError'`, disparar evento global `quota_exceeded` para que la UI avise al usuario, y encolar la operación para reintento tras limpieza.

#### HOOK-008 · `auditService.logEvent` race condition
- **Severidad:** 🟠 ALTO · **Esfuerzo:** S
- **Ubicación:** `src/services/auditService.js:38-46`
- **Descripción:** Patrón `getItem` → `unshift` → `setItem` sin lock. Si dos `logEvent` se disparan concurrentemente (ej: checkout que loguea VENTA + STOCK + CLIENTE en ráfaga), el segundo `getItem` puede leer antes de que el primer `setItem` commit, perdiendo entradas.
- **Recomendación:** Usar `navigator.locks.request('audit_log_lock', ...)` o una cola en memoria con flush periódico.

#### HOOK-009 · `auditService.purgeOldEntries` borra a 90 días
- **Severidad:** 🟠 ALTO · **Esfuerzo:** XS
- **Ubicación:** `src/services/auditService.js:11, 110-123`, `src/App.jsx:82`
- **Descripción:** `MAX_AGE_DAYS = 90` y se ejecuta en cada arranque. Para fines fiscales/legales en VE, los registros de ventas y audit logs suelen requerir retención de 5+ años. Esto borra evidencia crítica.
- **Recomendación:** Subir `MAX_AGE_DAYS` a 1825 (5 años) o hacerlo configurable. Nunca purgar entradas de categoría `VENTA`/`CLIENTE`/`PAGO`.

#### HOOK-010 · `PrinterSerial` sin manejo de desconexión
- **Severidad:** 🟠 ALTO · **Esfuerzo:** S
- **Ubicación:** `src/services/PrinterSerial.js:76-90, 108-111`
- **Descripción:** No registra `navigator.serial.addEventListener('disconnect', ...)`. Si el usuario desconecta el cable USB, la app no lo sabe; el próximo `_write` lanza un error no capturado que rompe el flujo de impresión del ticket. Tampoco hay timeout en `_write` (puede colgar si el buffer se llena).
- **Recomendación:** Escuchar `disconnect`, limpiar `_port`/`_writer`, exponer callback `onDisconnect`. Añadir `Promise.race` con timeout de 5s en `_write`.

#### HOOK-011 · Monkeypatch global de `localStorage.setItem`
- **Severidad:** 🟠 ALTO · **Esfuerzo:** M
- **Ubicación:** `src/hooks/useCloudSync.js:38-44`
- **Descripción:** (Ver SEC-009.) Se reemplaza `localStorage.setItem` a nivel módulo (irreversible, afecta a toda la app incl. libs de terceros). Si el módulo se importa dos veces (HMR, tests), se re-patchea el ya-patcheado → recursión.
- **Recomendación:** Usar un Proxy sobre localStorage, o mejor, reemplazar por llamadas explícitas `storageService.setItem` en los puntos de escritura.

#### HOOK-012 · `useCloudSync` no desuscribe Realtime en cleanup
- **Severidad:** 🟠 ALTO · **Esfuerzo:** S
- **Ubicación:** `src/hooks/useCloudSync.js:187-189`
- **Descripción:** El cleanup del `useEffect` explícitamente NO llama `globalSubscription.unsubscribe()` (comentario: "debe vivir mientras la app esté abierta"). Si el hook se monta en múltiples componentes o si `deviceId` cambia a `null` y vuelve, se crea una NUEVA suscripción sin matar la vieja.
- **Recomendación:** En cleanup, llamar `globalSubscription?.unsubscribe()` y nullificar `globalSubscription` e `isInitialized.current`.

#### HOOK-013 · `useAuthStore.usuarioActivo` no se sincroniza con cloud
- **Severidad:** 🟠 ALTO · **Esfuerzo:** S
- **Ubicación:** `src/hooks/store/useAuthStore.js:93-98, 216-219`
- **Descripción:** `partialize` excluye `usuarioActivo`; se persiste manualmente en `abasto-device-session` (NO en `LOCAL_KEYS` de `useCloudSync`). Cuando `usuarios` se actualiza vía cloud (PIN cambiado en dispositivo A), el `usuarioActivo` en dispositivo B queda con el PIN hash viejo.
- **Recomendación:** Incluir `usuarioActivo.id` en `partialize` y re-validar contra `usuarios` tras rehydrate. O sincronizar `abasto-device-session` también.

#### HOOK-014 · `useCloudBackup` causa eco cloud
- **Severidad:** 🟠 ALTO · **Esfuerzo:** XS
- **Ubicación:** `src/hooks/useCloudBackup.js:27-45` vs `src/hooks/useCloudSync.js:64-67`
- **Descripción:** `applyCloudBackup` llama `storageService.setItem` que a su vez llama `pushCloudSync`. Como `applyCloudBackup` se ejecuta fuera del flujo Realtime, `isSyncingFromCloud` es `false` → los datos restaurados se re-envían a la nube. No es un loop infinito (el `upsert` es idempotente), pero genera writes innecesarios.
- **Recomendación:** Setear `isSyncingFromCloud = true` alrededor de `applyCloudBackup`, o que `storageService` exponga un `setItemLocal` que no dispare push.

### Infra/Config

#### INFRA-006 · PWA `cacheId: '...-v' + Date.now()`
- **Severidad:** 🟠 ALTO · **Esfuerzo:** XS
- **Ubicación:** `vite.config.js:16`
- **Descripción:** Invalida caché en cada dev start, rompe HMR/dev.
- **Recomendación:** Usar versión estática del `package.json` o un hash del build.

#### INFRA-007 · `autoUpdate` + `skipWaiting` + `clientsClaim`
- **Severidad:** 🟠 ALTO · **Esfuerzo:** S
- **Ubicación:** `vite.config.js:14-15`
- **Descripción:** Combinación que causa recargas abruptas en producción sin aviso al usuario. El usuario puede estar a mitad de un checkout y la app se recarga.
- **Recomendación:** Cambiar a `registerType: 'prompt'` y mostrar un toast "Nueva versión disponible" con botón de actualizar.

#### INFRA-008 · `manualChunks` no separa `groq-sdk` ni `@capacitor/*`
- **Severidad:** 🟠 ALTO · **Esfuerzo:** XS
- **Ubicación:** `vite.config.js:169-176`
- **Descripción:** Bundle inflado. `groq-sdk` y Capacitor se incluyen en el chunk principal.
- **Recomendación:** Añadir `groq: ['groq-sdk']` y `capacitor: ['@capacitor/core', '@capacitor/android']` al `manualChunks`.

#### INFRA-009 · Dual lockfile: `bun.lock` (v1 legacy) + `package-lock.json` (v3)
- **Severidad:** 🟠 ALTO · **Esfuerzo:** XS
- **Ubicación:** raíz del repo
- **Descripción:** Gestor de paquetes ambiguo, builds no reproducibles, CI puede resolver dependencias distintas.
- **Recomendación:** Elegir un gestor (recomendado: `bun` por el stack) y eliminar el otro lockfile. Añadir `"packageManager": "bun@x.y.z"` al `package.json`.

#### INFRA-010 · `vercel.json` + `wrangler.jsonc` contradictorios
- **Severidad:** 🟠 ALTO · **Esfuerzo:** S
- **Ubicación:** raíz del repo
- **Descripción:** Ambos definen deploy. Vercel no responde `/api/*` pero el worker sí. La feature Groq de `SystemTester.js` falla silenciosamente en prod.
- **Recomendación:** Elegir un único target de deploy. Si es Cloudflare: eliminar `vercel.json` y mover `/api/analyze` a una Cloudflare Function. Si es Vercel: eliminar `wrangler.jsonc` y mover `/api/rates` + `/api/share` a Vercel Edge Functions.

#### INFRA-011 · Ausencia total de security headers
- **Severidad:** 🟠 ALTO · **Esfuerzo:** S
- **Ubicación:** Vercel, Worker, `index.html`
- **Descripción:** No se establece Content-Security-Policy, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`. La app puede ser embebida en iframes de terceros (clickjacking).
- **Recomendación:** Añadir CSP estricta, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` en el worker/Vercel.

#### INFRA-012 · Dev server `/api/analyze` expone `GROQ_API_KEY` sin auth/limit
- **Severidad:** 🟠 ALTO · **Esfuerzo:** S
- **Ubicación:** `vite.config.js:129-160`
- **Descripción:** (Ver SEC-011.)
- **Recomendación:** Limitar CORS, exigir token efímero, mover a Edge Function con auth.

#### INFRA-013 · `theme_color` inconsistente
- **Severidad:** 🟠 ALTO · **Esfuerzo:** XS
- **Ubicación:** `vite.config.js:42` (manifest) + `index.html` (meta)
- **Descripción:** `#10B981` en manifest vs `#f8fafc` en HTML vs `black-translucent` en iOS. La barra de estado del móvil cambia de color según el contexto.
- **Recomendación:** Unificar a `#10B981` (verde de marca) en todos los lugares.

#### INFRA-014 · SQLs incompatibles para `cloud_backups`
- **Severidad:** 🟠 ALTO · **Esfuerzo:** S
- **Ubicación:** `supabase_cloud_schema.sql` vs `db_estacion_maestra_setup.sql`
- **Descripción:** PK `device_id TEXT` vs PK `id UUID`. Schema distinto según qué SQL se aplique.
- **Recomendación:** Consolidar a un único schema. Documentar cuál es el canónico.

#### INFRA-015 · `password_hash TEXT` sin salt ni política; índice en `email` comentado
- **Severidad:** 🟠 ALTO · **Esfuerzo:** S
- **Ubicación:** `supabase_cloud_schema.sql`
- **Descripción:** Anti-patrón: deberías usar Supabase Auth. Sin índice en `email`, las búsquedas son full-scan.
- **Recomendación:** Migrar a Supabase Auth. Si se mantiene custom, añadir salt + política (argon2/bcrypt) y crear el índice.

#### INFRA-016 · `OneSignalSDKWorker.js` committed pero sin uso
- **Severidad:** 🟠 ALTO · **Esfuerzo:** XS
- **Ubicación:** `public/OneSignalSDKWorker.js`
- **Descripción:** Competirá con el SW de Workbox si se activa, rompiendo el cacheo PWA.
- **Recomendación:** Eliminar si no se usa OneSignal, o integrar correctamente como scope separado.

---

## 🟡 ISSUES MEDIOS (selección — ver worklog para los 40 completos)

### Seguridad
- **SEC-015** Auto-lock bypaseable desde la consola — `useAutoLock.js:15-21,30-33` — Requerir re-autenticación real (PIN) al volver de inactividad. (M)
- **SEC-016** `requireLogin` por defecto `false` — `useAuthStore.js:100` — Defaultear a `true` cuando exista cuenta cloud. (XS)
- **SEC-017** PIN de cajero de solo 4 dígitos — `LoginPinModal.jsx:6` — Exigir ≥6 dígitos. (XS)
- **SEC-018** `abasto-device-session` acepta cualquier JSON — `useAuthStore.js:93-98` — Validar estructura; firmar con HMAC del backend. (S)
- **SEC-019** `auditService.clearAuditLog` sin verificación de rol — `auditService.js:128-130` — Append-only audit log; exigir PIN de admin para borrar. (S)
- **SEC-020** `document.write` en ventana de impresión — `printerUtils.js:17,29` — Sanitizar/escapar HTML de campos dinámicos. (S)

### Financiero
- **FIN-020** `CurrencyService.applyRoundingRule` siempre CEIL Bs a entero vs POS `round2` — `CurrencyService.js:27` — Unificar. (XS)
- **FIN-021** `smartCashRounding` epsilon `0.2001` hacky — `calculatorUtils.js:54` — Usar `Number.EPSILON` o `round2` con umbral explícito. (XS)
- **FIN-022** `checkoutProcessor` validación débil — `checkoutProcessor.js:29-37` — Añadir `effectiveRate > 0` y consistencia `cartTotalBs ≈ cartTotalUsd * effectiveRate`. (S)
- **FIN-023** `isPaid = remainingUsd < 0.009` umbral mágico — `useCheckoutCalculations.js:44` — Usar `round2(remainingUsd) === 0` o constante `EPSILON_PAGO` documentada. (XS)
- **FIN-024** `ticketGenerator`/`ticketHtmlTemplate` usan `* rate` raw — `ticketGenerator.js:122,138,141,241,268`, `ticketHtmlTemplate.js:25,31,50` — Usar `mulR`. (S)
- **FIN-025** `dailyCloseGenerator` lee `tasa_cop`/`cop_enabled` de localStorage — `dailyCloseGenerator.js:40-41` — Recibir como parámetros. (XS)
- **FIN-026** `handleSaveApertura` no usa lock ni valida montos — `useCheckoutFlow.js:71-98` — Envolver en `navigator.locks.request` y validar `>= 0`. (S)
- **FIN-027** `voidSaleProcessor` usa `currentProducts` stale — `voidSaleProcessor.js:29` — Re-leer de storage. (XS)
- **FIN-028** `CierreCajaWizard` semáforo solo considera USD — `CierreCajaWizard.jsx:55-59` — Tres semáforos o combinación ponderada. (S)
- **FIN-029** `CashReconciliationModal` no soporta COP — `CashReconciliationModal.jsx:1-110` — Añadir campo COP o deprecar. (S)

### Hooks/Servicios
- **HOOK-015** `useRates` sin backoff exponencial — `useRates.js:77-93` — Implementar backoff (1s, 2s, 4s) con jitter. (S)
- **HOOK-016** `useRates isOffline` solo se setea en catch — `useRates.js:236-239` — Setear `isOffline(true)` también si `bcv.price` no es > 0. (XS)
- **HOOK-017** `useRates.validateMagnitude` puede corromper COP — `useRates.js:179-188` — Pasar rango esperado como parámetro. (XS)
- **HOOK-018** Race condition auto-save vs cloud push — `ProductContext.jsx:103-122`, `useCloudSync.js:106-114` — Setear `savingRef.current = true` antes del timeout. (XS)
- **HOOK-019** `useVoiceSearch` sin cleanup — `useVoiceSearch.js:67-82` — `recognitionRef.current?.abort()` en cleanup. (XS)
- **HOOK-020** `useSounds` no cierra AudioContext — `useSounds.js:11-19` — `ctx.close()` en cleanup. (XS)
- **HOOK-021** `useLicenseMonitoring` callbacks stale — `useLicenseMonitoring.js:106` — Usar refs o incluir callbacks en deps. (XS)
- **HOOK-022** `useSecurity` errores silenciados — `useSecurity.js:121,186,299,434` — Al menos `console.warn('[Security] ...', e)`. (XS)
- **HOOK-023** `useCloudSync` pull inicial secuencial sin aislamiento — `useCloudSync.js:150-155` — try/catch por doc individual. (XS)
- **HOOK-024** `useOfflineQueue.getCachedRates` sin staleness check — `useOfflineQueue.js:38-43` — Devolver `{ rates, stale: true }` si > 24h. (XS)
- **HOOK-025** `useDataImportExport.localforage.clear()` borra flags críticos — `useDataImportExport.js:103` — Preservar `pda_demo_flag_v1` y `bodega_autobackup_v1`. (S)
- **HOOK-026** `ErrorBoundary` recuperación inefectiva — `ErrorBoundary.jsx:28-43` — "Reintentar" debe `window.location.reload()`. (XS)
- **HOOK-027** `useSpeech` patrón deprecado `onvoiceschanged` — `useSpeech.js:19-20` — Migrar a `addEventListener`. (XS)

### Infra/Config
- **INFRA-017** `bun.lock` v1 legacy — raíz — Formato antiguo, sin hash v2. (XS)
- **INFRA-018** ESLint `varsIgnorePattern: '^[A-Z_]'` — `eslint.config.js` — Silencia imports muertos. (XS)
- **INFRA-019** Capacitor config mínima — `capacitor.config.json` — Falta `androidScheme: 'https'`, `appName` inconsistente. (XS)
- **INFRA-020** Tailwind `blue`/`purple`/`indigo` aliasados al mismo color — `tailwind.config.js` — Confusión de paleta. (XS)
- **INFRA-021** Scripts `package.json`: typo `'linc'`, falta `cap sync`, `typecheck`, `format:check` — `package.json:6-13` — (XS)
- **INFRA-022** `index.html`: apple-touch-icon 192 en vez de 180, falta manifest link — (XS)
- **INFRA-023** ~13 MB de binarios/PII committed — `cierre_2026-03-25.pdf`, `inventario 23.xls`, `WhatsApp Video .mp4`, `frames/`, `verify_financials.py` con 102 ventas reales — Mover fuera del repo. (S)
- **INFRA-024** `wrangler.jsonc` sin `observability` ni `compatibility_flags` — (XS)
- **INFRA-025** `.gitignore` con patrones incorrectos (`!api/`, `*.html`, `"logo .png"` con quotes literales) — (XS)

---

## 🟢 ISSUES BAJOS (selección — ver worklog para los 27 completos)

### Seguridad
- **SEC-021** `supabaseClient.js` con fallback a placeholder `'REEMPLAZAR_CON_TU_ANON_KEY_VERDADERA'` — Lanzar error claro al boot. (XS)
- **SEC-022** Ausencia de headers de seguridad — Añadir CSP estricta, X-Frame-Options, etc. (S) *(ver INFRA-011)*
- **SEC-023** `MonitorView` con "debug secreto" (7 clics en logo) — Gatear con `import.meta.env.DEV`. (XS)

### Financiero
- **FIN-030** `priceUsdt` typo histórico — `productProcessor.js:57` — Migrar a `priceUsd` con alias temporal. (S)
- **FIN-031** `formatBs` shadowed en `DiscountModal` — `DiscountModal.jsx:44` — Usar el import directamente. (XS)
- **FIN-032** `console.log` en producción — `voidSaleProcessor.js:58` — Remover o mover a `logEvent`. (XS)
- **FIN-033** `safeRate = effectiveRate > 0 ? effectiveRate : 1` fallback silencioso — `useCheckoutCalculations.js:19` — Lanzar error o mostrar toast. (XS)
- **FIN-034** `useCalculator.handleQuickAdd` usa `Math.ceil`/`toFixed(0)` — `useCalculator.js:65` — Usar `round2` consistente. (XS)

### Hooks/Servicios
- **HOOK-028** `useBarcodeScanner` deps inline — `useBarcodeScanner.js:52` — Usar ref para `onScan`. (XS)
- **HOOK-029** `useProductForm` 22 `useState` individuales — `useProductForm.js:4-22` — Consolidar en reducer. (M)
- **HOOK-030** `useInventoryVelocity` deps `productsTrigger` — `useInventoryVelocity.js:45` — Usar primitivo. (XS)
- **HOOK-031** `useNotifications.send` catch silencioso — `useNotifications.js:43` — Loguear en dev. (XS)
- **HOOK-032** `Toast.jsx` setTimeout no limpiado — `Toast.jsx:55-59` — Guardar IDs en ref y limpiar. (XS)
- **HOOK-033** `main.jsx` wheel listener global sin cleanup — `main.jsx:27-32` — Mover a `useEffect` en App. (XS)
- **HOOK-034** `useAutoLock` removeEventListener sin opciones — `useAutoLock.js:77` — Inconsistencia con add. (XS)
- **HOOK-035** `store.js user` duplica `useAuthStore.usuarioActivo` — `store.js:11-12` — Eliminar (grep confirma no uso). (XS)
- **HOOK-036** `RateService` sin stale detection — `RateService.js:44-45` — Devolver flag `stale: true`. (XS)
- **HOOK-037** `CurrencyService.safeParse` no maneja formato europeo — `CurrencyService.js:15` — Detectar formato y normalizar. (XS)
- **HOOK-038** `auditService.clearAuditLog` sin role check — `auditService.js:128-130` — Aceptar `user` param y validar rol. (XS)
- **HOOK-039** `useDemoCountdown onExpired` stale — `useDemoCountdown.js:44` — Usar ref. (XS)
- **HOOK-040** `useSecurity.checkLicense` no memoizado — `useSecurity.js:172` — `useCallback`. (XS)
- **HOOK-041** Duplicación `IDB_KEYS`/`LS_KEYS` en 3 archivos — `useCloudBackup.js:49-69`, `useAutoBackup.js:10-30`, `useRemoteBackupListener.js:5-19` — Extraer a `src/config/backupKeys.js`. (XS)
- **HOOK-042** `useCloudSync._applyFromCloud` no maneja payload null para 'store' — `useCloudSync.js:90-118` — Si payload null, `localforage.removeItem(docId)`. (XS)
- **HOOK-043** `useAutoBackup` re-crea intervalo en cada cambio de `isPremium`/`isDemo` — `useAutoBackup.js:113` — Separar config en ref. (XS)

### Infra/Config
- **INFRA-026** Dependencias actuales sin CVEs críticas conocidas — (N/A, informativo)
- **INFRA-027** `postcss-import` instalado pero no registrado en `postcss.config.js` — (XS)
- **INFRA-028** `robots.txt` referencia sitemap inexistente en dominio Vercel — (XS)
- **INFRA-029** Iconos PWA duplicados (`apple-touch-icon.png` ≡ `apple-touch-icon-180x180.png`, `pwa-144x144.png` sin uso) — (XS)
- **INFRA-030** `console.error` en worker sin `observability` — (XS)

---

## 🗺️ Roadmap de remediación

### Fase 0 — Contención de emergencia (24-48 h)
Issues a resolver antes de cualquier otra cosa:
- **INFRA-001** + **SEC-002**: Rotar Supabase anon key, purgar git history, aplicar RLS real.
- **SEC-001**: Eliminar path XOR legacy de `verifyLicenseToken`.
- **SEC-004** + **HOOK-001**: Fix `useAutoLock` (implementar `setAdminCredentials` o rediseñar).
- **FIN-001**: Fix void de `COBRO_DEUDA`.
- **FIN-007** + **HOOK-004**: Feature detection + polyfill de `navigator.locks`.
- **INFRA-004** + **INFRA-005**: Endurecer Worker (auth, rate-limit, `crypto.getRandomValues`, CORS whitelist).

**Esfuerzo estimado:** ~3-4 días-dev (1 persona).

### Fase 1 — Integridad financiera (1 semana)
- **FIN-002**, **FIN-003**, **FIN-004**, **FIN-005**: Fixes del `FinancialEngine`.
- **FIN-008**: Deep-freeze de sales.
- **FIN-009**: Eliminar fallback `4150`.
- **FIN-006**: Lock en `processCustomerTransaction`.
- Unificar todos los cálculos a `dinero.js` (FIN-010 a FIN-019).
- **HOOK-007**: Manejo de `QuotaExceededError`.

**Esfuerzo estimado:** ~5-7 días-dev.

### Fase 2 — Hardening de seguridad (1-2 semanas)
- **SEC-005**, **SEC-006**, **SEC-013**: PINs con salt + rate-limit persistente + sesión sin hash.
- **SEC-007**, **SEC-008**: Eliminar XOR, fortalecer fingerprint.
- **SEC-009** + **HOOK-011**: Eliminar monkeypatch de `localStorage.setItem`.
- **HOOK-002**: Cron server-side + RPC `heartbeat_device` para expirar demos.
- **INFRA-011**: Security headers (CSP, X-Frame-Options, etc.).
- **INFRA-009**, **INFRA-010**: Unificar gestor de paquetes y target de deploy.

**Esfuerzo estimado:** ~7-10 días-dev.

### Fase 3 — Robustez de hooks/servicios (1-2 semanas)
- **HOOK-005**: `useMemo` en `ProductContext`.
- **HOOK-006**: Consolidar estado de carrito.
- **HOOK-008**, **HOOK-009**: Lock y retención del audit log.
- **HOOK-010**: Listener `disconnect` en `PrinterSerial`.
- **HOOK-012**, **HOOK-013**, **HOOK-014**: Fixes de sync cloud.
- Todos los `MEDIO` de hooks (HOOK-015 a HOOK-027).

**Esfuerzo estimado:** ~5-8 días-dev.

### Fase 4 — Limpieza y deuda técnica (backlog continuo)
- Todos los `BAJO`.
- Mover binarios/PII fuera del repo (INFRA-023).
- Migrar a TypeScript (opcional, alta inversión).
- Consolidar claves IDB/LS (HOOK-041).

**Esfuerzo estimado:** Continuo.

---

## 📋 Cómo usar este documento

1. **Cada issue tiene un ID único** (`SEC-001`, `FIN-001`, etc.) — úsalo para crear issues en GitHub/GitLab.
2. **Las dependencias entre issues** se indican con "(Duplicado de ...)" o "(ver ...)".
3. **El esfuerzo es orientativo** (1 pt ≈ ½ día-dev) — ajusta según tu equipo.
4. **El worklog completo** con todos los detalles (incluyendo los 40 MEDIO y 27 BAJO no listados aquí por espacio) está en `/home/z/my-project/worklog.md`.
5. **La auditoría fue de solo lectura** — no se modificó ningún archivo del proyecto.

### Plantilla para crear issue en GitHub
```
Title: [SEC-001] Bypass de licencia vía token XOR "legacy"
Labels: security, critical, phase-0
Milestone: Fase 0 — Contención
Estimate: M (3pt)

## Descripción
<copiar de ISSUES.md>

## Ubicación
<copiar de ISSUES.md>

## Impacto
<copiar de ISSUES.md>

## Recomendación
<copiar de ISSUES.md>

## Dependencias
- Blocks: SEC-007, SEC-013
- Blocked by: ninguna
```

---

*Auditoría realizada el 2026-03-30 por 4 agentes en paralelo (seguridad, financiero, hooks/servicios, infra/config). Reporte completo en `/home/z/my-project/worklog.md`.*
