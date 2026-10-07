# PLAN DE IMPLEMENTACIÓN — CARTERA DE CLIENTES Y SALDO A FAVOR

**Proyecto:** `preciosaldia-bodega`  
**Fecha:** 2026-08-10  
**Estado:** Implementado en esta rama; pendiente de piloto operativo y validación manual de caja  
**Documento de origen:** Auditoría de cartera, clientes, checkout, reportes y reversión  
**Rama base observada:** `main`  
**Arquitectura:** Vite + React + Zustand + IndexedDB/localForage + Supabase, offline-first  
**Prioridad:** Alta — involucra dinero, cartera y arqueo de caja

---

## 1. Objetivo

Implementar una cartera de clientes que permita:

1. Registrar clientes con saldo deudor.
2. Registrar clientes con saldo a favor.
3. Usar el saldo a favor como método de pago total o parcial.
4. Combinar saldo a favor con efectivo, Bs, COP, Pago Móvil y otros métodos.
5. Acreditar correctamente cambios que el cliente decida dejar en cuenta.
6. Mantener historial auditable de cada movimiento.
7. Revertir ventas, abonos y ajustes sin depender de heurísticas.
8. Excluir el crédito interno de los ingresos físicos y del arqueo.
9. Operar offline y sincronizar de forma segura.
10. Mantener compatibilidad con los clientes y ventas existentes.

---

## 2. Resultado esperado

El cliente tendrá un único estado financiero comercial:

```text
Saldo a favor > 0  → el negocio le debe crédito al cliente
Saldo deudor > 0   → el cliente le debe dinero al negocio
Ambos = 0          → cuenta al día
```

La implementación mantendrá la regla de normalización existente: un cliente no debe quedar simultáneamente con `deuda > 0` y `favor > 0`.

`casheaDeuda` continuará siendo independiente, porque representa dinero por cobrar a Cashea y no deuda del cliente.

---

## 3. Decisiones de negocio recomendadas

Estas decisiones gobiernan todo el plan. Si alguna cambia, debe actualizarse el documento antes de comenzar la ejecución.

### D1 — Moneda canónica: USD

Todos los saldos de cartera se almacenarán en USD con dos decimales.

- Un abono recibido en Bs se convierte a USD usando la tasa de la operación.
- Un abono recibido en COP se convierte a USD usando la tasa COP de la operación.
- Una compra pagada con saldo a favor usa el saldo USD existente.
- La operación conserva la tasa utilizada para auditoría y comprobantes.
- El valor histórico del saldo no cambia porque cambie la tasa actual.

### D2 — Saldo deudor y saldo a favor son estados opuestos

Se conservará la regla actual:

```text
favor > 0 y deuda = 0
ó
favor = 0 y deuda > 0
ó
favor = 0 y deuda = 0
```

Los datos históricos que tengan ambos campos positivos se normalizarán por saldo neto durante la migración.

### D3 — Saldo a favor no se convierte automáticamente en efectivo

El saldo a favor solo puede aplicarse a compras, abonos o ajustes autorizados.

Un cliente con `$50` a favor que compra `$10` puede usar hasta `$10`, pero no puede generar `$40` de vuelto físico desde el crédito interno.

Si en el futuro se desea devolver saldo a favor en efectivo, deberá existir una operación separada, autorización de ADMIN, motivo obligatorio y registro de retiro.

### D4 — `saldo_favor` será un método virtual protegido

Debe aparecer en el checkout como método de pago, pero no será un método externo editable como Pago Móvil o efectivo.

Características:

- No se puede eliminar.
- No se puede deshabilitar desde Ajustes.
- Solo aparece con un cliente seleccionado.
- Solo aparece si el cliente tiene saldo positivo.
- Tiene límite automático por saldo disponible y monto restante.
- No participa como efectivo físico.

### D5 — Ledger de cartera como fuente de auditoría

Se creará un ledger append-only de movimientos de clientes.

`customer.favor` y `customer.deuda` seguirán existiendo como snapshot para compatibilidad y lectura rápida, pero toda mutación financiera deberá crear un movimiento en el ledger.

### D6 — Todas las operaciones financieras deben ser idempotentes

Cada movimiento tendrá un `id` único y, cuando corresponda, un `sourceId` o `sourceSaleId`.

Reintentar una operación por doble clic, recuperación offline o sincronización no podrá duplicar el crédito, la deuda o el pago.

### D7 — Ajustes administrativos requieren ADMIN

ADMIN podrá:

- corregir saldos;
- condonar deuda;
- emitir crédito manual;
- registrar devolución en saldo;
- revertir un ajuste.

CAJERO podrá:

- usar saldo a favor en ventas;
- recibir abonos normales;
- acreditar cambio si la política lo permite.

CAJERO no podrá eliminar saldos ni hacer ajustes libres.

### D8 — Cashea permanece separado

No se debe mezclar:

- deuda del cliente con la bodega;
- saldo a favor del cliente;
- deuda pendiente de Cashea hacia la bodega.

La venta Cashea seguirá usando `casheaDeuda` y la remesa Cashea seguirá usando `COBRO_CASHEA`.

---

## 4. Problemas actuales que este plan corrige

