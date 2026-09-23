# Auditoría y plan de corrección — Animación de apertura (Splash)

**Fecha:** 2026-08-02
**Versión auditada:** v1.5.4 (commit `c38e548`)
**Alcance:** `src/remotion/StandaloneLogoAnimation.jsx`, `src/remotion/SplashScreenPlayer.jsx`, `src/remotion/LogoAnimation.jsx`, `src/remotion/Root.jsx`, montaje en `src/App.jsx:87-113` y `src/App.jsx:520-536`.

---

## 1. Cómo se hizo la auditoría

Medición real en Chromium vía CDP, no inspección teórica. Se inyectó un script de instrumentación antes del JS de la página que muestrea cada 120 ms el `getBoundingClientRect` y los estilos computados del `<h1>`, el `<p>` y el `<svg>` del overlay, más la cadencia real de `requestAnimationFrame`.

| Entorno | Detalle |
|---|---|
| Build de desarrollo | `npm run dev` (Vite 7.3.5), `http://localhost:5174` |
| Build de producción | `dist/` existente servido con `npm run preview`, `http://localhost:4173` |
| Viewports probados | 1440×900, 412×915, 390×844, 360×740, 320×568, 740×360 (landscape) |
| Condiciones extra | `prefers-color-scheme: dark`, `prefers-reduced-motion: reduce` |

Capturas de evidencia en `screenshots/splash_*.png`.

**Limitación declarada:** todas las mediciones de rendimiento se hicieron en CPU de escritorio sin throttling y sobre `localhost`. Los tiempos en un Android de gama baja con red móvil serán peores; los defectos de layout, en cambio, son independientes del hardware y se reproducen exactamente igual.

---

## 2. Resultados de las mediciones

### 2.1 Tiempo hasta que la app es usable (build de producción, 390×844, caché caliente)

| Hito | ms |
|---|---|
| `first-paint` | 740 |
| `first-contentful-paint` | 1224 |
| Overlay del splash visible | 845 |
| Overlay desmontado | 5762 |
| **Total pantalla bloqueada** | **≈ 5.9 s** |

En desarrollo con caché fría (1440×900) el overlay tardó **2581 ms** en montarse y el total fue **7.3 s**.

### 2.2 Layout del bloque de texto por viewport

`L` = número de líneas del `<h1>`; los saltos son desplazamientos verticales medidos del logo y del subtítulo durante la animación.

| Viewport | `h1` líneas (inicio → fin) | `p` líneas | Desborde del contenedor | Salto de layout |
|---|---|---|---|---|
| 1440×900 | 1 → 1 | 1 | no | ninguno |
| 412×915 | **2** → 1 | 1 | no | logo +12 px, subtítulo −32 px |
| 390×844 | **2** → 1 | 1 | no | logo +19 px, subtítulo −30 px |
| 360×740 | **2** → **2** | 2 → 1 | no | subtítulo −22 px |
| 320×568 | **2** → **2** | **2** → **2** | **sí — `scrollWidth` 304 > `clientWidth` 288** | logo −8 px |
| 740×360 | 1 → 1 | 1 | **sí — `scrollHeight` 370 > `clientHeight` 328** | logo fuera de pantalla |

### 2.3 Cadencia de fotogramas durante el splash (escritorio, sin throttling)

| Métrica | Valor |
|---|---|
| Intervalo mediano entre `rAF` | 16.7 ms (60 Hz) |
| p95 | 17.0 ms |
| Pico máximo | **383.7 ms** |
| Frames > 33 ms en la ventana del splash | 7 |

---

## 3. Hallazgos

### 🔴 Bloqueantes

#### B1 — La animación cuesta ~6 s de pantalla muerta y se muestra en *toda* apertura

`App.jsx:90-104` siempre devuelve `show: true`; lo único que varía es la duración (`full` 5 s / `express` 1.5 s). Eso significa que el splash aparece en cada F5, en cada relanzamiento de la PWA y en cada recarga tras una actualización del service worker.

Además el splash **no cubre el arranque, va después**: se monta dentro del árbol de React, así que el usuario ve primero blanco (740–2581 ms según caché), *luego* empieza la animación. El orden está invertido respecto a lo que un splash debe hacer.

**Impacto de negocio:** una bodega abre el POS decenas de veces al día. 6 s por apertura frente a un cliente en el mostrador es tiempo real perdido.

#### B2 — El título rompe en dos líneas y el layout salta a mitad de animación

Evidencia: `screenshots/splash_360_titulo_2lineas.png`, `screenshots/splash_320_desborde.png`.

