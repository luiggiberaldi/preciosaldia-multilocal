# 🔒 AUDITORÍA TÉCNICA DE SEGURIDAD Y VULNERABILIDADES

> **Proyecto:** Precios al Día (POS Bodega & Landing Page Comercial)  
> **Fecha:** 2026-08-23  
> **Alcance:** `preciosaldia-bodega` (PWA / Electron / POS) + `pagina precios al dia` (Next.js / Edge API)  
> **Evaluador:** Especialista en Ciberseguridad & Arquitectura Full-Stack  
> **Estado:** ⚠️ VULNERABILIDADES IDENTIFICADAS — PLAN DE REMEDIACIÓN REQUERIDO

---

## 📊 1. Resumen Ejecutivo

Se ha realizado una auditoría exhaustiva de seguridad sobre el modelo de licenciamiento, control de acceso local (PIN/roles), almacenamiento persistente (`IndexedDB`, `localStorage`, `sessionStorage`), comunicación con Supabase y endpoints de API públicos.

| Métrica | Resultado |
|---|---|
| **Vulnerabilidades Críticas (P0)** | **3** (Bypass offline de licencia, backdoor de PIN maestro, defacement de precios) |
| **Vulnerabilidades de Alto Impacto (P1)** | **2** (Escalada de rol Cajero→Admin, manipulación de reloj en demo) |
| **Vulnerabilidades de Impacto Medio (P2)** | **2** (Agotamiento de cuota de IA, multiplicación de demos por navegador) |
| **Nivel de Riesgo Global** | 🔴 **ALTO** (Riesgo de pérdida de ingresos y compromiso de terminal de caja) |

---

## 📋 2. Tabla Resumen de Vulnerabilidades

| ID | Severidad | Vulnerabilidad | Archivo Afectado | Impacto en el Negocio |
|---|:---:|---|---|---|
| **SEC-CRIT-001** | 🔴 **CRÍTICO** | Bypass de Licencia Permanente Offline vía `pda_license_cache` sin firma | `src/hooks/useSecurity.jsx` | Piratería trivial: activación permanente gratis sin pagar. |
| **SEC-CRIT-002** | 🔴 **CRÍTICO** | Clave Maestra de Emergencia Hardcodeada (`24457713`) | `src/components/security/EmergencyPinResetModal.jsx` | Cualquier empleado puede sobreescribir el PIN del dueño. |
| **SEC-CRIT-003** | 🔴 **CRÍTICO** | Endpoint `/api/price` POST público sin autenticación | `pagina precios al dia/src/app/api/price/route.ts` | Cualquier persona en internet puede alterar los precios oficiales. |
| **SEC-HIGH-001** | 🟡 **ALTO** | Escalada de Privilegios Local vía `abasto-device-session` | `src/hooks/store/useAuthStore.js` | Empleado cajero pasa a Admin editando LocalStorage. |
| **SEC-HIGH-002** | 🟡 **ALTO** | Extensión de Demo mediante manipulación del reloj del SO | `src/hooks/useDemoCountdown.js` y `useSecurity.jsx` | Uso ilimitado de la demo retrasando la fecha de Windows/Android. |
| **SEC-MED-001** | 🔵 **MEDIO** | Agotamiento de cuota Groq por `/api/chat` sin rate limiting | `pagina precios al dia/src/app/api/chat/route.ts` | Denegación de servicio en el Asistente IA de la web y POS. |
| **SEC-MED-002** | 🔵 **MEDIO** | Re-activación de Demo cambiando de navegador en el mismo equipo | `src/security/deviceFingerprint.js` | 3 días extra por cada navegador instalado (Chrome, Edge, Brave). |

---

## 🔍 3. Análisis Técnico Detallado de Brechas

---

### 🔴 SEC-CRIT-001: Bypass de Licencia Permanente Offline vía `pda_license_cache`

