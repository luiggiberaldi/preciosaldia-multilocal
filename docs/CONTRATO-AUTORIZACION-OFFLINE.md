# Contrato propuesto — autorización offline del POS

**Fecha:** 2026-10-08
**Estado:** diseño técnico para revisión. No implementado, no aplicado a Supabase y no autoriza uso ni despliegue en producción.

## Contexto

`CloudGate` llama a `getCurrentDeviceMembershipStatus()` al iniciar. Si Supabase no permite verificar membresía, la función devuelve `unavailable` y el gate no llama a `onReady()`. D9 fija autorización offline máxima de 24 horas y revisión individual por el dueño de las operaciones pendientes de un dispositivo revocado o vencido. Este documento propone verificar una autorización previa sin confiar en marcas locales.

Referencias: [estado offline y criterios](ESTADO-OFFLINE-POS.md), [plan maestro](PLAN-MAESTRO-RECUPERACION-SYNC-IDENTIDAD.md), [decisiones D1–D10](DECISIONES-PENDIENTES-SYNC-MULTISEDE.md).

## 1. Invariantes

1. Solo el servidor emite o renueva permiso, tras verificar autenticación, instalación registrada, membresía activa y alcance permitido.
2. En cliente, el permiso habilita únicamente superar temporalmente el gate de arranque dentro del alcance indicado. No otorga roles ni sustituye autorización server-side de cada operación.
3. Vigencia máxima: **24 horas desde `iat` del servidor**. Abrir o reiniciar la app no renueva ni extiende el plazo.
4. El permiso se liga a instalación, cuenta/principal y sedes explícitas. Una bandera local, alias, `navigator.onLine`, `pda_account_linked` o `pda_pro_activated` jamás demuestra autorización.
5. Al reconectar, la membresía y revocación actuales del servidor prevalecen. Mientras está desconectado, el dispositivo no puede conocer una revocación reciente; la ventana residual se limita por `exp` y es un riesgo explícito.
6. Pasar CloudGate no implica que existan datos de negocio cacheados ni que venta, stock, cartera, outbox o sync funcionen offline.

## 2. Formato conceptual

Propuesta: JWS firmado con algoritmo estándar compatible (preferencia inicial Ed25519/EdDSA si backend y navegadores destino lo soportan). El verificador fija algoritmos permitidos y nunca acepta el algoritmo del token sin compararlo con esa lista. Si no hay interoperabilidad, evaluar alternativa estándar antes de implementar; no crear criptografía propia ni reutilizar la clave JWT de Supabase.

Header ilustrativo:

```json
{"typ":"offline-authorization+jwt","alg":"EdDSA","kid":"offline-auth-2026-01"}
```

Claims conceptuales requeridos:

```json
{
  "iss":"<issuer-configurado>",
  "aud":"preciosaldia-pos-offline-v1",
  "sub":"<principal-autenticado-canonico>",
  "account_id":"<cuenta-canonica>",
  "device_id":"<ID-de-instalacion-registrado>",
  "business_ids":["neg-1","neg-fac22061"],
  "scope":"pos-offline",
  "jti":"<identificador-aleatorio-unico>",
  "iat":<epoch-seconds-de-servidor>,
  "nbf":<epoch-seconds-de-servidor>,
  "exp":<iat+TTL-menor-o-igual-a-86400>,
  "authz_version":<versión-monótona-de-membresía>
}
```

Son nombres de contrato, no valores desplegables. El servidor deriva sujeto, cuenta, dispositivo, sedes y versión de autorización de sesión/membresía verificadas; nunca confía en esos valores si los propone el cliente. No incluir emails, secretos, tickets, stock ni datos personales.

La clave privada vive exclusivamente en backend protegido. El cliente recibe clave pública desde configuración/release autenticada y versionada, no desde una respuesta no autenticada del mismo canal que falla. La firma da integridad/origen, **no cifra**. Guardar el token en almacenamiento local privado del origen; no en documentos sync, URL, logs ni backups genéricos. Un backup restaurado no es autorización para otra instalación.

