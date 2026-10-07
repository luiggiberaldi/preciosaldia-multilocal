# PLAN DE DISEÑO Y MEJORA UX — ZONA DE COBRO MÓVIL

**Proyecto:** `preciosaldia-bodega`  
**Fecha:** 2026-08-11  
**Estado:** Plan propuesto; pendiente de implementación y validación con cajeros  
**Prioridad:** Alta — afecta velocidad de cobro, errores operativos y uso diario en pantallas pequeñas  
**Alcance:** Checkout básico y experiencia móvil del POS  
**Restricción principal:** mejorar la presentación y el flujo sin cambiar las reglas financieras ya auditadas

---

## 1. Objetivo

Rediseñar la zona de cobro para teléfonos y tabletas de forma que el cajero pueda completar una venta rápidamente, sin que la pantalla se vea aglomerada y sin confundir:

- total de la venta;
- monto recibido;
- restante por pagar;
- vuelto;
- cambio físico en USD y Bs;
- saldo a favor;
- dinero dejado en caja;
- crédito o fiado;
- Cashea.

La experiencia móvil debe mostrar primero lo esencial y revelar los controles avanzados únicamente cuando sean necesarios.

---

## 2. Problemas observados en la UI actual

| ID | Problema | Impacto |
|---|---|---|
| MOB-001 | Cliente, métodos de pago, Cashea, vuelto y distribución aparecen juntos. | Sobrecarga visual y mayor tiempo de lectura. |
| MOB-002 | Existen áreas grandes vacías entre bloques. | El cajero debe desplazarse demasiado. |
| MOB-003 | Los métodos de pago ocupan demasiado espacio vertical. | Se pierde contexto del total y del estado del cobro. |
| MOB-004 | USD y Bs se muestran simultáneamente aunque normalmente se usa una moneda principal. | Mayor riesgo de ingresar el monto en el campo equivocado. |
| MOB-005 | La distribución avanzada del vuelto aparece antes de ser necesaria. | Los campos compiten con la acción principal. |
| MOB-006 | Los textos secundarios son demasiado pequeños en algunas resoluciones. | Baja legibilidad y errores de interpretación. |
| MOB-007 | El botón final está separado visualmente del estado del pago. | El cajero no siempre sabe por qué está bloqueado. |
| MOB-008 | Cashea ocupa espacio aunque no esté habilitado. | Ruido visual y desplazamiento innecesario. |
| MOB-009 | El resumen de vuelto puede mostrar demasiados conceptos al mismo tiempo. | Dificulta verificar la distribución. |
| MOB-010 | El checkout móvil se comporta como una versión reducida de escritorio. | No aprovecha patrones móviles como acordeones, tabs y bottom sheets. |

---

## 3. Principios de diseño

### P1 — Mostrar primero la decisión actual

En cada momento debe existir una acción principal clara:

```text
Ingresar pago → completar pago → decidir vuelto → confirmar venta
```

### P2 — Progresivo, no aglomerado

Los controles avanzados deben estar ocultos hasta que el cajero los solicite.

Ejemplo:

```text
Vuelto: $2,88

[Entregar todo]
[Personalizar cambio]
```

Los campos USD, Bs, billetera y caja aparecen al pulsar `Personalizar cambio`.

### P3 — Una moneda visible a la vez cuando sea posible

Los métodos de pago deben organizarse por pestañas o acordeones:

```text
[Dólares] [Bolívares] [COP / Otros]
```

La lógica seguirá aceptando combinaciones de monedas; solo se simplifica la presentación.

### P4 — El estado financiero siempre debe estar visible

Aunque se colapsen detalles, el cajero debe ver siempre:

- total;
- pagado;
- falta o vuelto;
- estado de distribución;
- razón por la que el botón está bloqueado.

### P5 — No cambiar la semántica financiera

El rediseño no debe modificar:

- cálculo de saldo a favor;
- cálculo de deuda;
- cálculo de vuelto;
- conversión USD/Bs;
- acreditación a billetera;
- dinero dejado en caja;
- registros del ledger;
- cierres y reportes.

### P6 — El botón debe confirmar una intención explícita

El saldo a favor solo se acredita después de pulsar `Acreditar` y confirmar la venta. Una cifra mostrada como sugerencia nunca debe persistirse por sí sola.

---

## 4. Flujo móvil objetivo

### 4.1 Estructura general

