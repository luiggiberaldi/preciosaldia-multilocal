# Licenciamiento Multi-Dispositivo y Sincronización de Datos

Este plan detalla los cambios necesarios para permitir que un solo código de licencia se use en hasta dos dispositivos (con un costo extra para dispositivos adicionales) e implementar la sincronización en tiempo real de inventario y ventas a través de Supabase.

## Revisión del Usuario Requerida

> [!IMPORTANT]
> La lógica de licenciamiento dependerá de un "Código de Licencia" compartido. Transicionaremos de "Licencias basadas en Dispositivo" a "Licencias basadas en Código con límites de Dispositivos".

## Cambios Propuestos

### [Capa de Base de Datos]

#### [MODIFICAR] Esquema de Supabase
Ajustaremos cómo se almacenan y validan las licencias.
1. **`license_codes` (Nueva Tabla)**:
   - `code`: El código de activación (Clave Primaria).
   - `product_id`: 'bodega'.
   - `max_devices`: Por defecto es 2.
   - `active`: Booleano.
   - `client_name`: Metadatos (Nombre del negocio).

2. **`licenses` (Modificar existente)**:
   - Asegurar que se vincule a `license_codes` o simplemente contenga el `code`.
   - La lógica actual usa `device_id` as a key. Mantendremos esto pero validaremos contra el límite `max_devices` de `license_codes`.

### [Capa de Lógica]

#### [MODIFICAR] `src/hooks/useSecurity.js`
- **`unlockApp`**: Actualizar para verificar el conteo total de dispositivos registrados para un código dado.
  - Si el código es válido y el conteo de dispositivos activos para ese código es < 2, permitir el registro.
  - Si el conteo es >= 2, devolver un error específico (ej. `LIMIT_REACHED`).
- **`heartbeat_device`**: Asegurar que continúe verificando que el dispositivo actual sigue siendo uno de los autorizados para ese código.

### [Capa de Datos]

#### [NUEVO] `src/utils/syncService.js`
Crearemos un nuevo servicio para manejar la sincronización en tiempo real.
- **`subscribeToChanges`**: Usar Supabase Realtime para escuchar actualizaciones en productos y ventas.
- **`syncLocalToCloud`**: Un proceso en segundo plano para subir cambios locales (soporte offline).

#### [MODIFICAR] `src/utils/storageService.js`
- Actualizar `getItem` and `setItem` para preferir Supabase cuando una licencia válida esté activa y haya internet disponible.

## Plan de Verificación

### Pruebas Automatizadas
- Script para simular la activación en 3 `deviceIds` diferentes usando el mismo código.
- Verificar que el 1er y 2do dispositivo tengan éxito.
- Verificar que el 3ro falle con `LIMIT_REACHED`.

### Verificación Manual
- Activar en PC y Móvil con el mismo código.
- Editar un producto en la PC y verificar que se actualice en el Móvil instantáneamente.
