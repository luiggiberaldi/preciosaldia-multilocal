-- ============================================================
-- Optimización de Egress — Realtime + Storage
-- ============================================================
-- ⚠️  CORRER EN EL PROYECTO **CLOUD / SYNC P2P** (el que apunta
--     VITE_SUPABASE_CLOUD_URL en tu .env — la DB "bodega 2" donde
--     vive la tabla sync_documents). NO en el proyecto de licencias.
--
-- Cubre 2 de los fixes de egress:
--   FASE 2 → sync_documents: REPLICA IDENTITY FULL → DEFAULT
--            (reduce ~2x el payload de cada mensaje de Realtime)
--   FASE 3.1 → bucket product-images para sacar las imágenes base64
--              fuera de sync_documents (mueve el 95% del egress de
--              Realtime, caro, a Storage, barato)
--
-- Es idempotente: se puede correr varias veces sin efectos duplicados.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- FASE 2 — Reducir el payload de Realtime a la mitad
-- ─────────────────────────────────────────────────────────────
-- REPLICA IDENTITY FULL hace que CADA broadcast de Realtime incluya
-- la fila vieja COMPLETA además de la nueva (old + new). El cliente
-- (useCloudSync.js) solo lee payload.new, nunca payload.old, así que
-- FULL solo duplica bytes sin aportar nada. DEFAULT emite solo la PK
-- en el registro viejo.

ALTER TABLE public.sync_documents REPLICA IDENTITY DEFAULT;

-- Verificación (debe devolver 'd' = default; antes devolvía 'f' = full):
--   SELECT relreplident FROM pg_class WHERE relname = 'sync_documents';


-- ─────────────────────────────────────────────────────────────
-- FASE 3.1 — Bucket de Storage para imágenes de productos
-- ─────────────────────────────────────────────────────────────
-- Bucket PÚBLICO (lectura por URL pública, sin auth) con límites
-- defensivos: máx 1 MB por archivo y solo formatos de imagen.
-- Los límites mitigan el abuso del INSERT anónimo (ver nota SEC abajo).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'product-images',
    'product-images',
    true,                                              -- público: lectura por URL sin auth
    1048576,                                           -- 1 MB máx por archivo
    ARRAY['image/webp', 'image/jpeg', 'image/png']     -- solo imágenes
)
ON CONFLICT (id) DO UPDATE SET
    public             = EXCLUDED.public,
    file_size_limit    = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ── Policies de storage.objects (patrón device-based / rol anon) ──
-- Consistente con sync_documents: la app usa la anon key, así que el
-- upload lo hace el rol `anon`. Restringimos por bucket_id.

-- Lectura: explícita para anon + authenticated (además del acceso
-- público del bucket, para permitir list() si se necesita).
DROP POLICY IF EXISTS "product_images_public_read" ON storage.objects;
CREATE POLICY "product_images_public_read" ON storage.objects
    FOR SELECT
    TO anon, authenticated
    USING (bucket_id = 'product-images');

-- Subir imágenes nuevas.
DROP POLICY IF EXISTS "product_images_anon_insert" ON storage.objects;
CREATE POLICY "product_images_anon_insert" ON storage.objects
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (bucket_id = 'product-images');

-- Reemplazar imágenes (upsert: true en el cliente).
DROP POLICY IF EXISTS "product_images_anon_update" ON storage.objects;
CREATE POLICY "product_images_anon_update" ON storage.objects
    FOR UPDATE
    TO anon, authenticated
    USING (bucket_id = 'product-images')
    WITH CHECK (bucket_id = 'product-images');

-- Borrar imágenes (al eliminar/editar un producto).
DROP POLICY IF EXISTS "product_images_anon_delete" ON storage.objects;
CREATE POLICY "product_images_anon_delete" ON storage.objects
    FOR DELETE
    TO anon, authenticated
    USING (bucket_id = 'product-images');


-- ── Verificación del bucket y policies ──
--   SELECT id, public, file_size_limit, allowed_mime_types
--     FROM storage.buckets WHERE id = 'product-images';
--
--   SELECT policyname, cmd, roles
--     FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'objects'
--      AND policyname LIKE 'product_images%';


-- ============================================================
-- NOTA DE SEGURIDAD (SEC)
-- ============================================================
-- Estas policies permiten a CUALQUIERA con la anon key subir/borrar
-- archivos en product-images (mismo modelo de confianza que ya tienes
-- en sync_documents con el rol anon). Mitigaciones ya incluidas:
--   • Límite de 1 MB por archivo.
--   • Solo mime-types de imagen.
-- Si más adelante quieres endurecerlo, la opción es exigir que el path
-- del objeto empiece por un device_id emparejado, p.ej.:
--
--   WITH CHECK (
--       bucket_id = 'product-images'
--       AND EXISTS (
--           SELECT 1 FROM public.device_pairings dp
--           WHERE dp.primary_device_id = (storage.foldername(name))[1]
--       )
--   )
--
-- Eso obliga a que la app suba a la ruta `{device_id}/archivo.webp`.
-- Se puede aplicar en la Fase 3 del código sin cambiar el bucket.
-- ============================================================