```text
Encabezado fijo
  ↓
Resumen compacto de la venta
  ↓
Cliente colapsable
  ↓
Método de pago activo
  ↓
Estado del pago
  ↓
Vuelto, solo cuando exista
  ↓
Botón de acción fijo
```

### 4.2 Estados principales

#### Estado A — Ingreso inicial

```text
Total: $7,12
Cliente: Consumidor Final
Método de pago: Dólares
Falta por pagar: $7,12
```

#### Estado B — Pago parcial

```text
Pagado: $5,00
Falta por pagar: $2,12

[Completar saldo]
[Registrar como fiado]
```

#### Estado C — Pago completo sin vuelto

```text
Pagado: $7,12
Pago completo

[Confirmar venta]
```

#### Estado D — Pago con vuelto

```text
Pagado: $10,00
Vuelto: $2,88

[Entregar todo]
[Personalizar cambio]
```

#### Estado E — Distribución personalizada

```text
Cambio físico: $1,00
Saldo a favor: $1,88
Queda en caja: $0,00

Distribución completa
[Confirmar venta]
```

#### Estado F — Fiado

```text
Pagado: $4,00
Restante: $3,12
Cliente seleccionado: Juan Pérez

[Confirmar fiado]
```

---

## 5. Diseño visual recomendado

### 5.1 Encabezado

Debe ser compacto y fijo:

```text
[ cerrar ]       COBRAR       Tasa: 724 Bs/$
```

Debajo o dentro del mismo bloque:

```text
TOTAL
$7,12                         Bs 5.154,88
```

Reglas:

- altura aproximada: 52–72 px;
- botón de cerrar mínimo de 44 × 44 px;
- total en tamaño mínimo de 22 px;
- tasa en texto secundario, no dominante;
- no repetir el total en múltiples lugares.

### 5.2 Resumen fijo de estado

Crear un componente visual compacto, por ejemplo:

```text
PaymentStatusSummary
```

Debe recibir:

```js
{
  totalUsd,
  totalBs,
  paidUsd,
  remainingUsd,
  changeUsd,
  status,
}
```

Estados visuales:

- `pending`: ámbar;
- `paid`: verde;
- `change`: verde destacado;
- `credit`: ámbar;
- `error`: rojo.

### 5.3 Cliente

Estado cerrado:

```text
Cliente
Consumidor Final                                  >
```

Estado abierto:

```text
Buscar cliente
[ nombre, teléfono o código             ]

Consumidor Final
Juan Pérez      Saldo a favor: $18,50
Ana López       Debe: $12,00

[Crear cliente]
```

Reglas:

- altura mínima de controles: 44 px;
- búsqueda con foco automático al abrir;
- mostrar solo información financiera relevante;
- reiniciar el pago interno al cambiar de cliente;
- no abrir automáticamente Cashea por seleccionar cliente.

### 5.4 Métodos de pago

Usar un selector horizontal desplazable o tabs:

```text
[Dólares] [Bolívares] [COP] [Saldo a favor]
```

La pestaña `Saldo a favor` solo debe aparecer cuando:

- hay cliente seleccionado;
- existe saldo utilizable;
- queda un monto pendiente;
- no se trata de un sobrepago.

Cada método debe usar una tarjeta compacta:

```text
Efectivo en dólares
[ 0,00                              $ ]

[1] [5] [10] [20] [50] [100]
[Completar saldo]
```

El método activo se expande; los demás quedan resumidos.

### 5.5 Cashea

Cashea debe vivir dentro de una sección secundaria:

```text
Más opciones                                      >
```

Solo mostrar Cashea si:

- está habilitado en configuración;
- la venta cumple el mínimo;
- el cliente está seleccionado.

Al activarlo:

```text
Cashea activado
Inicial: $X
Financiado: $Y
Nivel: X
```

No debe ocupar una tarjeta grande cuando está inactivo.

---

## 6. Rediseño específico del vuelto

### 6.1 Vista simple por defecto

Cuando existe vuelto, mostrar solamente:

```text
VUELTO
$2,88
Bs 2.085,12

[Entregar todo]
[Personalizar cambio]
```

La acción `Entregar todo` debe dejar el vuelto físico completo y marcar la distribución como completa.

### 6.2 Acciones alternativas

En una segunda fila o menú de acciones:

```text
[Dejar en caja]
[Acreditar a billetera]
```

Estas acciones deben respetar las condiciones actuales:

- billetera requiere cliente;
- caja puede ser total o parcial;
- acreditar no ocurre hasta pulsar el botón;
- la confirmación final debe incluir el monto.

### 6.3 Distribución avanzada

