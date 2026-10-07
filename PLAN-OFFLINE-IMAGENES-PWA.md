# PLAN — Imágenes de producto visibles sin internet (PWA)

> **Objetivo:** que TODA imagen de producto siga visible sin conexión en la PWA,
> sin importar en cuál de los tres formatos esté guardada.
>
> **Alcance:** solo PWA (navegador + instalada). Electron queda **fuera de alcance**
> por decisión explícita del usuario (2026-07-27): "en Electron no lo estamos usando
> por ahora".
>
> **Estado:** plan aprobado, pendiente de ejecución.
> **Fecha:** 2026-07-27

---

## 0. Contexto — por qué hace falta este cambio

### 0.1 Los tres formatos de imagen que existen en producción

El campo `product.image` puede contener tres cosas distintas. Se verificó
inspeccionando los backups reales del repositorio:

| Formato | Ejemplo | Backup donde aparece | ¿Se ve offline HOY? |
|---|---|---|---|
| `data:image/...;base64,...` | base64 embebido | `backup_dondejuancho_completo_2026-07-17.json` → 59 de 72 productos | ✅ **Sí** — viaja dentro del producto |
| URL de Supabase Storage | `https://<proj>.supabase.co/storage/v1/object/public/product-images/...` | `backup_100_productos.json` → 100 de 100 | ✅ **Sí** — regla `CacheFirst` ya existente |
| **Ruta local del catálogo** | `/images/catalog/cerveza-zulia.webp` | `backup_juancho_productos.json` → **70 de 70**<br>`backup_inventario_importable.json` → 23 de 29 | ❌ **NO** |

