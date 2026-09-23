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
        return "papel higienico euro"
    if name_upper == "KETCHUP":
        return "salsa de tomate ketchup"
    if name_upper == "TRIFOGON":
        return "chupeta trifogon"
    if name_upper == "LA PAMPA":
        return "margarina la pampa"
    if name_upper == "AURORA SOYA":
        return "aceite de soya aurora"
    if name_upper == "SARDINES OIL":
        return "sardinas en aceite"
    if name_upper == "TWISTI":
        return "twisti dulce"
    if name_upper == "ALISOFT PAPEL":
        return "papel higienico alisoft"
        
    if name_upper.startswith("TOM "):
        flavor = name_upper.replace("TOM ", "").strip()
        return f"chupeta tom sabor {flavor}"
        
    if "BAMBOO" in name_upper:
        return "papel higienico bamboo"
        
    if "DOÑA TITA" in name_upper or "DONA TITA" in name_upper:
        item = name_upper.replace("DOÑA TITA", "").replace("DONA TITA", "").strip()
        return f"{item} dona tita"
        
    if "CAPRI" in name_upper:
        item = name_upper.replace("CAPRI", "").strip()
        return f"{item} capri"
        
    if "PAZCUM" in name_upper:
        item = name_upper.replace("PAZCUM", "").strip()
        return f"{item} pazcum"
        
    return f"{name} venezuela"

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

def scrape_tuzona_search(page, query):
    """Searches TuzonaMarket search endpoint."""
    try:
        page.goto("https://tuzonamarket.com/carabobo", timeout=20000)
        page.wait_for_timeout(2000)
        
        search_input = page.locator("input[placeholder*='Buscar'], input[type='text'], input[name='search']").first
        search_input.fill(query)
        search_input.press("Enter")
        page.wait_for_timeout(4000)
        
        images = page.locator("img").all()
        for img in images:
            src = img.get_attribute("src")
            alt = (img.get_attribute("alt") or "").lower()
            try:
                parent_text = img.locator("xpath=./ancestor::*[contains(@class, 'product') or contains(@class, 'item') or position() < 4]").first.inner_text().lower()
            except Exception:
                parent_text = ""
            combined = (alt + " " + parent_text).lower()
            
            keywords = [w for w in query.lower().split() if len(w) > 2]
            if all(k in combined for k in keywords):
                if src:
                    return src if src.startswith("http") else f"https://tuzonamarket.com{src}"
    except Exception as e:
        print(f"    TuzonaMarket search failed: {e}")
    return None

def scrape_caraota_search(page, query):
    """Searches Caraota Market search endpoint."""
    try:
        page.goto(f"https://caraotamarket.com/buscar?controller=search&s={query}", timeout=20000)
        page.wait_for_timeout(4000)
        
        images = page.locator(".product-miniature img, img").all()
        for img in images[:8]:
            src = img.get_attribute("src")
            alt = (img.get_attribute("alt") or "").lower()
            if src and src.startswith("http") and not any(x in src for x in [".svg", ".gif", "logo"]):
                return src
    except Exception as e:
        print(f"    Caraota Market search failed: {e}")
    return None

def scrape_instamarket_search(page, query):
    """Searches InstaMarket search endpoint."""
    try:
        page.goto(f"https://instamarketca.com/search?q={query}", timeout=20000)
        page.wait_for_timeout(4000)
        
        images = page.locator("li.product img, img").all()
        for img in images[:8]:
            src = img.get_attribute("src")
            if src:
                if src.startswith("//"):
                    src = f"https:{src}"
                if src.startswith("http") and not any(x in src for x in [".svg", ".gif", "logo"]):
                    return src
    except Exception as e:
        print(f"    InstaMarket search failed: {e}")
    return None

def scrape_yahoo_image(page, query):
    """Navigates Yahoo Images search fallback."""
    try:
        page.goto(f"https://images.search.yahoo.com/search/images?p={query}", timeout=20000)
        page.wait_for_timeout(3000)
        
        images = page.locator("li.ld img, img").all()
        for img in images[:10]:
            src = img.get_attribute("src")
            if src and src.startswith("http") and not any(x in src for x in [".svg", ".gif", "yahoo.com/rp", "logo"]):
                return src
    except Exception as e:
        print(f"    Yahoo Images search failed: {e}")
    return None

def main():
    print("--- STARTING MULTI-STORE SEQUENTIAL IMPORTABLE SCRAPER ---")
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    if not os.path.exists(CATALOG_PATH):
        print("Catalog JSON not found.")
        return
        
    with open(CATALOG_PATH, "r", encoding="utf-8") as f:
        catalog = json.load(f)
        
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
            
    print(f"Total importable products to scrape: {len(missing_products)}")
    
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
            
            print(f" [{idx+1}/{len(missing_products)}] Scraping: '{name}' (query: '{query}')")
            
            img_url = None
            source_store = "Web Scraper"
            
            try:
                # 1. TuzonaMarket
                img_url = scrape_tuzona_search(page, query)
                if img_url:
                    source_store = "TuzonaMarket"
                    
                # 2. Caraota Market
                if not img_url:
                    print("  TuzonaMarket missed. Trying Caraota Market...")
                    img_url = scrape_caraota_search(page, query)
                    if img_url:
                        source_store = "Caraota Market"
                        
                # 3. InstaMarket
                if not img_url:
                    print("  Caraota Market missed. Trying InstaMarket...")
                    img_url = scrape_instamarket_search(page, query)
                    if img_url:
                        source_store = "InstaMarket"
                        
                # 4. Yahoo Images Fallback (covers Cocomercado, Gama, etc.)
                if not img_url:
                    print("  Supermarket searches missed. Trying Yahoo Images fallback...")
                    img_url = scrape_yahoo_image(page, query)
                    if img_url:
                        source_store = "Yahoo Images Fallback"
                        
                if img_url:
                    print(f"  Found image URL ({source_store}): {img_url[:75]}...")
                    if download_and_save(img_url, slug):
                        catalog.append({
                            "name": name,
                            "slug": slug,
                            "price": bp.get("priceUsd", 0.0),
                            "category": bp.get("category", "Varios"),
                            "image_path": f"/images/catalog/{slug}.webp",
                            "source_store": source_store
                        })
                        print("  SUCCESS: Saved and indexed.")
                        added_count += 1
                        
                        # Save immediately
                        with open(CATALOG_PATH, "w", encoding="utf-8") as f:
                            json.dump(catalog, f, ensure_ascii=False, indent=2)
                    else:
                        print("  FAILED to download/save image.")
                else:
                    print("  FAILED to find image across all stores.")
            except Exception as loop_err:
                print(f"  ERROR processing '{name}': {loop_err}")
                
            time.sleep(1.5) # Polite delay
            
        browser.close()
        
    print("\n--- COMPLETED ---")
    print(f"Scraped and added {added_count} products.")
    print(f"Total catalog products: {len(catalog)}")

if __name__ == "__main__":
    main()