Al pulsar `Personalizar cambio`, abrir un panel expandible o bottom sheet:

```text
Personalizar cambio                         [cerrar]

Cambio físico en $
[ 1,00 ]                 Restante: $1,88
Equivalente restante: Bs 1.361,12

Cambio físico en Bs
[ 0 ]                   Restante: Bs 1.361,12
Equivalente restante: $1,88

[Todo $] [Todo Bs]

Saldo a favor
[ Acreditar $1,88 ]

Queda en caja
[ Configurar monto ]

Resumen
Físico: $1,00
Billetera: $0,00
Caja: $0,00
Pendiente: $1,88
```

### 6.4 Reglas de interacción

- Los montos USD y Bs representan el mismo vuelto, no dos montos sumables independientes.
- El monto máximo de una moneda debe descontar lo ingresado en la otra.
- `Todo $` completa el remanente disponible en USD.
- `Todo Bs` completa el remanente disponible en Bs.
- El restante debe aparecer en ambas monedas.
- Si se pulsa `Acreditar`, el bloque debe cambiar a `Saldo seleccionado para acreditar`.
- Si se pulsa `Dejar en caja`, mostrar el campo parcial y el botón `Todo`.
- Si queda dinero sin destino, el CTA debe mostrar `Asignar el vuelto` y permanecer bloqueado.

---

## 7. Botón de acción fijo

El botón debe permanecer fijo en la parte inferior, respetando `safe-area-inset-bottom`.

### Estados

```text
Faltan $2,12
```

```text
Selecciona un cliente
```

```text
Asignar el vuelto
```

```text
Confirmar venta
```

```text
Confirmar fiado
```

```text
Procesando...
```

Requisitos:

- altura mínima: 52 px;
- ancho completo con márgenes laterales de 12–16 px;
- texto e icono siempre visibles;
- mostrar la causa de bloqueo encima del botón;
- no utilizar únicamente color para comunicar el estado;
- evitar que el teclado virtual cubra el CTA.

---

## 8. Responsividad

### Breakpoints sugeridos

| Tamaño | Comportamiento |
|---|---|
| `< 640 px` | Flujo móvil completo, una columna, acordeones y bottom sheets. |
| `640–1023 px` | Una columna amplia, tarjetas compactas, posibilidad de dos campos de cambio. |
| `>= 1024 px` | Mantener layout POS de dos columnas si existe espacio suficiente. |

### Reglas móviles

- no usar dos columnas para contenido principal en teléfonos;
- evitar `min-height` excesivo que cree espacio vacío;
- utilizar `min-h-0` en contenedores flex con scroll;
- garantizar un único contenedor de scroll principal;
- evitar scroll horizontal accidental;
- usar `100dvh` cuando esté disponible;
- reservar espacio inferior para el CTA fijo;
- considerar orientación horizontal en tabletas, no en teléfonos.

### Teclado virtual

Al enfocar un monto:

- usar `inputMode="decimal"`;
- desplazar el campo a zona visible;
- mantener el resumen de estado visible si es posible;
- no ocultar el CTA detrás del teclado;
- permitir cerrar el teclado antes de confirmar.

---

## 9. Componentización recomendada

Revisar y, si conviene, extraer los siguientes componentes:

```text
src/components/Sales/MobileCheckout/
  MobileCheckoutShell.jsx
  MobileCheckoutHeader.jsx
  PaymentStatusSummary.jsx
  MobileCustomerSection.jsx
  MobilePaymentMethodTabs.jsx
  MobilePaymentMethodCard.jsx
  MobileAdvancedOptions.jsx
  MobileChangeSummary.jsx
  MobileChangeAllocationSheet.jsx
  MobileCheckoutFooter.jsx
```

Responsabilidades:

- `MobileCheckoutShell`: layout, scroll y safe areas.
- `MobileCheckoutHeader`: cerrar, título y tasa.
- `PaymentStatusSummary`: total, pagado, falta y vuelto.
- `MobileCustomerSection`: selección y búsqueda.
- `MobilePaymentMethodTabs`: navegación por moneda o grupo.
- `MobilePaymentMethodCard`: input, billetes y completar saldo.
- `MobileAdvancedOptions`: Cashea y opciones secundarias.
- `MobileChangeSummary`: vista simple del vuelto.
- `MobileChangeAllocationSheet`: distribución avanzada USD/Bs/caja/billetera.
- `MobileCheckoutFooter`: CTA y estado de validación.

