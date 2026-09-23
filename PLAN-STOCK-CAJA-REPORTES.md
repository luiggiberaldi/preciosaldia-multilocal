# AUDITORÍA Y PLAN — STOCK POR LOTES, CAJA Y REPORTES

**Proyecto:** Precios al Día Bodega
**Alcance:** inventario, entradas/egresos por lotes, efectivo esperado, cierres, gastos, reportes y adaptación al Supervisor con una sola caja vinculada.
**Estado:** auditoría completada; este documento no activa mutaciones ni modifica la lógica operativa.

> **Alcance confirmado por el propietario:** todo lo descrito en este plan pertenece exclusivamente al **Modo Supervisor**. No se rediseñará ni se modificará la interfaz normal de ventas, inventario, gastos, caja o reportes del usuario principal. Cuando sea imprescindible que la caja principal reciba una orden remota, solo se añadirá un receptor protegido y aislado; no se cambiará el flujo local existente.

---

## 1. Resumen ejecutivo

### Alcance estricto

- Las nuevas pantallas, filtros, tarjetas, PDFs y acciones se implementan en `OwnerMonitorView` y servicios del Supervisor.
- La caja principal continúa funcionando exactamente igual para sus usuarios actuales.
- Los cálculos del Supervisor leerán los documentos sincronizados y no reemplazarán `FinancialEngine` ni los reportes normales.
- No se cambiará el menú, permisos ni flujo de la aplicación principal salvo el receptor técnico necesario para una orden remota autorizada.
- Las mutaciones remotas seguirán desactivadas hasta completar las pruebas.

---

La idea es viable y tiene mucho valor operativo, pero no debe implementarse como una colección de botones aislados. Hay que convertirla en un pequeño sistema de movimientos trazables:

1. **Movimiento de inventario:** ingreso o egreso, por unidades o cajas/bultos.
2. **Movimiento de caja:** entrada o salida de efectivo por moneda.
3. **Cierre de turno:** fotografía inmutable de ventas, gastos, cambios, efectivo esperado y efectivo declarado.
4. **Reportes:** vistas calculadas desde esos movimientos, no desde contadores de la interfaz.
5. **Supervisor:** primero lectura; después, y de forma controlada, envío de un ajuste de inventario por lote.

La aplicación ya tiene una parte importante construida en el Supervisor. El principal riesgo para este alcance no es visual: el Supervisor debe leer los datos con la misma semántica de la caja y, si en el futuro envía un ajuste, la caja debe recibirlo de forma aislada, idempotente y sin alterar los flujos locales actuales.

Los hallazgos del inventario y de caja que aparecen en este documento se tratan como **riesgos de interpretación del Supervisor**. No se corregirán mediante cambios generales en la aplicación principal dentro de este plan.

### Recomendación general

- **Sí añadir al Supervisor:** ingresos/egresos por lotes en lectura, efectivo esperado detallado, cierre PDF completo, reporte de productos vendidos y reporte de gastos mejorado.
- **Después añadir al Supervisor:** ingreso/egreso remoto por lote, con confirmación, idempotencia y permisos.
- **No tocar:** las pantallas y flujos normales de ventas, inventario, gastos, caja y reportes de la caja principal.
- **No añadir todavía:** FIFO automático, múltiples Supervisores, comandos de usuarios/PINs o edición remota libre del catálogo.

---

## 2. Qué existe actualmente

### 2.1 Stock por lotes

Ya existe `StockBatchModal.jsx` con:

- ingreso masivo;
- egreso masivo;
- selección de varios productos;
- unidades o bultos/cajas;
- configuración de unidades por bulto;
- vista previa antes de aplicar;
- motivo obligatorio para egresos.

Por tanto, esta función no se modificará dentro del flujo normal. El Supervisor debe consumir sus datos mediante un contrato de lectura y mostrar el movimiento de forma formal y trazable. Solo si se aprueba una mutación remota se añadirá un receptor aislado en la caja.

### 2.2 Efectivo esperado y cambios

Ya existe en el cierre de caja:

- apertura en USD, Bs y COP;
- pagos por método;
- vuelto entregado;
- propina/cambio dejado en caja;
- gastos y pagos a proveedores;
- avances de efectivo;
- efectivo esperado frente a efectivo declarado;
- diferencia por moneda;
- semáforo de cuadre.

La pantalla de la imagen ya representa correctamente la dirección que se busca: muestra efectivo esperado, cambios dejados en caja, ventas del turno, ganancia y gastos.

### 2.3 Cierres PDF

Ya existe:

- PDF detallado de cierre;
- impresión térmica;
- compartir reporte;
- descarga desde el cierre actual;
- descarga desde parte del historial.

### 2.4 Reporte de productos vendidos

Ya existen:

- total de ventas;
- productos más vendidos;
- cantidad de artículos;
- ingresos;
- historial de ventas;
- exportación general a PDF.

Falta un reporte dedicado, completo y filtrable de productos vendidos. Actualmente el “top de productos” no sustituye un reporte contable/inventariable completo.

### 2.5 Reporte de gastos

Ya existe una pestaña de gastos con:

- gastos internos;
- pagos a proveedores;
- categorías;
- búsqueda;
- filtro;
- total en USD/Bs/COP;
- historial del período.

Faltan separación más clara entre gasto que afecta caja, autoconsumo que afecta inventario y movimientos anulados, además de una descarga PDF específica.

---

## 3. Hallazgos y riesgos encontrados

### 3.1 🔴 Ajustes de stock pueden competir con una venta

El ajuste actual lee y vuelve a escribir `bodega_sales_v1` sin utilizar siempre `withLock`. Una venta confirmándose al mismo tiempo puede desaparecer del historial por una escritura posterior desde un arreglo viejo.

**Acción obligatoria:** todas las operaciones que cambien stock o historial deben usar un único lock, releer datos frescos y escribir una sola vez.

### 3.2 🔴 El egreso masivo puede pedir más stock del disponible

La interfaz permite solicitar, por ejemplo, 100 unidades cuando existen 3. El sistema recorta el stock a cero, pero el movimiento puede quedar registrado como si hubieran salido 100.

**Regla nueva:** por defecto, rechazar el egreso si supera el stock disponible. El recorte silencioso no debe usarse para movimientos manuales.

### 3.3 🟠 El motivo del egreso se pierde

El modal exige un motivo, pero el valor no se guarda en el registro creado.

**Regla nueva:** cada egreso debe guardar motivo, usuario, fecha, cantidad solicitada, cantidad aplicada y producto afectado.

### 3.4 🟠 El ajuste masivo hace demasiadas escrituras

Actualmente puede hacer una lectura/escritura completa del historial por cada producto seleccionado. En catálogos grandes puede congelar la interfaz y generar tráfico innecesario de sincronización.

**Regla nueva:** un lote de ajuste debe producir una sola operación lógica, una sola lectura fresca y una sola persistencia.

