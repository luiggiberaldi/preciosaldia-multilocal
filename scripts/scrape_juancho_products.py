import os
import re
import json
import requests
import urllib.parse
import time
import shutil
from bs4 import BeautifulSoup
from PIL import Image
from io import BytesIO

# --- CONFIGURATION ---
WORKSPACE_OUTPUT_DIR = r"C:\Users\luigg\Desktop\pisu_starter\projects\precios al dia\precios al dia rebranding\preciosaldia-bodega\productos"
DESKTOP_OUTPUT_DIR = r"C:\Users\luigg\Desktop\preciosaldia-bodega\productos"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "es-VE,es;q=0.9,en-US;q=0.8,en;q=0.7"
}

PRODUCTS = [
    # Cervezas
    {"category": "Cervezas", "name": "Cerveza Zulia", "query": "Cerveza Zulia venezuela", "filename": "cerveza-zulia"},
    {"category": "Cervezas", "name": "Zulia lata", "query": "Cerveza Zulia lata", "filename": "zulia-lata"},
    {"category": "Cervezas", "name": "Tercio Polar", "query": "Cerveza Polar Pilsen tercio", "filename": "tercio-polar"},
    {"category": "Cervezas", "name": "Cerveza Polar Negrita", "query": "Cerveza Polar Negra botella", "filename": "cerveza-polar-negrita"},
    {"category": "Cervezas", "name": "Polar Light lata pequeña", "query": "Cerveza Polar Light lata 250ml", "filename": "polar-light-lata-pequena"},
    {"category": "Cervezas", "name": "Polar Light lata grande", "query": "Cerveza Polar Light lata 355ml", "filename": "polar-light-lata-grande"},
    {"category": "Cervezas", "name": "Polar Light Pilsen", "query": "Cerveza Polar Light botella", "filename": "polar-light-pilsen"},
    {"category": "Cervezas", "name": "Polar Pilsen lata grande", "query": "Cerveza Polar Pilsen lata 355ml", "filename": "polar-pilsen-lata-grande"},
    {"category": "Cervezas", "name": "Polar Pilsen lata pequeña", "query": "Cerveza Polar Pilsen lata 250ml", "filename": "polar-pilsen-lata-pequena"},

    # Maltas
    {"category": "Maltas", "name": "Malta retornable", "query": "Maltin Polar botella", "filename": "malta-retornable"},
    {"category": "Maltas", "name": "Malta grande", "query": "Maltin Polar botella grande", "filename": "malta-grande"},
    {"category": "Maltas", "name": "Malta lata", "query": "Maltin Polar lata", "filename": "malta-lata"},

    # Gaseosas y refrescos
    {"category": "Gaseosas", "name": "Glup 1 litro", "query": "Refresco Glup 1 litro", "filename": "glup-1-litro"},
    {"category": "Gaseosas", "name": "Golden 2 litros", "query": "Refresco Golden 2 litros", "filename": "golden-2-litros"},
    {"category": "Gaseosas", "name": "Soda Milnava lata", "query": "Soda Milnava lata", "filename": "soda-milnava-lata"},
    {"category": "Gaseosas", "name": "Caroreña lata pequeña", "query": "Sangria Caroreña lata", "filename": "carorena-lata-pequena"},
    {"category": "Gaseosas", "name": "Coca-Cola lata", "query": "Coca Cola lata 355ml", "filename": "coca-cola-lata"},
    {"category": "Gaseosas", "name": "Solera lata", "query": "Cerveza Solera lata", "filename": "solera-lata"},
    {"category": "Gaseosas", "name": "Pepsi 2 litros", "query": "Refresco Pepsi 2 litros", "filename": "pepsi-2-litros"},

    # Licores y destilados
    {"category": "Licores", "name": "Sangría La Diosa", "query": "Sangria La Diosa venezuela", "filename": "sangria-la-diosa"},
    {"category": "Licores", "name": "Tucacas (licor)", "query": "Licor de ron Tucacas", "filename": "tucacas-licor"},
    {"category": "Licores", "name": "Country Club (licor)", "query": "Licor Country Club venezuela", "filename": "country-club-licor"},
    {"category": "Licores", "name": "Jhon Master (licor)", "query": "Licor Jhon Master venezuela", "filename": "jhon-master-licor"},

    # Aguardiente de cocuy (Leal)
    {"category": "Licores", "name": "Aguardiente de Cocuy 0.35 L Leal", "query": "Aguardiente de Cocuy Leal 0.35 L", "filename": "aguardiente-de-cocuy-0-35-l-leal"},
    {"category": "Licores", "name": "Aguardiente de Cocuy 0.70 L Leal", "query": "Aguardiente de Cocuy Leal 0.70 L", "filename": "aguardiente-de-cocuy-0-70-l-leal"},
    {"category": "Licores", "name": "Aguardiente de Cocuy 1 L Leal", "query": "Aguardiente de Cocuy Leal 1 L", "filename": "aguardiente-de-cocuy-1-l-leal"},

    # Brandy Chemineaud
    {"category": "Licores", "name": "Brandy Chemineaud 0.35 L", "query": "Brandy Chemineaud 0.35 L", "filename": "brandy-chemineaud-0-35-l"},
    {"category": "Licores", "name": "Brandy Chemineaud 0.70 L", "query": "Brandy Chemineaud 0.70 L", "filename": "brandy-chemineaud-0-70-l"},
    {"category": "Licores", "name": "Brandy Chemineaud 1.75 L", "query": "Brandy Chemineaud 1.75 L", "filename": "brandy-chemineaud-1-75-l"},
    {"category": "Licores", "name": "Brandy Chemineaud VSOP", "query": "Brandy Chemineaud VSOP", "filename": "brandy-chemineaud-vsop"},

    # Ron
    {"category": "Licores", "name": "Ron Pampero", "query": "Ron Pampero oro venezuela", "filename": "pampero"},

    # Víveres
    {"category": "Viveres", "name": "Harina Pan", "query": "Harina PAN blanca 1kg", "filename": "harina-pan"},
    {"category": "Viveres", "name": "Arroz Primor", "query": "Arroz Primor clasico 1kg", "filename": "arroz-primor"},
    {"category": "Viveres", "name": "Harina de maíz Flor de Auruaca", "query": "Harina de maiz Flor de Auruaca 1kg", "filename": "harina-de-maiz-flor-de-auruaca"},
    {"category": "Viveres", "name": "Pasta Primor larga", "query": "Pasta Primor larga spaghetti 1kg", "filename": "pasta-primor-larga"},
    {"category": "Viveres", "name": "Sardina Mar Bonita", "query": "Sardinas Mar Bonita lata", "filename": "sardina-mar-bonita"},
    {"category": "Viveres", "name": "Granola", "query": "Granola empaque venezuela", "filename": "granola"},
    {"category": "Viveres", "name": "Sal Mía", "query": "Sal Mia empaque 1kg", "filename": "sal-mia"},
    {"category": "Viveres", "name": "Cocoeste", "query": "Cocosette wafer nestle venezuela", "filename": "cocoeste"},
    {"category": "Viveres", "name": "Ávila Tripac", "query": "Avila Tripac venezuela", "filename": "avila-tripac"},
    {"category": "Viveres", "name": "Ávila Soya", "query": "Aceite de soya Avila venezuela", "filename": "avila-soya"},
    {"category": "Viveres", "name": "Ávila Ajo", "query": "Salsa de ajo Avila venezuela", "filename": "avila-ajo"},

    # Galletas y snacks
    {"category": "Snacks", "name": "Club Social", "query": "Galletas Club Social paquete Kraft", "filename": "club-social"},
    {"category": "Snacks", "name": "Samba", "query": "Samba chocolate Nestle venezuela", "filename": "samba"},
    {"category": "Snacks", "name": "Bonbonbum", "query": "Chupeta Bon Bon Bum Colombina", "filename": "bonbonbum"},
    {"category": "Snacks", "name": "Chocolate Savoy pequeño", "query": "Chocolate de leche Savoy pequeno venezuela", "filename": "chocolate-savoy-pequeno"},
    {"category": "Snacks", "name": "Chocolate varios pequeño", "query": "Chocolate Savoy con leche venezuela", "filename": "chocolate-varios-pequeno"},
    {"category": "Snacks", "name": "Cheese Trees pequeño", "query": "Cheese Tris pequeno Savoy venezuela", "filename": "cheese-trees-pequeno"},
    {"category": "Snacks", "name": "Cheese Trees grande", "query": "Cheese Tris grande Savoy venezuela", "filename": "cheese-trees-grande"},
    {"category": "Snacks", "name": "Tostón Tom", "query": "Toston Tom snacks venezuela", "filename": "toston-tom"},
    {"category": "Snacks", "name": "Natu Chips", "query": "Natuchips platanitos original venezuela", "filename": "natu-chips"},
    {"category": "Snacks", "name": "Jack chicharrón pequeño", "query": "Chicharron Jacks pequeno venezuela", "filename": "jack-chicharron-pequeno"},
    {"category": "Snacks", "name": "Jack chicharrón grande", "query": "Chicharron Jacks grande venezuela", "filename": "jack-chicharron-grande"},
    {"category": "Snacks", "name": "Pepito pequeño", "query": "Pepito Savoy pequeno venezuela", "filename": "pepito-pequeno"},
    {"category": "Snacks", "name": "Raqueti", "query": "Rikesa o Raquety snacks venezuela", "filename": "raqueti"},
    {"category": "Snacks", "name": "Tom mediano", "query": "Chupeta Tom mediano venezuela", "filename": "tom-mediano"},
    {"category": "Snacks", "name": "Doritos grande", "query": "Doritos grande PepsiCo venezuela", "filename": "doritos-grande"},
    {"category": "Snacks", "name": "Doritos dinamita grande", "query": "Doritos dinamita grande PepsiCo venezuela", "filename": "doritos-dinamita-grande"},
    {"category": "Snacks", "name": "Doritos pequeño", "query": "Doritos pequeno PepsiCo venezuela", "filename": "doritos-pequeno"},
    {"category": "Snacks", "name": "Chetos grande", "query": "Cheetos grande PepsiCo venezuela", "filename": "chetos-grande"},
    {"category": "Snacks", "name": "Chiquesesito pequeño", "query": "Chiclets Adams o Chicles pequeno", "filename": "chiquesesito-pequeno"},
    {"category": "Snacks", "name": "Flips mediano", "query": "Cereal Flips chocolate mediano venezuela", "filename": "flips-mediano"},

    # Cigarrillos
    {"category": "Cigarrillos", "name": "Consul", "query": "Cigarrillos Consul cajetilla venezuela", "filename": "consul"},
    {"category": "Cigarrillos", "name": "Pall Mall", "query": "Cigarrillos Pall Mall cajetilla venezuela", "filename": "pall-mall"},
    {"category": "Cigarrillos", "name": "Viceroy", "query": "Cigarrillos Viceroy cajetilla venezuela", "filename": "viceroy"},
    {"category": "Cigarrillos", "name": "Belmont", "query": "Cigarrillos Belmont cajetilla venezuela", "filename": "belmont"},
    {"category": "Cigarrillos", "name": "Belmont media", "query": "Cigarrillos Belmont media cajetilla venezuela", "filename": "belmont-media"},
    {"category": "Cigarrillos", "name": "Lucky", "query": "Cigarrillos Lucky Strike cajetilla venezuela", "filename": "lucky"},

    # Otros
    {"category": "Otros", "name": "Apureñito", "query": "Chimo Apureñito original venezuela", "filename": "apurenito"},
    {"category": "Otros", "name": "Halls", "query": "Caramelos Halls menta venezuela", "filename": "halls"}
]