## 3. Emisión y renovación

1. Tras login del dueño o vínculo admitido por servidor, verificar identidad persistida, sesión, cuenta, membresía activa/no revocada y sedes/scope permitidos.
2. Endpoint/RPC autenticado emite `iat` usando reloj servidor y `exp = iat + TTL`, donde `0 < TTL <= 86400`; issuer, audience, algoritmo y key ID configurados por servidor.
3. No registrar token en logs; respuesta `Cache-Control: no-store`. Emisión no crea ni revive membresías/dispositivos.
4. El cliente valida firma/claims y relee el valor persistido; fallo de escritura/readback no autoriza.
5. Solo una verificación online satisfactoria renueva. Fallo de red conserva permiso anterior solo hasta `exp`; no hay renovación offline.
6. Dispositivo vinculado por código/sesión anónima necesita prueba server-side explícita equivalente. `pda_account_linked` o una sesión anónima por sí solos no permiten emitir.

## 4. Validación local y CloudGate

Diseñar un verificador puro, separado de React y la red, por ejemplo `verifyOfflineAuthorization({ token, expectedDeviceId, expectedAccountId, requestedBusinessId, clockState })`. Devuelve `valid` o motivo de rechazo (`missing`, `malformed`, `bad-signature`, `unknown-key`, `wrong-issuer`, `wrong-audience`, `wrong-device`, `wrong-account`, `scope-denied`, `not-yet-valid`, `expired`, `clock-rollback`, `unsupported-version`). Cualquier error bloquea; nunca cae a `ready`.

- Fijar algoritmos, issuer, audience, versión y claves permitidas; rechazar `alg=none`, `kid` desconocido, claims ausentes, TTL >24 h, `exp <= iat`, token futuro fuera de tolerancia, scopes malformados y versiones desconocidas.
- Igualar exactamente `device_id` con la identidad persistida; verificar cuenta/principal y sede solicitada. El token no repara, regenera ni sustituye identidad.
- Verificar `exp`/`nbf` con reloj local y persistir ancla/último tiempo confiable. Retroceso fuera de tolerancia, ancla ausente/incoherente, restauración antigua detectable, cambio de instalación o conflicto de identidad implican fail-closed y revalidación online.
- **Límite:** una PWA no posee reloj monotónico confiable que sobreviva a todos los reinicios ni puede impedir a quien controla el equipo cambiar reloj/storage. La firma no resuelve ese límite. Producto debe aprobar tolerancia y riesgo residual; si exige resistencia fuerte, mantener fail-closed offline o usar plataforma con hardware seguro. No afirmar que un timestamp local previene por completo rollback.
- Borrado de datos, reinstalación, clonación, cambio de cuenta o restauración sin ancla invalidan permiso offline hasta revalidación. No copiarlo al reparar instalación.

CloudGate conserva verificación remota como camino preferido. Solo si consulta termina `unavailable` podrá validar un permiso previamente emitido y persistido. Estado remoto `revoked` o `missing` no se degrada a permiso local: requiere flujo online. `navigator.onLine` puede afectar UX/espera, nunca veredicto. Mostrar «modo offline» y vencimiento estimado; nunca «sincronizado/confirmado» por validar el permiso.

## 5. Reconexión, revocación y D9

- El servidor mantiene revocación/versión autoritativa. Cada operación remota vuelve a verificar sesión, dispositivo, cuenta, sede, rol/scope y política vigente. El permiso de arranque no sustituye estos controles.
- Al reconectar validar membresía/revocación antes de reanudar push. Si venció o fue revocado, detener nuevas operaciones protegidas y preservar íntegros journal/outbox originales.
- Pendientes bloqueadas pasan a revisión individual del dueño según D9, antiguas primero y con motivo breve. No aplicar, borrar, reescribir ni descartar automáticamente.
- Aceptar/rechazar requiere acción autenticada y auditada. Antes de aplicar una aceptada, servidor revalida ámbito e idempotencia; mismo ID/contenido obtiene ACK idempotente; mismo ID/contenido distinto va a conflicto/cuarentena. Rechazo no tiene efecto económico y conserva evidencia/decisión según retención aprobada.
- UI y flujo operativo D9 siguen pendientes; una confirmación local no puede simular que existen.

