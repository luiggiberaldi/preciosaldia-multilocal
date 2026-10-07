import os
import re
import json
import hashlib
import requests
from bs4 import BeautifulSoup
from PIL import Image
from io import BytesIO
import urllib.parse
import time

# --- CONFIGURATION ---
SUPABASE_URL = "https://sodgzkablshladvbtnes.supabase.co"
SUPABASE_SERVICE_KEY = ""
GROQ_API_KEYS = []

def load_env():
    global SUPABASE_SERVICE_KEY, GROQ_API_KEYS
    env_paths = [
        os.path.join(os.path.dirname(__file__), "..", ".env"),
        os.path.join(os.path.dirname(__file__), "..", "..", "pagina precios al dia", ".env"),
        os.path.join(os.path.dirname(__file__), ".env"),
        ".env"
    ]
    for path in env_paths:
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#"):
                            continue
                        if "=" in line:
                            parts = line.split("=", 1)
                            if len(parts) == 2:
                                k = parts[0].strip()
                                v = parts[1].strip().strip('"').strip("'")
                                if k == "GROQ_KEYS" or k == "GROQ_API_KEY":
                                    GROQ_API_KEYS = [key.strip() for key in v.split(",") if key.strip()]
                                elif k == "SUPABASE_SERVICE_KEY" or k == "SUPABASE_SERVICE_ROLE_KEY" or k == "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY":
                                    SUPABASE_SERVICE_KEY = v
                print(f"Loaded environment variables from: {path}")
                break
            except Exception as e:
                print(f"Failed to read env file '{path}': {e}")
                
    # Fallback to environment variables
    if not GROQ_API_KEYS and os.environ.get("GROQ_KEYS"):
        GROQ_API_KEYS = [key.strip() for key in os.environ.get("GROQ_KEYS").split(",") if key.strip()]
    if not SUPABASE_SERVICE_KEY:
        SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

# Load environment keys
load_env()

current_key_idx = 0

def get_groq_key():
    global current_key_idx
    if not GROQ_API_KEYS:
        return ""
    return GROQ_API_KEYS[current_key_idx]

def rotate_groq_key():
    global current_key_idx
    if GROQ_API_KEYS:
        current_key_idx = (current_key_idx + 1) % len(GROQ_API_KEYS)
        print(f"Rotating Groq Key... Now using key index {current_key_idx}")

SUPERMARKETS = [
    {"name": "Farmatodo", "domain": "farmatodo.com.ve", "path_kw": "/producto/"},
    {"name": "Plazas", "domain": "elplazas.com", "path_kw": "/productos/"},
    {"name": "Gama", "domain": "excelsiorgama.com", "path_kw": "/producto/"}
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "es-VE,es;q=0.9,en-US;q=0.8,en;q=0.7"
}

# --- HELPERS ---
def clean_product_name_with_groq(raw_name):
    """Uses Groq to extract a clean commercial name for search."""
    prompt = f"""Dada el nombre de un producto en un punto de venta venezolano: "{raw_name}"
Extrae el nombre comercial limpio y marca del producto para buscarlo en Google.
Ejemplos:
- "desifentante-1lt" -> "Desinfectante Mistolin 1L"
- "arroz-clasico-superior-primor-900g" -> "Arroz Primor 900g"
- "mayones-mavesa-175g" -> "Mayonesa Mavesa 175g"

Responde en formato JSON con la siguiente estructura:
{{
  "query": "el nombre comercial limpio, marca y presentacion"
}}
"""
    for _ in range(len(GROQ_API_KEYS)):
        key = get_groq_key()
        try:
            r = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={
                    "model": "llama-3.1-8b-instant",
                    "messages": [{"role": "user", "content": prompt}],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.1
                },
                timeout=10
            )
            if r.status_code == 200:
                result = r.json()
                data = json.loads(result["choices"][0]["message"]["content"])
                return data.get("query", raw_name.replace("-", " ")).strip()
            elif r.status_code == 429:
                print(f"Rate limit hit on key index {current_key_idx}. Rotating...")
                rotate_groq_key()
            else:
                print(f"Groq API returned error {r.status_code}. Rotating...")
                rotate_groq_key()
        except Exception as e:
            print(f"Error calling Groq: {e}. Rotating...")
            rotate_groq_key()
    return raw_name.replace("-", " ")

