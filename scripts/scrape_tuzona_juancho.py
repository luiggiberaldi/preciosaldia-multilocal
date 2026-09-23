import os
import re
import json
import requests
import urllib.parse
import time
import shutil
from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup
from PIL import Image
from io import BytesIO

# --- CONFIGURATION ---
WORKSPACE_OUTPUT_DIR = r"C:\Users\luigg\Desktop\pisu_starter\projects\precios al dia\precios al dia rebranding\preciosaldia-bodega\productos"
DESKTOP_OUTPUT_DIR = r"C:\Users\luigg\Desktop\preciosaldia-bodega\productos"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
}

PRODUCTS = [
    # Cervezas
    {"category": "Cervezas", "name": "Cerveza Zulia", "queries": ["cerveza zulia"], "filename": "cerveza-zulia"},
    {"category": "Cervezas", "name": "Zulia lata", "queries": ["cerveza zulia lata", "zulia lata"], "filename": "zulia-lata"},
    {"category": "Cervezas", "name": "Tercio Polar", "queries": ["cerveza polar pilsen botella", "polar tercio"], "filename": "tercio-polar"},
    {"category": "Cervezas", "name": "Cerveza Polar Negrita", "queries": ["cerveza polar pilsen botella", "polar negra"], "filename": "cerveza-polar-negrita"},
    {"category": "Cervezas", "name": "Polar Light lata pequeña", "queries": ["polar light lata 250ml", "polar light lata pequeña"], "filename": "polar-light-lata-pequena"},
    {"category": "Cervezas", "name": "Polar Light lata grande", "queries": ["polar light lata 355ml", "polar light lata grande"], "filename": "polar-light-lata-grande"},
    {"category": "Cervezas", "name": "Polar Light Pilsen", "queries": ["polar light botella", "polar light pilsen"], "filename": "polar-light-pilsen"},
    {"category": "Cervezas", "name": "Polar Pilsen lata grande", "queries": ["polar pilsen lata 355ml", "polar pilsen lata grande"], "filename": "polar-pilsen-lata-grande"},
    {"category": "Cervezas", "name": "Polar Pilsen lata pequeña", "queries": ["polar pilsen lata 250ml", "polar pilsen lata pequeña"], "filename": "polar-pilsen-lata-pequena"},

    # Maltas
    {"category": "Maltas", "name": "Malta retornable", "queries": ["maltin polar botella", "maltin polar retornable"], "filename": "malta-retornable"},
    {"category": "Maltas", "name": "Malta grande", "queries": ["maltin polar botella grande", "maltin polar grande"], "filename": "malta-grande"},
    {"category": "Maltas", "name": "Malta lata", "queries": ["maltin polar lata"], "filename": "malta-lata"},

    # Gaseosas y refrescos
    {"category": "Gaseosas", "name": "Glup 1 litro", "queries": ["refresco glup 1 litro", "glup 1l"], "filename": "glup-1-litro"},
    {"category": "Gaseosas", "name": "Golden 2 litros", "queries": ["refresco golden 2 litros", "golden 2l"], "filename": "golden-2-litros"},
    {"category": "Gaseosas", "name": "Soda Milnava lata", "queries": ["soda milnava lata", "soda milnava"], "filename": "soda-milnava-lata"},
    {"category": "Gaseosas", "name": "Caroreña lata pequeña", "queries": ["sangria caroreña lata", "caroreña lata"], "filename": "carorena-lata-pequena"},
    {"category": "Gaseosas", "name": "Coca-Cola lata", "queries": ["coca cola lata", "coca-cola lata"], "filename": "coca-cola-lata"},
    {"category": "Gaseosas", "name": "Solera lata", "queries": ["cerveza solera lata", "solera lata"], "filename": "solera-lata"},
    {"category": "Gaseosas", "name": "Pepsi 2 litros", "queries": ["refresco pepsi 2 litros", "pepsi 2l"], "filename": "pepsi-2-litros"},

    # Licores y destilados
    {"category": "Licores", "name": "Sangría La Diosa", "queries": ["sangria la diosa", "la diosa"], "filename": "sangria-la-diosa"},
    {"category": "Licores", "name": "Tucacas (licor)", "queries": ["licor tucacas", "ron tucacas"], "filename": "tucacas-licor"},
    {"category": "Licores", "name": "Country Club (licor)", "queries": ["licor country club", "country club"], "filename": "country-club-licor"},
    {"category": "Licores", "name": "Jhon Master (licor)", "queries": ["licor jhon master", "jhon master"], "filename": "jhon-master-licor"},

    # Aguardiente de cocuy (Leal)
    {"category": "Licores", "name": "Aguardiente de Cocuy 0.35 L Leal", "queries": ["cocuy leal 0.35", "cocuy leal 350ml"], "filename": "aguardiente-de-cocuy-0-35-l-leal"},
    {"category": "Licores", "name": "Aguardiente de Cocuy 0.70 L Leal", "queries": ["cocuy leal 0.70", "cocuy leal 700ml"], "filename": "aguardiente-de-cocuy-0-70-l-leal"},
    {"category": "Licores", "name": "Aguardiente de Cocuy 1 L Leal", "queries": ["cocuy leal 1 litro", "cocuy leal 1l"], "filename": "aguardiente-de-cocuy-1-l-leal"},

    # Brandy Chemineaud
    {"category": "Licores", "name": "Brandy Chemineaud 0.35 L", "queries": ["brandy chemineaud 0.35", "chemineaud 350ml"], "filename": "brandy-chemineaud-0-35-l"},
    {"category": "Licores", "name": "Brandy Chemineaud 0.70 L", "queries": ["brandy chemineaud 0.70", "chemineaud 700ml"], "filename": "brandy-chemineaud-0-70-l"},
    {"category": "Licores", "name": "Brandy Chemineaud 1.75 L", "queries": ["brandy chemineaud 1.75", "chemineaud 1.75l"], "filename": "brandy-chemineaud-1-75-l"},
    {"category": "Licores", "name": "Brandy Chemineaud VSOP", "queries": ["brandy chemineaud vsop", "chemineaud vsop"], "filename": "brandy-chemineaud-vsop"},

    # Ron
    {"category": "Licores", "name": "Ron Pampero", "queries": ["ron pampero oro", "ron pampero"], "filename": "pampero"},

    # Víveres
    {"category": "Viveres", "name": "Harina Pan", "queries": ["harina pan blanca", "harina pan 1kg"], "filename": "harina-pan"},
    {"category": "Viveres", "name": "Arroz Primor", "queries": ["arroz primor", "arroz primor clasico"], "filename": "arroz-primor"},
    {"category": "Viveres", "name": "Harina de maíz Flor de Auruaca", "queries": ["harina auruaca", "flor de auruaca"], "filename": "harina-de-maiz-flor-de-auruaca"},
    {"category": "Viveres", "name": "Pasta Primor larga", "queries": ["pasta primor larga", "pasta primor spaghetti"], "filename": "pasta-primor-larga"},
    {"category": "Viveres", "name": "Sardina Mar Bonita", "queries": ["sardina mar bonita", "mar bonita"], "filename": "sardina-mar-bonita"},
    {"category": "Viveres", "name": "Granola", "queries": ["granola"], "filename": "granola"},
    {"category": "Viveres", "name": "Sal Mía", "queries": ["sal mia", "sal mia 1kg"], "filename": "sal-mia"},
    {"category": "Viveres", "name": "Cocosette", "queries": ["cocosette nestle", "cocosette"], "filename": "cocoeste"}, # using "Cocosette" query as requested
    {"category": "Viveres", "name": "Ávila Tripac", "queries": ["chupeta tom", "chupeta tom mix"], "filename": "avila-tripac"}, # Wait, is Avila Tripac a lollipop?
    {"category": "Viveres", "name": "Ávila Soya", "queries": ["aceite de soya avila", "aceite avila"], "filename": "avila-soya"},
    {"category": "Viveres", "name": "Ávila Ajo", "queries": ["salsa de ajo avila", "salsa ajo avila"], "filename": "avila-ajo"},

    # Galletas y snacks
    {"category": "Snacks", "name": "Club Social", "queries": ["galletas club social", "club social original"], "filename": "club-social"},
    {"category": "Snacks", "name": "Samba", "queries": ["samba fresa nestle", "samba chocolate"], "filename": "samba"},
    {"category": "Snacks", "name": "Bonbonbum", "queries": ["bonbonbum", "bon bon bum"], "filename": "bonbonbum"},
    {"category": "Snacks", "name": "Chocolate Savoy pequeño", "queries": ["chocolate de leche savoy", "chocolate savoy pequeño"], "filename": "chocolate-savoy-pequeno"},
    {"category": "Snacks", "name": "Chocolate varios pequeño", "queries": ["chocolate de leche savoy"], "filename": "chocolate-varios-pequeno"},
    {"category": "Snacks", "name": "Cheese Trees pequeño", "queries": ["cheese tris pequeño", "cheese tris"], "filename": "cheese-trees-pequeno"},
    {"category": "Snacks", "name": "Cheese Trees grande", "queries": ["cheese tris grande"], "filename": "cheese-trees-grande"},
    {"category": "Snacks", "name": "Tostón Tom", "queries": ["toston tom", "tostones tom"], "filename": "toston-tom"},
    {"category": "Snacks", "name": "Natu Chips", "queries": ["natuchips", "natu chips platanitos"], "filename": "natu-chips"},
    {"category": "Snacks", "name": "Jack chicharrón pequeño", "queries": ["jacks chicharron pequeño", "chicharron jacks"], "filename": "jack-chicharron-pequeno"},
    {"category": "Snacks", "name": "Jack chicharrón grande", "queries": ["jacks chicharron grande", "chicharron jacks"], "filename": "jack-chicharron-grande"},
    {"category": "Snacks", "name": "Pepito pequeño", "queries": ["pepito savoy", "pepito pequeño"], "filename": "pepito-pequeno"},
    {"category": "Snacks", "name": "Raqueti", "queries": ["raqueti", "rikesa"], "filename": "raqueti"},
    {"category": "Snacks", "name": "Tom mediano", "queries": ["chupeta tom mediano", "chupeta tom"], "filename": "tom-mediano"},
    {"category": "Snacks", "name": "Doritos grande", "queries": ["doritos grande", "doritos Mega"], "filename": "doritos-grande"},
    {"category": "Snacks", "name": "Doritos dinamita grande", "queries": ["doritos dinamita grande", "doritos dinamita"], "filename": "doritos-dinamita-grande"},
    {"category": "Snacks", "name": "Doritos pequeño", "queries": ["doritos pequeño"], "filename": "doritos-pequeno"},
    {"category": "Snacks", "name": "Chetos grande", "queries": ["cheetos grande", "cheetos"], "filename": "chetos-grande"},
    {"category": "Snacks", "name": "Chiquesesito pequeño", "queries": ["chiclets adams", "chiclets"], "filename": "chiquesesito-pequeno"},
    {"category": "Snacks", "name": "Flips mediano", "queries": ["flips chocolate mediano", "flips chocolate 120g"], "filename": "flips-mediano"},

    # Cigarrillos
    {"category": "Cigarrillos", "name": "Consul", "queries": ["cajetilla consul", "cigarrillos consul"], "filename": "consul"},
    {"category": "Cigarrillos", "name": "Pall Mall", "queries": ["cajetilla pall mall", "cigarrillos pall mall"], "filename": "pall-mall"},
    {"category": "Cigarrillos", "name": "Viceroy", "queries": ["cajetilla viceroy", "cigarrillos viceroy"], "filename": "viceroy"},
    {"category": "Cigarrillos", "name": "Belmont", "queries": ["cajetilla belmont", "cigarrillos belmont"], "filename": "belmont"},
    {"category": "Cigarrillos", "name": "Belmont media", "queries": ["cajetilla belmont media", "belmont de 10"], "filename": "belmont-media"},
    {"category": "Cigarrillos", "name": "Lucky", "queries": ["cajetilla lucky strike", "cigarrillos lucky"], "filename": "lucky"},

    # Otros
    {"category": "Otros", "name": "Apureñito", "queries": ["apureñito", "chimo apureñito"], "filename": "apurenito"},
    {"category": "Otros", "name": "Halls", "queries": ["halls menta", "halls"], "filename": "halls"}
]

