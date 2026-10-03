-- 005_product_images_catalog.sql
-- Catálogo de imágenes de productos para la búsqueda automática de fotos
-- (api/search-image.js lo consulta por slug exacto y por coincidencia de tags).
--
-- Cada fila: id = slug del producto (PK), name legible, image_url pública,
-- tags[] para la búsqueda parcial, source = 'lite' | 'pro' | 'manual'.
-- Se puebla con scripts/poblar_catalogo_fotos.py (idempotente, upsert).

create table if not exists public.product_images_catalog (
    id text primary key,
    name text not null,
    image_url text not null,
    tags text[] not null default '{}',
    source text not null default 'manual',
    created_at timestamptz not null default now()
);

create index if not exists idx_product_images_catalog_tags
    on public.product_images_catalog using gin (tags);

alter table public.product_images_catalog enable row level security;

drop policy if exists "catalogo lectura publica" on public.product_images_catalog;
create policy "catalogo lectura publica"
    on public.product_images_catalog
    for select
    using (true);
