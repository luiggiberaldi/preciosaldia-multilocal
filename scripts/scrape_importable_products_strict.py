from playwright.sync_api import sync_playwright
import os
import re
import json
import requests
from PIL import Image
from io import BytesIO
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')

CATALOG_PATH = r"C:\Users\luigg\Desktop\pisu_starter\projects\precios al dia\precios al dia rebranding\preciosaldia-bodega\public\images\catalog\catalog.json"
IMPORTABLE_PATH = r"C:\Users\luigg\Desktop\pisu_starter\projects\precios al dia\precios al dia rebranding\preciosaldia-bodega\backup_inventario_importable.json"
OUTPUT_DIR = r"C:\Users\luigg\Desktop\pisu_starter\projects\precios al dia\precios al dia rebranding\preciosaldia-bodega\public\images\catalog"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
}

def get_slug(name):
    s = name.lower()
    s = s.replace("á", "a").replace("é", "e").replace("í", "i").replace("ó", "o").replace("ú", "u")
    s = s.replace("ñ", "n")
    s = re.sub(r'[^a-z0-9\s-]', '', s)
    s = re.sub(r'[\s-]+', '-', s)
    return s.strip("-")

def get_search_query(name):
    name_upper = name.upper().strip()
    
    if name_upper == "EURO":
        return "papel higienico"
    if name_upper == "KETCHUP":
        return "ketchup"
    if name_upper == "TRIFOGON":
        return "chupeta"
    if name_upper == "LA PAMPA":
        return "margarina"
    if name_upper == "AURORA SOYA":
        return "aceite"
    if name_upper == "SARDINES OIL":
        return "sardinas"
    if name_upper == "TWISTI":
        return "dulce"
    if name_upper == "ALISOFT PAPEL":
        return "papel higienico"
        
    if name_upper.startswith("TOM "):
        flavor = name_upper.replace("TOM ", "").strip()
        return f"chupeta {flavor}"
        
    if "BAMBOO" in name_upper:
        return "papel higienico"
        
    if "DOÑA TITA" in name_upper or "DONA TITA" in name_upper:
        item = name_upper.replace("DOÑA TITA", "").replace("DONA TITA", "").strip()
        return f"{item}"
        
    if "CAPRI" in name_upper:
        item = name_upper.replace("CAPRI", "").strip()
        return f"{item}"
        
    if "PAZCUM" in name_upper:
        item = name_upper.replace("PAZCUM", "").strip()
        return f"{item}"
        
    return name

def download_and_save(image_url, slug):
    filepath = os.path.join(OUTPUT_DIR, f"{slug}.webp")
    try:
        r = requests.get(image_url, headers=HEADERS, timeout=15)
        if r.status_code == 200:
            img = Image.open(BytesIO(r.content))
            if img.mode != "RGB":
                img = img.convert("RGB")
            img = img.resize((400, 400), Image.Resampling.LANCZOS)
            img.save(filepath, format="WEBP", quality=80)
            return True
    except Exception as e:
        print(f"    Failed download from {image_url[:50]}...: {e}")
    return False

# --- STORE SCRAPERS ---

def scrape_tuzona(page, query):
    """Search TuzonaMarket for a product image by text match in product cards."""
    try:
        page.goto(f"https://tuzonamarket.com/carabobo/buscar?q={query}", timeout=25000)
        page.wait_for_timeout(5000)
        
        cards = page.locator("div.item-prod, div[class*='product'], div[class*='item']").all()
        for card in cards:
            try:
                text = card.inner_text().lower()
                keywords = [w for w in query.lower().split() if len(w) > 2]
                if all(k in text for k in keywords):
                    img = card.locator("img").first
                    if img.count() > 0:
                        src = img.get_attribute("src")
                        if src and src.startswith("http"):
                            return src
            except Exception:
                pass
    except Exception: pass
    return None

