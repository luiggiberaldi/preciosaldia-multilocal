import re

with open("cierre_text.txt", "r", encoding="utf-8") as f:
    lines = f.readlines()

sales = []
current_sale = {}

for line in lines:
    line = line.strip()
    
    # Match start of sale: '05:35 p. m.Consumidor Final $1.20'
    m = re.match(r'(\d{2}:\d{2}.*?)Consumidor Final\s+\$([\d\.]+)', line)
    if m:
        if current_sale:
            sales.append(current_sale)
        current_sale = {'time': m.group(1), 'total_usd': float(m.group(2)), 'items': [], 'pago_str': ''}
        continue
    
    # Match items
    if line.startswith('1u ') or line.startswith('2u ') or line.startswith('4u ') or line.startswith('5u '):
        if current_sale:
            current_sale['items'].append(line)
        continue
        
    # Match Pago
    if line.startswith('Pago:'):
        if current_sale:
            current_sale['pago_str'] = line

if current_sale:
    sales.append(current_sale)

totals_by_method_usd = {}
total_usd_calculated = 0

print("Discrepancy Analysis:")
for sale in sales:
    total_usd_calculated += sale['total_usd']
    
    pago = sale['pago_str']
    method = ""
    if 'Efectivo En Bolívares' in pago: method = 'Efectivo En Bolívares'
    elif 'Efectivo En Dólares' in pago: method = 'Efectivo En Dólares'
    elif 'Punto De Venta' in pago: method = 'Punto De Venta'
    elif 'Pago Móvil' in pago: method = 'Pago Móvil'
    elif 'Pago Mixto' in pago: method = 'Pago Mixto'
    else: method = 'Unknown'
    
    totals_by_method_usd[method] = totals_by_method_usd.get(method, 0) + sale['total_usd']

v_efectivo_usd = 0.0
for sale in sales:
    if 'Efectivo En Dólares' in sale['pago_str']:
        v_efectivo_usd += sale['total_usd']
        print(f"Sale in USD cash: {sale['total_usd']} - {sale['pago_str']}")

print(f"\nTotal calculated from sales list: ${total_usd_calculated:.2f}")
print("Sales by method (USD value based on sale total):")
for m, v in totals_by_method_usd.items():
    print(f"  {m}: ${v:.2f}")