| ID | Severidad | Problema actual | Corrección prevista |
|---|---|---|---|
| CART-001 | Crítica | El checkout básico no permite usar saldo a favor. | Método virtual disponible en ambos modos. |
| CART-002 | Crítica | El cambio acreditado se muestra, pero no se persiste. | Movimiento `VUELTO_ACREDITADO` persistido dentro de la venta. |
| CART-003 | Crítica | El procesador no valida suficientemente el monto de crédito utilizado. | Validación de saldo fresco dentro del lock. |
| CART-004 | Crítica | `saldo_favor` puede terminar clasificado como USD cobrado. | Bucket interno separado de efectivo e ingresos. |
| CART-005 | Crítica | La anulación usa heurísticas basadas en el saldo actual. | Reversión por `sourceId`/ledger. |
| CART-006 | Crítica | “Poner en 0” modifica el cliente sin movimiento financiero. | Ajuste administrativo registrado e idempotente. |
| CART-007 | Alta | Se mezclan `favor`, `saldoFavor` y deuda negativa. | Migración a `favor` como campo canónico. |
| CART-008 | Alta | El selector no muestra correctamente el saldo positivo. | Estado visible y actualizado en el selector de cliente. |
| CART-009 | Alta | Las escrituras de venta, cliente y ledger no son una operación coordinada. | Servicio financiero único dentro de `withLock`. |
| CART-010 | Alta | No hay cobertura suficiente de saldo a favor. | Tests unitarios, regresión, integración y checklist E2E. |
| CART-011 | Media | El saldo puede actualizarse desde varias vistas con lógica duplicada. | Una única puerta de escritura para cartera. |
| CART-012 | Media | El backup/sync no contempla un ledger de cartera. | Inclusión, validación y merge append-only. |

---

## 5. Alcance

### Incluido

- Modelo de ledger de cartera.
- Servicio único de operaciones de cartera.
- Uso de saldo a favor en checkout básico y POS.
- Saldo a favor como pago parcial o total.
- Acreditación de vuelto.
- Abonos en USD, Bs y COP.
- Ventas fiadas usando el saldo neto correcto.
- Anulación exacta de movimientos.
- Ajustes administrativos.
- Migración de datos históricos.
- Reportes, cierre de caja, tickets y monitor Supervisor.
- Backups y sincronización offline-first.
- Tests y validación de regresión.

### Fuera de alcance de la primera versión

- Retiro automático de saldo a favor en efectivo.
- Integración bancaria para devolver créditos.
- Límites de crédito automáticos por cliente.
- Cálculo de intereses o mora.
- Estados de cuenta fiscales externos.
- Contabilidad de doble partida completa.
- Portal externo para que el cliente consulte su saldo.

---

## 6. Modelo de datos propuesto

### 6.1 Snapshot compatible del cliente

Se mantienen los campos actuales:

```js
{
  id,
  code,
  name,
  documentId,
  phone,
  deuda: 0,
  favor: 0,
  casheaDeuda: 0,
  createdAt,
  accountVersion,
  accountUpdatedAt
}
```

Reglas:

- `deuda`, `favor` y `casheaDeuda` siempre son números finitos.
- `deuda` y `favor` se redondean a dos decimales.
- Nunca se permite saldo negativo en un campo.
- `accountVersion` aumenta en cada movimiento de cartera.
- `accountUpdatedAt` registra la última modificación financiera.

### 6.2 Nuevo ledger

Nueva clave local:

```text
bodega_customer_ledger_v1
```

Registro recomendado:

```js
{
  id: 'uuid',
  customerId: 'uuid',
  type: 'VENTA_FIADA',
  direction: 'DEBIT',
  amountUsd: 12.50,
  currency: 'USD',
  rate: 580,
  balanceBeforeUsd: 0,
  balanceAfterUsd: -12.50,
  deudaBeforeUsd: 0,
  deudaAfterUsd: 12.50,
  favorBeforeUsd: 0,
  favorAfterUsd: 0,
  sourceType: 'SALE',
  sourceId: 'sale-uuid',
  sourceSaleId: 'sale-uuid',
  paymentMethodId: null,
  reason: 'Venta fiada',
  userId: 'user-uuid',
  userName: 'Cajero',
  timestamp: '2026-08-10T00:00:00.000Z',
  reversalOf: null,
  status: 'COMPLETED'
}
```

### 6.3 Tipos de movimiento

| Tipo | Dirección | Efecto |
|---|---|---|
| `SALDO_INICIAL_MIGRADO` | Según saldo | Importa el estado existente. |
| `ABONO_DEUDA` | CREDIT | Reduce deuda; el excedente puede crear favor. |
| `VENTA_FIADA` | DEBIT | Aumenta deuda. |
| `SALDO_FAVOR_USADO` | DEBIT | Consume crédito interno. |
| `VUELTO_ACREDITADO` | CREDIT | Acredita cambio no entregado. |
| `DEVOLUCION_A_FAVOR` | CREDIT | Registra devolución como crédito. |
| `AJUSTE_CREDITO` | CREDIT | Crédito manual autorizado. |
| `AJUSTE_DEBITO` | DEBIT | Corrección o condonación invertida autorizada. |
| `ANULACION` | Reversa | Revierte exactamente un movimiento anterior. |

