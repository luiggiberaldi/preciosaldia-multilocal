# F3 — Comparación local de evidencias

**Fecha:** 2026-10-08. **Estado:** herramienta y análisis offline ejecutados; conciliación/restore productivo **no aprobados**.

## Qué se entregó

[Comparador CLI](../scripts/reconcile_backups_readonly.py) y [pruebas herméticas](../tests/reconcile_backups_readonly_test.py), sin dependencias nuevas ni llamadas de red. Lee:

- `--backup archivo.json` (repetible): backup app v2.0 o legacy; admite arrays guardados como strings JSON. Rechaza `appName` de otro producto cuando está presente.
- `--sync-json filas.json` (repetible): array de filas `{device_id, collection, doc_id, data, updated_at}` con envelope `{schemaVersion: 1, payload, updatedAt}` (schemaVersion ausente se trata como el contrato legacy v1). No promueve `payload` SQL legacy ni convierte deltas inválidos.
- `--dump archivo.dump` + `--pg-restore pg_restore.exe`: extrae **solo `public.sync_documents`** a stdout usando `--data-only --table=sync_documents --file=-`. **Nunca** pasa `--dbname`, URI, psql o shell; no ejecuta el SQL ni restaura una base. Decodifica COPY texto PostgreSQL conservando escapes JSON.
- `--storage-manifest manifest.json`: compara URLs completas, incluido query, con recibos ya adquiridos. No hace GET ni decodifica/rehash imágenes.
- `--output directorio-nuevo`: obligatorio, **fuera del checkout**, sin sobrescribir directorios existentes. Entrega `report.json` (JSON compacto v1) y `report.md` (resumen). Máximo 256 MiB por entrada/extracción. Exit 0 significa **reporte producido**, no datos conciliados; error de entrada/extracción/escritura da exit 1.

Ejemplo Git Bash (rutas literales; no acceso remoto):

```bash
python -X utf8 scripts/reconcile_backups_readonly.py \
  --backup "$LOCALAPPDATA/PreciosAlDia/backups/F0-2026-10-08/storage-json/source-backup.json" \
  --dump "$LOCALAPPDATA/PreciosAlDia/backups/F0-2026-10-08/preciosaldia-public-storage.dump" \
  --pg-restore "$TEMP/pda-postgres17/pg_restore.exe" \
  --storage-manifest "$LOCALAPPDATA/PreciosAlDia/backups/F0-2026-10-08/storage-json/manifest.json" \
  --output "$LOCALAPPDATA/PreciosAlDia/reconciliation/F3-nueva-corrida"
```

El path del binario refleja las herramientas locales ya descargadas; si no existen, obtener cliente PostgreSQL apropiado por separado. No buscar credenciales ni usar scripts de investigación de dispositivo.

## Contrato del informe

- `sources`: alias `source-N`, tipo, bytes y SHA-256 de cada entrada. Los archivos se releen al final: `inputIntegrityVerified` solo true si sus hashes permanecen iguales.
- `documents`, `recordLists`, `datasets`: procedencia por documento/dispositivo hasheados, timestamp remoto y conteos de filas. **Ningún timestamp selecciona un ganador**.
- `coverage`: IDs únicos observados por sede/dominio. No es catálogo canónico ni suma de stock.
- `entities`: agrupación estricta `(sede, dominio, id)`, refs SHA-256, hashes de todas las variantes y dataset que las contiene. Clasifica `coincident`, `only_in_one_dataset`, `conflicting`; una variante exclusiva no prueba pérdida/local-only/cloud-only. Diferencias de barcode/precio/moneda/costo/foto y estado/importes de venta se muestran como categorías, sin valores. Comparación de catálogo ignora solo stock/updatedAt volátiles; stock se compara aparte.
- `voidConflict`: hay versiones vigentes/anuladas del mismo ID; se conserva evidencia de ambas, sin reactivar ni aplicar una. `recommendation` es revisar/retener, nunca merge ejecutable.
- `unknownOriginCandidates`: solapamiento del grupo **sin asignar** con cada sede conocida. No mueve datos ni propone destino automático. No usa nombre del backup, alias, `appName`, root sede o negocio activo. Atribución solo por namespace físico `nb_<sede>:<clave>` o campo explícito de cada registro; contradicciones quedan sin asignar.
- `businesses`: mapa aprobado Bodega `neg-1`, Cosméticos `neg-fac22061`, eliminada `neg-856cdc73`; versiones contradictorias y tombstones se registran, no se publican. Otras sedes tienen referencia hash, no se asignan a Cosméticos.
- `issues`: documentos inválidos, duplicados/missing ID y conflictos de scope; `journalEvidence` conserva referencias a la cuarentena y **no la convierte en snapshot aceptado**.
- `images`: cobertura de referencias y recibos manifest-only. Los conteos de observaciones pueden repetir el mismo producto/URL entre versiones.