def clean_and_prepare_dirs():
    """Wipes old wrong files and prepares directories."""
    for path in [WORKSPACE_OUTPUT_DIR, DESKTOP_OUTPUT_DIR]:
        if os.path.exists(path):
            try:
                shutil.rmtree(path)
            except Exception:
                pass
        os.makedirs(path, exist_ok=True)

def get_match_score(query, card_text):
    """Calculates keyword match overlap score."""
    q_words = set(re.findall(r'[a-z0-9]+', query.lower()))
    # Remove common filler words
    q_words = {w for w in q_words if len(w) > 2 and w not in ["con", "del", "de-"]}
    t_words = set(re.findall(r'[a-z0-9]+', card_text.lower()))
    
    overlap = q_words.intersection(t_words)
    if not overlap:
        return 0
    return len(overlap)

def fallback_bing_images_tuzona(query):
    """Fallback search on Bing for TuzonaMarket indexed page images."""
    search_url = f"https://www.bing.com/images/search?q=site%3Atuzonamarket.com+{urllib.parse.quote(query)}"
    try:
        r = requests.get(search_url, headers=HEADERS, timeout=15)
        if r.status_code == 200:
            soup = BeautifulSoup(r.text, "html.parser")
            for a in soup.find_all("a", class_="iusc"):
                m_attr = a.get("m")
                if m_attr:
                    try:
                        m_data = json.loads(m_attr)
                        murl = m_data.get("murl")
                        if murl and murl.startswith("http") and not murl.endswith(".gif") and not murl.endswith(".svg"):
                            return murl
                    except Exception:
                        pass
    except Exception as e:
        print(f"    Bing fallback failed: {e}")
    return None

