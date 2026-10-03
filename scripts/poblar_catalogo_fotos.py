#!/usr/bin/env python3
"""
poblar_catalogo_fotos.py — Puebla product_images_catalog en un proyecto Supabase.

Fuentes:
  1. Catálogo del Lite (public/images/catalog): imágenes genéricas de productos,
     ya nombradas con slug. Se SUBEN al bucket del proyecto destino.
  2. Fotos existentes de Pro (mapeo_fotos_bodega.json): ya están en el bucket;
     solo se registran en el catálogo con nombre/slug/tags correctos para que
     la búsqueda automática (api/search-image.js) las encuentre.

Idempotente: las subidas usan upsert y las filas se insertan con
on_conflict=id (las de Pro pisan a las de Lite si colisiona el slug).

Uso:
  python3 poblar_catalogo_fotos.py \
    --supabase-url https://xyz.supabase.co \
    --service-key "$SUPABASE_SERVICE_KEY" \
    --lite-catalog ~/workspace/preciosaldia2026/public/images/catalog \
    --pro-mapeo ~/workspace/inventarios-limpios/mapeo_fotos_bodega.json

  --dry-run      : no sube ni escribe nada, solo reporta lo que haría.
  --skip-upload  : no sube imágenes (ya están), solo puebla el catálogo.
  --self-test    : valida la generación de slugs contra casos conocidos.

Requiere la service_role key (DDL ya aplicado: supabase/migrations/005).
"""
import argparse
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("falta 'requests': pip install requests")


def get_slug(name: str) -> str:
    """Réplica exacta del getSlug de api/search-image.js."""
    s = unicodedata.normalize("NFD", name.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"(^-|-$)+", "", s)
    return s


def tags_for(slug: str, name: str):
    words = set()
    for token in re.split(r"[\s\-_]+", f"{slug} {name.lower()}"):
        t = get_slug(token)
        if len(t) > 2:
            words.add(t)
    return sorted(words)


def self_test():
    cases = {
        "MAYONESA MAVESA 445GR": "mayonesa-mavesa-445gr",
        "Harina PAN 1kg": "harina-pan-1kg",
        "Aceite De Argán OGX 100ml": "aceite-de-argan-ogx-100ml",
        "7UP 2L": "7up-2l",
    }
    ok = True
    for inp, exp in cases.items():
        got = get_slug(inp)
        status = "PASS" if got == exp else "FAIL"
        print(f"{status} | slug({inp!r}) = {got!r}" + ("" if got == exp else f" esperado {exp!r}"))
        ok = ok and got == exp
    # tags
    t = tags_for("mayonesa-mavesa-445gr", "MAYONESA MAVESA 445GR")
    ok2 = "mayonesa" in t and "mavesa" in t and "445gr" in t
    print(("PASS" if ok2 else "FAIL") + f" | tags = {t}")
    return ok and ok2


class Supa:
    def __init__(self, url, key, dry_run=False):
        self.url = url.rstrip("/")
        self.key = key
        self.dry = dry_run
        self.h = {"apikey": key, "Authorization": f"Bearer {key}"}

    def storage_exists(self, bucket, path):
        r = requests.head(f"{self.url}/storage/v1/object/{bucket}/{path}", headers=self.h, timeout=30)
        return r.status_code == 200

    def storage_upload(self, bucket, path, data, content_type):
        if self.dry:
            return True
        h = dict(self.h, **{"Content-Type": content_type, "x-upsert": "true"})
        r = requests.post(f"{self.url}/storage/v1/object/{bucket}/{path}", headers=h, data=data, timeout=120)
        if r.status_code not in (200, 201):
            print(f"  !! upload {path}: {r.status_code} {r.text[:120]}")
            return False
        return True

    def catalog_upsert(self, rows):
        if self.dry:
            return True
        h = dict(self.h, **{"Content-Type": "application/json", "Prefer": "resolution=merge-duplicates"})
        r = requests.post(
            f"{self.url}/rest/v1/product_images_catalog?on_conflict=id",
            headers=h, data=json.dumps(rows), timeout=120,
        )
        if r.status_code not in (200, 201, 204):
            print(f"  !! upsert: {r.status_code} {r.text[:200]}")
            return False
        return True

    def catalog_count(self):
        r = requests.get(
            f"{self.url}/rest/v1/product_images_catalog?select=id",
            headers=dict(self.h, **{"Prefer": "count=exact", "Range": "0-0"}),
            timeout=30,
        )
        m = re.search(r"/(\d+)$", r.headers.get("Content-Range", ""))
        return int(m.group(1)) if m else None


