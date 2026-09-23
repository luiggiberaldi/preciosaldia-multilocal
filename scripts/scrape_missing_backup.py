from playwright.sync_api import sync_playwright
import os
import re
import json
import requests
from PIL import Image
from io import BytesIO
import sys

sys.stdout.reconfigure(encoding='utf-8')

CATALOG_PATH = r"C:\Users\luigg\Desktop\pisu_starter\projects\precios al dia\precios al dia rebranding\preciosaldia-bodega\public\images\catalog\catalog.json"
BACKUP_PATH = r"C:\Users\luigg\Desktop\pisu_starter\projects\precios al dia\precios al dia rebranding\preciosaldia-bodega\backup_100_productos.json"
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
        print(f"    Failed to download/save {image_url}: {e}")
    return False

def search_tuzona_playwright(page, query):
    """Searches TuzonaMarket for a matching product image as a fallback."""
    try:
        page.goto("https://tuzonamarket.com/carabobo", timeout=30000)
        page.wait_for_timeout(2000)
        
        search_input = page.locator("input[placeholder*='Buscar'], input[type='text'], input[name='search']").first
        search_input.fill(query)
        search_input.press("Enter")
        page.wait_for_timeout(5000)
        
        images = page.locator("img").all()
        for img in images:
            src = img.get_attribute("src")
            alt = (img.get_attribute("alt") or "").lower()
            try:
                parent_text = img.locator("xpath=./ancestor::*[contains(@class, 'product') or contains(@class, 'item') or position() < 4]").first.inner_text().lower()
            except Exception:
                parent_text = ""
            combined = (alt + " " + parent_text).lower()
            
            # Simple keyword matching
            keywords = [w for w in query.lower().split() if len(w) > 2]
            if all(k in combined for k in keywords):
                if src:
                    return src if src.startswith("http") else f"https://tuzonamarket.com{src}"
    except Exception as e:
        print(f"    Playwright search error for '{query}': {e}")
    return None

def main():
    print("--- STARTING BACKUP PRODUCTS IMAGE SYNC & SCRAPER ---")
    
    if not os.path.exists(CATALOG_PATH):
        print("Catalog JSON not found. Please run the 500 products scraper first.")
        return
        
    with open(CATALOG_PATH, "r", encoding="utf-8") as f:
        catalog = json.load(f)
        
    with open(BACKUP_PATH, "r", encoding="utf-8") as f:
        backup = json.load(f)
        
    catalog_slugs = {item["slug"] for item in catalog}
    catalog_names = {item["name"].lower() for item in catalog}
    
    backup_products = backup["data"]["idb"]["bodega_products_v1"]
    
    missing_products = []
    for bp in backup_products:
        name = bp["name"]
        slug = get_slug(name)
        if slug not in catalog_slugs and name.lower() not in catalog_names:
            missing_products.append(bp)
            
    print(f"Total backup products to process: {len(missing_products)}")
    
    playwright_needed = []
    
    # 1. Download images from Supabase backup URLs first (fast and precise)
    print("\nPhase 1: Downloading images from backup Supabase URLs...")
    for idx, bp in enumerate(missing_products):
        name = bp["name"]
        slug = get_slug(name)
        img_url = bp.get("image")
        
        print(f" [{idx+1}/{len(missing_products)}] Processing: '{name}'")
        
        success = False
        if img_url and img_url.startswith("http"):
            print(f"  Attempting download from: {img_url}")
            success = download_and_save(img_url, slug)
            
        if success:
            catalog.append({
                "name": name,
                "slug": slug,
                "price": bp.get("priceUsd", 0.0),
                "category": bp.get("category", "Víveres"),
                "image_path": f"/images/catalog/{slug}.webp",
                "source_store": "Backup Storage"
            })
            print(f"  SUCCESS: Downloaded and added to catalog.")
        else:
            print(f"  FAILED/NO URL: Queueing for live scraping fallback.")
            playwright_needed.append(bp)
            
    # 2. Fallback Playwright scraping for failed/missing URLs
    if playwright_needed:
        print(f"\nPhase 2: Scraping {len(playwright_needed)} products via Playwright fallbacks...")
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
                viewport={"width": 1366, "height": 768}
            )
            page = context.new_page()
            
            for idx, bp in enumerate(playwright_needed):
                name = bp["name"]
                slug = get_slug(name)
                print(f" [{idx+1}/{len(playwright_needed)}] Live Scraping: '{name}'")
                
                scraped_url = search_tuzona_playwright(page, name)
                if scraped_url:
                    print(f"  Found image URL on TuzonaMarket: {scraped_url}")
                    if download_and_save(scraped_url, slug):
                        catalog.append({
                            "name": name,
                            "slug": slug,
                            "price": bp.get("priceUsd", 0.0),
                            "category": bp.get("category", "Víveres"),
                            "image_path": f"/images/catalog/{slug}.webp",
                            "source_store": "TuzonaMarket Scraper"
                        })
                        print(f"  SUCCESS: Scraped and added to catalog.")
                        continue
                print(f"  FAILED to find image on TuzonaMarket for '{name}'.")
                
            browser.close()
            
    # Save the updated catalog.json
    with open(CATALOG_PATH, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
        
    print("\n--- COMPLETED ---")
    print(f"Updated catalog JSON saved with {len(catalog)} total products.")

if __name__ == "__main__":
    main()