### 3.5 🟡 Inventario y ventas comparten historial sin contrato suficiente

Los ajustes se guardan con forma parecida a una venta. Esto ya contaminó velocidad de ventas y puede afectar futuros reportes.

**Recomendación:** crear un diario separado `bodega_inventory_movements_v1` para entradas y salidas. Mientras se migra, los consumidores deben excluir explícitamente `AJUSTE_ENTRADA` y `AJUSTE_SALIDA`.

### 3.6 🟠 El costo de un lote no está definido

El producto tiene un costo general, pero una nueva compra puede llegar con otro precio. Si se cambia automáticamente el costo del producto al ingresar mercancía, se puede alterar el margen histórico de ventas anteriores.

**Recomendación para la primera versión:** guardar el costo del lote como dato histórico, pero no cambiar automáticamente el costo principal del producto. Definir después si el negocio usará costo promedio ponderado o FIFO.

### 3.7 🟠 El PDF histórico no siempre lleva el arqueo

El cierre actual guarda `reconData`, pero algunas rutas de descarga del historial generan el PDF con `reconData: null`. El PDF puede mostrar ventas y gastos, pero no el esperado, declarado y diferencia reales del cierre.

**Acción obligatoria:** el PDF de un cierre debe usar el `cierreId` y el `reconData` guardados en ese cierre; nunca recalcularlo con la tasa o los datos actuales.

### 3.8 🟡 Los reportes de gastos pueden mezclar conceptos

El autoconsumo no afecta la caja, pero sí reduce inventario. Debe aparecer separado de los gastos de caja. También deben distinguirse gastos anulados y pagos a proveedores.

**Regla nueva:** ningún reporte debe sumar autoconsumo como salida de efectivo.

### 3.9 🟡 “Cambios dejados en caja” puede duplicarse si no se define

El dinero dejado por el cliente ya está dentro del efectivo recibido. Debe aparecer como dato informativo, no sumarse otra vez al efectivo esperado.

**Definición propuesta:**

- **Vuelto entregado:** resta del efectivo esperado.
- **Cambio/propina dejado en caja:** ya permanece en la gaveta y se muestra como informativo.
- **Efectivo esperado:** lo que físicamente debería quedar, sin duplicar la propina.

---

## 4. Contrato de inventario por lotes

### 4.1 Datos mínimos del movimiento

Cada movimiento debe tener:

```text
movementId
productId
productNameSnapshot
direction: ingreso | egreso
quantityInput
inputUnit: unidades | bultos
unitsPerPackageSnapshot
unitsDelta
stockBefore
stockAfter
reason
supplierId/opcional
lotReference/opcional
unitCostUsd/opcional
totalCostUsd/opcional
operatorId/opcional
operatorNameSnapshot
timestamp
shiftId/opcional
cierreId/opcional
source: local | supervisor
status: applied | rejected | voided
```

`unitsPerPackageSnapshot` es importante: si hoy una caja tiene 24 unidades y el próximo mes tiene 12, el historial viejo debe seguir diciendo 24.

### 4.2 Ingreso

- Puede registrarse por unidades o cajas/bultos.
- Debe mostrar stock anterior, cantidad recibida y stock final.
- Debe permitir nota, proveedor y referencia de factura opcionales.
- El costo del lote se guarda si se conoce.
- No debe cambiar automáticamente el precio de venta.
- No debe cambiar el costo histórico de ventas ya realizadas.

### 4.3 Egreso

- Puede registrarse por unidades o cajas/bultos.
- El motivo es obligatorio.
- No puede superar el stock disponible, salvo que el usuario tenga activada explícitamente la política de stock negativo.
- Debe mostrar advertencia clara antes de confirmar.
- Un egreso de inventario no descuenta efectivo.
- Autoconsumo, merma, vencimiento, daño, devolución a proveedor y ajuste administrativo deben conservar categorías distintas.

### 4.4 Reversión

No se debe borrar un movimiento. Si se comete un error, se crea un movimiento inverso con referencia al movimiento original.

Esto permite que el Kardex y los reportes sigan siendo auditables.

---

## 5. Contrato de efectivo esperado

El esperado debe calcularse por moneda y por turno, no solamente por día calendario.

### 5.1 Fórmula base

Para cada moneda física:

```text
Efectivo esperado
= apertura
+ cobros en efectivo
+ cobros de deudas en efectivo
+ otros ingresos físicos
- vuelto entregado
- gastos pagados en efectivo
- pagos a proveedores en efectivo
- efectivo entregado por avances
+ ajustes físicos autorizados
```

Las ventas fiadas, pagos móviles, transferencias, punto de venta y Cashea por cobrar no deben sumarse como efectivo físico.

### 5.2 “Cambios dejados en caja”

Debe mostrarse como tarjeta informativa:

- cantidad de ventas que dejaron cambio/propina;
- total en USD, Bs o COP;
- aclaración: “ya incluido en el efectivo recibido; no se suma nuevamente”.

### 5.3 Datos que debe conservar el cierre

```text
expectedUsd / expectedBs / expectedCop
cashUsd / cashBs / cashCop
diffUsd / diffBs / diffCop
openingUsd / openingBs / openingCop
cashSalesUsd / cashSalesBs / cashSalesCop
changeGivenUsd / changeGivenBs / changeGivenCop
tipsLeftUsd / tipsLeftBs / tipsLeftCop
cashExpensesUsd / cashExpensesBs / cashExpensesCop
cashSupplierPayments
cashAdvances
reconciliationVersion
```

La tasa usada para mostrar equivalencias debe guardarse como fotografía del cierre. Un cierre antiguo no debe cambiar porque hoy cambió la tasa.

---

## 6. Reportes propuestos

### 6.1 Cierre de caja en PDF

Debe incluir:

- negocio, fecha, turno, cajero y `cierreId`;
- apertura por moneda;
- ventas y cantidad de artículos;
- cobros por método;
- cambios entregados;
- cambios/propinas dejados;
- gastos de caja por categoría;
- pagos a proveedores;
- avances de efectivo;
- efectivo esperado;
- efectivo declarado;
- diferencia por moneda;
- semáforo del arqueo;
- productos vendidos principales;
- autoconsumo y egresos de inventario, separados de caja;
- estado de conectividad si el cierre fue recibido por Supervisor;
- fecha de generación del PDF, sin alterar la fecha del cierre.

### 6.2 Reporte de productos vendidos

Filtros:

- hoy, ayer, semana, mes y rango personalizado;
- producto, categoría y código;
- cajero;
- turno/cierre;
- incluir o excluir anuladas.

Columnas:

- producto;
- unidades vendidas;
- bultos equivalentes;
- ventas USD/Bs/COP;
- costo;
- ganancia;
- margen;
- devoluciones/anulaciones separadas.