def download_and_save_image(img_url, filename):
    """Downloads image, crops/resizes to 400x400 WebP and saves."""
    try:
        r = requests.get(img_url, headers=HEADERS, timeout=15)
        if r.status_code == 200:
            img = Image.open(BytesIO(r.content))
            
            # Crop to square
            width, height = img.size
            if width != height:
                min_dim = min(width, height)
                left = (width - min_dim) / 2
                top = (height - min_dim) / 2
                right = (width + min_dim) / 2
                bottom = (height + min_dim) / 2
                img = img.crop((left, top, right, bottom))
            
            # Resize
            img = img.resize((400, 400), Image.Resampling.LANCZOS)
            
            # Convert to RGB
            if img.mode != "RGB":
                img = img.convert("RGB")
            
            # Save Workspace
            workspace_filepath = os.path.join(WORKSPACE_OUTPUT_DIR, f"{filename}.webp")
            img.save(workspace_filepath, format="WEBP", quality=85)
            
            # Save Desktop
            try:
                desktop_filepath = os.path.join(DESKTOP_OUTPUT_DIR, f"{filename}.webp")
                img.save(desktop_filepath, format="WEBP", quality=85)
                print(f"    Saved {filename}.webp in BOTH directories!")
            except Exception as e:
                print(f"    Saved {filename}.webp in workspace. (Desktop skipped: {e})")
            return True
    except Exception as e:
        print(f"    Error downloading image: {e}")
    return False