### 6.4 Saldos firmados y snapshots

El ledger manejará un saldo neto conceptual:

```text
balanceAfterUsd > 0  → saldo a favor
balanceAfterUsd < 0  → saldo deudor
balanceAfterUsd = 0  → al día
```

El snapshot compatible se deriva así:

```js
favor = Math.max(balanceAfterUsd, 0)
deuda = Math.max(-balanceAfterUsd, 0)
```

Los cálculos monetarios deberán usar `dinero.js`, nunca aritmética financiera cruda.

---

## 7. Arquitectura propuesta

### 7.1 Nueva puerta de escritura

Crear un servicio financiero central, por ejemplo:

```text
src/services/customerWalletService.js
```

Responsabilidades:

- leer cliente y ledger frescos;
- validar la operación;
- calcular el nuevo balance;
- crear movimiento idempotente;
- actualizar snapshot del cliente;
- asociar el movimiento a venta o ajuste;
- persistir todo dentro de `withLock('pos_write_lock')`;
- devolver el estado actualizado para la UI.

Operaciones mínimas:

```js
applySaleImpact(...)
registerCustomerPayment(...)
applyStoreCredit(...)
applyCreditToSale(...)
createAdministrativeAdjustment(...)
reverseMovement(...)
rebuildCustomerSnapshot(...)
```

### 7.2 `financialLogic.js`

Debe continuar siendo una función pura de transición, pero dejar de ser llamada directamente desde múltiples vistas para persistir saldos.

La función pura calculará:

```js
transitionCustomerBalance(currentBalance, movement)
```

El servicio será responsable de almacenamiento, locks, idempotencia y ledger.

### 7.3 Regla de consistencia

Ninguna vista podrá hacer directamente:

```js
storageService.setItem('bodega_customers_v1', ...)
```

para cambiar deuda o favor.

Las vistas solo invocarán el servicio central.

---

## 8. Diseño funcional del checkout

### 8.1 Selección de cliente

El selector deberá mostrar:

```text
Juan Pérez
Saldo a favor: $18.50
```

o:

```text
Juan Pérez
Debe: $24.00
```

Al seleccionar cliente:

- cargar saldo fresco para validación final;
- reiniciar el pago interno del checkout;
- actualizar los límites del método `saldo_favor`;
- no activar Cashea automáticamente;
- no conservar el saldo aplicado de un cliente anterior.

### 8.2 Método “Saldo a Favor”

Debe aparecer en ambos modos:

- Checkout básico.
- Checkout POS.

Contrato del pago:

```js
{
  id,
  methodId: 'saldo_favor',
  methodLabel: 'Saldo a Favor',
  currency: 'INTERNAL_CREDIT',
  amountInput: 10,
  amountUsd: 10,
  amountBs: 0,
  isInternalCredit: true,
  customerId
}
```

Regla del monto máximo:

```text
maxAplicable = min(saldoFavorDisponible, montoRestanteDeLaVenta)
```

No se debe permitir:

- saldo a favor sin cliente;
- monto mayor al saldo disponible;
- monto mayor al restante de la venta;
- vuelto físico provocado por sobreaplicación de crédito;
- doble aplicación por doble clic.

### 8.3 Pago combinado

Ejemplo permitido:

```text
Venta:                    $100
Saldo a favor utilizado:  $30
Efectivo recibido:        $50
Saldo fiado restante:     $20
```

La venta debe registrarse como `VENTA_FIADA`, con:

```js
fiadoUsd: 20
payments: [
  { methodId: 'saldo_favor', amountUsd: 30 },
  { methodId: 'efectivo_usd', amountUsd: 50 }
]
```

El ledger debe registrar:

1. `SALDO_FAVOR_USADO` por `$30`.
2. `VENTA_FIADA` por `$20`.

### 8.4 Vuelto acreditado

Si el cliente paga de más y decide dejar el cambio:

```text
Venta:                 $10
Pago recibido:         $20
Cambio físico:          $0
Crédito acreditado:    $10
```

Debe persistirse:

- `vueltoParaMonedero: 10` en la venta por compatibilidad.
- Movimiento `VUELTO_ACREDITADO` por `$10`.
- `sourceSaleId` apuntando a la venta.
- saldo anterior y posterior.

Si el cliente recibe parte en efectivo y deja solo una parte:

```text
Cambio total:       $10
Cambio entregado:    $4
Cambio acreditado:   $6
```

El procesador debe verificar que:

```text
cambioEntregado + cambioAcreditado <= cambioReal
```

### 8.5 Venta fiada y saldo a favor

Si un cliente tiene saldo a favor y se genera una nueva venta fiada por un importe mayor al crédito disponible, el saldo a favor se consume primero y solo el excedente queda como deuda.

No se debe generar deuda y favor simultáneamente en el snapshot.

---

## 9. Validaciones obligatorias en el procesador

`checkoutProcessor.js` debe validar dentro del lock y usando datos frescos:

1. Carrito válido.
2. Total USD y Bs consistente.
3. Tasa BCV válida.
4. Métodos de pago permitidos.
5. Monedas válidas.
6. Montos no negativos ni `NaN`.
7. Cliente obligatorio para `saldo_favor`, fiado o Cashea.
8. Cliente existente en almacenamiento.
9. Saldo a favor disponible suficiente.
10. Saldo interno no superior al restante de la venta.
11. Vuelto total no superior al vuelto real.
12. Crédito acreditado más vuelto entregado no superior al vuelto real.
13. No generar cambio físico a partir de `saldo_favor`.
14. `sourceId` no procesado previamente.
15. Venta y movimiento de cartera asociados al mismo identificador.
16. Stock y venta actualizados dentro del lock.
17. Auditoría con el mismo total persistido.

Errores esperados:

```text
Se requiere cliente para usar saldo a favor.
El saldo a favor disponible es insuficiente.
El saldo a favor no puede generar vuelto en efectivo.
La operación de cartera ya fue procesada.
El cliente no existe o fue actualizado por otra operación.
```

---

## 10. Reportes, cierre y contabilidad operativa

### 10.1 `FinancialEngine`

El método `saldo_favor` no debe tener `currency: 'USD'` como si fuera dinero recibido.

Debe generar una entrada similar a:

```js
{
  total: 30,
  currency: 'INTERNAL_CREDIT',
  label: 'Saldo a Favor Utilizado',
  isInternalCredit: true,
  isCash: false,
  isRevenue: false
}
```

### 10.2 Dashboard y reportes

Mostrar por separado:

- efectivo recibido en USD;
- efectivo recibido en Bs;
- COP recibido;
- pagos electrónicos;
- saldo a favor utilizado;
- fiado pendiente;
- Cashea por cobrar;
- vuelto entregado.

El saldo a favor utilizado:

- sí debe aparecer como método aplicado;
- no debe sumarse como caja física;
- no debe sumarse como ingreso monetario nuevo;
- no debe inflar porcentajes de métodos de pago;
- sí puede aparecer como métrica de ventas financiadas con crédito interno.

### 10.3 Cierre de caja

El arqueo físico debe continuar calculando únicamente métodos físicos/electrónicos que realmente entren en caja o banco.

`saldo_favor` no modifica:

```text
expectedUsd
expectedBs
expectedCop
```

El cierre puede mostrar una línea informativa:

```text
Saldo a favor aplicado durante el turno: $X
```

pero no incluirla en el efectivo esperado.

### 10.4 Supervisor

`supervisorFinancials.js` debe usar el mismo contrato de pagos y filtrar `isInternalCredit` de los totales físicos.

Debe mostrar el crédito interno como categoría informativa independiente.

### 10.5 Tickets y estados de cuenta

El ticket debe distinguir:

```text
Saldo a favor utilizado: $10.00
Efectivo recibido: $20.00
```

El estado de cuenta del cliente debe incluir:

- saldo anterior;
- movimiento;
- saldo a favor usado;
- deuda generada;
- saldo posterior;
- fecha y usuario.

---

## 11. Migración de datos históricos

### 11.1 Preparación

Antes de ejecutar la migración:

1. Generar backup completo.
2. Confirmar que el backup puede restaurarse.
3. Registrar conteo de clientes y ventas.
4. Registrar clientes con `favor > 0`.
5. Registrar clientes con `saldoFavor > 0`.
6. Registrar clientes con deuda negativa.
7. Registrar clientes con deuda y favor simultáneos.
8. Registrar clientes con `casheaDeuda > 0`.
9. No ejecutar migración dos veces.

### 11.2 Normalización

Para cada cliente:

1. Convertir valores no numéricos a cero.
2. Redondear a dos decimales.
3. Migrar `saldoFavor` a `favor` si existe.
4. Convertir deuda negativa a favor.
5. Si existen deuda y favor, calcular saldo neto:

```text
saldoNeto = favor - deuda
```

6. Derivar:

```text
favor = max(saldoNeto, 0)
deuda = max(-saldoNeto, 0)
```

7. Mantener `casheaDeuda` intacta y separada.

### 11.3 Semilla del ledger

Por cada cliente con saldo distinto de cero, crear un movimiento:

```text
SALDO_INICIAL_MIGRADO
```

Debe contener:

- saldo anterior reportado;
- saldo normalizado;
- campos históricos encontrados;
- fecha de migración;
- versión de migración;
- usuario `SYSTEM`.

### 11.4 Idempotencia

Crear una marca de migración, por ejemplo:

```text
customer_ledger_migration_v1
```

La migración no debe volver a crear movimientos si ya fue completada.

### 11.5 Informe de migración

La migración debe producir un resumen:

```text
Clientes revisados
Clientes normalizados
Clientes con saldo a favor
Clientes con deuda
Clientes con campos inconsistentes
Movimientos iniciales creados
Clientes que requieren revisión manual
```

---

## 12. Ajustes administrativos

Crear una operación de ajuste con:

- cliente;
- tipo: crédito o débito;
- monto;
- motivo obligatorio;
- comentario opcional;
- usuario;
- fecha;
- confirmación explícita;
- saldo anterior;
- saldo posterior.

Acciones sugeridas:

```text
Emitir saldo a favor
Reducir saldo a favor
Condonar deuda
Reactivar deuda corregida
Registrar devolución como crédito
```

No se debe permitir editar directamente los campos `favor` o `deuda` desde la UI.