Debe tener vista resumida y detalle por venta. El PDF puede ser la primera descarga; CSV puede añadirse después para análisis.

### 6.3 Reporte de gastos

Separar claramente:

1. Gastos que afectan caja.
2. Pagos a proveedores.
3. Autoconsumo.
4. Mermas/daños/vencimientos.
5. Gastos anulados.
6. Gastos pagados fuera de caja.

Filtros y datos:

- rango de fechas;
- categoría;
- método de pago;
- moneda;
- descripción/nota;
- cajero;
- turno/cierre;
- total en moneda original y equivalencias;
- descarga PDF.

---

## 7. Adaptación al Supervisor con un solo dispositivo extra

### 7.1 Primera etapa: solo lectura

El Supervisor debe mostrar:

- stock actual;
- entradas y egresos recientes;
- stock bajo;
- ventas por producto;
- gastos del turno;
- efectivo esperado;
- cambios dejados;
- cierre seleccionado con su arqueo real;
- última sincronización y antigüedad de los datos.

Esto no necesita activar mutaciones remotas.

### 7.2 Segunda etapa: una mutación remota controlada

Cuando las pruebas estén aprobadas, añadir un único comando especializado, por ejemplo:

```text
supervisor.inventory.batch.adjust
```

El payload debe contener:

```text
commandId
productId
direction
quantityInput
inputUnit
unitsPerPackage
reason
lotReference
expectedStock
schemaVersion
```

Guardarraíles:

- solo el monitor vinculado a esa caja;
- una caja principal y un Supervisor, sin selección automática de otra caja;
- `expectedStock` para detectar que el dato cambió antes de aplicar;
- operación idempotente;
- confirmación previa y ACK posterior;
- no enviar una lista libre de parches de productos;
- no permitir egreso superior al stock;
- no tocar usuarios ni PINs;
- si la caja está offline, dejar el comando pendiente o rechazarlo: nunca fingir que se aplicó.

### 7.3 SQL necesario

Para las funciones locales de stock, cierres y reportes **no hace falta SQL nuevo** si se mantienen offline-first.

Solo habrá migración SQL cuando se decida:

- sincronizar el diario de movimientos como documento cloud independiente; o
- activar el comando remoto de ajuste por lote.

Esa migración deberá ser aditiva e incluir:

- nueva clave/documento permitida en el contrato de sincronización;
- tipo de comando nuevo en el `CHECK` y en la RPC;
- validación server-side de cantidad, unidad, motivo y target;
- ningún `GRANT` a `anon`;
- RLS cerrada;
- rollback documentado;
- verificación de lectura antes de activar el flag.

**No ejecutar SQL por esta auditoría.** Primero se implementa y prueba localmente el contrato; luego se entrega el SQL exacto si hace falta.

---

## 8. Plan de implementación por fases

### Fase 0 — Contrato Supervisor sin tocar la operación normal

Antes de construir las pantallas nuevas:

- definir el documento sincronizado que el Supervisor consumirá;
- definir cómo distinguir ventas, gastos, autoconsumo y movimientos de inventario;
- validar en el Supervisor cantidades, monedas, turnos y `cierreId`;
- mostrar “dato no disponible” cuando el documento no tenga información suficiente;
- preparar pruebas de lectura con documentos legacy;
- mantener `SUPERVISOR_REMOTE_MUTATIONS_ENABLED = false`.

Si posteriormente se activan órdenes remotas, la caja recibirá únicamente un comando específico y protegido. No se modificarán los botones ni el flujo normal de inventario, ventas o caja.

**Salida:** el Supervisor no interpreta mal los datos y la operación normal sigue intacta.

### Fase 1 — Vista Supervisor de movimientos de inventario

- Crear contrato de lectura para `bodega_inventory_movements_v1` o su equivalente sincronizado.
- Mostrar entradas y salidas por cajas/unidades sin modificar `StockBatchModal`.
- Mostrar snapshot de empaque, motivo, usuario, proveedor y referencia cuando existan.
- Mostrar reversión como movimiento inverso, no borrar historial.
- Marcar documentos antiguos o incompletos.

### Fase 2 — Panel Supervisor de caja esperada

- Crear un normalizador financiero exclusivo del Supervisor.
- Leer el cierre y mostrar efectivo físico separado de pagos no monetarios.
- Mostrar cambios entregados y cambios dejados sin duplicar.
- Separar autoconsumo de gastos que afectan caja.
- Mostrar la fotografía del arqueo por `cierreId` y turno.
- Añadir pruebas de cada moneda sin cambiar el cálculo de la caja principal.

### Fase 3 — PDF de cierre desde el Supervisor

- Generar el PDF desde el cierre seleccionado en el Supervisor.
- Usar `reconData` real, `cierreId`, turno y cajero.
- Incluir gastos, cambios, efectivo esperado y diferencias.
- No recalcular cierres antiguos con la tasa actual.
- Añadir pruebas de PDF con cierre cuadrado, sobrante, faltante y COP sin declarar.
- No modificar el PDF ni el flujo de cierre de la caja principal salvo reutilizar funciones puras.

### Fase 4 — Reporte de productos vendidos del Supervisor

- Crear agregador completo por producto e ID, no solo por nombre.
- Separar anulaciones y devoluciones.
- Filtrar por rango, categoría, turno y cajero.
- Añadir vista completa y top resumido.
- Exportar PDF desde el Supervisor.

### Fase 5 — Reporte de gastos del Supervisor

- Separar caja, proveedores, autoconsumo y gastos anulados.
- Mostrar moneda original y equivalencias.
- Agregar PDF de gastos desde el Supervisor.
- Verificar que autoconsumo nunca aumente el efectivo esperado.

### Fase 6 — Supervisor de lectura

- Sincronizar movimientos, reportes y cierres.
- Mostrar antigüedad de datos.
- Mostrar el último cierre confirmado.
- Añadir estados de conexión y datos degradados.
- Mantener `SUPERVISOR_REMOTE_MUTATIONS_ENABLED = false`.

### Fase 7 — Egreso/ingreso remoto por lote, opcional y aislado

Solo después de las fases anteriores y sin modificar los flujos normales:

- añadir el comando especializado;
- preparar SQL aditivo si es necesario;
- añadir únicamente el receptor protegido en la caja;
- probar ACK/NACK, timeout, reconexión y replay;
- habilitar primero ingreso de stock;
- después egreso con motivo;
- mantener rollback mediante movimiento inverso;
- conservar todos los botones y procesos locales sin cambios.

### Fase 8 — Activación gradual

Activar mutaciones únicamente con:

- E2E en entorno sintético;
- dos navegadores: caja y Supervisor;
- prueba de caja offline;
- prueba de doble clic y reintento;
- prueba de stock insuficiente;
- prueba de cierre concurrente;
- verificación de que ninguna venta o usuario actual se altera.

---

## 9. Pruebas obligatorias