`fontSize: 36` está fijo en píxeles y el `letterSpacing` se **anima** de `0.22em` a `0.14em` (`StandaloneLogoAnimation.jsx:74`). Es el propio tracking animado el que provoca el reflujo: en 390 px el `<h1>` mide 2 líneas hasta t≈2761 ms y pasa a 1 línea en t≈3243 ms, y en ese instante el SVG salta de `y=197` a `y=216`.

En 360 px —el ancho de Android más común en el parque de equipos de gama baja— el título **nunca** cabe en una línea: queda `PRECIOS AL` / `DÍA`, con "DÍA" huérfana.

En 320 px el contenedor desborda horizontalmente (`scrollWidth` 304 vs `clientWidth` 288) y `overflow: hidden` lo recorta.

#### B3 — En horizontal el logo se corta y el texto queda fuera de pantalla

Evidencia: `screenshots/splash_740x360_landscape_recortado.png`.

A 740×360 el SVG se renderiza con `y` entre **−18 y −30** (arranca por encima del borde superior), el contenedor recorta 42 px verticales y el subtítulo queda en `bottom: 398` sobre un viewport de 360 px de alto: no se ve nunca. La captura muestra la "D" cortada arriba y abajo.

Causa: el SVG tiene `width="320" height="320"` fijos y el bloque completo mide ~408 px de alto, sin ninguna consulta de altura disponible.

*Mitigación parcial:* el manifest declara `orientation: 'portrait'` (`vite.config.js:97`), así que la PWA instalada en Android no debería rotar. Pero sí ocurre en pestaña de navegador, en iOS Safari (que no honra el bloqueo de orientación) y en tablets o ventanas de escritorio bajas.

---

### 🟠 Altos

#### A1 — La lógica de "primera apertura del día" está corrida 4 horas en Venezuela

```js
// App.jsx:92
const today = new Date().toISOString().split('T')[0];  // ← UTC, no hora local
```

`toISOString()` devuelve UTC. Venezuela es UTC−4, así que el "día" cambia a las **20:00 hora local**.

Consecuencia concreta e invertida respecto al diseño: quien abre la app a las **21:00 recibe el splash largo de 5 s** (para el código es un día nuevo), y a la **mañana siguiente a las 7:00 recibe el express de 1.5 s** (para el código sigue siendo el mismo día UTC). La apertura de la mañana —la que se quería celebrar— es justo la que se degrada.

Hay otros 4 usos de `toISOString().split('T')[0]` en `src/` que conviene revisar con el mismo criterio, fuera del alcance de este plan.

#### A2 — El splash es blanco puro aunque el usuario tenga tema oscuro

Evidencia: `screenshots/splash_390_tema_oscuro_blanco.png`, capturada con `prefers-color-scheme: dark` y `localStorage.theme = 'dark'`.

`backgroundColor` está fijo en `#FFFFFF` en el componente y el overlay usa `bg-white` en `App.jsx:524`. Resultado: ~6 s de pantalla blanca a brillo completo para quien usa tema oscuro, típicamente de noche. Encima `index.html:78` fija `theme-color: #1a1917` en oscuro, así que la barra de estado queda negra sobre pantalla blanca.

#### A3 — No respeta `prefers-reduced-motion`

Verificado: con `reduce` activo la animación corre **completa** (4890 ms medidos, opacidades y desenfoques animándose). El bloque de `src/styles/tokens.css:197-205` sólo neutraliza `animation` y `transition` de CSS; este splash es `requestAnimationFrame` + estilos inline, así que lo esquiva por completo.

#### A4 — El bucle de `requestAnimationFrame` nunca se detiene y `onComplete` se dispara en cada frame

```js
// StandaloneLogoAnimation.jsx:38-52
if (currentFrame >= DURATION_FRAMES) {
    if (loop) { /* ... */ }
    else {
        currentFrame = DURATION_FRAMES;
        if (onComplete) onComplete();   // ← se llama en CADA frame posterior
    }
}
setFrame(currentFrame);
animRef.current = requestAnimationFrame(animate);  // ← se reencola sin condición
```

Al terminar con `loop=false` sigue encolando `rAF` y llamando `onComplete` ~60 veces por segundo hasta que React desmonta el componente.

Agravante: el `useEffect` declara `[loop, onComplete, DURATION_FRAMES]` como dependencias y `onComplete` es una arrow inline en `App.jsx:531`, recreada en cada render de `App`. Cada render del árbol raíz cancela y reinicia el bucle de animación.

---