“Poner en 0” debe reemplazarse por un flujo de ajuste:

```text
Poner cuenta en cero
→ seleccionar motivo
→ mostrar saldo que será afectado
→ confirmar como ADMIN
→ registrar movimiento
```

---

## 13. Anulación y reversión

### 13.1 Regla general

Toda operación que afecte cartera debe poder encontrar su movimiento original por:

```text
sourceSaleId
sourceId
```

### 13.2 Anular una venta

Al anular una venta:

1. Verificar que no esté anulada.
2. Leer venta y cliente frescos.
3. Marcar venta como `ANULADA`.
4. Crear reversión de cada movimiento de cartera asociado.
5. Restaurar stock.
6. Persistir snapshot y ledger.
7. Registrar auditoría.
8. Impedir doble reversión.

No se debe inferir la reversión mirando únicamente el saldo actual.

### 13.3 Anular un abono

Debe revertir exactamente:

- reducción de deuda;
- saldo a favor generado;
- saldo aplicado a compras posteriores no debe desaparecer silenciosamente;
- si el saldo ya fue usado, el sistema debe bloquear la anulación automática o solicitar una operación administrativa explícita.

Recomendación conservadora:

> No permitir anular un abono si su saldo ya fue consumido en operaciones posteriores sin una revisión ADMIN.

### 13.4 Anular un ajuste

Todo ajuste debe poder revertirse mediante otro movimiento que apunte a `reversalOf`.

---

## 14. Offline-first y sincronización

### 14.1 Backup

Agregar `bodega_customer_ledger_v1` a:

- `src/config/backupKeys.js`;
- backup completo;
- backup compartido;
- restauración local;
- validadores de esquema.

### 14.2 Validación remota

El payload remoto del ledger debe validarse como:

- arreglo;
- movimientos con `id` válido;
- `customerId` obligatorio;
- `type` permitido;
- `amountUsd` finito y no negativo;
- `timestamp` válido;
- `status` permitido.

### 14.3 Merge

No sincronizar el ledger como un array reemplazable sin merge.

Regla recomendada:

1. Unir movimientos por `id`.
2. Conservar todos los movimientos únicos.
3. Rechazar duplicados con contenido conflictivo.
4. Marcar conflictos para auditoría.
5. Reconstruir snapshots desde el ledger o desde el evento más reciente válido.
6. Nunca reemplazar una cartera más nueva por un array remoto antiguo.

### 14.4 Operación sin internet

La venta debe poder completarse offline.

Cada operación debe guardar:

- UUID local;
- timestamp local;
- usuario;
- dispositivo;
- versión de cartera;
- fuente de operación.

La sincronización posterior debe ser idempotente.

---

## 15. Plan de ejecución por fases

Las fases deben ejecutarse en orden. No se debe implementar la UI antes de tener el contrato financiero y las pruebas del procesador.

### Fase 0 — Prevuelo y baseline

**Objetivo:** congelar el estado inicial.

Tareas:

- Confirmar rama y cambios existentes.
- Registrar baseline de `bun run test`.
- Ejecutar `bun run typecheck`.
- Ejecutar `bun run build`.
- Crear backup de datos de desarrollo.
- Confirmar que no hay otro agente modificando los archivos objetivo.

Criterio de salida:

- baseline registrado;
- backup disponible;
- sin cambios accidentales en archivos ajenos.

### Fase 1 — Contrato financiero y tests rojos

**Objetivo:** definir el comportamiento correcto antes del código de producción.

Crear o ampliar tests para:

- saldo a favor positivo;
- deuda positiva;
- normalización de ambos campos;
- pago completo con saldo a favor;
- pago parcial con saldo a favor;
- pago combinado;
- saldo insuficiente;
- saldo sin cliente;
- crédito no puede generar vuelto;
- cambio acreditado;
- anulación exacta;
- doble procesamiento idempotente.

Criterio de salida:

- los tests describen el contrato final;
- los nuevos casos fallan únicamente por falta de implementación;
- no se modifican tests existentes para ocultar regresiones.

### Fase 2 — Ledger y servicio puro de transición

**Objetivo:** crear las bases testeables.

Tareas:

- Crear contrato de tipos de movimiento.
- Crear función pura de transición de saldo.
- Crear normalizador de cliente.
- Crear generador de ledger.
- Aplicar `dinero.js` en todos los cálculos.
- Probar que no se pueden producir saldos negativos en `favor` o `deuda`.

Criterio de salida:

- transición pura cubierta por tests;
- reglas de saldo neto certificadas;
- no hay acceso a almacenamiento desde la función pura.

### Fase 3 — Servicio central de cartera

**Objetivo:** centralizar todas las escrituras financieras.

Tareas:

- Crear `customerWalletService`.
- Implementar lectura fresca dentro de `withLock`.
- Implementar idempotencia por `sourceId`.
- Persistir ledger y snapshot.
- Implementar `registerCustomerPayment`.
- Implementar `applyCreditToSale`.
- Implementar `applyAdministrativeAdjustment`.
- Implementar `reverseMovement`.

Criterio de salida:

- ninguna operación de cartera depende de una vista;
- doble ejecución no duplica movimientos;
- todos los movimientos tienen usuario, fecha y fuente.