def search_bing_images(query, clean_filename):
    """Searches Bing Images for a query and returns the first image link."""
    # Build query
    search_url = f"https://www.bing.com/images/search?q={urllib.parse.quote(query)}"
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
        print(f"    Bing Image Search failed for '{query}': {e}")
    return None

def download_and_save_image(img_url, filename, category):
    """Downloads image, crops/resizes to 400x400 WebP and saves."""
    try:
        r = requests.get(img_url, headers=HEADERS, timeout=15)
        if r.status_code == 200:
            img = Image.open(BytesIO(r.content))
            
            # Crop to square if it's not square
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
            
            # Convert to RGB if needed (JPEG/WebP don't support RGBA well)
            if img.mode != "RGB":
                img = img.convert("RGB")
            
            # Ensure workspace path exists
            os.makedirs(WORKSPACE_OUTPUT_DIR, exist_ok=True)
            workspace_filepath = os.path.join(WORKSPACE_OUTPUT_DIR, f"{filename}.webp")
            img.save(workspace_filepath, format="WEBP", quality=85)
            
            # Also try to copy/save to Desktop path
            try:
                os.makedirs(DESKTOP_OUTPUT_DIR, exist_ok=True)
                desktop_filepath = os.path.join(DESKTOP_OUTPUT_DIR, f"{filename}.webp")
                img.save(desktop_filepath, format="WEBP", quality=85)
                print(f"  Saved {filename}.webp in BOTH directories!")
            except Exception as e:
                # Desktop not writable or doesn't exist, just log it
                print(f"  Saved {filename}.webp in workspace. (Desktop copy skipped: {e})")
            
            return True
    except Exception as e:
        print(f"  Error downloading image: {e}")
    return False

