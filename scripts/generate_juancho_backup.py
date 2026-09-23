import os
import json
import shutil
import time

# --- CONFIGURATION ---
BODEGA_DIR = r"C:\Users\luigg\Desktop\pisu_starter\projects\precios al dia\precios al dia rebranding\preciosaldia-bodega"
WORKSPACE_BACKUP_PATH = os.path.join(BODEGA_DIR, "backup_juancho_productos.json")
DESKTOP_BACKUP_PATH = r"C:\Users\luigg\Desktop\backup_juancho_productos.json"
PRODUCTOS_DIR = os.path.join(BODEGA_DIR, "productos")
CATALOG_IMAGES_DIR = os.path.join(BODEGA_DIR, "public", "images", "catalog")

RAW_PRODUCTS = [
    # Cervezas
    {"name": "Cerveza Zulia", "stock": 73, "category": "Bebidas", "image": "cerveza-zulia"},
    {"name": "Zulia lata", "stock": 0, "category": "Bebidas", "image": "zulia-lata"},
    {"name": "Tercio Polar", "stock": 327, "category": "Bebidas", "image": "tercio-polar"},
    {"name": "Cerveza Polar Negrita", "stock": 933, "category": "Bebidas", "image": "cerveza-polar-negrita"},
    {"name": "Polar Light lata pequeña", "stock": 1, "category": "Bebidas", "image": "polar-light-lata-pequena"},
    {"name": "Polar Light lata grande", "stock": 161, "category": "Bebidas", "image": "polar-light-lata-grande"},
    {"name": "Polar Light Pilsen", "stock": 2109, "category": "Bebidas", "image": "polar-light-pilsen"},
    {"name": "Polar Pilsen lata grande", "stock": 0, "category": "Bebidas", "image": "polar-pilsen-lata-grande"},
    {"name": "Polar Pilsen lata pequeña", "stock": 0, "category": "Bebidas", "image": "polar-pilsen-lata-pequena"},

    # Maltas
    {"name": "Malta retornable", "stock": 0, "category": "Bebidas", "image": "malta-retornable"},
    {"name": "Malta grande", "stock": 11, "category": "Bebidas", "image": "malta-grande"},
    {"name": "Malta lata", "stock": 0, "category": "Bebidas", "image": "malta-lata"},

    # Gaseosas y refrescos
    {"name": "Glup 1 litro", "stock": 1, "category": "Bebidas", "image": "glup-1-litro"},
    {"name": "Golden 2 litros", "stock": 2, "category": "Bebidas", "image": "golden-2-litros"},
    {"name": "Soda Milnava lata", "stock": 0, "category": "Bebidas", "image": "soda-milnava-lata"},
    {"name": "Caroreña lata pequeña", "stock": 0, "category": "Bebidas", "image": "carorena-lata-pequena"},
    {"name": "Coca-Cola lata", "stock": 0, "category": "Bebidas", "image": "coca-cola-lata"},
    {"name": "Solera lata", "stock": 0, "category": "Bebidas", "image": "solera-lata"},
    {"name": "Pepsi 2 litros", "stock": 0, "category": "Bebidas", "image": "pepsi-2-litros"},

    # Licores y destilados
    {"name": "Sangría La Diosa", "stock": 2, "category": "Bebidas", "image": "sangria-la-diosa"},
    {"name": "Tucacas (licor)", "stock": 8, "category": "Bebidas", "image": "tucacas-licor"},
    {"name": "Country Club (licor)", "stock": 0, "category": "Bebidas", "image": "country-club-licor"},
    {"name": "Jhon Master (licor)", "stock": 1, "category": "Bebidas", "image": "jhon-master-licor"},

    # Aguardiente de cocuy (Leal)
    {"name": "Aguardiente de Cocuy 0.35 L Leal", "stock": 3, "category": "Bebidas", "image": "aguardiente-de-cocuy-0-35-l-leal"},
    {"name": "Aguardiente de Cocuy 0.70 L Leal", "stock": 5, "category": "Bebidas", "image": "aguardiente-de-cocuy-0-70-l-leal"},
    {"name": "Aguardiente de Cocuy 1 L Leal", "stock": 2, "category": "Bebidas", "image": "aguardiente-de-cocuy-1-l-leal"},

    # Brandy Chemineaud
    {"name": "Brandy Chemineaud 0.35 L", "stock": 17, "category": "Bebidas", "image": "brandy-chemineaud-0-35-l"},
    {"name": "Brandy Chemineaud 0.70 L", "stock": 6, "category": "Bebidas", "image": "brandy-chemineaud-0-70-l"},
    {"name": "Brandy Chemineaud 1.75 L", "stock": 6, "category": "Bebidas", "image": "brandy-chemineaud-1-75-l"},
    {"name": "Brandy Chemineaud VSOP", "stock": 4, "category": "Bebidas", "image": "brandy-chemineaud-vsop"},

    # Ron
    {"name": "Ron Pampero", "stock": 6, "category": "Bebidas", "image": "pampero"},

    # Víveres
    {"name": "Harina Pan", "stock": 6, "category": "Víveres", "image": "harina-pan"},
    {"name": "Arroz Primor", "stock": 2, "category": "Víveres", "image": "arroz-primor"},
    {"name": "Harina de maíz Flor de Auruaca", "stock": 2, "category": "Víveres", "image": "harina-de-maiz-flor-de-auruaca"},
    {"name": "Pasta Primor larga", "stock": 6, "category": "Víveres", "image": "pasta-primor-larga"},
    {"name": "Sardina Mar Bonita", "stock": 11, "category": "Víveres", "image": "sardina-mar-bonita"},
    {"name": "Granola", "stock": 4, "category": "Víveres", "image": "granola"},
    {"name": "Sal Mía", "stock": 13, "category": "Víveres", "image": "sal-mia"},
    {"name": "Cocoeste", "stock": 14, "category": "Víveres", "image": "cocoeste"},
    {"name": "Ávila Tripac", "stock": 1, "category": "Víveres", "image": "avila-tripac"},
    {"name": "Ávila Soya", "stock": 5, "category": "Víveres", "image": "avila-soya"},
    {"name": "Ávila Ajo", "stock": 2, "category": "Víveres", "image": "avila-ajo"},

    # Galletas y snacks
    {"name": "Club Social", "stock": 6, "category": "Snacks", "image": "club-social"},
    {"name": "Samba", "stock": 20, "category": "Snacks", "image": "samba"},
    {"name": "Bonbonbum", "stock": 25, "category": "Snacks", "image": "bonbonbum"},
    {"name": "Chocolate Savoy pequeño", "stock": 7, "category": "Snacks", "image": "chocolate-savoy-pequeno"},
    {"name": "Chocolate varios pequeño", "stock": 12, "category": "Snacks", "image": "chocolate-varios-pequeno"},
    {"name": "Cheese Trees pequeño", "stock": 3, "category": "Snacks", "image": "cheese-trees-pequeno"},
    {"name": "Cheese Trees grande", "stock": 2, "category": "Snacks", "image": "cheese-trees-grande"},
    {"name": "Tostón Tom", "stock": 2, "category": "Snacks", "image": "toston-tom"},
    {"name": "Natu Chips", "stock": 2, "category": "Snacks", "image": "natu-chips"},
    {"name": "Jack chicharrón pequeño", "stock": 9, "category": "Snacks", "image": "jack-chicharron-pequeno"},
    {"name": "Jack chicharrón grande", "stock": 4, "category": "Snacks", "image": "jack-chicharron-grande"},
    {"name": "Pepito pequeño", "stock": 5, "category": "Snacks", "image": "pepito-pequeno"},
    {"name": "Raqueti", "stock": 13, "category": "Snacks", "image": "raqueti"},
    {"name": "Tom mediano", "stock": 4, "category": "Snacks", "image": "tom-mediano"},
    {"name": "Doritos grande", "stock": 1, "category": "Snacks", "image": "doritos-grande"},
    {"name": "Doritos dinamita grande", "stock": 4, "category": "Snacks", "image": "doritos-dinamita-grande"},
    {"name": "Doritos pequeño", "stock": 4, "category": "Snacks", "image": "doritos-pequeno"},
    {"name": "Chetos grande", "stock": 6, "category": "Snacks", "image": "chetos-grande"},
    {"name": "Chiquesesito pequeño", "stock": 7, "category": "Snacks", "image": "chiquesesito-pequeno"},
    {"name": "Flips mediano", "stock": 5, "category": "Snacks", "image": "flips-mediano"},

    # Cigarrillos
    {"name": "Consul", "stock": 2, "category": "Otros", "image": "consul"},
    {"name": "Pall Mall", "stock": 4, "category": "Otros", "image": "pall-mall"},
    {"name": "Viceroy", "stock": 16, "category": "Otros", "image": "viceroy"},
    {"name": "Belmont", "stock": 6, "category": "Otros", "image": "belmont"},
    {"name": "Belmont media", "stock": 6, "category": "Otros", "image": "belmont-media"},
    {"name": "Lucky", "stock": 1, "category": "Otros", "image": "lucky"},

    # Otros
    {"name": "Apureñito", "stock": 16, "category": "Otros", "image": "apurenito"},
    {"name": "Halls", "stock": 2, "category": "Otros", "image": "halls"}
]