La lógica financiera debe permanecer en hooks y servicios existentes. Estos componentes solo deben recibir estado y callbacks.

---

## 10. Estado de UI recomendado

Crear un estado de presentación separado del estado financiero:

```js
const [expandedSection, setExpandedSection] = useState('payment');
const [activePaymentCurrency, setActivePaymentCurrency] = useState('USD');
const [showAdvancedChange, setShowAdvancedChange] = useState(false);
const [showCustomerSearch, setShowCustomerSearch] = useState(false);
const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
```

Reglas:

- estos estados no deben modificar pagos ni saldos;
- cambiar de pestaña no debe borrar montos ingresados;
- cerrar un panel no debe cancelar una decisión ya confirmada;
- cambiar de cliente sí debe reiniciar saldo a favor aplicado y distribución asociada;
- cambiar el total debe invalidar configuraciones de vuelto incompatibles.

---

## 11. Accesibilidad y operación con tacto

### Objetivos mínimos

- área táctil mínima de 44 × 44 px;
- contraste WCAG AA para texto normal;
- foco visible en inputs y botones;
- labels asociados a todos los campos;
- `aria-expanded` en acordeones;
- `aria-live="polite"` para falta, vuelto y errores;
- no depender de emojis para comunicar estados;
- iconos acompañados por texto;
- orden de tabulación lógico;
- soporte para lectores de pantalla en el CTA.

### Microcopy

Usar textos directos:

| Evitar | Usar |
|---|---|
| `Resta` | `Falta por pagar` |
| `En caja` sin contexto | `Queda en caja` |
| `Billetera` ambiguo | `Saldo a favor del cliente` |
| `Total` en varios botones | `Completar saldo` |
| `Donar` | `Dejar cambio en caja` |
| `Asignar` sin detalle | `Asignar el vuelto` |

---

## 12. Reglas financieras que deben conservarse

El rediseño móvil debe reutilizar exactamente los cálculos existentes:

```text
Vuelto total = pago recibido - total de venta

Vuelto entregado USD
+ vuelto entregado Bs convertido a USD
+ saldo a favor acreditado
+ monto dejado en caja
= vuelto total
```

Validaciones obligatorias:

1. No permitir distribución mayor al vuelto real.
2. No permitir saldo a favor sin cliente.
3. No acreditar automáticamente por mostrar una sugerencia.
4. No convertir saldo a favor usado en efectivo.
5. No sumar saldo interno al cierre de caja.
6. No duplicar USD y Bs como si fueran dos vueltos.
7. Mantener las referencias de ticket, ledger y venta.
8. Confirmar la venta solo cuando no exista monto pendiente de asignar.

---

## 13. Fases de implementación

### Fase 0 — Baseline y prototipo

Tareas:

- capturar screenshots del checkout actual en teléfonos de 360, 390 y 430 px;
- probar tablet de 768 px;
- registrar alturas de teclado virtual;
- documentar estados: pendiente, completo, vuelto, fiado y Cashea;
- crear wireframe de baja fidelidad;
- confirmar con un cajero el flujo propuesto.

Criterio de salida:

- wireframe aprobado;
- lista de estados cubierta;
- sin cambios en lógica financiera.

### Fase 1 — Shell responsive

Tareas:

- crear o adaptar contenedor móvil de pantalla completa;
- eliminar espacio vertical innecesario;
- garantizar un único scroll principal;
- añadir header fijo y footer fijo;
- reservar safe area inferior;
- mantener la versión de escritorio sin regresiones.

Criterio de salida:

- no hay scroll horizontal;
- el CTA nunca queda fuera de pantalla;
- el teclado no oculta el campo activo ni el estado del pago.

### Fase 2 — Resumen y cliente

Tareas:

- crear resumen compacto de total/pagado/falta/vuelto;
- convertir cliente en sección colapsable;
- mejorar búsqueda y selección táctil;
- mostrar deuda o saldo a favor sin saturar la tarjeta;
- reiniciar correctamente estado al cambiar de cliente.

Criterio de salida:

- el cajero sabe cuánto debe cobrar sin desplazarse;
- seleccionar cliente requiere máximo dos interacciones.

### Fase 3 — Métodos de pago

Tareas:

- implementar tabs o acordeones por moneda;
- mostrar una tarjeta expandida a la vez;
- conservar montos de métodos no visibles;
- adaptar botones de billetes a pantallas estrechas;
- mostrar equivalencia de moneda solo cuando sea útil;
- ocultar métodos internos cuando no aplican.

Criterio de salida:

- no se muestran dos bloques grandes de monedas simultáneamente en teléfono;
- el usuario puede completar el monto en pocos toques.

### Fase 4 — Vuelto progresivo

Tareas:

- mostrar vista simple de vuelto por defecto;
- añadir `Entregar todo`;
- mover distribución avanzada a panel expandible o bottom sheet;
- mantener `Dejar en caja` y `Acreditar` como acciones explícitas;
- mostrar remanente USD/Bs en tiempo real;
- mostrar resumen de destinos compacto;
- bloquear CTA con mensaje claro si falta asignar.

Criterio de salida:

- un vuelto simple requiere una sola decisión;
- una distribución combinada se puede completar sin confusión;
- no existe doble conteo.

### Fase 5 — Cashea y opciones secundarias

Tareas:

- esconder Cashea dentro de `Más opciones` cuando no aplica;
- expandir solo después de activación;
- conservar validaciones existentes;
- no activar Cashea automáticamente por seleccionar cliente.

Criterio de salida:

- Cashea no ocupa espacio cuando no está disponible;
- el estado activo queda claramente visible.

### Fase 6 — Accesibilidad y pulido

Tareas:

- revisar tamaño de targets;
- revisar contraste;
- añadir estados de foco y aria;
- corregir textos truncados;
- revisar feedback de éxito, error y bloqueo;
- probar uso con una mano.

Criterio de salida:

- todos los controles principales son utilizables por tacto;
- ningún estado depende únicamente del color.

### Fase 7 — Pruebas y piloto

Tareas:

- ejecutar pruebas unitarias y de regresión;
- probar breakpoints reales;
- probar teclado Android y iOS si están disponibles;
- probar offline/PWA;
- realizar cobros con cajeros reales;
- medir tiempo hasta confirmar venta;
- recoger errores operativos.

Criterio de salida:

- suite completa, typecheck y build pasan;
- no hay errores de consola;
- dos cajeros pueden completar los flujos principales sin explicación adicional.

---

## 14. Matriz de pruebas UI/UX

### Layout

- [ ] Pantalla de 320 px de ancho.
- [ ] Pantalla de 360 px de ancho.
- [ ] Pantalla de 390 px de ancho.
- [ ] Pantalla de 430 px de ancho.
- [ ] Tablet de 768 px.
- [ ] Orientación vertical.
- [ ] Orientación horizontal en tablet.
- [ ] Safe area con dispositivo con notch.
- [ ] Scroll largo sin áreas vacías excesivas.
- [ ] Sin scroll horizontal.

### Pago

- [ ] Pago en USD.
- [ ] Pago en Bs.
- [ ] Pago combinado.
- [ ] Pago móvil.
- [ ] COP si está habilitado.
- [ ] Saldo a favor visible solo cuando aplica.
- [ ] Cashea oculto cuando no aplica.
- [ ] Cliente requerido para fiado.
- [ ] Teclado decimal correcto.
- [ ] Botón completar saldo.

### Vuelto

- [ ] Pago exacto sin mostrar panel de vuelto innecesario.
- [ ] Vuelto simple con `Entregar todo`.
- [ ] Vuelto con `Dejar en caja`.
- [ ] Vuelto parcial en caja.
- [ ] Vuelto físico en USD.
- [ ] Vuelto físico en Bs.
- [ ] Combinación USD + Bs.
- [ ] USD + Bs + billetera.
- [ ] USD + Bs + caja.
- [ ] Cambio no asignado bloquea confirmación.
- [ ] Acreditar requiere pulsación explícita.
- [ ] El resumen no duplica USD y Bs.

### Interacción

- [ ] Cambiar cliente reinicia estado dependiente.
- [ ] Cerrar y abrir acordeón conserva valores.
- [ ] Cambiar tab no borra montos.
- [ ] Volver con botón del dispositivo no pierde una venta sin aviso.
- [ ] Doble toque no duplica una operación.
- [ ] Loading visible al confirmar.
- [ ] Error de tasa visible y accionable.

### Accesibilidad

- [ ] Targets de al menos 44 px.
- [ ] Labels correctos.
- [ ] Foco visible.
- [ ] Contraste suficiente.
- [ ] Lectura de estado con lector de pantalla.
- [ ] No se depende solo de color.

### Regresión financiera

- [ ] Venta normal igual al flujo anterior.
- [ ] Venta fiada igual al flujo anterior.
- [ ] Saldo a favor igual al flujo anterior.
- [ ] Vuelto acreditado igual al flujo anterior.
- [ ] Caja y reportes sin diferencias.
- [ ] Ticket y ledger sin diferencias.