* **Ubicación:** [`preciosaldia-bodega/src/hooks/useSecurity.jsx:230-245`](file:///c:/Users/luigg/Desktop/precios%20al%20dia%20final/preciosaldia-bodega/src/hooks/useSecurity.jsx#L230-L245) y [`L467-L483`](file:///c:/Users/luigg/Desktop/precios%20al%20dia%20final/preciosaldia-bodega/src/hooks/useSecurity.jsx#L467-L483)
* **Descripción Técnica:**  
  Cuando el dispositivo no tiene conexión a internet (`netError === true` o fallo de red simulado), el hook `useSecurity` consulta la clave `pda_license_cache` en `localStorage`. Si el objeto contiene `isActive: true` y `deviceId === currentDeviceId`, concede inmediatamente `isPremium = true` sin verificar si existe una firma RSA válida (`pda_premium_token`).
* **Código Vulnerable:**
  ```javascript
  // useSecurity.jsx (Líneas 230-239)
  const cached = localStorage.getItem('pda_license_cache');
  if (cached) {
      const cacheObj = JSON.parse(cached);
      if (cacheObj.deviceId === currentDeviceId && cacheObj.isActive) {
          const { isPremium: isPrem } = applyLicenseState(cacheObj.type, cacheObj.isActive, cacheObj.expiresAt, cacheObj.createdAt);
          if (isPrem) {
              setLoading(false);
              return; // ⚠️ Concede Premium Permanente sin verificar firma RSA
          }
      }
  }
  ```
* **Vector de Explotación:**  
  1. El usuario desconecta el Wi-Fi o bloquea las peticiones a `*.supabase.co`.
  2. Abre la consola de DevTools (F12) y ejecuta:
     ```javascript
     localStorage.setItem('pda_license_cache', JSON.stringify({
       type: 'permanent',
       isActive: true,
       expiresAt: null,
       createdAt: new Date().toISOString(),
       deviceId: localStorage.getItem('pda_device_id'),
       updatedAt: Date.now()
     }));
     ```
  3. Recarga la app. La aplicación queda desbloqueada como **Premium Vitalicio** de forma indefinida en modo offline.
* **Remediación:**  
  Para que la licencia offline sea válida como Permanente, **debe existir y validarse obligatoriamente el token firmado con RSA (`pda_premium_token`)** mediante `verifyLicenseToken()`. La caché sin firma solo debe ser admitida de forma temporal para licencias remotas con un TTL máximo de tolerancia (ej. 7 días) y un hash HMAC local.

---

### 🔴 SEC-CRIT-002: Clave Maestra de Emergencia Hardcodeada en el Frontend

* **Ubicación:** [`preciosaldia-bodega/src/components/security/EmergencyPinResetModal.jsx:24`](file:///c:/Users/luigg/Desktop/precios%20al%20dia%20final/preciosaldia-bodega/src/components/security/EmergencyPinResetModal.jsx#L24)
* **Descripción Técnica:**  
  El componente de recuperación de PIN contiene una clave fija en texto plano:
  ```javascript
  const defaultMasterKey = '24457713';
  ```
  Al ingresarla, el modal pasa inmediatamente al paso 2 y permite sobrescribir el PIN de cualquier usuario (incluido el Administrador).
* **Vector de Explotación:**  
  1. Un cajero o empleado en el turno presiona *"¿Olvidaste tu PIN?"* en la pantalla de bloqueo.
  2. Ingresa `24457713`.
  3. Establece un nuevo PIN para el Administrador.
  4. Toma control total del sistema, accede a configuración, puede borrar ventas o alterar arqueos de caja.
* **Remediación:**  
  1. Eliminar por completo `defaultMasterKey` del código fuente.
  2. La clave de emergencia debe ser configurada de forma única por el dueño durante el primer arranque y almacenarse únicamente como hash PBKDF2 (`pda_emergency_pin_hash`).
  3. Alternativamente, la recuperación debe realizarse mediante escaneo del código QR del Supervisor enlazado.

---

### 🔴 SEC-CRIT-003: Endpoint Público `/api/price` sin Autenticación

* **Ubicación:** [`pagina precios al dia/src/app/api/price/route.ts:132-185`](file:///C:/Users/luigg/Desktop/precios%20al%20dia%20final/pagina%20precios%20al%20dia/src/app/api/price/route.ts#L132-L185)
* **Descripción Técnica:**  
  La ruta de Next.js `/api/price` expone un handler `POST` con cabeceras CORS abiertas (`*`) que acepta cualquier payload `{ price, comparePrice }` y actualiza tanto el archivo en disco `db/price_config.json` como la base de datos Supabase (`device_pairings`) sin verificar ningún token de autorización.
* **Vector de Explotación:**  
  Cualquier persona en el mundo puede enviar:
  ```bash
  curl -X POST https://preciosaldiaweb.vercel.app/api/price \
    -H "Content-Type: application/json" \
    -d '{"price": 1, "comparePrice": 2}'
  ```
  Esto cambia el precio de venta oficial en la página web a $1 USD.
* **Remediación:**  
  Exigir en el `POST` la cabecera `Authorization: Bearer <PRICE_ADMIN_SECRET>`, validando contra una variable de entorno secreta en el servidor.

---

### 🟡 SEC-HIGH-001: Escalada de Privilegios Local de Cajero a Administrador

* **Ubicación:** [`preciosaldia-bodega/src/hooks/store/useAuthStore.js:130-146`](file:///c:/Users/luigg/Desktop/precios%20al%20dia%20final/preciosaldia-bodega/src/hooks/store/useAuthStore.js#L130-L146)
* **Descripción Técnica:**  
  La sesión activa se rehidrata directamente desde `localStorage.getItem('abasto-device-session')`. Aunque valida los tipos de campos (`id: number, nombre: string, rol: string`), no existe una firma de integridad de sesión.
* **Vector de Explotación:**  
  Un usuario con rol `CAJERO` abre DevTools y escribe:
  ```javascript
  localStorage.setItem('abasto-device-session', JSON.stringify({ id: 1, nombre: 'Administrador', rol: 'ADMIN' }));
  ```
  Al recargar, el store asigna `usuarioActivo.rol = 'ADMIN'` y otorga acceso a vistas restringidas (Reportes, Inventario completo, Usuarios).
* **Remediación:**  
  Mantener la sesión autenticada validada en `sessionStorage` con un token de sesión efímero generado al comprobar el PIN con PBKDF2.

---

### 🟡 SEC-HIGH-002: Extensión de Demo mediante Manipulación del Reloj del Sistema

* **Ubicación:** [`preciosaldia-bodega/src/hooks/useDemoCountdown.js:23`](file:///c:/Users/luigg/Desktop/precios%20al%20dia%20final/preciosaldia-bodega/src/hooks/useDemoCountdown.js#L23) y `useSecurity.jsx`
* **Descripción Técnica:**  
  El tiempo restante de la demo se calcula con `Date.now() < expiresAt`. Si la app está offline y el usuario retrasa la fecha de su sistema operativo (ej. 6 meses al pasado), `Date.now()` siempre será menor a `expiresAt`.
* **Remediación:**  
  Implementar **Monotonic Clock Check**: guardar en `IndexedDB` el mayor timestamp observado (`last_observed_time`). Si en cualquier momento `Date.now() < last_observed_time - 300000` (el reloj retrocedió más de 5 minutos), suspender el modo demo hasta reconectar con el servidor.

---

### 🔵 SEC-MED-001: Agotamiento de Cuota por Endpoint `/api/chat` sin Rate Limiting

* **Ubicación:** [`pagina precios al dia/src/app/api/chat/route.ts`](file:///C:/Users/luigg/Desktop/precios%20al%20dia%20final/pagina%20precios%20al%20dia/src/app/api/chat/route.ts)
* **Descripción Técnica:**  
  El endpoint de streaming de IA no tiene limitación de peticiones por IP ni validación de origen estricta. Un bot puede inundar la API con miles de mensajes concurrentes y consumir el crédito de Groq (`llama-3.3-70b-versatile`).
* **Remediación:**  
  Implementar un token bucket o rate limiter en memoria / Edge (máximo 15 mensajes/minuto por IP).

---

### 🔵 SEC-MED-002: Multiplicación de Demos por Cambio de Navegador

* **Ubicación:** [`preciosaldia-bodega/src/security/deviceFingerprint.js`](file:///c:/Users/luigg/Desktop/precios%20al%20dia%20final/preciosaldia-bodega/src/security/deviceFingerprint.js)
* **Descripción Técnica:**  
  El fingerprint incluye el `User-Agent` (`Chrome`, `Edge`, `Firefox`). Al abrir la app en un navegador distinto en la misma PC, se genera un `deviceId` diferente, permitiendo activar una nueva demo de 3 días en Supabase.
* **Remediación:**  
  Limitar en la función `activate_demo_secure` de Supabase las activaciones por rango de IP / red en ventanas de 30 días, o solicitar un número de teléfono/correo verificado.

---

## 🛠️ 4. Plan de Remediación y Blindaje Paso a Paso

### Fase 1: Parches Inmediatos para Vulnerabilidades Críticas (Prioridad P0)

1. **Parche `pda_license_cache` (SEC-CRIT-001):**
   - En `useSecurity.jsx`, exigir que cualquier licencia offline permanente cuente con un token RSA verificado mediante `verifyLicenseToken()`.
   - Si no hay token RSA y la app está offline, permitir únicamente un período de gracia temporal de máximo 7 días con hash HMAC local.
2. **Eliminación de Backdoor (SEC-CRIT-002):**
   - Eliminar `defaultMasterKey = '24457713'` de `EmergencyPinResetModal.jsx`.
   - Exigir clave personalizada definida por el usuario hasheada con PBKDF2.
3. **Autenticación en `/api/price` (SEC-CRIT-003):**
   - Añadir validación de `Bearer PRICE_ADMIN_SECRET` en el endpoint `POST` de `/api/price`.

---

### Fase 2: Blindaje de Sesión y Demo (Prioridad P1)

1. **Anti-Clock Tampering (SEC-HIGH-002):**
   - Integrar un tracker de tiempo monótono en `storageService` que detecte saltos temporales hacia atrás.
2. **Protección de Sesión (SEC-HIGH-001):**
   - Firmar la sesión de `abasto-device-session` en memoria volátil (`sessionStorage`).

---

### Fase 3: Hardening de API y Cuotas (Prioridad P2)

1. **Rate Limiting en `/api/chat` (SEC-MED-001):**
   - Limitar el consumo de tokens de Groq por dirección IP.
2. **Refuerzo en Supabase RPCs:**
   - Añadir cooldown a `verify_activation_code` para mitigar ataques de fuerza bruta.

---

## 🧪 5. Checklist de Verificación Post-Remediación

- [ ] Intentar inyectar `pda_license_cache` en DevTools offline y verificar que el sistema rechaza la activación sin token RSA.
- [ ] Intentar desbloquear la recuperación de PIN con `24457713` y confirmar que es rechazada.
- [ ] Enviar petición `POST` a `/api/price` sin token y verificar que devuelve `401 Unauthorized`.
- [ ] Intentar cambiar `rol: "ADMIN"` en `localStorage` y verificar que la sesión es invalidada.
- [ ] Retrasar el reloj del sistema 1 año en modo demo y confirmar que el sistema detecta la alteración.