def main():
    print("--- STARTING JUANCHO BODEGA PRODUCTS SCRAPER ---")
    start_time = time.time()
    
    success_count = 0
    
    for idx, p in enumerate(PRODUCTS, 1):
        name = p["name"]
        category = p["category"]
        filename = p["filename"]
        
        print(f"\n[{idx}/{len(PRODUCTS)}] Scraping: '{name}' ({category})")
        
        # Determine query priority
        queries = []
        if category in ["Cervezas", "Licores"]:
            # Priority queries for licores/cervezas based on suggested domains
            queries.append(f"site:licoresmundiales.com {name}")
            queries.append(f"site:gamaenlinea.com/es/licores {name}")
            queries.append(f"site:sigo.com.ve/licores {name}")
        
        # General search fallback
        queries.append(p["query"])
        
        img_url = None
        for q in queries:
            print(f"  Searching query: '{q}'")
            img_url = search_bing_images(q, filename)
            if img_url:
                print(f"  Found URL: {img_url[:75]}...")
                break
            time.sleep(1) # polite delay between queries
            
        if img_url:
            if download_and_save_image(img_url, filename, category):
                success_count += 1
            else:
                print("  Failed to download/save image.")
        else:
            print("  Failed to find any image URL.")
            
        time.sleep(1.5) # polite delay between products
        
    end_time = time.time()
    print(f"\n--- SCRAPING COMPLETED ---")
    print(f"Successfully scraped {success_count} / {len(PRODUCTS)} images.")
    print(f"Total time elapsed: {int(end_time - start_time)} seconds.")

if __name__ == "__main__":
    main()
