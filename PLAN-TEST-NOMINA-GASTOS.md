# Plan de prueba integral — Nómina + Gastos (PreciosAlDía Pro)

**Fecha:** 2026-10-03 · **Autorizó:** luigi
**Versión app:** v2.1.19+ (requiere v2.1.20 con fix de backup de nómina, commit `38fb6f5` — aún sin push al momento de redactar; NO ejecutar sin confirmar `38fb6f5` en GitHub + deploy en prod)
**Cuenta real:** `medina180276@gmail.com` (medina = primer cliente Pro, licencia LIC-G3K43S)
**Sedes:** 2 (Bodega `neg-1` + Cosméticos `neg-2`)

## 0. REGLAS ANTES DE EMPEZAR

1. ✅ **Autorización expresa de luigi para tocar datos reales** (chat 2026-10-03): *"ahorita no se está usando el sistema y el inventario lo cambiaremos ya que el cliente está vendiendo con otro sistema"*.
2. **NO mezclar productos:** todo es Pro, nada de Lite.
3. **No tocar el importador Excel** ni los cambios ajenos sin commitear.
4. El dueño es omnipotente; el administrador solo ve/gestiona su sede.
5. Si algo no se puede probar deterministamente, se dice de frente, no se declara verificado.
6. Si aparece un conflicto local/nube, **NO** elegir "Usar los de la Nube" sin verificar ambos lados primero (lección 2026-10-02).

## 1. PREFLIGHT

- [ ] Confirmar que la app en prod muestra el pill **v2.1.20** (fix de backup de nómina) o superior.
- [ ] Iniciar sesión con `medina180276@gmail.com` → código del cliente cero (licencia LIC-G3K43S) → PIN de dueño.
- [ ] Verificar sede activa = **Bodega**, rol = **dueño** (Nómina visible en el nav).
- [ ] Verificar tasa BCV visible en la app; anotarla (la liquidación en Bs la necesita).
- [ ] **Limpiar antes del backup:** si el E2E limitado anterior dejó datos de prueba (empleado/producto/consumo), eliminarlos ANTES de tomar el backup definitivo. Verificar cloud también.

## 2. BACKUP + SNAPSHOT PRE-PRUEBA

### 2.1 Backup local (por sede, en la app: Ajustes → Respaldos)
- [ ] Sede **Bodega**: exportar backup JSON → guardar como `backup-pre-test-Bodega-YYYYMMDD-HHMM.json`.
- [ ] Cambiar de sede desde login (con PIN del dueño, regla activa) → sede **Cosméticos**.
- [ ] Sede **Cosméticos**: exportar backup JSON → `backup-pre-test-Cosmeticos-YYYYMMDD-HHMM.json`.
- [ ] Verificar que el export incluye `bodega_employees_v1` y docs dinámicos (`bodega_payroll_consumo_*`, `bodega_payroll_periodo_*`, `bodega_payroll_liquidacion_*`) — el fix v2.1.20 lo agregó.

### 2.2 Snapshot cloud (para verificar limpieza al final)
Por sede, contar documentos en `sync_documents` (cliente cero `oshexsmweswzbwaksvra`):
```sql
SELECT COUNT(*) FROM sync_documents
WHERE document_id LIKE '%<negocioId>%'
  AND (document_id LIKE '%payroll%' OR document_id LIKE '%employees%');
```
- [ ] Anotar conteos: empleados / consumos / períodos / liquidaciones por sede.

### 2.3 Baseline de datos (anotar valores)
- [ ] Productos por sede (Bodega: 2.423, Cosméticos: 2.988 — confirmar).
- [ ] Stock de los productos que se usarán en las pruebas (consumo y venta de prueba).
- [ ] Ventas registradas (las 2 ventas de prueba anuladas de $6,90 y $4,50 están en historial).
- [ ] Gastos internos existentes.
- [ ] Clientes / fiados existentes.
- [ ] Empleados: debe ser **0**.

## 3. MATRIZ DE PRUEBAS

### 3.1 Roles y permisos
| ID | Prueba | Resultado esperado |
|----|--------|-------------------|
| R1 | Dueño entra a Nómina | Ve zona, empleados, resumen, historial |
| R2 | Cambiar a usuario admin (su sede) | NO ve zona Nómina en nav; botón consumo SÍ visible en POS |
| R3 | Cajero | NO ve zona Nómina, NO ve botón consumo, NO ve saldos |
| R4 | Admin intenta anular consumo (si puede registrarlo) | Bloqueado — solo dueño anula |
| R5 | Admin intenta liquidar | Bloqueado — solo dueño liquida |

### 3.2 Empleados (solo dueño)
| ID | Prueba | Resultado esperado |
|----|--------|-------------------|
| E1 | Crear empleado semanal USD | Se crea, activo, aparece en lista |
| E2 | Crear empleado quincenal Bs | OK |
| E3 | Crear empleado mensual USD | OK |
| E4 | Editar sueldo/frecuencia de E2 | Cambia; el snapshot del período abierto NO se altera |
| E5 | Desactivar E3 | No acepta nuevos consumos; no sale en resumen |
| E6 | Intentar crear empleado sin nombre / sueldo ≤ 0 | Valida y bloquea |

