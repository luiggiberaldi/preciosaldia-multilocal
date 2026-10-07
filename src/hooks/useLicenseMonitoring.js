// Auditoría post-plan (2026-10-01): el monitoreo legacy de licencias queda
// DESACTIVADO en Pro.
//
// Antes este hook enviaba heartbeats cada 3 minutos, consultaba el estado
// de la licencia vía RPC, registraba el equipo y leía la tabla `licenses`
// con `product_id` de Lite — una mina de scoping Lite/Pro, además de requests
// reales (404) cada sesión hasta que el guard `deviceBackend` caía.
//
// El gate real de Pro es CloudGate (código → registro de equipo con tope 6 →
// PIN local). La API del hook se conserva como no-op para no romper a su único
// llamador (`useSecurity.jsx`). La verificación local de tokens RSA sigue viva
// en `useSecurity`; las funciones de activación manual legadas de ese archivo
// quedan pendientes de limpieza en el refactor de licencias.
export function useLicenseMonitoring() {
    // no-op intencional
}