### 🟡 Medios

#### M1 — La animación corre a 30 fps forzados sobre pantallas de 60/120 Hz

`Math.floor(elapsedSeconds * FPS)` con `FPS = 30` (`StandaloneLogoAnimation.jsx:33, 37`) cuantiza el fotograma. La pantalla refresca cada 16.7 ms (medido) pero el valor sólo cambia cada 33 ms: se ven escalones en el tracking del título y en el pulso final. Encima se llama `setFrame` en cada `rAF` (60–120 veces/s) aunque el valor no cambie.

El docblock de `SplashScreenPlayer.jsx:8` afirma "a 60 FPS"; es incorrecto.

#### M2 — Coste de pintado alto: `blur()` animado sobre texto y `drop-shadow` sobre el SVG

Cada fotograma re-rasteriza el `<h1>` con desenfoque de hasta 8 px (`filter: blur(${titleBlur}px)`) y el contenedor del SVG con `drop-shadow`. Sin `will-change` ni promoción a capa. En el equipo de prueba (escritorio) ya se midieron 7 fotogramas por encima de 33 ms y un pico de 383 ms dentro de la ventana del splash; en gama baja este es el primer candidato a tirones visibles.

#### M3 — Beat muerto en el revelado de la "D"

La longitud real del path de la máscara es **1246** (medida con `getTotalLength()`), pero se usan `strokeDasharray="1400"` y un `strokeDashoffset` que va de 1400 a 0. El trazo queda completo en cuanto el offset baja de 154, lo que con `easeOutCubic` ocurre al **52 %** del tramo asignado: la "D" termina de dibujarse hacia el fotograma 12 de 24 y quedan ~0.4 s en los que no pasa absolutamente nada antes de que entren las barras.

#### M4 — IDs de SVG hardcodeados

`cleanTeal` y `cleanDMask` están fijos en ambos componentes. Si dos instancias coexisten en el DOM (el splash y la previsualización del Panel Dev, `App.jsx:538-550`), los IDs colisionan y una máscara pisa a la otra. Hoy no se reproduce porque no coinciden en pantalla, pero es una bomba latente.

#### M5 — Sin salida, sin afordancia de salto y sin accesibilidad de teclado

El overlay entra con `animate-in fade-in` pero desaparece de golpe al desmontarse: corte seco. El "Toca para saltar" vive sólo en el atributo `title` (`App.jsx:526`), invisible en móvil. No hay manejador de `Escape`, ni `role`, ni `aria-label`, ni foco: con teclado no hay forma de saltarlo.

#### M6 — `npm run remotion:render` está roto

El script apunta a `PreciosAlDíaLogoIntro` (con tilde) y la composición registrada en `Root.jsx:11` es `PreciosAlDiaLogoIntro` (sin tilde). Verificado byte a byte: no coinciden, el render falla por composición inexistente.

---

### 🔵 Deuda técnica

- **D1 — `LogoAnimation.jsx` y `StandaloneLogoAnimation.jsx` están duplicados y ya divergieron.** El SVG y el bloque de textos son ~150 líneas idénticas, pero las curvas no: la versión Remotion usa `interpolate` lineal y la standalone usa `easeOutCubic`/`easeOutQuart`, y sólo la standalone tiene modo express. El vídeo que se renderice no será lo que ve el usuario.
- **D2 — Efecto secundario dentro del inicializador de `useState`.** `App.jsx:90-104` escribe en `localStorage` durante el render. Con `StrictMode` (activo en `main.jsx:104`) el inicializador se ejecuta dos veces en desarrollo, con lo que la primera apertura del día se degrada a express al probar en local. En producción no afecta, pero es un patrón inseguro.
- **D3 — Props muertas.** `autoPlay` en `App.jsx:547` no existe en `SplashScreenPlayer`; `accentColor` en `Root.jsx:19` no existe en `LogoAnimation`.
- **D4 — `rounded-3xl` y `shadow-inner` en un overlay a pantalla completa** (`SplashScreenPlayer.jsx:15` y `StandaloneLogoAnimation.jsx:110`). Sobre fondo blanco no se percibe, pero deja de tener sentido y añade una capa de compositing gratuita.
- **D5 — La fuente `Outfit` no está precargada.** Llega por `<link>` de Google Fonts con `display=swap`. En la primera visita con red lenta el título puede pintarse con la fuente de sistema y saltar a Outfit a mitad de animación. En las pruebas `document.fonts.status` ya era `loaded`, pero era `localhost`.

---

## 4. Plan de corrección