def search_product_page(domain, path_keyword, clean_name):
    """Searches Bing or Google for a product link from a specific domain."""
    query = f"site:{domain} {clean_name}"
    # Use Bing search as it is usually less aggressive with instant blocks than Google
    search_url = f"https://www.bing.com/search?q={urllib.parse.quote(query)}"
    
    try:
        r = requests.get(search_url, headers=HEADERS, timeout=10)
        if r.status_code == 200:
            soup = BeautifulSoup(r.text, "html.parser")
            for a in soup.find_all("a"):
                href = a.get("href")
                if href and domain in href and path_keyword in href:
                    return href
    except Exception as e:
        print(f"Search failed for '{query}' on Bing: {e}")
        
    # Fallback to Yahoo Search
    yahoo_url = f"https://search.yahoo.com/search?p={urllib.parse.quote(query)}"
    try:
        r = requests.get(yahoo_url, headers=HEADERS, timeout=10)
        if r.status_code == 200:
            soup = BeautifulSoup(r.text, "html.parser")
            for a in soup.find_all("a"):
                href = a.get("href")
                if href and domain in href and path_keyword in href:
                    return href
    except Exception as e:
        print(f"Search failed for '{query}' on Yahoo: {e}")
        
    return None

def get_og_image_from_page(url):
    """Fetches a product page and extracts the og:image URL."""
    try:
        r = requests.get(url, headers=HEADERS, timeout=10)
        if r.status_code == 200:
            soup = BeautifulSoup(r.text, "html.parser")
            # Find meta og:image
            og_img = soup.find("meta", property="og:image")
            if og_img and og_img.get("content"):
                return og_img["content"]
            # Fallback to search inside page for main image
            for img in soup.find_all("img"):
                src = img.get("src")
                if src and ("product" in src or "cdn" in src) and src.startswith("http"):
                    return src
    except Exception as e:
        print(f"Failed to fetch page or extract image from '{url}': {e}")
    return None

def process_and_optimize_image(image_url):
    """Downloads, resizes to 400x400 WebP and returns bytes + hash."""
    try:
        r = requests.get(image_url, headers=HEADERS, timeout=10)
        if r.status_code == 200:
            img = Image.open(BytesIO(r.content))
            # Convert to RGB if PNG/RGBA
            if img.mode != "RGB":
                img = img.convert("RGB")
            # Resize
            img = img.resize((400, 400), Image.Resampling.LANCZOS)
            # Save to buffer
            buf = BytesIO()
            img.save(buf, format="WEBP", quality=75)
            webp_bytes = buf.getvalue()
            # Calculate MD5 hash
            md5_hash = hashlib.md5(webp_bytes).hexdigest()
            return webp_bytes, md5_hash
    except Exception as e:
        print(f"Image processing error for '{image_url}': {e}")
    return None, None

LOCAL_HASHES = {}
HASHES_FILE = os.path.join(os.path.dirname(__file__), "image_hashes.json")

def load_local_hashes():
    global LOCAL_HASHES
    if os.path.exists(HASHES_FILE):
        try:
            with open(HASHES_FILE, "r", encoding="utf-8") as f:
                LOCAL_HASHES = json.load(f)
        except Exception as e:
            print(f"Error loading local hashes: {e}")

def save_local_hashes():
    try:
        with open(HASHES_FILE, "w", encoding="utf-8") as f:
            json.dump(LOCAL_HASHES, f, indent=2)
    except Exception as e:
        print(f"Error saving local hashes: {e}")

def check_duplicate_hash_in_db(md5_hash, current_product_id):
    """Checks local hashes to prevent duplicate images."""
    for prod_id, h in LOCAL_HASHES.items():
        if h == md5_hash and prod_id != current_product_id:
            return {"id": prod_id, "name": prod_id}
    return None

