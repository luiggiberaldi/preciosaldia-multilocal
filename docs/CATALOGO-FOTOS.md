# Catálogo de fotos para búsqueda automática

La búsqueda automática de fotos del form de productos (`api/search-image.js`)
consulta la tabla `product_images_catalog` en Supabase: primero por slug exacto,
luego por coincidencia de tags. Si la tabla está vacía, la búsqueda siempre da 404.

## Poblar el catálogo en una cuenta Supabase (nueva o existente)

### 1. Crear la tabla
Pegar en el SQL editor del proyecto (dashboard de Supabase) el contenido de
`supabase/migrations/005_product_images_catalog.sql`.
(Cada proyecto nuevo la trae si se aplican las migraciones del repo.)

### 2. Poblar con el script
```bash
python3 scripts/poblar_catalogo_fotos.py \
  --supabase-url https://<ref>.supabase.co \
  --service-key "$SUPABASE_SERVICE_KEY" \
  --lite-catalog ~/workspace/preciosaldia2026/public/images/catalog \
  --pro-mapeo ~/workspace/inventarios-limpios/mapeo_fotos_bodega.json
```
- `--dry-run`: no sube ni escribe, solo reporta.
- `--skip-upload`: solo puebla el catálogo (imágenes ya subidas).
- `--self-test`: valida que los slugs generados coincidan con `getSlug` del frontend.
- Sin `--pro-mapeo`: solo se cargan las imágenes genéricas del Lite.
- El mapeo de otro cliente debe tener el formato `{ "foto.webp": {"producto_excel": "NOMBRE..."} }`.
- Idempotente: se puede correr varias veces (upsert; las fotos del cliente pisan
  a las del Lite si colisiona el slug).

### 3. Verificar
```bash
curl "https://preciosaldia-multilocal.vercel.app/api/search-image?q=harina+pan"
# debe devolver 200 con matches, no 404
```

## Fuentes de imágenes
- **Lite** (`preciosaldia2026/public/images/catalog`, ~1.170 slugs únicos): fotos
  genéricas de productos, ya nombradas con slug. Se suben a
  `product-images/catalog/` del proyecto destino.
- **Pro** (fotos del cliente en `product-images/` raíz): no se re-suben, solo se
  registran con el nombre correcto del producto para que la búsqueda las encuentre.

## Nota multi-tenant (importante)
`api/search-image.js` usa las env vars **estáticas** `VITE_SUPABASE_CLOUD_URL` /
`VITE_SUPABASE_CLOUD_KEY` de Vercel: hoy apunta a UN solo proyecto (cliente cero).
Si un segundo cliente tiene su propio Supabase con su propio catálogo, la función
seguirá consultando el catálogo del cliente cero a menos que se parametrize
(p. ej. aceptar el project ref desde el frontend, que ya lo conoce vía CloudGate).
No mezclar: cada cuenta debe poblar SU propio catálogo con este script.
