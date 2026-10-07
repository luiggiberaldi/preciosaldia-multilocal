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
        print(f"    Failed download from {image_url[:60]}...: {e}")
    return False

def scrape_bing_image(page, query):
    """Navigates Bing Images and retrieves the first actual product image link."""
    try:
        page.goto(f"https://www.bing.com/images/search?q={query}", timeout=25000)
        page.wait_for_timeout(2000)
        
        images = page.locator("img.mimg, img").all()
        for img in images[:12]:
            src = img.get_attribute("src")
            if src and src.startswith("http"):
                # Filter out SVGs, tracking pixels, or Bing icons
                if not any(x in src for x in [".svg", ".gif", "r.bing.com", "logo"]):
                    return src
    except Exception as e:
        print(f"    Search error: {e}")
    return None

def main():
    print("--- STARTING IMPORTABLE PRODUCTS IMAGE SCRAPER ---")
    
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
            
            img_url = scrape_bing_image(page, query)
            if img_url:
                print(f"  Found image URL: {img_url[:80]}...")
                if download_and_save(img_url, slug):
                    catalog.append({
                        "name": name,
                        "slug": slug,
                        "price": bp.get("priceUsd", 0.0),
                        "category": bp.get("category", "Varios"),
                        "image_path": f"/images/catalog/{slug}.webp",
                        "source_store": "Web Scraper"
                    })
                    print("  SUCCESS: Saved and indexed.")
                    added_count += 1
                    
                    # Periodic save of catalog to prevent data loss
                    if added_count % 10 == 0:
                        with open(CATALOG_PATH, "w", encoding="utf-8") as f:
                            json.dump(catalog, f, ensure_ascii=False, indent=2)
                else:
                    print("  FAILED to download/save image.")
            else:
                print("  FAILED to find image.")
                
            time.sleep(1) # Polite delay between searches
            
        browser.close()
        
    # Final save
    with open(CATALOG_PATH, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
        
    print("\n--- COMPLETED ---")
    print(f"Scraped and added {added_count} products.")
    print(f"Total catalog products: {len(catalog)}")

if __name__ == "__main__":
    main()