def upload_image_to_supabase(product_id, image_bytes):
    """Uploads the image bytes to Supabase Storage."""
    filename = f"images/{product_id}.jpg" # Keeping extension for compatibility
    url = f"{SUPABASE_URL}/storage/v1/object/product-images/{filename}"
    headers = {
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "image/webp"
    }
    try:
        # Check if file exists, if so delete it first to overwrite
        requests.delete(url, headers=headers)
        
        # Upload new file
        r = requests.post(url, headers=headers, data=image_bytes)
        if r.status_code == 200:
            # Return public URL
            return f"{SUPABASE_URL}/storage/v1/object/public/product-images/{filename}"
    except Exception as e:
        print(f"Failed to upload image to Supabase storage: {e}")
    return None

def update_product_in_catalog(product_id, image_url):
    """Updates the product catalog record with the new URL."""
    url = f"{SUPABASE_URL}/rest/v1/product_images_catalog?id=eq.{product_id}"
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
    }
    payload = {
        "image_url": image_url
    }
    try:
        r = requests.patch(url, headers=headers, json=payload)
        return r.status_code in [200, 204]
    except Exception as e:
        print(f"Failed to update database catalog for '{product_id}': {e}")
    return False

# --- MAIN ---
def main():
    print("--- STARTING SCRAPER 2.0 CATALOG CORRECTION ---")
    load_local_hashes()
    
    # Load mismatched products
    mismatched_file = r"C:\Users\luigg\.gemini\antigravity\brain\7158ffc2-06b5-45be-8361-0196bab79b5e\scratch\mismatched_products.json"
    if not os.path.exists(mismatched_file):
        print(f"Error: file '{mismatched_file}' not found.")
        return
        
    with open(mismatched_file, "r", encoding="utf-8") as f:
        products = json.load(f)
        
    print(f"Loaded {len(products)} products to fix.")
    
    success_count = 0
    for idx, p in enumerate(products, 1):
        product_id = p["id"]
        raw_name = p["name"]
        
        print(f"\n[{idx}/{len(products)}] Processing: {raw_name} (ID: {product_id})")
        
        # 1. Groq Query Cleaning
        clean_name = clean_product_name_with_groq(raw_name)
        print(f"  Clean Name: '{clean_name}'")
        
        found_image = False
        # 2. Try each supermarket
        for store in SUPERMARKETS:
            print(f"  Trying {store['name']} ({store['domain']})...")
            product_url = search_product_page(store["domain"], store["path_kw"], clean_name)
            if product_url:
                print(f"    Found Page: {product_url}")
                img_url = get_og_image_from_page(product_url)
                if img_url:
                    print(f"    Found Image: {img_url}")
                    
                    # 3. Process image
                    image_bytes, md5_hash = process_and_optimize_image(img_url)
                    if image_bytes and md5_hash:
                        # 4. Hash verification
                        duplicate_prod = check_duplicate_hash_in_db(md5_hash, product_id)
                        if duplicate_prod and duplicate_prod["id"] != product_id:
                            print(f"    BLOCKED: Image hash is duplicate of '{duplicate_prod['name']}' (ID: {duplicate_prod['id']})")
                            continue
                            
                        # 5. Upload to Supabase Storage
                        supabase_img_url = upload_image_to_supabase(product_id, image_bytes)
                        if supabase_img_url:
                            print(f"    Uploaded to Supabase: {supabase_img_url}")
                            
                            # 6. Update Database
                            if update_product_in_catalog(product_id, supabase_img_url):
                                print(f"    SUCCESSFULLY UPDATED DB!")
                                LOCAL_HASHES[product_id] = md5_hash
                                save_local_hashes()
                                success_count += 1
                                found_image = True
                                break
            time.sleep(1) # Polite scraping delay
            
        if not found_image:
            print(f"  Could not find or assign a valid image for '{raw_name}' from the specified supermarkets.")
            
    print(f"\n--- SCRAPER 2.0 COMPLETED ---")
    print(f"Corrected {success_count} / {len(products)} products.")

if __name__ == "__main__":
    main()