### Fase 4 — Migración y compatibilidad histórica

**Objetivo:** llevar los datos existentes al nuevo contrato.

Tareas:

- Implementar migración idempotente.
- Normalizar `favor`, `saldoFavor` y deuda negativa.
- Crear movimientos `SALDO_INICIAL_MIGRADO`.
- Generar informe de inconsistencias.
- Mantener `deuda`, `favor` y `casheaDeuda` para compatibilidad.
- Agregar prueba de migración repetida.

Criterio de salida:

- cero clientes con deuda y favor simultáneos salvo excepciones reportadas;
- ningún saldo se pierde;
- la suma de snapshots coincide con el ledger.

### Fase 5 — Procesador de checkout

**Objetivo:** integrar la cartera al núcleo de ventas.

Tareas:

- Validar `saldo_favor` en `checkoutProcessor`.
- Leer cliente fresco.
- Limitar monto disponible y restante.
- Prohibir vuelto generado por crédito interno.
- Persistir `fiadoUsd` real.
- Persistir `vueltoParaMonedero` cuando corresponda.
- Asociar movimientos a `sale.id`.
- Mantener Cashea separado.
- Garantizar operación idempotente.

Criterio de salida:

- el procesador rechaza entradas inválidas incluso si vienen fuera de la UI;
- una venta combinada actualiza correctamente crédito, pago real y deuda;
- el stock, venta, snapshot y ledger quedan consistentes.

### Fase 6 — Checkout básico

**Objetivo:** mostrar y permitir `Saldo a Favor` en el checkout básico.

Tareas:

- Agregar método virtual al flujo de pagos.
- Mostrarlo únicamente con cliente y saldo disponible.
- Mostrar saldo restante en tiempo real.
- Permitir botón “Usar todo”.
- Permitir monto manual con límite.
- Actualizar botones “Total” de otras monedas descontando crédito.
- Mostrar saldo deudor posterior si queda deuda.
- Eliminar props muertos como `onUseSaldoFavor` si ya no son necesarios.

Criterio de salida:

- el modo básico y POS tienen el mismo contrato financiero;
- el operador ve claramente cuánto crédito usa;
- el monto no se puede aumentar por encima del límite.

### Fase 7 — Checkout POS y cambio acreditado

**Objetivo:** completar la experiencia POS.

Tareas:

- Reemplazar la lógica duplicada de `WalletSection` por el servicio central.
- Persistir realmente `vueltoCredito`.
- Mostrar crédito aplicado y cambio físico por separado.
- Aplicar límite `min(saldo, restante)` también al input manual.
- No generar efectivo desde saldo virtual.
- Invalidar estado al cambiar de cliente.
- Cubrir Cashea + saldo a favor + pago físico combinado.

Criterio de salida:

- el crédito mostrado antes de confirmar coincide con el persistido;
- el cliente recibe crédito solo por el monto autorizado;
- no hay fuga de efectivo por sobreaplicación.

### Fase 8 — Cartera y ajustes administrativos

**Objetivo:** corregir la gestión de clientes.

Tareas:

- Sustituir `saldoFavor` por `favor` en todos los checks.
- Corregir filtro “Saldo a Favor”.
- Corregir eliminación de clientes con saldo.
- Mostrar saldo en tarjetas y selector.
- Implementar ajuste administrativo con motivo.
- Reemplazar “Poner en 0” por ajuste registrado.
- Mostrar historial de movimientos del ledger.
- Añadir estado anterior y posterior a cada operación.

Criterio de salida:

- ningún componente usa deuda negativa como representación normal;
- ningún componente usa `saldoFavor` salvo migración compatible;
- no existe escritura directa de saldo desde la UI.

### Fase 9 — Anulación y reversión

**Objetivo:** eliminar heurísticas.

Tareas:

- Asociar cada movimiento a su fuente.
- Revertir por `sourceId`.
- Bloquear doble reversión.
- Bloquear o elevar a ADMIN la anulación de movimientos consumidos posteriormente.
- Actualizar `voidSaleProcessor` para usar el servicio central.
- Mantener reversión de stock y cartera dentro del mismo lock.

Criterio de salida:

- anular una venta devuelve exactamente el estado anterior;
- anular una venta posterior no altera indebidamente movimientos anteriores;
- los tests de secuencias múltiples pasan.

### Fase 10 — Reportes, cierre, tickets y Supervisor

**Objetivo:** separar crédito interno de caja e ingresos.

Tareas:

- Actualizar `FinancialEngine`.
- Actualizar Dashboard.
- Actualizar Reports.
- Actualizar `CierreCajaWizard`.
- Actualizar generadores de PDF/tickets.
- Actualizar `supervisorFinancials`.
- Mostrar saldo a favor utilizado como categoría informativa.
- Excluirlo del arqueo físico y de ingresos monetarios.

Criterio de salida:

- los reportes no inflan efectivo;
- el cierre cuadra igual con o sin uso de saldo a favor;
- Supervisor y caja muestran el mismo resultado.

### Fase 11 — Backup, sync y restauración

**Objetivo:** hacer segura la cartera offline-first.

Tareas:

- Agregar ledger a `backupKeys`.
- Actualizar esquema de sincronización.
- Implementar merge por ID.
- Probar restauración de backup.
- Probar operaciones offline y sincronización posterior.
- Probar duplicados y conflictos.
- Reconstruir snapshots desde ledger cuando sea necesario.

Criterio de salida:

- backup y restauración conservan todos los movimientos;
- la sincronización no duplica créditos;
- un documento remoto antiguo no pisa cartera nueva.

### Fase 12 — Tests, auditoría y validación manual

**Objetivo:** certificar el comportamiento completo.

Tareas:

- Ejecutar suite completa.
- Ejecutar typecheck.
- Ejecutar build.
- Ejecutar lint relevante.
- Ejecutar pruebas de migración.
- Ejecutar pruebas de reportes.
- Ejecutar pruebas de anulación.
- Completar checklist manual en modo básico y POS.
- Probar móvil/PWA y operación sin internet.

Criterio de salida:

- todos los tests pasan;
- no hay errores nuevos en consola;
- no hay discrepancias entre ticket, cartera, venta y cierre.

### Fase 13 — Piloto controlado y salida

**Objetivo:** liberar con riesgo controlado.

Tareas:

- Habilitar la funcionalidad detrás de un flag si es posible.
- Probar con datos de prueba y luego con un tenant piloto.
- Comparar cartera antes/después.
- Revisar cierres de caja.
- Mantener backup anterior disponible.
- Publicar notas operativas para cajeros.
- Activar gradualmente.

Criterio de salida:

- un turno completo cuadra correctamente;
- los saldos migrados coinciden;
- no hay duplicados ni diferencias contables;
- existe procedimiento de rollback.

---

## 16. Matriz mínima de pruebas

### Saldo y transición

- Cliente al día + abono menor que cero deuda → favor.
- Cliente deudor + abono exacto → cero.
- Cliente deudor + abono superior → favor por excedente.
- Cliente con favor + uso parcial → favor disminuye.
- Cliente con favor + uso total → cero.
- Cliente con favor + venta superior → favor se consume y excedente queda como deuda.
- Cliente con datos inconsistentes → normalización por saldo neto.

### Checkout

- Compra completa con saldo a favor.
- Compra parcial con saldo a favor y efectivo.
- Compra parcial con saldo a favor y Bs.
- Compra parcial con saldo a favor y COP.
- Compra con saldo a favor más deuda restante.
- Saldo a favor sin cliente → rechazo.
- Saldo superior al disponible → rechazo.
- Saldo superior al total → se limita al total.
- Crédito interno no genera vuelto físico.
- Cliente cambia antes de confirmar → se reinicia el saldo aplicado.
- Doble clic → una sola venta y un solo movimiento.
- Reintento offline → operación idempotente.

### Vuelto

- Cambio completo entregado en USD.
- Cambio completo entregado en Bs.
- Cambio dividido USD/Bs.
- Cambio parcial entregado y resto acreditado.
- Cambio completo acreditado.
- Cambio acreditado a cliente con deuda → paga deuda primero según regla.
- Cambio acreditado a cliente al día → crea favor.

### Anulación

- Anular venta fiada.
- Anular venta con saldo a favor usado.
- Anular venta con cambio acreditado.
- Anular venta con pago combinado.
- Anular abono antes de consumir crédito.
- Intentar anular abono después de consumir crédito.
- Doble anulación.
- Anulación con operaciones posteriores del mismo cliente.

### Reportes y cierre

- Venta normal sin crédito.
- Venta pagada solo con saldo a favor.
- Venta combinada.
- Cierre con saldo a favor usado.
- Cierre con Cashea y saldo a favor.
- Dashboard y Supervisor con los mismos totales.
- Ticket mostrando saldo aplicado.

### Migración y sync

- `saldoFavor` histórico.
- deuda negativa histórica.
- deuda y favor simultáneos.
- cliente sin movimientos.
- migración ejecutada dos veces.
- backup/restauración.
- sincronización de movimientos duplicados.
- conflicto entre snapshots.

---

## 17. Checklist manual de aceptación

### Cartera

- [ ] Crear cliente nuevo.
- [ ] Registrar abono mayor que su deuda.
- [ ] Ver saldo a favor en Clientes.
- [ ] Filtrar por “Saldo a Favor”.
- [ ] Seleccionar cliente desde checkout.
- [ ] Ver saldo disponible en ambos modos.

### Pago

- [ ] Usar saldo a favor completo.
- [ ] Usar saldo a favor parcial.
- [ ] Completar con USD.
- [ ] Completar con Bs.
- [ ] Completar con COP.
- [ ] Intentar exceder saldo disponible.
- [ ] Intentar usar saldo sin cliente.
- [ ] Confirmar que no aparece vuelto físico indebido.

### Cambio

- [ ] Pagar de más.
- [ ] Entregar parte del cambio.
- [ ] Acreditar el resto.
- [ ] Confirmar saldo actualizado al cerrar la venta.

### Anulación

- [ ] Anular una venta con crédito interno.
- [ ] Verificar snapshot anterior.
- [ ] Verificar ledger reversado.
- [ ] Verificar stock.
- [ ] Verificar reportes.

### Caja

- [ ] Cerrar turno con saldo a favor utilizado.
- [ ] Confirmar que el crédito no aparece como efectivo.
- [ ] Confirmar que USD/Bs/COP físicos cuadran.