def scrape_product_tuzona(page, product):
    name = product["name"]
    filename = product["filename"]
    category = product["category"]
    
    # We will search Lara first, then Carabobo if empty.
    zones = ["lara", "carabobo"]
    if category in ["Cervezas", "Licores"]:
        # Put lara first for licores
        zones = ["lara", "carabobo"]
        
    for zone in zones:
        for q in product["queries"]:
            search_url = f"https://tuzonamarket.com/{zone}/buscar?q={urllib.parse.quote(q)}"
            print(f"  Trying {zone.upper()} search for '{q}'...")
            try:
                page.goto(search_url, timeout=30000)
                # Wait for elements to load
                page.wait_for_timeout(4000)
                
                content = page.content()
                soup = BeautifulSoup(content, "html.parser")
                
                candidates = []
                for img in soup.find_all("img"):
                    src = img.get("src")
                    # Match only actual product image assets
                    if src and ("producto" in src or "images/producto" in src or "assets.tuzonamarket.com/images/producto" in src):
                        # Climb up to 5 parent levels to inspect description text
                        parent = img.parent
                        parent_text = ""
                        for _ in range(5):
                            if not parent: break
                            text = parent.get_text(separator=" ").strip()
                            if text:
                                parent_text = text
                                if "$" in text or "Bs" in text:
                                    break
                            parent = parent.parent
                        
                        score = get_match_score(q, parent_text)
                        if score > 0:
                            candidates.append({
                                "src": src,
                                "score": score,
                                "text": parent_text
                            })
                            
                if candidates:
                    # Sort by score descending
                    candidates.sort(key=lambda x: x["score"], reverse=True)
                    best = candidates[0]
                    print(f"    FOUND match with score {best['score']}: {best['src'][:60]}...")
                    if download_and_save_image(best["src"], filename):
                        return True
            except Exception as e:
                print(f"    Error during search page scan: {e}")
                
    # --- FALLBACK: BING IMAGES SITE SEARCH ---
    print(f"  Tuzona local search failed. Trying Bing indexed fallback for '{product['queries'][0]}'.")
    fallback_url = fallback_bing_images_tuzona(product["queries"][0])
    if fallback_url:
        print(f"    FOUND fallback URL: {fallback_url[:60]}...")
        if download_and_save_image(fallback_url, filename):
            return True
            
    return False

def main():
    print("--- STARTING REAL BODEGA TUZONAMARKET SCRAPER (reality-hardened) ---")
    clean_and_prepare_dirs()
    
    start_time = time.time()
    success_count = 0
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            viewport={"width": 1366, "height": 768}
        )
        page = context.new_page()
        
        for idx, product in enumerate(PRODUCTS, 1):
            print(f"\n[{idx}/{len(PRODUCTS)}] Processing: '{product['name']}' ({product['category']})")
            if scrape_product_tuzona(page, product):
                success_count += 1
            else:
                print(f"  ❌ FAILED to get image for '{product['name']}'")
            time.sleep(2) # Polite delay
            
        browser.close()
        
    end_time = time.time()
    print(f"\n--- SCRAPING COMPLETED ---")
    print(f"Successfully scraped {success_count} / {len(PRODUCTS)} images.")
    print(f"Time elapsed: {int(end_time - start_time)} seconds.")

if __name__ == "__main__":
    main()