CT = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".png": "image/png"}


def collect_lite(lite_dir: Path):
    """Agrupa por slug; prefiere .webp sobre .jpg."""
    by_slug = {}
    for f in sorted(lite_dir.rglob("*")):
        if not f.is_file() or f.suffix.lower() not in CT:
            continue
        slug = f.stem  # el nombre ya es slug
        cur = by_slug.get(slug)
        if cur is None or (f.suffix.lower() == ".webp" and cur.suffix.lower() != ".webp"):
            by_slug[slug] = f
    return by_slug


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--supabase-url", default=os.environ.get("SUPABASE_URL", ""))
    ap.add_argument("--service-key", default=os.environ.get("SUPABASE_SERVICE_KEY", ""))
    ap.add_argument("--lite-catalog", default="")
    ap.add_argument("--pro-mapeo", default="")
    ap.add_argument("--bucket", default="product-images")
    ap.add_argument("--catalog-prefix", default="catalog/")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--skip-upload", action="store_true")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()

    if a.self_test:
        sys.exit(0 if self_test() else 1)
    if not a.supabase_url or not a.service_key:
        sys.exit("faltan --supabase-url y --service-key (o env SUPABASE_URL / SUPABASE_SERVICE_KEY)")

    supa = Supa(a.supabase_url, a.service_key, dry_run=a.dry_run)
    ref = a.supabase_url.split("//", 1)[1].split(".", 1)[0]
    rows = []
    stats = {"lite_up": 0, "lite_skip": 0, "pro": 0, "lite_rows": 0}

    # ── 1. Lite: subir imágenes ──────────────────────────────
    lite_by_slug = {}
    if a.lite_catalog:
        lite_by_slug = collect_lite(Path(a.lite_catalog))
        print(f"Lite: {len(lite_by_slug)} slugs únicos")
        for slug, f in lite_by_slug.items():
            dest = f"{a.catalog_prefix}{f.name}"
            if a.skip_upload:
                stats["lite_skip"] += 1
            elif supa.storage_exists(a.bucket, dest):
                stats["lite_skip"] += 1
            else:
                ok = supa.storage_upload(a.bucket, dest, f.read_bytes(), CT[f.suffix.lower()])
                stats["lite_up" if ok else "lite_skip"] += 1
            url = f"{a.supabase_url}/storage/v1/object/public/{a.bucket}/{dest}"
            name = slug.replace("-", " ").title()
            rows.append({"id": slug, "name": name, "image_url": url,
                         "tags": tags_for(slug, name), "source": "lite"})
            stats["lite_rows"] += 1
        print(f"  subidas: {stats['lite_up']}, ya existían/omitidas: {stats['lite_skip']}")

    # ── 2. Pro: registrar fotos existentes ───────────────────
    if a.pro_mapeo:
        mapeo = json.loads(Path(a.pro_mapeo).read_text())
        seen = set()
        for fname, info in mapeo.items():
            pname = (info.get("producto_excel") or "").strip()
            if not pname:
                continue
            slug = get_slug(pname)
            if not slug or slug in seen:
                continue
            seen.add(slug)
            url = f"{a.supabase_url}/storage/v1/object/public/{a.bucket}/{fname}"
            rows.append({"id": slug, "name": pname, "image_url": url,
                         "tags": tags_for(slug, pname), "source": "pro"})
            stats["pro"] += 1
        print(f"Pro: {stats['pro']} fotos registradas del mapeo")

    # ── 3. Upsert al catálogo (Pro pisa a Lite en colisiones) ─
    # Lite ya está primero en `rows`; al hacer upsert por lotes, el último gana.
    print(f"Total filas al catálogo: {len(rows)} (dry_run={a.dry_run})")
    ok_all = True
    for i in range(0, len(rows), 500):
        if not supa.catalog_upsert(rows[i:i + 500]):
            ok_all = False
    before = supa.catalog_count()
    print(f"Filas en catálogo tras upsert: {before}")
    print("OK" if ok_all else "HUBO ERRORES")
    # Nota ref para verificar URLs:
    print(f"Ref proyecto: {ref}")


if __name__ == "__main__":
    main()