### Inventario

- ingreso de 3 unidades;
- ingreso de 2 cajas de 24;
- producto con 1.5 bultos;
- egreso válido;
- egreso superior al stock;
- egreso con motivo;
- reversión;
- dos ajustes simultáneos con una venta;
- reintento duplicado;
- modo offline;
- producto vendido por peso o unidad suelta.

### Caja

- apertura + venta en efectivo;
- venta con vuelto;
- propina/cambio dejado;
- gasto en efectivo;
- gasto no monetario/autoconsumo;
- pago a proveedor;
- avance de efectivo;
- pago móvil que no debe entrar como efectivo;
- USD, Bs y COP;
- COP no declarado;
- sobrante y faltante;
- dos turnos en el mismo día.

### Reportes

- ventas anuladas excluidas de totales;
- productos con el mismo nombre separados por ID;
- movimientos de stock fuera del reporte de ventas;
- autoconsumo fuera del efectivo esperado;
- cierre antiguo estable aunque cambie la tasa;
- PDF histórico con arqueo real;
- PDF sin datos y con datos grandes;
- fechas y zonas horarias.

### Supervisor

- pairing único;
- reemplazo del único Supervisor;
- lectura con datos viejos claramente marcada;
- comando expirado;
- ACK aplicado;
- NACK/rechazo;
- comando repetido;
- conexión perdida durante aplicación;
- stock cambiado antes de aplicar;
- no ejecutar mutación cuando el flag está desactivado.

---

## 10. Criterios de aceptación

La mejora estará lista cuando:

- un usuario pueda recibir mercancía por cajas o unidades y ver el stock final correcto;
- cada egreso tenga motivo y trazabilidad;
- ningún ajuste pueda borrar una venta concurrente;
- el efectivo esperado cuadre por moneda y por turno;
- los cambios dejados no se dupliquen en el esperado;
- el autoconsumo no reduzca efectivo;
- el PDF histórico muestre el arqueo que realmente se hizo;
- exista reporte completo de productos vendidos;
- exista reporte filtrable y descargable de gastos;
- el Supervisor vea estos datos con la antigüedad real de sincronización;
- las mutaciones remotas sigan bloqueadas hasta pasar E2E;
- solo después se active gradualmente el ingreso/egreso remoto.

---

## 11. Decisión recomendada

**Aprobar el proyecto exclusivamente para el Modo Supervisor**, ejecutándolo en este orden:

1. Contrato de datos y alcance aislado del Supervisor.
2. Shell responsive y estados de conexión.
3. Vista Supervisor de movimientos por lotes.
4. Efectivo esperado y detalle del turno.
5. PDF de cierres históricos.
6. Reporte de productos vendidos.
7. Reporte de gastos.
8. Lectura sincronizada y pruebas E2E.
9. Ingreso remoto por lote como primera mutación opcional.
10. Egreso remoto por lote como última mutación.

La caja principal no cambia sus pantallas ni sus flujos. Si se necesita ejecutar una orden remota, solo se añade un receptor técnico aislado y protegido.

La pantalla mostrada es una buena base visual. Lo que falta es asegurar que cada número tenga una fuente, un turno, una moneda, un movimiento y una trazabilidad verificable.

---

## 12. Requisito responsive obligatorio

La zona completa del Supervisor debe funcionar correctamente en móvil, tablet, escritorio y orientación horizontal. No se acepta una vista que solo funcione en 1280 px.

### 12.1 Viewports obligatorios

La batería visual y funcional debe cubrir como mínimo:

| Perfil | Viewport |
|---|---:|
| Móvil pequeño | 320 × 568 |
| Móvil estándar | 360 × 800 |
| Móvil grande | 390 × 844 |
| Móvil grande | 414 × 896 |
| Tablet vertical | 768 × 1024 |
| Tablet horizontal | 1024 × 768 |
| Escritorio | 1280 × 800 |
| Escritorio grande | 1440 × 900 |
| Horizontal móvil | 844 × 390 |

### 12.2 Reglas de diseño

- Cero desplazamiento horizontal accidental.
- Ninguna tarjeta puede cortar importes, fechas, nombres o mensajes.
- Los valores monetarios deben permitir wrapping o reducir tipografía de forma controlada.
- Las métricas pasan de varias columnas a una columna en móvil.
- Las tablas pasan a tarjetas apiladas en pantallas pequeñas.
- Los filtros se convierten en carrusel horizontal accesible o menú compacto.
- Los modales se comportan como bottom sheet en móvil y modal centrado en escritorio.
- Los botones táctiles tendrán como mínimo 44 × 44 px.
- El header no debe tapar el contenido al hacer scroll.
- Los botones de PDF, refrescar y desvincular deben seguir siendo accesibles sin zoom.
- Los nombres de productos largos, notas y motivos deben envolver texto, nunca desbordar.
- Se respetarán `env(safe-area-inset-*)` en dispositivos con notch.
- Loading, vacío, error, desconectado y datos antiguos tendrán diseños propios responsive.
- No se dependerá únicamente del color para comunicar estado.
- El foco de teclado debe permanecer visible en escritorio.

### 12.3 Criterios automáticos responsive

Cada viewport debe verificar:

```text
scrollWidth <= clientWidth
ningún elemento importante fuera del viewport
ningún botón crítico oculto
ningún texto monetario cortado
modal visible y cerrable
filtros utilizables con teclado y toque
```

También se tomarán capturas visuales de:

- turno activo;
- inventario por lotes;
- efectivo esperado;
- historial de cierres;
- reporte de ventas;
- reporte de gastos;
- estado desconectado;
- error de sincronización;
- comando pendiente y aplicado.

---

## 13. Arquitectura del arnés de pruebas

Se utilizarán los mecanismos ya presentes en el proyecto: Vitest para pruebas unitarias/contractuales y Playwright para E2E. No se conectarán los E2E a producción.

### 13.1 Fixtures sintéticos

Crear fixtures deterministas para:

- caja sin turno;
- turno activo;
- turno con apertura USD/Bs/COP;
- ventas en efectivo;
- ventas con vuelto;
- cambio/propina dejada;
- pagos no monetarios;
- gastos de caja;
- autoconsumo;
- pagos a proveedores;
- avances de efectivo;
- dos cierres distintos;
- movimientos de ingreso por unidades y cajas;
- movimientos de egreso con motivo;
- productos con nombres largos;
- documentos legacy incompletos;
- COP no declarado;
- conexión perdida;
- comandos repetidos y expirados.

Los fixtures no deben contener datos reales, tokens, clientes ni credenciales.

### 13.2 Harness del Supervisor

El arnés debe poder:

- sembrar un estado local sintético;
- controlar fecha y hora;
- controlar la tasa BCV y COP;
- simular conexión/desconexión;
- simular `last_seen_at`;
- simular documentos de sync viejos;
- interceptar RPC de creación y ACK;
- devolver ACK, NACK, timeout o error;
- repetir el mismo comando;
- comprobar que una mutación no se ejecutó cuando el flag está desactivado;
- limpiar el estado al terminar cada prueba.

