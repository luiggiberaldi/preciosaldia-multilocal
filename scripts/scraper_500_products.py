from playwright.sync_api import sync_playwright
import os
import re
import json
import requests
from PIL import Image
from io import BytesIO
import sys

sys.stdout.reconfigure(encoding='utf-8')

OUTPUT_DIR = r"C:\Users\luigg\Desktop\pisu_starter\projects\precios al dia\precios al dia rebranding\preciosaldia-bodega\public\images\catalog"
CATALOG_JSON_PATH = os.path.join(OUTPUT_DIR, "catalog.json")

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
    if os.path.exists(filepath):
        return True # Already downloaded
    try:
        r = requests.get(image_url, headers=HEADERS, timeout=15)
        if r.status_code == 200:
            img = Image.open(BytesIO(r.content))
            if img.mode != "RGB":
                img = img.convert("RGB")
            img = img.resize((400, 400), Image.Resampling.LANCZOS)
            img.save(filepath, format="WEBP", quality=75)
            return True
    except Exception as e:
        pass
    return False

def parse_tuzona_card(text):
    """Parses TuzonaMarket card inner text to extract name, price and category."""
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    if len(lines) < 2:
        return None, None, None
        
    price = None
    category = "Víveres"
    
    # 1. Look for price line (e.g. "3,34 $" or "$ 1.45")
    clean_lines = []
    for line in lines:
        if "$" in line:
            # Try to extract the number
            match = re.search(r'[\d.,]+', line)
            if match and not price:
                price = float(match.group().replace(",", "."))
            continue
        if any(w in line.lower() for w in ["iva", "disponibles", "agregar", "prime:", "carrito", "añadir"]):
            continue
        clean_lines.append(line)
        
    if not clean_lines:
        return None, None, None
        
    # The name is usually the longest remaining line or specific length
    name = max(clean_lines, key=len)
    
    # If category exists, it's typically the line before the name or short line
    if len(clean_lines) > 1:
        for idx, line in enumerate(clean_lines):
            if line == name:
                if idx > 0:
                    category = clean_lines[idx - 1]
                break
                
    return name, price, category

def scrape_tuzona(page, catalog, seen_slugs, target_count):
    print("🌐 Scraping TuzonaMarket...")
    try:
        page.goto("https://tuzonamarket.com/carabobo", timeout=60000)
        page.wait_for_timeout(6000)
        
        # Deep scroll to trigger lazy loading of hundreds of products
        print("  Scrolling page deeply to load products...")
        for i in range(40):
            page.mouse.wheel(0, 1500)
            page.wait_for_timeout(350)
            if len(seen_slugs) >= target_count:
                break
                
        page.wait_for_timeout(4000)
        
        cards = page.locator("div.item-prod").all()
        print(f"  Found {len(cards)} product cards on TuzonaMarket.")
        
        added = 0
        for card in cards:
            if len(catalog) >= target_count:
                break
            try:
                text = card.inner_text()
                name, price, category = parse_tuzona_card(text)
                if not name:
                    continue
                    
                slug = get_slug(name)
                if slug in seen_slugs:
                    continue
                    
                # Find image inside card
                img_element = card.locator("img").first
                if img_element.count() > 0:
                    src = img_element.get_attribute("src")
                    if src:
                        img_url = src if src.startswith("http") else f"https://tuzonamarket.com{src}"
                        if download_and_save(img_url, slug):
                            catalog.append({
                                "name": name,
                                "slug": slug,
                                "price": price or 0.0,
                                "category": category,
                                "image_path": f"/images/catalog/{slug}.webp",
                                "source_store": "TuzonaMarket"
                            })
                            seen_slugs.add(slug)
                            added += 1
            except Exception:
                pass
        print(f"  Successfully added {added} products from TuzonaMarket.")
    except Exception as e:
        print(f"  Error scraping TuzonaMarket: {e}")

