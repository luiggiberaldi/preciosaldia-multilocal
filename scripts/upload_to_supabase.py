import os
import json
import requests
import re
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')

CATALOG_PATH = r"C:\Users\luigg\Desktop\pisu_starter\projects\precios al dia\precios al dia rebranding\preciosaldia-bodega\public\images\catalog\catalog.json"
OUTPUT_DIR = r"C:\Users\luigg\Desktop\pisu_starter\projects\precios al dia\precios al dia rebranding\preciosaldia-bodega\public\images\catalog"
ENV_PATH = r"C:\Users\luigg\Desktop\pisu_starter\projects\precios al dia\precios al dia rebranding\preciosaldia-bodega\.env"

BACKUP_FILES = [
    r"C:\Users\luigg\Desktop\pisu_starter\projects\precios al dia\precios al dia rebranding\preciosaldia-bodega\backup_100_productos.json",
    r"C:\Users\luigg\Desktop\pisu_starter\projects\precios al dia\precios al dia rebranding\preciosaldia-bodega\backup_inventario_importable.json",
    r"C:\Users\luigg\Desktop\pisu_starter\projects\precios al dia\precios al dia rebranding\preciosaldia-bodega\backup_tasasaldia_completo_2026-07-11.json"
]

SUPABASE_URL = "https://sodgzkablshladvbtnes.supabase.co"
SUPABASE_SERVICE_KEY = ""

def load_env():
    global SUPABASE_SERVICE_KEY
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    parts = line.split("=", 1)
                    if parts[0].strip() == "SUPABASE_SERVICE_KEY":
                        SUPABASE_SERVICE_KEY = parts[1].strip().strip('"').strip("'")
                        break

def get_slug(name):
    s = name.lower()
    s = s.replace("á", "a").replace("é", "e").replace("í", "i").replace("ó", "o").replace("ú", "u")
    s = s.replace("ñ", "n")
    s = re.sub(r'[^a-z0-9\s-]', '', s)
    s = re.sub(r'[\s-]+', '-', s)
    return s.strip("-")

def main():
    print("--- STARTING SUPABASE STORAGE IMAGE UPLOADER ---")
    load_env()
    
    if not SUPABASE_SERVICE_KEY:
        print("Error: SUPABASE_SERVICE_KEY not found in .env.")
        return
        
    if not os.path.exists(CATALOG_PATH):
        print("Error: catalog.json not found.")
        return
        
    with open(CATALOG_PATH, "r", encoding="utf-8") as f:
        catalog = json.load(f)
        
    catalog_slugs = {item["slug"] for item in catalog}
    print(f"Loaded {len(catalog_slugs)} products from catalog.json.")
    
    # 1. Identify all local image files
    local_images = []
    for file in os.listdir(OUTPUT_DIR):
        if file.endswith(".webp") and file.replace(".webp", "") in catalog_slugs:
            local_images.append(file)
            
    print(f"Found {len(local_images)} matching local WebP images to check.")
    
    uploaded_urls = {}
    skipped_count = 0
    uploaded_count = 0
    failed_count = 0
    
    # 2. Iterate and upload to Supabase Storage
    headers_check = {
        "User-Agent": "Mozilla/5.0"
    }
    headers_upload = {
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "image/webp"
    }
    
    for idx, img_file in enumerate(local_images, 1):
        slug = img_file.replace(".webp", "")
        public_url = f"{SUPABASE_URL}/storage/v1/object/public/product-images/images/{slug}.webp"
        
        print(f" [{idx}/{len(local_images)}] Checking: {slug}")
        
        # Check if already exists in Supabase
        exists = False
        try:
            r = requests.head(public_url, headers=headers_check, timeout=10)
            if r.status_code == 200:
                exists = True
        except Exception:
            pass
            
        if exists:
            print(f"  Already exists in storage.")
            uploaded_urls[slug] = public_url
            skipped_count += 1
        else:
            print(f"  Uploading to storage...")
            filepath = os.path.join(OUTPUT_DIR, img_file)
            try:
                with open(filepath, "rb") as f:
                    image_bytes = f.read()
                    
                # Upload endpoint
                upload_url = f"{SUPABASE_URL}/storage/v1/object/product-images/images/{slug}.webp"
                # Ensure it is deleted first to overwrite if there was a broken upload
                requests.delete(upload_url, headers=headers_upload, timeout=10)
                
                r = requests.post(upload_url, headers=headers_upload, data=image_bytes, timeout=15)
                if r.status_code == 200:
                    print("  SUCCESS: Uploaded to Supabase.")
                    uploaded_urls[slug] = public_url
                    uploaded_count += 1
                else:
                    print(f"  FAILED to upload. Status: {r.status_code}")
                    failed_count += 1
            except Exception as e:
                print(f"  ERROR uploading: {e}")
                failed_count += 1
                
        # Brief pause to avoid hammering the server
        time.sleep(0.1)
        
    print(f"\nUpload run finished: {uploaded_count} uploaded, {skipped_count} skipped (already in storage), {failed_count} failed.")
    
    # 3. Update JSON database backup files with public URLs
    print("\nUpdating database backup files with public Supabase URLs...")
    for backup_path in BACKUP_FILES:
        if not os.path.exists(backup_path):
            continue
            
        print(f"  Updating: {os.path.basename(backup_path)}...")
        with open(backup_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        products = None
        try:
            products = data["data"]["idb"]["bodega_products_v1"]
        except KeyError:
            try:
                if "bodega_products_v1" in data:
                    products = data["bodega_products_v1"]
                elif "data" in data and "bodega_products_v1" in data["data"]:
                    products = data["data"]["bodega_products_v1"]
            except Exception:
                pass
                
        if products is None:
            # Deeper recursive search
            def find_products_array(obj):
                if isinstance(obj, dict):
                    for k, v in obj.items():
                        if k == "bodega_products_v1" and isinstance(v, list):
                            return v
                        res = find_products_array(v)
                        if res is not None:
                            return res
                elif isinstance(obj, list):
                    for item in obj:
                        res = find_products_array(item)
                        if res is not None:
                            return res
                return None
            products = find_products_array(data)
            
        if products is None:
            continue
            
        updated = 0
        for p in products:
            name = p.get("name")
            if not name:
                continue
            slug = get_slug(name)
            if slug in uploaded_urls:
                p["image"] = uploaded_urls[slug]
                updated += 1
                
        with open(backup_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            
        print(f"    Done: Updated {updated} products.")
        
    # 4. Update catalog.json image paths with public URLs as well
    print("\nUpdating catalog.json index...")
    for item in catalog:
        slug = item["slug"]
        if slug in uploaded_urls:
            item["image_path"] = uploaded_urls[slug]
            
    with open(CATALOG_PATH, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
        
    print("\n--- ALL COMPLETED ---")

if __name__ == "__main__":
    main()