### 3.3 Consumos (dueño/admin)
| ID | Prueba | Esperado |
|----|--------|----------|
| C1 | Consumo normal (producto con stock) | Descuenta stock exacto; aparece en historial; resta del neto |
| C2 | Precio aplicado = precio de venta | El monto del consumo = precio_venta × cantidad |
| C3 | Producto a granel (kg) | Stock respeta 3 decimales |
| C4 | Stock insuficiente | Bloquea con mensaje |
| C5 | Producto sin precio | Bloquea |
| C6 | Consumo = límite exacto (100% sueldo) | Permite |
| C7 | Consumo > límite sin override | Bloquea |
| C8 | Consumo > límite CON override (dueño) | Permite; queda auditado (actor/equipo/motivo) |
| C9 | Doble clic rápido en "Registrar" | NO duplica el consumo |
| C10 | Consumo en sede Bodega no visible en Cosméticos | Aislamiento por sede |
| C11 | Admin registra consumo para empleado de SU sede | OK |
| C12 | Empleado desactivado (E5) intenta consumir | Bloquea |

### 3.4 Anulación de consumos (solo dueño)
| ID | Prueba | Esperado |
|----|--------|----------|
| A1 | Anular consumo con motivo | Estado VOIDED; stock devuelto exacto; resumen/neto recalculado |
| A2 | Anular sin motivo | Bloquea (motivo obligatorio) |
| A3 | Anular un consumo ya liquidado | Bloquea |
| A4 | Re-anular un consumo ya anulado | Bloquea (terminal) |

### 3.5 Liquidación (solo dueño)
| ID | Prueba | Esperado |
|----|--------|----------|
| L1 | Liquidar E1 (semanal USD) | neto = salario_snapshot − consumos APPLIED; genera **UN** GASTO_INTERNO categoría `personal`, monto negativo, `afectaCaja: true`, dentro de `bodega_sales_v1` |
| L2 | Liquidar E2 (quincenal Bs) | Neto en Bs con tasa BCV registrada; gasto equivalente correcto |
| L3 | Gasto de liquidación aparece en historial de gastos/reportes/cierre | Visible y con categoría `personal`; NO se confunde con una venta |
| L4 | Liquidar dos veces el mismo período | Bloquea (no duplicados) |
| L5 | Liquidación con neto ≤ 0 | Bloquea |
| L6 | Período queda LIQUIDADO; consumo posterior cae en período vigente | OK |
| L7 | Recibo 80mm: datos negocio, empleado/cédula, frecuencia+rango, sueldo, consumos, neto USD/Bs, tasa, método, folio, firmas | Completo |
| L8 | Recibo 56mm | Completo y legible |
| L9 | Descargar/compartir PDF del recibo | OK (la impresión física no es automatizable — reportar) |
| L10 | Reimprimir desde historial | OK |

### 3.6 Gastos (no nómina) — auditar `src/views/ControlView.jsx` / `useGastosInternos.js` primero
| ID | Prueba | Esperado |
|----|--------|----------|
| G1 | Crear gasto manual con categoría y descripción | Se guarda; impacta reportes/caja |
| G2 | Gasto en Bs con tasa | Conversión correcta |
| G3 | Recargar la app → el gasto persiste | OK |
| G4 | Anular/eliminar gasto (si la UI lo permite) | Según UI |
| G5 | Gasto de nómina (L1/L2) no se duplica ni mezcla con ventas | OK |

### 3.7 Ventas
| ID | Prueba | Esperado |
|----|--------|----------|
| V1 | Venta normal | Guarda `vendedorId`/`vendedorNombre`; stock y total correctos |
| V2 | Anular venta | Devuelve stock; NO toca nómina |
| V3 | Tasa automática decimal con toggle ON | Redondea hacia arriba (Math.ceil) |
| V4 | Tasa exacta con toggle OFF | Conserva decimal |
| V5 | Tasa manual | Nunca se redondea |

### 3.8 Sync y multi-sede
| ID | Prueba | Esperado |
|----|--------|----------|
| S1 | Recargar app tras pruebas | Todo persiste (IndexedDB) |
| S2 | Docs de nómina visibles en cloud (`sync_documents`) | Aparecen con prefijo `nb_<negocioId>:` |
| S3 | Cambiar a Cosméticos | NO muestra nómina de Bodega |
| S4 | Docs dinámicos pasan validadores de `supervisorContracts.js` | Sin errores en consola |

## 4. RESTAURACIÓN POST-PRUEBA

1. [ ] En **Bodega**: importar `backup-pre-test-Bodega-*.json` (restauración completa).
2. [ ] En **Cosméticos**: importar `backup-pre-test-Cosmeticos-*.json`.
3. [ ] Verificar contra baseline §2.3: productos, stock de productos usados, ventas, gastos, clientes.
4. [ ] **Limpieza cloud:** eliminar los documentos de nómina de prueba (`bodega_employees_v1`, `bodega_payroll_consumo_*`, `bodega_payroll_periodo_*`, `bodega_payroll_liquidacion_*`) creados durante la prueba; verificar con el conteo del §2.2 que quedó igual.
5. [ ] Recargar/sincronizar y confirmar que los datos de prueba **no resucitan**.
6. [ ] Checklist final: 0 empleados de prueba, 0 productos de prueba, 0 consumos, 0 liquidaciones, 0 gastos/ventas de prueba.

## 5. INFORME FINAL

Tabla PASS/FAIL por ID de prueba (§3.1–§3.8) con valores observados (montos, stocks antes/después, folios, tasas).
Sección de limitaciones: lo que no se pudo probar en el navegador (impresión física, cámara, PWA instalada).
Entregar a luigi con los archivos de backup referenciados.