Las rutas `/images/catalog/*.webp` **no son código**: entran como dato cuando el
negocio importa un backup. Los generan los scripts de
[scripts/scraper_500_products.py:127](scripts/scraper_500_products.py#L127) y
hermanos. Por eso son reales en producción y no se pueden ignorar.

### 0.2 Los tres huecos confirmados

**Hueco 1 — las 612 imágenes del catálogo local no se cachean (el grave).**

- `public/images/catalog/` contiene **612 archivos, 23 MB**.
- El precache manifest del service worker construido tiene **36 entradas**:
  25 `js`, 7 `png`, 1 `css`, 1 `html`, 1 `ico`, 1 `webmanifest` — **cero `webp`**.
- Causa: el `globPatterns` por defecto de `vite-plugin-pwa` es
  `**/*.{js,css,html,ico,png,svg}`, que **no incluye `.webp`**, y en el bloque
  `workbox` de [vite.config.js:21-65](vite.config.js#L21-L65) no se sobreescribe.
- Y tampoco hay regla de `runtimeCaching` que las capture: la única regla de
  imágenes matchea solo `/storage/v1/object/public/product-images/`
  ([vite.config.js:56](vite.config.js#L56)).
- Agravante: [useImagePrecache.js:87](src/hooks/useImagePrecache.js#L87) filtra con
  `/^https?:/i.test(img)`, así que las rutas relativas **también quedan fuera del
  precalentado**.

**Hueco 2 — `maxEntries: 500` desaloja imágenes.**
[vite.config.js:60](vite.config.js#L60). Con un inventario grande el LRU empieza a
botar imágenes justo cuando más se necesitan.

**Hueco 3 — respuestas opacas inflan la cuota.**
[useImagePrecache.js:50](src/hooks/useImagePrecache.js#L50) usa
`fetch(url, { mode: 'no-cors' })`. Eso produce respuestas **opacas**, y cada
respuesta opaca suma ~7 MB de *padding* a la cuota de almacenamiento del navegador
(no lo que pesa de verdad). Resultado: el navegador cree que el cache está lleno
mucho antes de lo real y empieza a purgar.

### 0.3 Dos cosas que se verificaron y NO hay que tocar

Se comprobaron para evitar "arreglos" innecesarios durante la ejecución:

1. **Los caches de runtime sobreviven los cambios de versión.** Aunque
   `cacheId: 'preciosaldia-bodega-v${APP_VERSION}'` ([vite.config.js:26](vite.config.js#L26))
   cambia en cada release, en
   [node_modules/workbox-core/src/_private/cacheNames.ts:69-71](node_modules/workbox-core/src/_private/cacheNames.ts#L69-L71)
   `getRuntimeName` devuelve `userCacheName || _createCacheName(...)` — es decir, un
   `cacheName` **explícito se usa tal cual, sin prefijo**. `product-images-cache`
   NO se renombra ni se pierde al actualizar la app. Lo mismo aplicará al nuevo
   `catalog-images-cache`.
2. **`navigateFallback: 'index.html'` no interfiere.** La ruta de navegación de
   Workbox solo aplica a `request.mode === 'navigate'`; las peticiones de `<img>`
   no la tocan.

### 0.4 Fuera de alcance (no hacer)

- ❌ Electron / `desktop/` — no se usa por ahora.
- ❌ Migrar a IndexedDB + object URLs — es la solución universal, pero exige tocar
  los 6 sitios que renderizan `<img src={p.image}>`. Descartada para esta ronda.
- ❌ Meter los 612 `.webp` en `globPatterns` — serían 23 MB descargados de golpe al
  instalar la PWA, bloqueando la activación del SW en equipos de gama baja.
  Se usa `CacheFirst` de runtime para persistir solo las ~70 que el negocio usa.
- ❌ Añadir `crossOrigin="anonymous"` a los `<img>` de producto — si a un bucket le
  faltaran cabeceras CORS, rompería imágenes que hoy funcionan.

---

## 1. Resumen de fases

| Fase | Qué hace | Archivo | Reversible sola |
|---|---|---|---|
| **0** | Pre-vuelo: rama, baseline verde | — | — |
| **1** | Regla `CacheFirst` para `/images/catalog/` | `vite.config.js` | ✅ |
| **2** | Subir `maxEntries` 500 → 1200 | `vite.config.js` | ✅ |
| **3** | Precalentar rutas locales + fetch CORS con fallback | `src/hooks/useImagePrecache.js` | ✅ |
| **4** | Cache-busting al re-subir imagen (recomendada) | `src/utils/imageUpload.js` | ✅ |
| **5** | Verificación end-to-end offline | — | — |

Las fases 1-4 son independientes entre sí: si una falla, se revierte sola sin
tocar las demás. **Ejecutar en orden** de todos modos, porque la verificación de la
Fase 5 asume las cuatro aplicadas.

---

## FASE 0 — Pre-vuelo

### Paso 0.1 — Crear rama

```bash
git checkout -b fix/offline-imagenes-pwa
```

### Paso 0.2 — Registrar el baseline de tests

```bash
npm test
```

**Anotar cuántos tests pasan y cuántos fallan ANTES de tocar nada.** La suite en
`tests/` no cubre PWA ni precache, así que este número **debe quedar idéntico** al
final. Si ya hay fallos previos, no son responsabilidad de este plan — solo no
deben aumentar.

### Paso 0.3 — Registrar el estado actual del build

```bash
npm run build
grep -c 'url:"' dist/sw.js
grep -c 'webp' dist/sw.js
grep -o 'catalog-images-cache' dist/sw.js | wc -l
```

**Valores esperados ANTES del cambio:** `36`, `0`, `0`.

> ⚠️ Si `dist/sw.js` no existe tras el build, el plugin PWA no generó el SW.
> Detenerse y revisar la salida de `npm run build` — no continuar.

**✅ Checkpoint 0:** rama creada, número de tests anotado, `dist/sw.js` existe con
36 entradas y 0 webp.

---

## FASE 1 — Regla `CacheFirst` para el catálogo local

**Archivo:** [vite.config.js](vite.config.js)
**Arregla:** Hueco 1 (parte SW).

### Paso 1.1 — Localizar el punto de inserción

Buscar este bloque **exacto** (es el final del array `runtimeCaching`, líneas
51-64 del archivo actual):

```js
          {
            // FASE 3 (Egress): imágenes de producto en Supabase Storage. Se cachean
            // para que se vean sin conexión (antes viajaban como base64 embebido,
            // siempre offline; ahora son URLs y necesitan cache runtime para no
            // perder esa capacidad offline-first).
            urlPattern: /\/storage\/v1\/object\/public\/product-images\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'product-images-cache',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
```

### Paso 1.2 — Reemplazarlo por esto

Se inserta un objeto nuevo **entre** la llave de cierre `},` de la regla de Storage
y el `],` que cierra el array:

```js
          {
            // FASE 3 (Egress): imágenes de producto en Supabase Storage. Se cachean
            // para que se vean sin conexión (antes viajaban como base64 embebido,
            // siempre offline; ahora son URLs y necesitan cache runtime para no
            // perder esa capacidad offline-first).
            urlPattern: /\/storage\/v1\/object\/public\/product-images\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'product-images-cache',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // OFFLINE-IMG (F1): catálogo base servido desde public/images/catalog/.
            // NO entra al precache: el globPatterns por defecto de vite-plugin-pwa
            // no incluye .webp, y precargar los 612 archivos (23MB) al instalar
            // bloquearía la activación del SW en equipos de gama baja. Con
            // CacheFirst de runtime solo se persisten las que el negocio abre.
            // Sin regex anclado con `$`: así también matchea si algún día llega
            // con querystring.
            urlPattern: /\/images\/catalog\//i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'catalog-images-cache',
              // 612 archivos en el catálogo → 700 deja margen sin desalojar.
              // Son inmutables (el nombre es el slug del producto) → 1 año.
              expiration: { maxEntries: 700, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
```

### Paso 1.3 — Verificar

```bash
npm run build
grep -o 'catalog-images-cache' dist/sw.js | wc -l
```

**Esperado:** `1` o más (Workbox puede emitir el nombre una sola vez).

**✅ Checkpoint 1:** el build pasa sin errores y `catalog-images-cache` aparece en
`dist/sw.js`.

**↩️ Rollback:** `git checkout vite.config.js`

---

## FASE 2 — Subir el techo de `maxEntries`

**Archivo:** [vite.config.js](vite.config.js)
**Arregla:** Hueco 2.

### Paso 2.1 — Editar una sola línea

Dentro de la regla `product-images-cache` (la que tiene
`cacheName: 'product-images-cache'`), buscar:

```js
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 90 },
```

Reemplazar por:

```js
              // OFFLINE-IMG (F2): 500 desalojaba imágenes en inventarios grandes.
              // maxAge se mantiene en 90 días a propósito: la ruta en Storage es
              // determinística con upsert, así que sin la Fase 4 una imagen
              // re-subida solo se refresca al expirar.
              expiration: { maxEntries: 1200, maxAgeSeconds: 60 * 60 * 24 * 90 },
```

> ⚠️ **Cuidado:** hay 3 bloques `expiration:` en el archivo. El de fonts
> (`maxEntries: 10`) NO se toca. Asegurarse de editar el que está debajo de
> `cacheName: 'product-images-cache'`.

### Paso 2.2 — Verificar

```bash
npm run build
grep -o 'maxEntries:1200\|maxEntries: 1200' dist/sw.js | wc -l
```

**Esperado:** `1`.

**✅ Checkpoint 2:** build limpio, `1200` presente en el SW generado.

**↩️ Rollback:** revertir esa línea a `maxEntries: 500`.

---

## FASE 3 — Precalentar rutas locales + fetch CORS

**Archivo:** [src/hooks/useImagePrecache.js](src/hooks/useImagePrecache.js)
**Arregla:** Hueco 1 (parte precalentado) y Hueco 3.

### Paso 3.1 — Añadir dos helpers

Buscar esta línea (línea 22 actual):

```js
const DEBOUNCE_MS = 5000;
```

Insertar **inmediatamente después**:

```js

/**
 * OFFLINE-IMG (F3): ¿el SW puede cachear esta imagen?
 *  - URL remota (Supabase Storage) → sí, regla product-images-cache.
 *  - Ruta local /images/... (catálogo base) → sí, regla catalog-images-cache.
 *  - data: base64 → se EXCLUYE a propósito: ya viaja embebido en el producto,
 *    está offline por definición y fetchearlo no aporta nada.
 */
function isPrecacheableImage(img) {
    if (typeof img !== 'string' || img.length === 0) return false;
    if (/^https?:/i.test(img)) return true;
    return img.startsWith('/images/');
}

/**
 * Resuelve una ruta relativa contra el origen. Cache Storage indexa por URL
 * absoluta, así que sin esto `caches.match('/images/...')` dependería del <base>
 * del documento.
 */
function toAbsoluteUrl(img) {
    try {
        return new URL(img, window.location.origin).href;
    } catch {
        return img;
    }
}
```

### Paso 3.2 — Cambiar el filtro de URLs

Buscar este bloque **exacto** (líneas 84-88 actuales, dentro del `setTimeout`):

```js
            const urls = [...new Set(
                (products || [])
                    .map(p => p?.image)
                    .filter(img => typeof img === 'string' && /^https?:/i.test(img))
            )];
```

Reemplazar por:

```js
            const urls = [...new Set(
                (products || [])
                    .map(p => p?.image)
                    .filter(isPrecacheableImage)
                    .map(toAbsoluteUrl)
            )];
```

### Paso 3.3 — Cambiar el fetch a CORS con fallback

Buscar este bloque **exacto** (líneas 49-51 actuales, dentro de `precacheImages`):

```js
                // El fetch pasa por el SW → la regla CacheFirst la persiste.
                await fetch(url, { mode: 'no-cors' });
            } catch { /* URL rota u offline parcial: continuar con el resto */ }
```

Reemplazar por:

```js
                // El fetch pasa por el SW → la regla CacheFirst la persiste.
                // OFFLINE-IMG (F3): CORS antes que no-cors. Una respuesta opaca
                // (no-cors) suma ~7MB de padding a la cuota del navegador en vez
                // de lo que pesa de verdad, así que el cache "se llena" muchísimo
                // antes de lo real. Los buckets públicos de Supabase y el propio
                // origen sí envían cabeceras CORS.
                try {
                    await fetch(url, { mode: 'cors', credentials: 'omit' });
                } catch {
                    // Bucket sin cabeceras CORS: caer a no-cors para no perder el
                    // cacheo por completo (guarda una respuesta opaca, que es
                    // exactamente el comportamiento anterior a este cambio).
                    await fetch(url, { mode: 'no-cors' });
                }
            } catch { /* URL rota u offline parcial: continuar con el resto */ }
```

> ℹ️ **Por qué el fallback importa:** con solo `mode: 'cors'`, un bucket sin CORS
> haría fallar el fetch y **no se cachearía nada** — una regresión frente a hoy.
> El `catch` anidado garantiza que en el peor caso quedamos igual que antes.

> ℹ️ **Una respuesta cacheada con CORS sirve igual a un `<img>` sin
> `crossOrigin`.** `caches.match` no discrimina por modo de petición, así que la
> imagen se muestra sin problema. No hay que tocar los `<img>`.

### Paso 3.4 — Actualizar el comentario de cabecera del archivo

Buscar (línea 11 actual):

```js
 * inventario y la caja se ven completos sin internet.
```

Reemplazar por:

```js
 * inventario y la caja se ven completos sin internet.
 *
 * OFFLINE-IMG (F3): cubre los DOS formatos cacheables — URLs de Storage y rutas
 * locales /images/catalog/ del catálogo base (que antes quedaban fuera por el
 * filtro /^https?:/). Los data: base64 no necesitan precalentado.
```

### Paso 3.5 — Verificar

```bash
npm run lint
npm test
```

**Esperado:** sin errores nuevos de lint, y **el mismo número de tests pasando que
en el Paso 0.2**.

**✅ Checkpoint 3:** lint limpio y suite igual al baseline.

**↩️ Rollback:** `git checkout src/hooks/useImagePrecache.js`

---

## FASE 4 — Cache-busting al re-subir una imagen (recomendada)

**Archivo:** [src/utils/imageUpload.js](src/utils/imageUpload.js)
**Arregla:** un bug de obsolescencia que las Fases 1-3 **agravan**.

### Paso 4.1 — Entender el problema antes de editar

En [imageUpload.js:66](src/utils/imageUpload.js#L66) la ruta es determinística y se
sube con `upsert: true` ([imageUpload.js:70](src/utils/imageUpload.js#L70)):

```js
const path = `${deviceId}/${id}.${ext}`;
```

Consecuencia: si el usuario **cambia la foto de un producto**, la URL pública es
**idéntica**. Con `CacheFirst`, el SW sirve la imagen vieja del cache y la nueva
no aparece hasta que expire (**hasta 90 días**).

Esto ya pasa hoy, pero mientras más sólido hacemos el cache, más se nota.

**Si se decide saltar esta fase:** dejarlo escrito en el PR y avisar al usuario
que cambiar una foto puede tardar en reflejarse. No es aceptable dejarlo sin
mencionar.

### Paso 4.2 — Editar el `getPublicUrl`

Buscar este bloque **exacto** (líneas 74-75 actuales):

```js
        const { data } = supabaseCloud.storage.from(BUCKET).getPublicUrl(path);
        return data?.publicUrl || null;
```

Reemplazar por:

```js
        const { data } = supabaseCloud.storage.from(BUCKET).getPublicUrl(path);
        if (!data?.publicUrl) return null;

        // OFFLINE-IMG (F4): la ruta es determinística y se sube con upsert, así
        // que cambiar la foto de un producto NO cambia la URL. El SW la sirve con
        // CacheFirst y mostraría la imagen vieja hasta que expire (90 días).
        // Un sello ?v= por subida hace que cada versión sea una clave de cache
        // distinta. Sigue matcheando el urlPattern de runtimeCaching y el regex
        // de isStorageImageUrl, que no anclan el final de la URL.
        const stamp = Date.now();
        const sep = data.publicUrl.includes('?') ? '&' : '?';
        return `${data.publicUrl}${sep}v=${stamp}`;
```

### Paso 4.3 — Verificar que las dos regex siguen matcheando

Comprobar a mano que la URL con `?v=` sigue pasando por:

1. `isStorageImageUrl` — [imageUpload.js:35](src/utils/imageUpload.js#L35):
   `/\/storage\/v1\/object\/public\/product-images\//` → no ancla el final. ✅
2. El `urlPattern` de la Fase 1 —
   `/\/storage\/v1\/object\/public\/product-images\/.*/i` → `.*` absorbe la query. ✅

```bash
node -e "const u='https://x.supabase.co/storage/v1/object/public/product-images/dev/abc.webp?v=1';console.log('isStorageImageUrl:',/\/storage\/v1\/object\/public\/product-images\//.test(u));console.log('urlPattern:',/\/storage\/v1\/object\/public\/product-images\/.*/i.test(u));"
```

**Esperado:** ambas `true`.

### Paso 4.4 — Verificar

```bash
npm run lint
npm test
```

**✅ Checkpoint 4:** ambas regex dan `true`, lint limpio, suite igual al baseline.

**↩️ Rollback:** `git checkout src/utils/imageUpload.js`

---

## FASE 5 — Verificación end-to-end offline

> ⚠️ **Obligatorio hacerlo sobre `npm run preview`, NO sobre `npm run dev`.**
> En dev el service worker no aplica las reglas de `runtimeCaching` del build.

### Paso 5.1 — Build y preview

```bash
npm run build
npm run preview
```

Abrir la URL que imprime (típicamente `http://localhost:4173`).

### Paso 5.2 — Confirmar que el SW tomó control

DevTools → **Application → Service Workers**: debe decir **activated and running**.
Si dice *waiting*, recargar una vez.

### Paso 5.3 — Cargar productos con las tres clases de imagen

Importar `backup_juancho_productos.json` (70/70 con rutas `/images/catalog/`) —
es el caso que hoy está roto y el que hay que probar sí o sí.

Entrar a la pestaña de **Inventario** y hacer scroll hasta que se hayan visto
varios productos.

### Paso 5.4 — Esperar el precalentado

El hook tiene un debounce de **5 s**
([useImagePrecache.js:22](src/hooks/useImagePrecache.js#L22)) y va en lotes de 4.
**Esperar ~30 s** con la app abierta y online.

### Paso 5.5 — Confirmar los caches poblados

DevTools → **Application → Cache Storage**. Debe existir:

- `catalog-images-cache` → con entradas `/images/catalog/*.webp` ← **la prueba clave**
- `product-images-cache` → con entradas de Storage (si el inventario tiene URLs)

> ❌ Si `catalog-images-cache` no existe o está vacío: revisar Fase 1 (regex) y
> Fase 3 (filtro). No seguir al paso 5.6 — daría un falso negativo.

### Paso 5.6 — La prueba real: offline

1. DevTools → **Network → Throttling → Offline**.
2. Recargar la página (`Ctrl+R`).
3. Navegar a **Inventario** y a **Caja/Ventas**.

**Criterio de aceptación:**

- ✅ La app abre sin internet (ya funcionaba, vía `navigateFallback`).
- ✅ Los productos con `/images/catalog/*.webp` **muestran su imagen** ← lo que arregla este plan.
- ✅ Los productos con URL de Storage muestran su imagen.
- ✅ Los productos con base64 muestran su imagen.
- ✅ Los productos sin imagen muestran el ícono de fallback, no un `<img>` roto.

### Paso 5.7 — Probar que sobrevive cerrar la app

Seguir offline. Cerrar la pestaña por completo, volver a abrir la URL.
Las imágenes deben seguir viéndose (el cache es persistente, y
[main.jsx:26](src/main.jsx#L26) ya pide `navigator.storage.persist()`).

### Paso 5.8 — Probar el cambio de foto (solo si se hizo la Fase 4)

Volver **online**. Editar un producto y cambiarle la imagen. Guardar.
La imagen nueva debe aparecer **de inmediato**, no la vieja.

**✅ Checkpoint 5:** los 5 criterios del paso 5.6 en verde.

---

## 6. Cierre

### Paso 6.1 — Confirmar que no hay regresión

```bash
npm run lint
npm test
npm run build
```

Suite igual al baseline del Paso 0.2.

### Paso 6.2 — Commit

```bash
git add vite.config.js src/hooks/useImagePrecache.js src/utils/imageUpload.js PLAN-OFFLINE-IMAGENES-PWA.md
git commit -m "fix(offline): cachear imagenes del catalogo local para que se vean sin internet en PWA

Las rutas /images/catalog/*.webp (70 de 70 productos en el backup de juancho)
no se cacheaban: el globPatterns por defecto de vite-plugin-pwa no incluye
.webp, no habia regla de runtimeCaching que las capturara, y useImagePrecache
las descartaba con el filtro /^https?:/.

- vite.config.js: regla CacheFirst catalog-images-cache para /images/catalog/
- vite.config.js: product-images-cache maxEntries 500 -> 1200
- useImagePrecache: precalentar tambien rutas locales; fetch CORS con fallback
  a no-cors para no inflar la cuota con respuestas opacas
- imageUpload: sello ?v= por subida para que cambiar la foto de un producto
  no quede servido desde CacheFirst con la imagen vieja"
```

### Paso 6.3 — Nota para el despliegue

El SW nuevo se activa solo (`registerType: 'autoUpdate'` + `skipWaiting`
[vite.config.js:19-23](vite.config.js#L19-L23)). Los equipos ya instalados
empiezan a poblar `catalog-images-cache` la primera vez que abran la app
**con internet** después del deploy. **Aviso al usuario:** un equipo que solo se
abra offline después del deploy todavía no tendrá las imágenes del catálogo —
necesita una sesión online de ~30 s para precalentar.

---

## 7. Lo que este plan NO arregla

Documentado a propósito para que nadie lo asuma resuelto:

1. **Electron** — sigue sin imágenes offline (`file://` no registra SW). Fuera de
   alcance por decisión del usuario.
2. **Primera carga siempre online** — una imagen que el equipo nunca descargó no
   puede aparecer de la nada. Se mitiga con el precalentado, no se elimina.
3. **Purga del navegador bajo presión de disco extrema** — `storage.persist()`
   reduce mucho el riesgo pero no lo elimina. La solución definitiva es
   IndexedDB + object URLs (ver §0.4).
4. **Techo de 700 imágenes de catálogo** — con más de 700 productos usando rutas
   locales, el LRU empieza a desalojar. Subir `maxEntries` si llega el caso.