### Offline

- [ ] Desconectar internet.
- [ ] Registrar abono.
- [ ] Hacer compra con saldo.
- [ ] Recargar aplicación.
- [ ] Reconectar internet.
- [ ] Confirmar que no hay duplicados.

---

## 18. Criterios globales de aceptación

La funcionalidad se considera terminada únicamente cuando:

1. El saldo a favor aparece como método de pago en checkout básico y POS.
2. El saldo disponible se valida en el procesador, no solo en la UI.
3. Los pagos con crédito interno no alteran el arqueo físico.
4. El cambio acreditado se persiste y aparece en cartera.
5. No existen escrituras directas de cartera desde vistas.
6. `favor` es el único campo canónico para saldo positivo.
7. Las anulaciones utilizan movimientos reversibles, no heurísticas.
8. Los ajustes administrativos tienen motivo y usuario.
9. La migración conserva el saldo histórico.
10. Ledger y snapshot coinciden.
11. Backup y sync incluyen el ledger.
12. El uso combinado de crédito, efectivo, Bs, COP y Cashea está cubierto.
13. La suite completa, typecheck y build pasan.
14. Un cierre de caja real cuadra correctamente.
15. No hay errores críticos nuevos en consola ni en auditoría.

---

## 19. Rollback y contingencia

Antes de migrar o activar la funcionalidad:

1. Crear backup completo.
2. Guardar copia independiente de `bodega_customers_v1`.
3. Guardar copia independiente de `bodega_sales_v1`.
4. Guardar copia independiente del nuevo ledger.
5. Registrar versión de aplicación.
6. Activar flag de funcionalidad si está disponible.

Si la migración falla:

- no volver a ejecutarla sin revisar la marca de migración;
- restaurar snapshot y ledger desde backup;
- conservar el informe de error;
- no borrar movimientos manualmente;
- bloquear nuevas ventas con crédito hasta validar consistencia.

Si los reportes no cuadran:

- no publicar el release;
- comparar ledger, snapshots, ventas y pagos;
- revisar primero clasificación `INTERNAL_CREDIT`;
- revisar después duplicados de sync;
- mantener la versión anterior operativa si es posible.

---

## 20. Archivos candidatos a modificar

La implementación deberá revisar, como mínimo:

```text
src/config/paymentMethods.js
src/config/backupKeys.js
src/utils/financialLogic.js
src/utils/checkoutProcessor.js
src/utils/customerTransactionProcessor.js
src/utils/voidSaleProcessor.js
src/core/FinancialEngine.js
src/hooks/useCheckoutCalculations.js
src/hooks/useCheckoutFlow.js
src/hooks/useSalesData.js
src/components/Sales/CheckoutModal.jsx
src/components/Sales/CheckoutModalPOS/index.jsx
src/components/Sales/CheckoutModalPOS/components/WalletSection.jsx
src/components/Sales/CheckoutCustomerPicker.jsx
src/views/CustomersView.jsx
src/components/Dashboard/DashboardPaymentBreakdown.jsx
src/components/Reports/ReportsMetricsTab.jsx
src/components/Dashboard/CierreCajaWizard.jsx
src/services/supervisorFinancials.js
src/utils/dailyCloseGenerator.js
src/utils/ticketGenerator.js
src/utils/ticketHtmlTemplate.js
src/hooks/useCloudSync.js
src/services/auditService.js
```

Nuevos módulos probables:

```text
src/services/customerWalletService.js
src/utils/customerLedger.js
src/utils/customerMigration.js
```

Tests probables:

```text
tests/customerLedger.test.js
tests/customerWalletService.test.js
tests/customerMigration.test.js
tests/checkout.test.js
tests/financialEngine.test.js
tests/supervisorFinancials.test.js
```

Los nombres finales pueden ajustarse si durante el anclaje del código se encuentra una convención más adecuada, pero no debe duplicarse lógica financiera en componentes.

---

## 21. Orden recomendado de implementación

```text
1. Baseline y backup
2. Tests del contrato
3. Ledger y transición pura
4. Servicio central de cartera
5. Migración histórica
6. Integración del procesador
7. Checkout básico
8. Checkout POS y vuelto acreditado
9. UI de Clientes y ajustes
10. Anulación y reversión
11. Reportes, cierre, tickets y Supervisor
12. Backup y sincronización
13. Suite completa y piloto
```

**No comenzar por la interfaz.** El riesgo principal está en la consistencia financiera, no en el botón visual.

---

## 22. Decisión final recomendada

Implementar la **Opción B: ledger de cartera con snapshot compatible**, usando:

- USD como moneda canónica;
- `favor` como único campo de saldo positivo;
- `saldo_favor` como método virtual protegido;
- crédito interno separado del efectivo;
- servicio central con lock e idempotencia;
- anulación basada en movimientos originales;
- migración histórica idempotente;
- sync append-only por ID;
- ajustes administrativos con autorización.

Esta solución requiere más trabajo inicial que un parche directo, pero evita los riesgos más graves: crédito duplicado, efectivo ficticio, saldos desaparecidos, reportes incorrectos y anulaciones que alteran operaciones posteriores.
