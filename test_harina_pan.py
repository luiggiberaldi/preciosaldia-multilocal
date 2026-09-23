from playwright.sync_api import sync_playwright
import os
import requests
from PIL import Image
from io import BytesIO
import sys

sys.stdout.reconfigure(encoding='utf-8')

OUTPUT_DIR = r"C:\Users\luigg\Desktop\pisu_starter\projects\precios al dia\precios al dia rebranding\preciosaldia-bodega\imagenes productos"

def download_and_save(image_url, name):
    filepath = os.path.join(OUTPUT_DIR, f"{name}.webp")
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    }
    try:
        r = requests.get(image_url, headers=headers, timeout=15)
        if r.status_code == 200:
            img = Image.open(BytesIO(r.content))
            if img.mode != "RGB":
                img = img.convert("RGB")
            img = img.resize((400, 400), Image.Resampling.LANCZOS)
            img.save(filepath, format="WEBP", quality=85)
            print(f"  SUCCESS: Saved {name}.webp from {image_url}")
            return True
        else:
            print(f"  FAILED: Status code {r.status_code} for {image_url}")
    except Exception as e:
        print(f"  FAILED: Error saving {name}: {e}")
    return False

def scrape_tuzona(page):
    print("\n[1/5] Scraping tuzonamarket...")
    page.goto("https://tuzonamarket.com/carabobo", timeout=45000)
    page.wait_for_timeout(3000)
    
    search_input = page.locator("input[placeholder*='Buscar'], input[type='text'], input[name='search']").first
    search_input.fill("Harina PAN")
    search_input.press("Enter")
    page.wait_for_timeout(6000)
    
    images = page.locator("img").all()
    print(f"  Found {len(images)} images.")
    for img in images:
        src = img.get_attribute("src")
        alt = img.get_attribute("alt") or ""
        try:
            parent_text = img.locator("xpath=./ancestor::*[contains(@class, 'product') or contains(@class, 'card') or contains(@class, 'item') or position() < 5]").first.inner_text().lower()
        except Exception:
            parent_text = ""
        combined = (alt + " " + parent_text).lower()
        if "harina" in combined and "pan" in combined:
            if src and src.startswith("http"): return src
            elif src and src.startswith("/"): return f"https://tuzonamarket.com{src}"
            
    # Fallback
    for img in images:
        src = img.get_attribute("src")
        if src and "product" in src:
            return src if src.startswith("http") else f"https://tuzonamarket.com{src}"
    return None

def scrape_gama(page):
    print("\n[2/5] Scraping gamaenlinea...")
    page.goto("https://gamaenlinea.com/es/search/?text=harina+pan", timeout=45000)
    # Wait longer for the search results overlay to render products
    page.wait_for_timeout(10000)
    
    images = page.locator("img").all()
    print(f"  Found {len(images)} images.")
    for img in images:
        src = img.get_attribute("src")
        alt = img.get_attribute("alt") or ""
        try:
            parent_text = img.locator("xpath=./ancestor::*[contains(@class, 'product') or position() < 4]").first.inner_text().lower()
        except Exception:
            parent_text = ""
        combined = (alt + " " + parent_text).lower()
        if "harina" in combined and "pan" in combined:
            if src: return src if src.startswith("http") else f"https://gamaenlinea.com{src}"
            
    # Fallback
    for img in images:
        src = img.get_attribute("src")
        if src and ("large" in src or "product" in src):
            return src if src.startswith("http") else f"https://gamaenlinea.com{src}"
    return None

def scrape_instamarket(page):
    print("\n[3/5] Scraping instamarket...")
    page.goto("https://instamarketca.com/search?q=harina+pan", timeout=45000)
    page.wait_for_timeout(8000)
    
    images = page.locator("img").all()
    print(f"  Found {len(images)} images.")
    for img in images:
        src = img.get_attribute("src")
        alt = img.get_attribute("alt") or ""
        try:
            parent_text = img.locator("xpath=./ancestor::*[position() < 4]").first.inner_text().lower()
        except Exception:
            parent_text = ""
        combined = (alt + " " + parent_text).lower()
        if "harina" in combined and "pan" in combined:
            if src:
                if src.startswith("//"): return f"https:{src}"
                return src
    # Fallback
    for img in images:
        src = img.get_attribute("src")
        if src and "products" in src:
            if src.startswith("//"): return f"https:{src}"
            return src
    return None