Cada operación offline debería llevar ID estable, sede/actor/dispositivo, referencia al permiso y tiempo local observado. Esa metadata ayuda a auditar, pero no prueba por sí sola autoridad ni sustituye ledger/outbox durable.

## 6. Claves y amenazas

- Clave privada con acceso mínimo en backend. Publicar clave pública y `kid` mediante configuración autenticada/versionada. Mantener claves previas solo mientras sus tokens puedan ser válidos; retirar antes requiere forzar revalidación. Clave no verificable implica bloqueo.
- Compromiso de clave privada: detener emisión, elevar versión/revocación y distribuir trust update por release autenticado. Cliente aislado no recibe retiro hasta reconectar; documentar ventana residual.
- Perfil clonado puede copiar ID y permiso: el binding reduce errores entre IDs, pero no prueba hardware ni impide clon completo. Detección de clones requiere servidor/diseño aparte.
- Firma no protege contra bundle modificado/DevTools en equipo controlado por usuario. No poner secretos de firma en frontend ni prometer seguridad cliente-only.

## 7. Matriz de aceptación previa a habilitar

| Caso | Resultado requerido |
|---|---|
| Permiso vigente, identidad/cuenta/sede correctas y membresía no consultable | CloudGate llega al POS con indicador offline; no muestra sync confirmado |
| Permiso ausente, corrupto o firma/issuer/audience/clave incorrectos | Bloquea sin borrar sesión/datos; explica que necesita conexión |
| TTL >24 h, expirado o `nbf` futuro | Rechaza sin extender por reinicio/reloj |
| Otro device ID, principal/cuenta o sede fuera de scope | Rechaza uso fuera de alcance; no adopta identidad del token |
| Reloj atrasado, ancla ausente, rollback o restauración | Fail-closed según tolerancia aprobada; exige reconexión |
| Dispositivo revocado offline y reconexión posterior | Servidor deniega nuevas operaciones; pendientes quedan en revisión D9 sin aplicación/borrado automático |
| Emisión/renovación o escritura/readback falla | No crea/extiende permiso; permiso previo solo hasta `exp` |
| Permiso vencido con outbox pendiente | Preserva outbox y bloquea nuevas operaciones protegidas; indica flujo D9 |
| Mismo ID/payload vs mismo ID/payload distinto | ACK idempotente vs conflicto/cuarentena preservado |
| Shell cacheado, datos esenciales POS ausentes | No declara POS operativo; informa indisponibilidad de datos requeridos |

Probar unidad criptográfica/claims; emisor/backend/DB en ensayo; sesión owner y vínculo anónimo por separado; E2E en build candidata/PWA instalada con red realmente bloqueada y restaurada, reinicio/suspensión, clon simulado y reloj manipulado. Unit tests o shell PWA no sustituyen RLS, D9 ni checkout real.

## 8. Decisiones antes de implementar

1. Confirmar algoritmo e interoperabilidad backend/navegadores y entrega confiable de clave pública. El proyecto no muestra dependencia JWS/JWT de aplicación en `package.json`; no agregar librería sin verificar encaje.
2. Definir issuer, audience, ciclo de claves, revocación de emergencia y versión de autorización.
3. Aprobar tolerancia/ancla de reloj y aceptar el riesgo de una PWA controlada por usuario; si no se acepta, mantener fail-closed offline.
4. Definir principal para dueño y dispositivos vinculados por código/sesión anónima.
5. Definir tratamiento de operaciones iniciadas antes de revocar, reinstalación/restauración y UI/operación de revisión D9.

Hasta resolver estos puntos y pasar ensayo, se mantiene el comportamiento actual fail-closed cuando la membresía no puede verificarse. **Este contrato no cambia código, esquema, datos, política aprobada ni estado productivo.**