def main():
    print("--- GENERATING BACKUP JSON FOR DONDE JUANCHO ---")
    
    # 1. Create list of products matching local schema
    products_list = []
    for idx, rp in enumerate(RAW_PRODUCTS):
        prod_id = f"prod_juancho_{int(time.time())}_{idx}"
        
        # Determine if image exists in product folder
        img_filename = f"{rp['image']}.webp"
        img_path = os.path.join(PRODUCTOS_DIR, img_filename)
        
        # Fallback if image doesn't exist yet, we still reference it
        relative_image_path = f"/images/catalog/{img_filename}"
        
        products_list.append({
            "id": prod_id,
            "name": rp["name"],
            "priceUsd": 0.0,
            "priceUsdt": 0.0,
            "costUsd": 0.0,
            "stock": rp["stock"],
            "lowStockAlert": 5,
            "category": rp["category"],
            "barcode": "",
            "unit": "und",
            "image": relative_image_path
        })
        
        # Copy to public catalog images folder if it exists
        if os.path.exists(img_path):
            os.makedirs(CATALOG_IMAGES_DIR, exist_ok=True)
            shutil.copy(img_path, os.path.join(CATALOG_IMAGES_DIR, img_filename))
            
    # 2. Build full backup structure
    backup_data = {
        "timestamp": "2026-07-14T02:00:00.000Z",
        "version": "2.0",
        "appName": "TasasAlDia_Bodegas",
        "data": {
            "idb": {
                "bodega_products_v1": products_list
            }
        }
    }
    
    # 3. Write to workspace
    with open(WORKSPACE_BACKUP_PATH, "w", encoding="utf-8") as f:
        json.dump(backup_data, f, ensure_ascii=False, indent=2)
    print(f"Saved backup JSON inside workspace: {WORKSPACE_BACKUP_PATH}")
    
    # 4. Write to Desktop
    try:
        with open(DESKTOP_BACKUP_PATH, "w", encoding="utf-8") as f:
            json.dump(backup_data, f, ensure_ascii=False, indent=2)
        print(f"Saved copy of backup JSON directly to Desktop: {DESKTOP_BACKUP_PATH}")
    except Exception as e:
        print(f"Desktop copy skipped: {e}")
        
    print("--- BACKUP GENERATION COMPLETED ---")

if __name__ == "__main__":
    main()