def scrape_cocomercado(page):
    print("\n[4/5] Scraping cocomercado...")
    page.goto("https://www.cocomercado.com/", timeout=45000)
    page.wait_for_timeout(6000)
    
    # Try to find and fill search input
    try:
        search_input = page.locator("input[placeholder*='buscar'], input[placeholder*='Buscar'], input[type='text']").first
        search_input.fill("Harina PAN")
        search_input.press("Enter")
        page.wait_for_timeout(8000)
    except Exception as e:
        print(f"  Search input failed: {e}")
        
    images = page.locator("img").all()
    print(f"  Found {len(images)} images.")
    for img in images:
        src = img.get_attribute("src")
        alt = img.get_attribute("alt") or ""
        try:
            parent_text = img.locator("xpath=./ancestor::*[position() < 4]").first.inner_text().lower()
        except Exception:
            parent_text = ""
        combined = (alt + " " + parent_text).lower()
        if "harina" in combined and "pan" in combined:
            if src: return src if src.startswith("http") else f"https://cocomercado.com{src}"
            
    # Fallback
    for img in images:
        src = img.get_attribute("src")
        if src and ("product" in src or "social-media" in src):
            return src if src.startswith("http") else f"https://cocomercado.com{src}"
    return None

def scrape_caraotamarket(page):
    print("\n[5/5] Scraping caraotamarket...")
    page.goto("https://caraotamarket.com/buscar?controller=search&s=harina+pan", timeout=45000)
    page.wait_for_timeout(5000)
    
    images = page.locator("img").all()
    print(f"  Found {len(images)} images.")
    for img in images:
        src = img.get_attribute("src")
        alt = img.get_attribute("alt") or ""
        try:
            parent_text = img.locator("xpath=./ancestor::*[position() < 4]").first.inner_text().lower()
        except Exception:
            parent_text = ""
        combined = (alt + " " + parent_text).lower()
        if "harina" in combined and "pan" in combined:
            if src: return src if src.startswith("http") else f"https://caraotamarket.com{src}"
    # Fallback
    for img in images:
        src = img.get_attribute("src")
        if src and ("product" in src or "img" in src):
            return src if src.startswith("http") else f"https://caraotamarket.com{src}"
    return None

def main():
    print("--- STARTING OPTIMIZED PLAYWRIGHT HARINA PAN DOWNLOAD ---")
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            viewport={"width": 1366, "height": 768}
        )
        page = context.new_page()
        
        # 1. TuzonaMarket
        img_url = scrape_tuzona(page)
        if img_url: download_and_save(img_url, "tuzonamarket")
        else: print("  FAILED: No image found for tuzonamarket")
            
        # 2. Gama en Línea
        img_url = scrape_gama(page)
        if img_url: download_and_save(img_url, "gamaenlinea")
        else: print("  FAILED: No image found for gamaenlinea")
            
        # 3. InstaMarket
        img_url = scrape_instamarket(page)
        if img_url: download_and_save(img_url, "instamarket")
        else: print("  FAILED: No image found for instamarket")
            
        # 4. Coco Mercado
        img_url = scrape_cocomercado(page)
        if img_url: download_and_save(img_url, "cocomercado")
        else: print("  FAILED: No image found for cocomercado")
            
        # 5. Caraota Market
        img_url = scrape_caraotamarket(page)
        if img_url: download_and_save(img_url, "caraotamarket")
        else: print("  FAILED: No image found for caraotamarket")
            
        browser.close()
        
    print("\n--- SCRAPING COMPLETED ---")
    print(f"Images saved in: {OUTPUT_DIR}")

if __name__ == "__main__":
    main()