def scrape_cocomercado(page, query):
    """Search Cocomercado for a product image by text search, extract image from product card."""
    try:
        page.goto("https://www.cocomercado.com/", timeout=25000)
        page.wait_for_timeout(4000)
        search_input = page.locator("input[placeholder*='buscar'], input[placeholder*='Buscar'], input[type='text']").first
        search_input.fill(query)
        search_input.press("Enter")
        page.wait_for_timeout(6000)
        
        # Cocomercado renders images via CDN with ImageKit
        images = page.locator("img").all()
        for img in images:
            src = img.get_attribute("src") or ""
            # ImageKit URLs contain 'imagekit.io' or 'cloudfront.net' - skip logos/svg
            if ("imagekit.io" in src or "cloudfront.net" in src) and not any(x in src for x in [".svg", ".gif", "logo"]):
                return src
    except Exception: pass
    return None

def main():
    print("--- STARTING STRICT 5-STORES PORTAL SCRAPER ---")
    
    if not os.path.exists(CATALOG_PATH):
        print("Catalog JSON not found.")
        return
        
    with open(CATALOG_PATH, "r", encoding="utf-8") as f:
        catalog = json.load(f)
        
    # --- CLEANUP NON-STRICT ITEMS FROM PREVIOUS RUNS ---
    clean_catalog = []
    removed_count = 0
    allowed_stores = ["TuzonaMarket", "Caraota Market", "InstaMarket", "Gama en Línea", "Coco Mercado", "Backup Storage"]
    
    for item in catalog:
        if item.get("source_store") in allowed_stores:
            clean_catalog.append(item)
        else:
            # Delete local file
            slug = item["slug"]
            filepath = os.path.join(OUTPUT_DIR, f"{slug}.webp")
            if os.path.exists(filepath):
                try:
                    os.remove(filepath)
                except Exception: pass
            removed_count += 1
            
    print(f"Cleaned up {removed_count} temporary fallback items from catalog.")
    catalog = clean_catalog
    
    # Save clean starting state
    with open(CATALOG_PATH, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
        
    with open(IMPORTABLE_PATH, "r", encoding="utf-8") as f:
        importable = json.load(f)
        
    catalog_slugs = {item["slug"] for item in catalog}
    catalog_names = {item["name"].lower() for item in catalog}
    
    importable_products = importable["data"]["idb"]["bodega_products_v1"]
    
    missing_products = []
    for bp in importable_products:
        name = bp["name"]
        slug = get_slug(name)
        if slug not in catalog_slugs and name.lower() not in catalog_names:
            missing_products.append(bp)
            
    print(f"Total importable products to check strictly: {len(missing_products)}")
    
    if not missing_products:
        print("All products are already present in the catalog.")
        return
        
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            viewport={"width": 1366, "height": 768}
        )
        page = context.new_page()
        
        added_count = 0
        for idx, bp in enumerate(missing_products):
            name = bp["name"]
            slug = get_slug(name)
            query = get_search_query(name)
            
            print(f" [{idx+1}/{len(missing_products)}] Strict Scrape: '{name}' (query: '{query}')")
            
            img_url = None
            source_store = None
            
            try:
                # 1. TuzonaMarket
                img_url = scrape_tuzona(page, query)
                if img_url: source_store = "TuzonaMarket"
                
                # 2. Coco Mercado
                if not img_url:
                    img_url = scrape_cocomercado(page, query)
                    if img_url: source_store = "Coco Mercado"
                    
                if img_url:
                    print(f"  Found image on registered store ({source_store}): {img_url[:75]}...")
                    if download_and_save(img_url, slug):
                        catalog.append({
                            "name": name,
                            "slug": slug,
                            "price": bp.get("priceUsd", 0.0),
                            "category": bp.get("category", "Varios"),
                            "image_path": f"/images/catalog/{slug}.webp",
                            "source_store": source_store
                        })
                        print("  SUCCESS: Saved and indexed strictly.")
                        added_count += 1
                        
                        # Save catalog immediately
                        with open(CATALOG_PATH, "w", encoding="utf-8") as f:
                            json.dump(catalog, f, ensure_ascii=False, indent=2)
                    else:
                        print("  FAILED to download/save image.")
                else:
                    print("  SKIPPED: Not found in TuzonaMarket or Cocomercado.")
            except Exception as loop_err:
                print(f"  ERROR processing '{name}': {loop_err}")
                
            time.sleep(1.5)
            
        browser.close()
        
    print("\n--- COMPLETED ---")
    print(f"Scraped and added {added_count} products (TuzonaMarket + Cocomercado only).")
    print(f"Total catalog products: {len(catalog)}")

if __name__ == "__main__":
    main()
