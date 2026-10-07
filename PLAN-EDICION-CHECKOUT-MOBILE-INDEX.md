# PLAN DE EDICIÓN SEGURA — `CheckoutModalPOS/index.jsx`

**Proyecto:** `preciosaldia-bodega`  
**Fecha:** 2026-08-11  
**Estado:** Plan de trabajo; no ejecutar cambios adicionales hasta aprobar la estrategia  
**Archivo central:** `src/components/Sales/CheckoutModalPOS/index.jsx`  
**Objetivo:** implementar la UX móvil por incrementos pequeños, sin convertir `index.jsx` en un componente monolítico ni romper el cobro.

---

## 1. Situación actual

`index.jsx` concentra actualmente:

- normalización de métodos de pago;
- estado del checkout;
- selección de cliente;
- Cashea;
- cálculos derivados del pago;
- distribución del vuelto;
- validaciones previas a procesar;
- construcción de pagos;
- render del layout POS;
- conexión con `PaymentLeftColumn`, `PaymentInputs`, `WalletSection` y `PaymentFooter`.

El diff actual frente a `HEAD` es aproximadamente:

```text
176 líneas agregadas
70 líneas eliminadas
```

Ese número incluye cambios financieros y de cartera realizados anteriormente en esta rama. Por eso, el rediseño móvil no debe volver a reescribir el archivo completo.

### Restricción crítica

No modificar en la primera etapa:

- `procesarPago`;
- `handleVueltoDistChange`;
- `handleCreditChange`;
- `handleTipAmountChange`;
- `usePaymentCalculations`;
- reglas de `changeAllocation`;
- validaciones de Crédito;
- contratos de `onConfirmSale`;
- cálculos de saldo a favor;
- persistencia de ventas o cartera.

La primera entrega debe ser principalmente de composición visual y responsive.

---

## 2. Diagnóstico del bloqueo

El riesgo de editar este archivo directamente es alto porque una modificación en JSX puede dejar desbalanceados:

- fragmentos;
- `div` anidados;
- expresiones `{...}`;
- props largas de componentes;
- cierres de `PaymentFooter`;
- orden de las columnas;
- condiciones de render del vuelto.

Además, `index.jsx` contiene lógica financiera junto con JSX. Una edición grande dificulta saber si un error pertenece a:

1. sintaxis JSX;
2. estado React;
3. cálculo financiero;
4. responsive CSS;
5. integración entre componentes.

### Decisión recomendada

Trabajar por **checkpoints compilables**, con una sola zona del archivo modificada por etapa.

```text
Checkpoint → typecheck → build → revisión del diff
```

No continuar a la siguiente etapa si una etapa anterior no compila.

---

## 3. Objetivo de arquitectura para `index.jsx`

`index.jsx` debe actuar como orquestador, no como pantalla completa.

Debe conservar estas responsabilidades:

```text
Estado financiero
Cálculos derivados
Callbacks de pago
Composición de subcomponentes
```

Debe evitar asumir estas responsabilidades:

```text
Markup detallado de cada método de pago
Markup detallado del cliente
Markup detallado de distribución de vuelto
Lógica de persistencia
Reglas duplicadas de cartera
```

Los componentes existentes deben seguir siendo las unidades de presentación:

```text
PaymentHeader
PaymentLeftColumn
PaymentInputs
WalletSection
PaymentFooter
CheckoutCustomerPicker
```

Si el JSX móvil crece demasiado, se debe extraer un componente nuevo antes de seguir agregando condiciones dentro de `index.jsx`.

---

## 4. Alcance de la primera implementación

### Incluido

1. Modal full-screen en teléfonos.
2. Header compacto y botón de cierre táctil.
3. Orden móvil:

```text
Cliente → método de pago → estado/vuelto → confirmar
```

4. Cliente visible antes de capturar el pago en móvil.
5. Tabs de moneda en móvil.
6. Footer móvil separado del footer de escritorio.
7. Distribución avanzada del vuelto colapsable.
8. Targets táctiles mínimos de 44 px.
9. Reutilización de todos los cálculos existentes.

### No incluido en la primera implementación

- migrar lógica a un nuevo hook;
- cambiar la persistencia de ventas;
- modificar el ledger;
- rediseñar reportes;
- cambiar tickets;
- cambiar reglas de saldo a favor;
- cambiar reglas de caja;
- crear un wizard obligatorio;
- reescribir `PaymentLeftColumn` completo;
- reescribir `CheckoutModalPOS/index.jsx` completo.

---

## 5. Mapa de edición por zonas

### Zona A — Importaciones

Cambios permitidos:

- importar un componente móvil si realmente se crea;
- reutilizar componentes ya existentes.

Regla:

> No agregar librerías nuevas ni duplicar iconos. `lucide-react` ya es la convención del proyecto.