---

## 15. Métricas de éxito

Medir durante el piloto:

- tiempo desde abrir cobro hasta confirmar;
- cantidad de toques por venta;
- porcentaje de ventas corregidas antes de confirmar;
- errores por moneda ingresada;
- ventas bloqueadas por vuelto sin asignar;
- uso de `Personalizar cambio`;
- errores de cajero reportados;
- abandonos del checkout;
- diferencias detectadas en cierre.

Objetivos iniciales sugeridos:

```text
- Reducir el desplazamiento vertical percibido al menos 40%.
- Mantener el flujo simple en 3–5 interacciones principales.
- Cero doble conteo de USD/Bs.
- Cero acreditaciones automáticas no confirmadas.
- CTA visible en todo momento.
- Ningún error crítico nuevo en cierre o cartera.
```

---

## 16. Archivos candidatos a revisar

```text
src/components/Sales/CheckoutModal.jsx
src/components/Sales/CheckoutModalPOS/index.jsx
src/components/Sales/CheckoutModalPOS/components/PaymentLeftColumn.jsx
src/components/Sales/CheckoutModalPOS/components/PaymentInputs.jsx
src/components/Sales/CheckoutModalPOS/components/PaymentFooter.jsx
src/components/Sales/CheckoutModalPOS/components/WalletSection.jsx
src/components/Sales/CheckoutPaymentBars.jsx
src/components/Sales/CheckoutCustomerPicker.jsx
src/hooks/useCheckoutCalculations.js
src/components/Sales/CheckoutModalPOS/hooks/usePaymentCalculations.js
src/components/Sales/CheckoutModalPOS/hooks/usePaymentState.js
src/utils/checkoutProcessor.js
```

Nuevos componentes posibles:

```text
src/components/Sales/MobileCheckout/MobileCheckoutShell.jsx
src/components/Sales/MobileCheckout/PaymentStatusSummary.jsx
src/components/Sales/MobileCheckout/MobileChangeAllocationSheet.jsx
src/components/Sales/MobileCheckout/MobileCheckoutFooter.jsx
```

No se debe duplicar la lógica de cálculo financiero en estos componentes.

---

## 17. Orden recomendado

```text
1. Capturar baseline y wireframes.
2. Crear shell responsive sin cambiar cálculos.
3. Fijar header, resumen y CTA.
4. Colapsar cliente y opciones secundarias.
5. Organizar métodos de pago por tabs/acordeones.
6. Convertir el vuelto en flujo progresivo.
7. Implementar bottom sheet de distribución avanzada.
8. Revisar accesibilidad y teclado móvil.
9. Probar todos los estados financieros existentes.
10. Ejecutar piloto con cajeros.
```

**No comenzar modificando el procesador financiero.** El objetivo de esta fase es mejorar la presentación y las interacciones reutilizando los contratos existentes.

---

## 18. Criterios globales de aceptación

El rediseño móvil se considerará terminado cuando:

1. La pantalla no se vea como dos columnas comprimidas en teléfonos.
2. El cliente, Cashea y distribución avanzada puedan colapsarse.
3. Solo el método de pago necesario aparezca expandido.
4. Total, pagado, falta y vuelto estén siempre visibles.
5. El CTA permanezca visible y explique su estado.
6. La distribución avanzada aparezca solo cuando se solicite.
7. USD y Bs se puedan combinar sin doble conteo.
8. El saldo a favor solo se acredite después de pulsar el botón y confirmar.
9. El teclado virtual no bloquee inputs ni CTA.
10. Todos los controles principales sean cómodos para tacto.
11. La versión de escritorio no pierda su layout actual.
12. No cambien cartera, caja, reportes, tickets ni ledger.
13. Typecheck, suite completa y build pasen.
14. La prueba manual con cajeros confirme que el flujo es más rápido y entendible.

---

## 19. Decisión recomendada

Implementar un **checkout móvil progresivo de una columna**, con:

- encabezado compacto fijo;
- resumen permanente de estado;
- cliente colapsable;
- métodos de pago por tabs o acordeones;
- Cashea dentro de opciones secundarias;
- vuelto simple por defecto;
- distribución avanzada en panel expandible o bottom sheet;
- CTA fijo con estado explícito;
- reutilización total de la lógica financiera existente.

Esta solución reduce la saturación sin esconder información importante y permite que el cajero solo vea los controles necesarios para la decisión actual.