Cuatro fases, ordenadas por relación impacto/riesgo. Cada fase es entregable y verificable por separado.

### Fase 1 — Recuperar el tiempo de arranque `[B1, A1, D2]`

Es la fase con más impacto de negocio y la que hay que decidir primero, porque cambia el contrato de las demás.

**1.1 — Mover el splash fuera del árbol de React, a `index.html`.**
Insertar el marcado del logo (SVG inline + textos) directamente en el `<body>` de `index.html`, animado con CSS puro y `@keyframes`. Se pinta en el *first paint* (740 ms → prácticamente 0 respecto al bundle) y cubre el hueco blanco en lugar de ir después. `main.jsx` lo retira al montar React, con un `fade-out` de 250 ms.
Beneficio medido esperado: los 845 ms de blanco inicial desaparecen y el splash deja de ser aditivo al arranque.

**1.2 — Recortar la duración y hacerla condicional al arranque real.**
Propuesta: mantener el remate largo sólo cuando de verdad aporta, y en el resto de aperturas terminar en cuanto la app está lista.
- Primera apertura del día: **2.5 s** máximo (hoy 5 s).
- Aperturas posteriores: se retira **en cuanto React monta**, con un mínimo de 400 ms para evitar parpadeo (hoy 1.5 s fijos).
- Techo duro de seguridad: 3 s, por si el arranque se atasca.

**1.3 — Corregir la clave de fecha a hora local.**
```js
const today = new Date().toLocaleDateString('sv-SE'); // 'YYYY-MM-DD' en hora local
```
Extraerlo a un helper `getLocalDateKey()` en `src/utils/` y reutilizarlo. Revisar por separado los otros 4 usos de `toISOString().split('T')[0]`.

**1.4 — Sacar la escritura de `localStorage` del inicializador de `useState`** y llevarla a un `useEffect` con `[]`, resolviendo D2.

> **Decisión pendiente del dueño del producto.** El punto 1.2 reduce la exposición de marca. Si se prefiere conservar los 5 s completos, el resto del plan sigue siendo válido, pero B1 permanece abierto: la app seguirá tardando ~6 s en ser usable en cada apertura diaria.

### Fase 2 — Arreglar el layout responsive `[B2, B3, A2, A3, M5]`

**2.1 — Tipografía fluida y sin reflujo.**
- `font-size: clamp(20px, 7.2vw, 36px)` en el `<h1>` y `clamp(9px, 2.8vw, 13px)` en el `<p>`.
- `white-space: nowrap` en ambos, para que el tracking animado no pueda provocar reflujo nunca.
- Alternativa si se quiere conservar el tamaño en 360 px: fijar el `letterSpacing` final desde el primer fotograma y animar sólo opacidad, desplazamiento y escala. Elimina la causa raíz de B2 sin tocar el tamaño.

**2.2 — SVG responsive.**
Sustituir `width="320" height="320"` por `width="100%"` con `max-width: min(320px, 62vw)` y `max-height: 45vh`, manteniendo el `viewBox`.

**2.3 — Soporte de landscape y alturas cortas.**
Añadir un `@media (max-height: 480px)` que pase el bloque a disposición horizontal (logo a la izquierda, textos a la derecha) y reduzca el logo a `36vh`. Resuelve B3 tanto en la PWA como en navegador e iOS.

**2.4 — Respetar el tema.**
Leer el tema ya resuelto por el script anti-FOUC de `index.html` y usar fondo `#1a1917` con el subtítulo en `#94a3b8` cuando esté en oscuro. El logo teal funciona sobre ambos fondos sin cambios.

**2.5 — Respetar `prefers-reduced-motion`.**
Con `reduce` activo: renderizar el estado final (logo completo, textos a opacidad 1, sin desenfoque ni pulso) y retirarlo tras 600 ms.

**2.6 — Entrada y salida, afordancia y accesibilidad.**
- `fade-out` de 250 ms al desmontar, en lugar del corte seco.
- Texto visible «Toca para saltar» que aparece a los 800 ms, con opacidad baja.
- `role="status"`, `aria-label="Cargando Precios Al Día"`, manejador de `Escape` y un `<button>` de salto enfocable.

### Fase 3 — Calidad de la animación y rendimiento `[M1, M2, M3, M4]`

**3.1 — Quitar la cuantización a 30 fps.** Usar `elapsedSeconds * FPS` sin `Math.floor`, de forma que la animación aproveche los 60/120 Hz reales. Corregir el docblock de `SplashScreenPlayer.jsx`.