Los informes no incluyen payloads, nombres/clientes, PINes, URLs, IDs crudos de registros/dispositivos ni valores económicos. **Los hashes no son anonimización**: guardar los reportes privados protegidos; sus referencias solo se resuelven contra la evidencia original bajo control del dueño.

## Corrida sobre copias disponibles

Entradas: copia del JSON principal, dump local F0 y manifiesto de imágenes. Reporte final privado en:

```text
%LOCALAPPDATA%\PreciosAlDia\reconciliation\F3-final-20261008-022924\report.json
%LOCALAPPDATA%\PreciosAlDia\reconciliation\F3-final-20261008-022924\report.md
```

- 228 documentos, 108.658 observaciones; 32.842 entidades por sede/dominio/ID: 10.620 coincidentes, 16.514 exclusivas de un dataset observado y 5.708 con variantes distintas. **No son 5.708 ventas erróneas**: incluyen catálogo/stock/usuarios y versiones históricas.
- 4.892 entidades sin sede asignada: 2.423 productos, su stock y 46 entradas de ventas/caja del JSON principal. Ese respaldo conserva origen desconocido.
- Bodega: 2.434 IDs de catálogo únicos, 192 entradas de ventas/caja interpretables, seis IDs de usuarios acumulados entre versiones (no certifica seis miembros actuales).
- Cosméticos: **tres documentos de 3.038 filas cada uno**, **3.036 IDs únicos**. Hay duplicados internos; dos IDs de catálogo presentan variantes distintas. No se redujo/importó ningún catálogo.
- Sede eliminada: 5.411 IDs de catálogo observados en conjunto histórico, no una foto canónica. Tiene tombstone observado y registros antiguos que aún la listan activa; historia conservada, no resurrección.
- También aparece una sede desconocida adicional en namespace: 2.991 IDs de catálogo. Se reporta como desconocida y no se equipara a ninguna de las sedes aprobadas.
- JSON principal vs Bodega: 2.423 IDs de producto compartidos, 2.422 con al menos una variante de catálogo idéntica y uno sin variante idéntica; stock de 2.387 IDs con alguna variante idéntica, 36 sin ella. Bodega tiene 11 IDs adicionales. **El mismo solapamiento aparece en historia de la sede eliminada**: no basta para atribuir el JSON a Bodega.
- Ninguna de las 46 entradas de ventas/caja del JSON comparte ID con las 192 entradas interpretables de Bodega. Se retienen todas; no se declara pérdida ni se asigna destino.
- 166 hallazgos: **70 deltas incompatibles** con contrato fecha/tickets + concordancia de doc ID (49 Bodega, nueve sede eliminada, 12 otra sede desconocida), y 96 ocurrencias de ID duplicado dentro de un documento. Los 70 payloads tienen objeto con `tickets` lista y sin `date`; estructura observada sin exponer ni convertir tickets. **No son necesariamente los tres documentos de la sesión previa** ni prueba de ventas perdidas: dump de otro momento/alcance. Adaptador requiere revisión aparte.
- Imágenes: 1.889 URLs únicas en todas las versiones inspeccionadas; 1.886 cubiertas por el manifiesto (1.883 recibos ok, tres fallidos), tres URLs adicionales fuera de ese manifiesto. No hubo red ni nueva descarga; firmas/bytes y restore integral no revalidados aquí.
- Tiempo de análisis final medido: **9,772 s**, incluida extracción local y checksums de entrada; excluye serialización/escritura final del reporte. JSON final: 37.647.156 bytes. Sin afirmación de speedup ni rendimiento en hardware de las cajas.

## Verificación y siguiente gate

- **17 pruebas Python aprobadas**, incluyendo CLI real con archivos temporales, conservación de hashes, no sobreescritura, redacción, escapes COPY, aislamiento de sedes, tombstones, duplicados/IDs inválidos, conflictos void/stock y origen desconocido.
- Typecheck del proyecto aprobado. No se modificó código de la app ni se repitieron build/E2E previos como si verificaran este CLI: la comprobación funcional de esta entrega es la CLI y sus archivos reales.
- Falta revisar/aceptar las discrepancias con el dueño, exportaciones de las tres PCs y cobertura/restore F0. No valida cuenta/membresía/RLS del dump ni operaciones que nunca llegaron a nube. No suma inventarios ni concilia importes contables; stock diferente sigue **sin causa explicada**.
- F3 tiene herramienta y reporte, **no gate de conciliación integral cerrado**. No se ejecutó registro, importación, cambio de sede, mutación de nube, conversión de los deltas, restauración ni despliegue; sin commit/push.