### 13.3 Fábrica de comandos

Toda prueba de comandos debe construir órdenes mediante una fábrica con:

```text
commandId
schemaVersion
issuedAt
expiresAt
targetDeviceId
actorAuthId
type
payload
```

No se permitirán comandos escritos manualmente en cada test, porque eso genera contratos inconsistentes.

---

## 14. Pruebas automáticas por nivel

### 14.1 Unitarias

Archivos previstos:

```text
tests/supervisorFinancials.test.js
tests/supervisorMetrics.test.js
tests/supervisorResponsive.test.js
tests/supervisorReportContracts.test.js
tests/supervisorCommandPayloads.test.js
```

Cubrirán:

- efectivo esperado por moneda;
- vuelto entregado;
- cambios dejados sin duplicación;
- gastos que afectan y no afectan caja;
- autoconsumo;
- turnos separados;
- cierres duplicados;
- productos vendidos por ID;
- movimientos por unidades y cajas;
- cantidades inválidas;
- documentos viejos;
- campos nulos;
- importes grandes y largos;
- payloads válidos e inválidos.

### 14.2 Contratos y seguridad

Archivos previstos:

```text
tests/supervisorCommands.test.js
tests/supervisorSqlGuardrails.test.js
tests/supervisorMutationGuardrails.test.js
tests/supervisorSync.test.js
```

Verificarán:

- allowlist de comandos;
- target correcto;
- actor autorizado;
- TTL máximo;
- `schemaVersion` válida;
- payload sin campos prohibidos;
- `commandId` repetido no duplica operaciones;
- ACK solo desde la caja autorizada;
- NACK y expiración;
- no transportar PINs ni credenciales;
- no permitir `anon`;
- no aceptar políticas abiertas;
- no activar mutaciones durante las pruebas.

### 14.3 E2E funcionales

Archivos previstos:

```text
tests/e2e/supervisor-responsive.e2e.spec.js
tests/e2e/supervisor-readonly.e2e.spec.js
tests/e2e/supervisor-reports.e2e.spec.js
tests/e2e/supervisor-inventory-command.e2e.spec.js
```

Escenarios:

1. Abrir Supervisor en cada viewport.
2. Vincular una sola caja.
3. Mostrar turno activo.
4. Ver efectivo esperado.
5. Ver cambios dejados.
6. Abrir inventario y filtrar productos.
7. Ver ingreso y egreso por lotes.
8. Descargar un cierre PDF.
9. Descargar reporte de productos vendidos.
10. Descargar reporte de gastos.
11. Desconectar la caja y comprobar estado degradado.
12. Reconectar y comprobar actualización.
13. Enviar un comando con mutaciones desactivadas y comprobar que no se aplica.
14. Enviar un comando sintético habilitado solo en el harness.
15. Comprobar ACK, NACK, timeout y replay.

### 14.4 Responsive y accesibilidad

Playwright comprobará automáticamente:

- ausencia de overflow horizontal;
- visibilidad de controles;
- tamaño mínimo de botones;
- cierre de modales con Escape;
- navegación por teclado;
- labels de campos;
- mensajes de error visibles;
- `aria-live` en estados de sincronización;
- tarjetas y tablas sin contenido cortado.

Las capturas visuales se compararán contra baselines revisadas. Un cambio visual intencional debe actualizar el baseline explícitamente, nunca ocultar el fallo.

### 14.5 Pruebas de rendimiento

- Listas largas de productos con paginación o virtualización adecuada.
- Reportes con miles de ventas sintéticas.
- PDF con muchas filas y varias páginas.
- Sin múltiples escrituras por cada producto de un lote.
- Sin re-render infinito al recibir `app_storage_update`.
- Tiempo de apertura del Supervisor dentro del presupuesto acordado.

---

## 15. Guardarraíles obligatorios

### 15.1 Guardarraíl de alcance

El trabajo debe limitarse a:

```text
src/views/OwnerMonitorView.jsx
src/components/Monitor/**
src/components/Settings/DevicesManager.jsx
src/hooks/useMonitorSync.js
src/hooks/useRemoteCommands.js
src/services/supervisor*.js
src/config/supervisorPolicy.js
tests/supervisor*.test.js
tests/e2e/supervisor*.spec.js
```

Cualquier cambio en ventas, inventario principal, caja principal o reportes normales requiere aprobación separada.

### 15.2 Guardarraíl de mutaciones

- `SUPERVISOR_REMOTE_MUTATIONS_ENABLED` permanece en `false` por defecto.
- El build normal no puede activarlo por accidente.
- Los tests deben fallar si el flag aparece activado sin una variable explícita de harness.
- No mostrar “aplicado” hasta recibir ACK real.
- Un timeout debe mostrarse como timeout, no como éxito.

### 15.3 Guardarraíl de datos

- No usar producción en E2E.
- No incluir tokens en fixtures, logs ni capturas.
- No escribir datos reales durante pruebas.
- No modificar usuarios, PINs, ventas ni productos existentes.
- Los cierres se identifican por `cierreId` y los productos por ID, nunca solo por nombre.

### 15.4 Guardarraíl SQL

Cualquier SQL futuro debe comprobar automáticamente:

- RLS activa;
- ausencia de permisos directos para `anon`;
- RPC con `SECURITY DEFINER` y `search_path` fijo;
- allowlist de tipos de comando;
- validación server-side;
- ningún `USING (true)` en tablas sensibles;
- migración aditiva;
- rollback escrito;
- consulta de verificación posterior.

No se ejecutará SQL durante la fase de diseño responsive o reportes de lectura.

### 15.5 Guardarraíl de sincronización

- Datos viejos deben estar marcados.
- Un documento rechazado no actualiza `lastSync`.
- Un fallo de refresh no muestra “Datos actualizados”.
- Realtime debe limpiar sus canales al desmontar.
- Un único Supervisor activo por caja.
- No elegir otra caja automáticamente.

---

## 16. Gates de salida por fase

### Gate A — Responsive

No avanzar si falla cualquiera:

- overflow horizontal;
- botón crítico fuera de pantalla;
- modal inutilizable en móvil;
- valores monetarios cortados;
- navegación por teclado rota.

### Gate B — Lectura y reportes

No avanzar si falla cualquiera:

- efectivo esperado incorrecto;
- gasto de autoconsumo sumado a caja;
- cierre histórico recalculado;
- venta anulada en totales;
- producto agrupado solo por nombre;
- datos viejos mostrados como actuales.

### Gate C — Mutaciones remotas

No avanzar si falla cualquiera:

- replay duplica stock;
- comando sin ACK aparece aplicado;
- target no autorizado puede ejecutar;
- egreso superior al stock se acepta;
- timeout se considera éxito;
- flag puede activarse accidentalmente;
- SQL abre permisos a `anon`.

### Gate D — Producción

Solo se considera liberable cuando:

- unitarias, contractuales y E2E pasan;
- baselines responsive están aprobadas;
- no hay fallos P0/P1;
- rollback probado;
- mutaciones siguen apagadas durante la primera publicación;
- la activación se hace de forma gradual.

---

## 17. Scripts de verificación

Conservar y ampliar el gate específico del Supervisor:

```text
bun run test
bun run lint:supervisor
bun run typecheck
bun run build
bun run test:e2e
bun run verify:supervisor
```

El gate final debe ejecutar además:

```text
bunx vitest run tests/supervisor*.test.js
bunx playwright test tests/e2e/supervisor*.spec.js
```

El lint global heredado no debe ocultar los resultados del gate específico del Supervisor.

---

## 18. Estado de ejecución

### Fase responsive — implementación completada; validación E2E pendiente

Implementado localmente en el panel Supervisor:

- shell con ancho mínimo seguro y overflow horizontal bloqueado;
- header adaptable con título truncado y acciones táctiles;
- controles críticos con área mínima de 44 px;
- pestañas utilizables como carrusel horizontal interno;
- métricas en una columna en móvil y varias columnas desde tablet;
- tarjetas de cierres y ventas con padding adaptable;
- cuadre USD/Bs/COP refluido para pantallas pequeñas;
- identificadores `data-testid` para el arnés E2E;
- prueba Playwright para los 9 viewports definidos.

Validado hasta este punto:

```text
Tests Supervisor: 59 pasan
Suite completa con `TZ=UTC`: 251 pasan, 10 omitidos
Typecheck: pasa
Build: pasa
ESLint del alcance: 0 errores, warnings legacy existentes
E2E responsive: 9 omitidos por falta de staging/local E2E habilitado
```

Pendiente para cerrar la validación de esta fase:

- ejecutar el E2E responsive con `SUPERVISOR_E2E_ENABLED=true` en localhost o staging sintético;
- revisar baselines visuales en los 9 tamaños;
- no activar mutaciones.

### Fase de modelos de lectura y reportes Supervisor — completada localmente

Implementado y validado localmente:

- normalizador de efectivo esperado por USD/Bs/COP;
- separación de cambios entregados y cambios dejados;
- normalizador de movimientos de inventario legacy;
- reporte de productos vendidos por ID;
- reporte de gastos con autoconsumo separado de caja;
- pestaña responsive de Reportes del Supervisor;
- filtros por período y `cierreId`;
- PDF exclusivo del Supervisor para cierre, ventas y gastos;
- PDF de cierre usando el `reconData` guardado del cierre seleccionado, sin recalcularlo con la tasa actual;
- arqueo declarado y diferencias dentro del PDF cuando existen;
- COP visible en pantalla y PDF únicamente cuando `copEnabled === true` en el sistema principal;
- 11 pruebas unitarias de contratos de lectura y generación PDF.

No se modificó la caja principal, no se agregó SQL y no se activaron mutaciones.

La validación E2E funcional sigue pendiente porque no existe un staging sintético habilitado. La suite completa debe ejecutarse con `TZ=UTC` en este entorno, porque una prueba legacy construye la fecha en UTC mientras el normalizador general usa la fecha local; sin esa variable falla únicamente por cambio de día/zona horaria, no por la funcionalidad del Supervisor.

### Corrección de sincronización Realtime — completada

La pantalla evidenció el error:

```text
cannot add `postgres_changes` callbacks for realtime:monitor:... after `subscribe()`
```

Se corrigió el ciclo de vida de `useMonitorSync` para:

- impedir dos suscripciones simultáneas al mismo monitor;
- esperar la eliminación del canal anterior antes de crear otro;
- usar un topic único por ciclo de vida;
- limpiar canales en timeout, error, cambio de dispositivo y desmontaje;
- ignorar respuestas tardías de una sincronización obsoleta;
- evitar que React StrictMode o un refresh manual duplique callbacks;
- mantener el estado degradado sin mostrar falsos datos en vivo.

Se añadió un guardarraíl automático para comprobar que cada ciclo usa un topic distinto.

Validación de esta corrección:

```text
Tests Supervisor: 59 pasan
Typecheck: pasa
Build: pasa
Lint: 0 errores, warnings legacy existentes
SQL: migración preparada, no aplicada
```

### Fase siguiente — movimientos de inventario del Supervisor iniciada

Primer bloque implementado:

- filtro responsive de entradas, salidas y todos los movimientos;
- visualización de cantidad ingresada, unidad del lote y unidades por caja/bulto;
- visualización de stock anterior y posterior cuando el documento los contiene;
- preservación del motivo y operador disponibles;
- lista limitada para no degradar el panel con historiales grandes.

Pendiente de esta fase:

- fixture sintético de lotes por unidades y cajas;
- contrato cloud independiente para movimientos, si se decide sincronizarlos;
- detalle de proveedor, lote y reversión;
- E2E de filtros y estados vacío/datos antiguos;
- E2E reales de ACK, NACK, timeout, replay y rollback;
- decidir si el primer comando remoto será ingreso de stock.

Este bloque ya quedó iniciado con normalización multi-producto, búsqueda por producto/lote/proveedor, datos incompletos visibles y fixtures sintéticos.

---

## 19. Plan restante por fases inteligentes

**Fecha de actualización:** 2026-08-09
**Estado:** Realtime confirmado; R1 y R2 validados en staging sintético; migración SQL de comandos de mutación aún no aplicada; M1 implementado detrás del flag bloqueado; mutaciones remotas todavía bloqueadas.

Este es el camino restante. Cada fase tiene una salida verificable y no se inicia la siguiente si falla su gate.

### Fase UX1 — Dropdowns redondeados del Supervisor — completada

Se reemplazaron los selects nativos del panel Supervisor por `SupervisorSelect`, evitando el menú cuadrado del navegador.

Incluye:

- período de reportes;
- cierre/turno;
- rol de usuario en Cajeros;
- menú con esquinas redondeadas;
- opción seleccionada resaltada;
- botones táctiles de mínimo 44 px;
- `role=listbox` y `role=option`;
- navegación con teclado, Escape y foco visible;
- funcionamiento responsive en móvil y escritorio.

Los selectores internos que ya usaban `CustomSelect` conservan el mismo tratamiento redondeado. No se modificaron dropdowns de la caja principal.

**Validación UX1:** no quedan `<select>` nativos en `OwnerMonitorView` ni `RemoteUsersManager`; 2 pruebas automáticas nuevas pasan.

### Fase R1 — Cerrar lectura de inventario en el Supervisor

**Objetivo:** completar la visualización de entradas y salidas sin modificar la caja principal.

Incluye:

- fixture sintético de ingreso por unidades;
- fixture sintético de ingreso por cajas/bultos;
- fixture de egreso con motivo obligatorio;
- proveedor, referencia de factura y lote;
- stock anterior, delta y stock posterior;
- reversión como movimiento inverso;
- documentos legacy marcados como incompletos;
- filtros por tipo, fecha, producto y estado.

**No incluye:** comandos remotos, cambios en `StockBatchModal`, escritura en producción o SQL automático.

**Gate R1:** los datos de entrada, egreso, lote y reversión se muestran correctamente; ningún movimiento de inventario aparece como venta ni afecta efectivo.

### Fase R2 — Arnés E2E de lectura y responsive

**Objetivo:** probar el Supervisor completo con datos sintéticos aislados.

Incluye:

- fixture de una caja y un único Supervisor;
- dos cierres con datos diferentes;
- efectivo USD/Bs y COP condicionado;
- reportes de ventas y gastos;
- descarga de los tres tipos de PDF;
- inventario por unidades y cajas;
- estados conectado, desconectado, degradado y datos antiguos;
- los 9 viewports responsive;
- comprobación de overflow, teclado, foco y botones táctiles.

**Estado actual R2:** arnés ampliado con lectura, reportes, filtros y dropdowns redondeados; los 14 E2E pasan contra el proyecto Supabase staging sintético `tdfcpwctvumbdjmifypd` usando una aplicación local. El staging contiene únicamente fixtures E2E y Anonymous Auth habilitado.

**Gate R2:** completado el 2026-08-09. Los 13 E2E pasan en localhost con la configuración de staging; no se usa producción; no quedan falsos éxitos en el recorrido de lectura/responsive. La validación de mutaciones sigue separada y bloqueada.

### Fase R3 — Decisión y preparación SQL, solo si es imprescindible

**Objetivo:** decidir si los movimientos deben sincronizarse como documento cloud y si se necesita aceptar un comando nuevo.

Regla:

- Si el Supervisor solo lee documentos ya existentes, **no se ejecuta SQL**.
- Si se requiere diario cloud independiente o comando remoto, se prepara una migración aditiva separada.

La migración, si aplica, debe incluir:

- tabla/documento y contrato versionado;
- RLS cerrada;
- ningún `GRANT` directo a `anon`;
- RPC con `SECURITY DEFINER` y `search_path` fijo;
- allowlist del comando;
- validación de cantidad, unidad, motivo y dispositivo objetivo;
- rollback y consultas de verificación.

**Estado actual R3:** se determinó que no hace falta SQL para la lectura; se preparó `supabase_supervisor_inventory_batch.sql` para el futuro comando remoto, pero no se aplicó en producción.

**Gate R3:** SQL revisado, con rollback escrito y verificación de lectura. Si no es necesario, la fase se cierra con la decisión explícita “sin SQL”.

### Fase M1 — Receptor remoto de ingreso por lote, bloqueado por defecto

**Objetivo:** permitir únicamente el ingreso remoto de stock como primera mutación.

Incluye:

- tipo `supervisor.inventory.batch.adjust` limitado a `direction: ingreso`;
- `commandId`, `schemaVersion`, TTL y `targetDeviceId`;
- producto identificado por ID;
- cantidad y unidad: unidades/cajas/bultos;
- `unitsPerPackage` obligatorio cuando aplique;
- `expectedStock` para detectar conflictos;
- motivo, operador y referencia del lote;
- aplicación idempotente;
- ACK solo después de persistir correctamente;
- receptor aislado de los botones normales de la caja.

**Guardarraíl:** `SUPERVISOR_REMOTE_MUTATIONS_ENABLED` continúa en `false`; el comando solo puede ejecutarse dentro del harness sintético.

**Estado actual M1:** contrato, receptor aislado, control de stock esperado, movimiento auditable e idempotencia durable local implementados; el flag sigue en `false` y el SQL aún no está aplicado.

**Gate M1:** payload inválido rechazado, dispositivo incorrecto rechazado, doble comando no duplica stock, y la caja principal conserva su flujo actual.

### Fase M2 — E2E de mutación de ingreso

**Objetivo:** comprobar la mutación en dos contextos: caja y Supervisor.

Escenarios obligatorios:

- ingreso de unidades;
- ingreso de cajas;
- doble clic;
- replay del mismo `commandId`;
- timeout;
- NACK;
- caja offline;
- stock cambiado antes de aplicar;
- documento duplicado;
- reconexión durante la aplicación;
- reversión del movimiento.

**Estado actual M2:** completado en staging sintético para el ciclo de comandos autenticado. Se validaron ACK aplicado, NACK por conflicto de stock, timeout real, replay idempotente, reutilización de `commandId` con payload distinto y rechazo del segundo ACK. El rollback local ante fallo de sincronización quedó cubierto por prueba automática.

```text
SUPERVISOR_STAGING_COMMANDS_E2E=true bunx vitest run tests/supervisorStagingCommands.test.js
1 test pasa
```

**Gate M2:** completado el 2026-08-09 en staging. No se modificó producción, no se aplicó stock real y el flag frontend continúa en `false`. La aplicación de stock real y la activación gradual siguen bloqueadas para M3.

### Fase M3 — Activación controlada del ingreso

**Estado:** arnés M3 validado en staging/local con dos contextos de navegador y desconexión del Supervisor. La activación queda bloqueada hasta aprobación explícita y revisión manual.

```text
M3 E2E: 1 test pasa
Mutaciones en producción: desactivadas
```

**Objetivo:** activar solo el ingreso remoto, nunca todas las mutaciones a la vez.

Condiciones:

- E2E R2 y M2 completos;
- revisión manual de los logs y movimientos;
- una sola caja principal y un solo Supervisor;
- flag explícito y auditable;
- monitorización de errores y comandos pendientes;
- procedimiento de apagado inmediato;
- prueba de que ventas, usuarios, precios y cierres no cambian.

**Gate M3:** activar ingreso únicamente después de una aprobación explícita. Si no se aprueba, permanece en lectura.

### Fase M4 — Egreso remoto por lote

**Estado:** contrato, receptor, modal protegido y validaciones locales implementados. El allowlist de ingreso/egreso se probó únicamente en staging; la bandera `SUPERVISOR_REMOTE_EGRESS_ENABLED` permanece en `false`.

Se validó:

- categoría obligatoria;
- egreso que no puede dejar stock negativo;
- `expectedStock` obligatorio;
- movimiento `AJUSTE_SALIDA` auditable;
- rollback local si falla la sincronización;
- NACK del egreso en staging mientras la política permanece bloqueada.

**Objetivo:** añadir egreso remoto como última mutación y con mayor protección.

Incluye:

- motivo obligatorio;
- categorías: merma, daño, vencimiento, autoconsumo, devolución o ajuste;
- prohibición de superar stock disponible;
- `expectedStock` obligatorio;
- reversión auditable;
- confirmación doble en el Supervisor;
- ACK/NACK y estados pendiente, aplicado, rechazado y expirado.

**Gate M4:** ningún egreso superior al stock, ningún replay duplicado, ninguna acción sin ACK y ningún impacto sobre efectivo esperado.

### Fase M5 — Activación final gradual y operación segura

**Estado actual:** preflight de producción completado y migración server-side income-only aplicada con autorización explícita. El canary del cliente todavía no está activado: falta desplegar un build con `VITE_SUPERVISOR_REMOTE_INCOME_ENABLED=true`. El egreso y las demás mutaciones siguen apagados.

Resultado documentado en:

```text
M5-PRODUCTION-CANARY.md
```

**Objetivo:** dejar el Supervisor listo para operación real sin perder el control.

Incluye:

- activar primero ingreso;
- observar estabilidad;
- activar egreso solo después de aprobar M4 y verificar stock insuficiente;
- mantener kill switch;
- conservar auditoría de comandos y movimientos;
- revisar semanalmente errores, timeouts y reintentos;
- rollback mediante comando inverso, nunca borrado.

**Criterio final:** si falla la sincronización, la aplicación vuelve a lectura segura; nunca inventa un ACK ni modifica datos locales sin confirmación.

**Gate M5 actual:** backend de ingreso preparado y verificado; canary de cliente pendiente de despliegue controlado. El egreso continúa bloqueado por separado. No se debe desplegar el canary sin monitoreo y procedimiento de rollback activo.

### Orden inmediato recomendado

1. Completar fixtures y detalle de movimientos de inventario.
2. Ejecutar E2E reales en localhost/staging sintético.
3. Cerrar la decisión “SQL necesario” o “sin SQL”.
4. Implementar únicamente el receptor de ingreso bloqueado. **Completado localmente.**
5. Probar ACK, NACK, timeout, replay y conflicto. **Completado en staging sintético.**
6. Ejecutar prueba de caja offline con navegador real y revisión manual.
7. Activar ingreso de forma controlada, solo con aprobación explícita.
8. Implementar y probar egreso.
9. Activar egreso como último paso.

### Bloqueos explícitos

No se permite avanzar a mutaciones si:

- los 14 E2E siguen omitidos;
- no existe fixture sintético reproducible;
- Realtime vuelve a generar callbacks duplicados;
- un PDF histórico cambia con la tasa actual;
- COP aparece cuando está desactivado;
- un timeout se muestra como aplicado;
- el replay duplica stock;
- el SQL abre permisos a `anon`;
- la operación normal de la caja requiere cambios de interfaz o flujo;
- producción no permite todavía `supervisor.inventory.batch.adjust` en su RPC/check;
- no existe aprobación explícita para el canary de ingreso.

---

## 20. Validación de staging sintético — completada

Se configuró y verificó exclusivamente el proyecto Supabase staging:

```text
Proyecto: precios-al-dia-staging
Ref: tdfcpwctvumbdjmifypd
URL: https://tdfcpwctvumbdjmifypd.supabase.co
```

Aplicado únicamente en staging:

- `device_pairings` y `sync_documents` aislados para fixtures E2E;
- RLS forzada en ambas tablas;
- sin permisos directos para `anon`;
- lectura limitada a dispositivos sintéticos `e2e-*` para sesiones autenticadas;
- Realtime habilitado para `sync_documents`;
- cinco documentos sintéticos de productos, ventas, tasa y COP;
- Anonymous Auth verificado con sesión anónima real.

Validación ejecutada:

```text
14 E2E: pasan
9 viewports responsive: pasan
M3: dos contextos de navegador y modo degradado pasan
Lectura autenticada de los 5 documentos sintéticos: pasa
Producción: no utilizada
Mutaciones remotas: siguen desactivadas
```

Archivo reproducible:

```text
supabase_supervisor_staging.sql
supabase_supervisor_inventory_batch.sql
```

Este SQL no se ejecutó en producción. La migración `supabase_supervisor_commands.sql` se aplicó únicamente en staging para probar el contrato de comandos; no habilita el flag del frontend ni modifica la caja principal. La migración `supabase_supervisor_inventory_batch.sql` se aplicó únicamente en staging para validar el allowlist M4; no se aplicó en producción.

## 21. Preflight de producción M5 — completado, backend income-only preparado

Se verificó producción en modo lectura y posteriormente se aplicó, con autorización explícita, `supabase_supervisor_inventory_income_production.sql`. La migración solo permite `direction=ingreso`; no habilita egresos.

Se verificó producción en modo lectura:

```text
Tablas Supervisor: presentes
RLS: activa en device_pairings, sync_documents y supervisor_commands
anon: sin grants de tabla ni EXECUTE de RPC
RPC: SECURITY DEFINER con search_path public, extensions
Comandos pendientes: 0
Pairings: 15 totales, 12 activos
Realtime: tablas Supervisor publicadas
```

Después se aplicó `supabase_supervisor_canary_allowlist.sql`, sin autorizar dispositivos:

```text
Allowlist canary: creada
RLS allowlist: activa y forzada
Dispositivos autorizados: 0
Trigger canary: activo
anon SELECT allowlist: bloqueado
authenticated SELECT allowlist: bloqueado
Comandos pending: 0
```

El trigger productivo solo permite `supervisor.inventory.batch.adjust` con `direction=ingreso` cuando coinciden caja, Supervisor vinculado, Auth del monitor, `enabled=true` y `expires_at` vigente. El egreso y cualquier otro comando son rechazados.

El canary de cliente está desplegado únicamente en **Vercel Preview** con:

```env
VITE_SUPERVISOR_REMOTE_INCOME_ENABLED=true
VITE_SUPERVISOR_REMOTE_EGRESS_ENABLED=false
```

Los 14 E2E del Preview pasan. Cloudflare Workers no es necesario para M5 porque la aplicación real está en Vercel y los endpoints `/api/*` ya viven en `api/`.

La promoción productiva queda bloqueada hasta elegir un único dispositivo, insertarlo en la allowlist por un plazo corto y ejecutar el smoke test controlado. No se activó el egreso.

## 22. Definición de terminado

El plan se considerará terminado cuando:

- toda la zona del Supervisor sea usable desde 320 px hasta escritorio grande;
- exista evidencia automática en todos los viewports definidos;
- el Supervisor muestre lotes, caja, cierres y reportes sin tocar los flujos normales;
- los PDFs descarguen información del cierre seleccionado;
- existan fixtures sintéticos reproducibles;
- existan unitarias, contratos, E2E y pruebas responsive;
- los guardarraíles impidan activar mutaciones accidentalmente;
- no haya SQL nuevo innecesario;
- la primera versión publicada permanezca en modo lectura;
- la activación de mutaciones se decida después de los resultados E2E.