**3.2 — Detener el bucle al terminar** (cierra también A4):
```js
if (currentFrame >= DURATION_FRAMES && !loop) {
    setFrame(DURATION_FRAMES);
    onCompleteRef.current?.();
    return;                       // no reencolar
}
```
y guardar `onComplete` en un `useRef` para sacarlo del array de dependencias del `useEffect`.

**3.3 — Reducir el coste de pintado.**
- Sustituir el `blur()` animado del título por `opacity` + `scale`, o congelarlo en 3 pasos discretos (8 → 4 → 0 px) en vez de recalcularlo cada fotograma.
- Añadir `will-change: transform, opacity` a los elementos animados y retirarlo al terminar.
- Reemplazar el `drop-shadow` animado del SVG por un `filter` estático aplicado a un contenedor que no se escale.

**3.4 — Ajustar el revelado de la "D".** Usar `pathLength="1"` en el path de la máscara con `strokeDasharray="1"` y `strokeDashoffset={1 - progreso}`. Elimina el número mágico 1400 y los ~0.4 s de beat muerto, y hace que el revelado termine exactamente cuando entran las barras.

**3.5 — IDs de SVG únicos por instancia** con `useId()` de React, resolviendo M4.

### Fase 4 — Limpieza `[D1, D3, D4, D5, M6]`

**4.1 — Extraer un componente compartido** `LogoMark.jsx` que reciba un objeto de progreso (`{ reveal, bar1, bar2, arrow, pulse }`) y sea consumido tanto por `LogoAnimation` (Remotion) como por `StandaloneLogoAnimation`. Elimina ~150 líneas duplicadas y garantiza que el vídeo renderizado coincida con lo que ve el usuario.

**4.2 — Corregir `remotion:render`** en `package.json` para que use `PreciosAlDiaLogoIntro`, o renombrar la composición en `Root.jsx`. Elegir una y dejar ambas consistentes.

**4.3 — Eliminar props muertas** (`autoPlay`, `accentColor`) y el `rounded-3xl` / `shadow-inner` del overlay a pantalla completa.

**4.4 — Precargar Outfit.** Añadir `<link rel="preload" as="font" crossorigin>` para el peso 900 de Outfit, o autoalojar ese único peso en `public/fonts/` para no depender de Google Fonts en el arranque —coherente con el enfoque offline-first del resto de la app.

---

## 5. Criterios de aceptación

Reproducibles con la misma instrumentación usada en esta auditoría.

| # | Criterio | Cómo se verifica |
|---|---|---|
| 1 | Cero blanco antes del splash | `first-paint` ≥ overlay visible |
| 2 | Tiempo total hasta app usable ≤ 2.8 s (primera del día) y ≤ 1.2 s (posteriores), en producción con caché caliente | muestreo de `__samples` |
| 3 | `h1.lines === 1` y `p.lines === 1` en **todos** los fotogramas, en 320/360/390/412 px | máximo de `lines` en el muestreo |
| 4 | `scrollWidth === clientWidth` y `scrollHeight === clientHeight` del contenedor en todos los viewports | muestreo del contenedor |
| 5 | En 740×360 el SVG tiene `y ≥ 0` y `p.bottom ≤ innerHeight` | muestreo de cajas |
| 6 | Ningún salto vertical > 4 px del SVG ni del subtítulo durante la animación | diferencia máxima entre muestras consecutivas |
| 7 | Con `prefers-reduced-motion: reduce`, duración ≤ 700 ms y sin opacidades animadas | `set media reduced-motion` |
| 8 | Con tema oscuro, el fondo del splash **no** es `#FFFFFF` | estilo computado |
| 9 | Cero fotogramas > 50 ms durante el splash en CPU throttled 4× | cadencia de `rAF` |
| 10 | `onComplete` se invoca exactamente una vez | contador instrumentado |
| 11 | `npm run remotion:render` completa sin error | ejecución |

---

## 6. Orden de ejecución sugerido

1. **Fase 1** — decidir primero el punto 1.2 (duración), porque condiciona el resto.
2. **Fase 2** — es la que arregla lo que el usuario final realmente ve mal hoy en su teléfono.
3. **Fase 3** — pulido, sin riesgo funcional.
4. **Fase 4** — limpieza, se puede hacer en cualquier momento.

Fases 1 y 2 son independientes entre sí y podrían ir en paralelo si se toca `index.html` (Fase 1) y el componente React (Fase 2) por separado; conviene, eso sí, unificarlas antes de publicar para no mantener dos implementaciones del mismo logo durante el trayecto.