def scrape_caraota(page, catalog, seen_slugs, target_count):
    print("🌐 Scraping Caraota Market...")
    try:
        page.goto("https://caraotamarket.com/", timeout=60000)
        page.wait_for_timeout(5000)
        
        print("  Scrolling page deeply to load products...")
        for i in range(25):
            page.mouse.wheel(0, 1500)
            page.wait_for_timeout(350)
            if len(seen_slugs) >= target_count:
                break
                
        page.wait_for_timeout(3000)
        
        cards = page.locator(".product-miniature").all()
        print(f"  Found {len(cards)} product cards on Caraota Market.")
        
        added = 0
        for card in cards:
            if len(catalog) >= target_count:
                break
            try:
                name_element = card.locator(".product-title, h3 a, h2 a, a.product-name").first
                name = name_element.inner_text().strip() if name_element.count() > 0 else None
                if not name:
                    continue
                    
                slug = get_slug(name)
                if slug in seen_slugs:
                    continue
                    
                # Price
                price_element = card.locator(".price, .product-price").first
                price = None
                if price_element.count() > 0:
                    match = re.search(r'[\d.,]+', price_element.inner_text())
                    if match:
                        price = float(match.group().replace(",", "."))
                        
                # Image
                img_element = card.locator("img").first
                if img_element.count() > 0:
                    src = img_element.get_attribute("src")
                    if src:
                        img_url = src if src.startswith("http") else f"https://caraotamarket.com{src}"
                        if download_and_save(img_url, slug):
                            catalog.append({
                                "name": name,
                                "slug": slug,
                                "price": price or 0.0,
                                "category": "Víveres",
                                "image_path": f"/images/catalog/{slug}.webp",
                                "source_store": "Caraota Market"
                            })
                            seen_slugs.add(slug)
                            added += 1
            except Exception:
                pass
        print(f"  Successfully added {added} products from Caraota Market.")
    except Exception as e:
        print(f"  Error scraping Caraota Market: {e}")

def scrape_instamarket_catalog(page, catalog, seen_slugs, target_count):
    print("🌐 Scraping InstaMarket...")
    try:
        page.goto("https://instamarketca.com/shop/", timeout=60000)
        page.wait_for_timeout(5000)
        
        print("  Scrolling page deeply to load products...")
        for i in range(25):
            page.mouse.wheel(0, 1500)
            page.wait_for_timeout(350)
            if len(seen_slugs) >= target_count:
                break
                
        page.wait_for_timeout(3000)
        
        cards = page.locator("li.product").all()
        print(f"  Found {len(cards)} product cards on InstaMarket.")
        
        added = 0
        for card in cards:
            if len(catalog) >= target_count:
                break
            try:
                name_element = card.locator(".woocommerce-loop-product__title, h2, h3, a.product-title").first
                name = name_element.inner_text().strip() if name_element.count() > 0 else None
                if not name:
                    continue
                    
                slug = get_slug(name)
                if slug in seen_slugs:
                    continue
                    
                # Price
                price_element = card.locator(".price, .woocommerce-Price-amount").first
                price = None
                if price_element.count() > 0:
                    match = re.search(r'[\d.,]+', price_element.inner_text())
                    if match:
                        price = float(match.group().replace(",", "."))
                        
                # Image
                img_element = card.locator("img").first
                if img_element.count() > 0:
                    src = img_element.get_attribute("src")
                    if src:
                        if src.startswith("//"):
                            img_url = f"https:{src}"
                        else:
                            img_url = src if src.startswith("http") else f"https://instamarketca.com{src}"
                        if download_and_save(img_url, slug):
                            catalog.append({
                                "name": name,
                                "slug": slug,
                                "price": price or 0.0,
                                "category": "Víveres",
                                "image_path": f"/images/catalog/{slug}.webp",
                                "source_store": "InstaMarket"
                            })
                            seen_slugs.add(slug)
                            added += 1
            except Exception:
                pass
        print(f"  Successfully added {added} products from InstaMarket.")
    except Exception as e:
        print(f"  Error scraping InstaMarket: {e}")

def main():
    print("--- STARTING 500 SUPERMARKET PRODUCTS SCRAPER ---")
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    catalog = []
    seen_slugs = set()
    target_count = 500
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            viewport={"width": 1366, "height": 768}
        )
        page = context.new_page()
        
        # 1. Scrape TuzonaMarket
        scrape_tuzona(page, catalog, seen_slugs, target_count)
        
        # 2. Scrape Caraota Market if needed
        if len(catalog) < target_count:
            scrape_caraota(page, catalog, seen_slugs, target_count)
            
        # 3. Scrape InstaMarket if needed
        if len(catalog) < target_count:
            scrape_instamarket_catalog(page, catalog, seen_slugs, target_count)
            
        browser.close()
        
    # Save the catalog.json index
    with open(CATALOG_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
        
    print(f"\n--- COMPLETED ---")
    print(f"Scraped and saved {len(catalog)} products to public/images/catalog/")
    print(f"Catalog JSON index saved to: {CATALOG_JSON_PATH}")

if __name__ == "__main__":
    main()