### Zona B — Estado de presentación

Agregar únicamente estados visuales:

```js
mobilePaymentCurrency
showMobileChangeDetails
```

Estos estados:

- no representan dinero;
- no se envían al procesador;
- no se guardan en storage;
- no deben cambiar cálculos.

### Zona C — Cálculos derivados

No agregar lógica financiera en esta fase.

Si la UI necesita un valor visual, debe reutilizar los valores ya calculados:

```js
faltaPorPagar
cambioUSD
changeAllocationComplete
remainingChangeUsd
remainingChangeBs
```

No crear una segunda fórmula de vuelto dentro del JSX.

### Zona D — Render principal

Esta es la zona prioritaria de edición.

Orden móvil recomendado:

```text
PaymentHeader
PaymentInputs / WalletSection
PaymentLeftColumn
PaymentFooter móvil
```

Orden escritorio recomendado:

```text
PaymentHeader
PaymentLeftColumn | PaymentInputs + PaymentFooter
```

El orden debe lograrse con `order-*` y wrappers simples, no duplicando los cálculos ni renderizando dos checkouts completos.

### Zona E — Footer

Mantener un footer de escritorio y uno móvil únicamente si sus posiciones necesitan ser diferentes.

El footer móvil debe:

- ocupar todo el ancho;
- estar al final o sticky según el contenedor de scroll;
- reutilizar el mismo `PaymentFooter`;
- recibir exactamente los mismos props;
- no tener una segunda lógica de `disabled`.

---

## 6. Plan de ejecución por checkpoints

### Checkpoint 0 — Congelar baseline

Antes de editar:

1. Revisar `git status`.
2. Identificar archivos modificados antes de esta tarea.
3. No hacer `git restore`, `reset`, `stash` ni checkout global.
4. Ejecutar:

```text
bun run typecheck
bun run test -- tests/checkout.test.js
bun run build
```

5. Registrar el tamaño actual del diff de `index.jsx`.
6. Confirmar que `index.jsx` termina con una estructura JSX balanceada.

Criterio de salida:

- baseline compilable;
- cambios previos identificados;
- ningún archivo ajeno sobrescrito.

### Checkpoint 1 — Shell móvil

Modificar solamente el wrapper del modal:

- `w-full` en móvil;
- `sm:w-[96vw]` o equivalente;
- `rounded-none` en teléfono;
- `max-h-[100dvh]` en móvil;
- `sm:max-h-[96vh]` en pantallas mayores;
- `p-0 sm:p-4` en el overlay.

No tocar estados ni cálculos.

Validar:

```text
bun run typecheck
bun run build
```

Revisión manual:

- modal ocupa la pantalla sin bordes innecesarios;
- desktop conserva su tamaño.

### Checkpoint 2 — Header y CTA

Modificar únicamente:

- `PaymentHeader.jsx` para targets y spacing móvil;
- `PaymentFooter.jsx` para ancho, altura y safe area;
- wrappers de footer en `index.jsx`.

No mover todavía `PaymentLeftColumn`.

Validar:

- botón cerrar accesible;
- CTA visible;
- no se duplica el procesamiento;
- el footer usa el mismo callback.

### Checkpoint 3 — Orden móvil

Modificar solo el layout del body:

```jsx
<div className="flex flex-col lg:flex-row ...">
```

Usar:

```text
PaymentLeftColumn: order-2 lg:order-1
columna de pago: order-1 lg:order-2
```

Si se necesita mostrar el cliente antes del pago, renderizar una instancia móvil del selector y ocultar la instancia de escritorio mediante clases responsive. Ambas deben usar:

```js
handleSetCliente
```

No duplicar estado de cliente.

Validar:

- el cliente no queda seleccionado dos veces;
- cambiar cliente reinicia el estado dependiente;
- desktop conserva sus dos columnas.

### Checkpoint 4 — Monedas móviles

La selección de moneda debe estar en `PaymentInputs.jsx` o `CheckoutPaymentBars.jsx` preferentemente.

Si el estado debe vivir en `index.jsx`, solo debe ser:

```js
mobilePaymentCurrency: 'USD' | 'BS' | 'COP'
```

Reglas:

- cambiar tab no borra valores;
- métodos ocultos siguen incluidos en los cálculos;
- saldo interno no aparece como moneda física;
- si USD no está disponible, seleccionar la primera moneda disponible;
- la versión desktop continúa mostrando sus grupos completos.

Validar:

- pago en USD;
- pago en Bs;
- pago combinado;
- cambio de tab sin pérdida de datos.

### Checkpoint 5 — Vuelto progresivo

Modificar solo la presentación de `PaymentLeftColumn`:

Vista inicial:

```text
Vuelto total
[Entregar todo]
[Dejar en caja]
[Acreditar a billetera]
[Personalizar distribución]
```

Vista avanzada:

```text
Cambio físico USD
Cambio físico Bs
Saldo a favor
Queda en caja
Resumen
```

El estado visual puede ser:

```js
showMobileChangeDetails
```

Reglas:

- ocultar campos avanzados, no eliminarlos;
- conservar valores al cerrar el panel;
- no cambiar `changeUsdGiven` ni `changeBsGiven` desde un efecto de presentación;
- no acreditar automáticamente;
- no alterar `changeAllocationComplete`.

### Checkpoint 6 — Accesibilidad móvil

Revisar en los componentes, no agregar lógica financiera:

- `min-h-[44px]` en botones;
- `aria-expanded` en panel avanzado;
- `aria-selected` en tabs;
- `role="tablist"` y `role="tab"`;
- foco visible;
- textos no truncados;
- estados de bloqueo explicados con texto.

### Checkpoint 7 — Pruebas y cierre

Ejecutar:

```text
bun run typecheck
bun run test
bun run build
git diff --check
```

Probar manualmente:

- pago exacto;
- pago con vuelto;
- vuelto todo físico;
- USD + Bs;
- USD + billetera;
- caja parcial;
- saldo a favor;
- fiado;
- Cashea;
- cambio de cliente;
- orientación vertical;
- teclado móvil.

---

## 7. Reglas de edición para no volver a trabarse

### Regla R1 — No reemplazar bloques gigantes

No usar reemplazos desde `return (` hasta el final del archivo.

Editar una sección delimitada por un bloque pequeño:

```text
un import;
un estado;
un wrapper;
un componente;
un cierre.
```

### Regla R2 — Una modificación por archivo y checkpoint

En cada checkpoint:

- editar `index.jsx` y como máximo un subcomponente relacionado;
- compilar;
- revisar diff;
- continuar solo si pasa.

### Regla R3 — No usar comentarios para “guardar” JSX

No envolver JSX en comentarios multilínea como mecanismo temporal:

```js
/* <div>...</div> */
```

Esto puede romperse con comentarios JSX internos y dejar errores difíciles de diagnosticar.

Si una sección debe ocultarse, usar:

```jsx
{condition && <Component />}
```

o clases responsive.

### Regla R4 — No corregir con reescritura total

Si aparece un error de JSX:

1. detener la edición;
2. leer las últimas 40 líneas;
3. contar apertura/cierre del bloque modificado;
4. ejecutar Prettier como parser;
5. reparar solo el cierre afectado.

### Regla R5 — Separar errores de sintaxis y errores de negocio

Primero resolver:

```text
JSX válido
Typecheck
Build
```

Después revisar:

```text
interacción
cálculo
persistencia
```

### Regla R6 — No tocar archivos modificados por otras tareas

Los cambios de cartera, reportes, tickets y finanzas ya existentes deben considerarse fuera del alcance de este rediseño.

---

## 8. Estrategia de rollback

El rollback debe ser por checkpoint, no global.

Antes de cada etapa registrar:

```text
git diff -- src/components/Sales/CheckoutModalPOS/index.jsx
```

Si la etapa falla:

1. identificar el último bloque editado;
2. revertir únicamente ese bloque con `str_replace`;
3. volver a ejecutar typecheck/build;
4. no tocar los cambios financieros previos.

No usar:

```text
git restore .
git reset --hard
git checkout -- .
```

porque destruiría trabajo previo no relacionado.

---

## 9. Criterios de aceptación del archivo

`index.jsx` se considera listo cuando:

1. Compila y pasa typecheck.
2. El render móvil no está duplicado completamente.
3. La lógica financiera permanece fuera del markup.
4. El checkout de escritorio conserva su comportamiento.
5. El selector de cliente no duplica mutaciones.
6. Las tabs móviles no eliminan pagos ocultos.
7. El footer móvil usa el mismo procesador.
8. La distribución avanzada del vuelto es progresiva.
9. No existen comentarios multilínea que contengan JSX.
10. El diff de cada etapa es pequeño y revisable.
11. Tests, build y `git diff --check` pasan.

---

## 10. Orden exacto recomendado

```text
1. Confirmar baseline compilable.
2. Corregir/confirmar el render base de index.jsx.
3. Shell responsive.
4. Header y footer.
5. Orden móvil de columnas.
6. Cliente móvil.
7. Tabs de moneda.
8. Vuelto progresivo.
9. Accesibilidad.
10. Pruebas completas.
```

**Decisión clave:** no volver a editar todo `index.jsx` en una sola operación. El archivo debe avanzar en checkpoints compilables y el markup móvil debe extraerse a componentes cuando supere un bloque pequeño y claramente delimitado.
