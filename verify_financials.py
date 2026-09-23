#!/usr/bin/env python3
"""
Verificador financiero independiente - Precios Al Día
Verifica todos los cálculos del reporte contra los datos brutos de ventas.
"""

from decimal import Decimal, ROUND_HALF_UP

def r2(v):
    """Round to 2 decimal places (same as dinero.js round2)"""
    return float(Decimal(str(v)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))

BCV = 36.50

# ─── APERTURA DE CAJA ───
APERTURA_USD = 100.00
APERTURA_BS  = 3650.00

# ─── VENTAS (del ticket compartido) ───
# Formato: (hora, cliente, total_usd, items_qty, tipo, pagos_list, descuento_usd, vuelto_usd, vuelto_bs)
# pagos_list = [(metodId, amount, currency)] donde currency = 'USD'|'BS'
# tipo: 'VENTA'|'VENTA_FIADA'|'ANULADA'

sales = [
    # 1 - 04:18 Consumidor Final $13.95 - Pago Movil Bs 509.17
    ("04:18", "CF", 13.95, 11, "VENTA", [("pago_movil", 509.17, "BS")], 0, 0, 0),
    # 2 - 01:14 CF $22.50 - Pago Movil Bs 821.25
    ("01:14", "CF", 22.50, 6, "VENTA", [("pago_movil", 821.25, "BS")], 0, 0, 0),
    # 3 - 09:04 Jose Rodriguez $4.00 - FIADO
    ("09:04", "JR", 4.00, 1, "VENTA_FIADA", [], 0, 0, 0),
    # 4 - 03:20 CF $9.45 - Pago Movil Bs 344.92 (descuento $1.05 from $10.50)
    ("03:20", "CF", 9.45, 3, "VENTA", [("pago_movil", 344.92, "BS")], 1.05, 0, 0),
    # 5 - 01:56 CF $12.80 - Pago Movil Bs 467.20
    ("01:56", "CF", 12.80, 5, "VENTA", [("pago_movil", 467.20, "BS")], 0, 0, 0),
    # 6 - 08:05 CF $4.30 - Efectivo $2.15 + Pago Movil Bs 78.47
    ("08:05a", "CF", 4.30, 2, "VENTA", [("efectivo_usd", 2.15, "USD"), ("pago_movil", 78.47, "BS")], 0, 0, 0),
    # 7 - 02:25 CF $8.46 - Pago Movil Bs 308.79 (descuento $0.94)
    ("02:25", "CF", 8.46, 4, "VENTA", [("pago_movil", 308.79, "BS")], 0.94, 0, 0),
    # 8 - 06:30 CF $20.65 - Efectivo $10.33 + Pago Movil Bs 376.68
    ("06:30", "CF", 20.65, 8, "VENTA", [("efectivo_usd", 10.33, "USD"), ("pago_movil", 376.68, "BS")], 0, 0, 0),
    # 9 - 04:34 CF $26.50 - Efectivo $50.00, vuelto $23.50
    ("04:34", "CF", 26.50, 8, "VENTA", [("efectivo_usd", 50.00, "USD")], 0, 23.50, 0),
    # 10 - 07:59 CF $2.20 - Efectivo $1.10 + Pago Movil Bs 40.15
    ("07:59", "CF", 2.20, 2, "VENTA", [("efectivo_usd", 1.10, "USD"), ("pago_movil", 40.15, "BS")], 0, 0, 0),
    # 11 - 07:48 CF $15.40 - Pago Movil Bs 562.10
    ("07:48", "CF", 15.40, 8, "VENTA", [("pago_movil", 562.10, "BS")], 0, 0, 0),
    # 12 - 08:05 CF $3.70 - Pago Movil Bs 135.05
    ("08:05b", "CF", 3.70, 3, "VENTA", [("pago_movil", 135.05, "BS")], 0, 0, 0),
    # 13 - 07:36 Ana Martinez $30.25 - FIADO
    ("07:36", "AM", 30.25, 11, "VENTA_FIADA", [], 0, 0, 0),
    # 14 - 09:49 ANULADA
    ("09:49", "CF", 0, 0, "ANULADA", [], 0, 0, 0),
    # 15 - 12:55 CF $17.90 - Pago Movil Bs 653.35
    ("12:55", "CF", 17.90, 6, "VENTA", [("pago_movil", 653.35, "BS")], 0, 0, 0),
    # 16 - 08:07 ANULADA
    ("08:07", "CF", 0, 0, "ANULADA", [], 0, 0, 0),
    # 17 - 01:16 Jose Rodriguez $15.70 - FIADO
    ("01:16", "JR", 15.70, 8, "VENTA_FIADA", [], 0, 0, 0),
    # 18 - 12:00 CF $8.10 - Efectivo $20.00, vuelto $11.90 (descuento $0.90)
    ("12:00", "CF", 8.10, 6, "VENTA", [("efectivo_usd", 20.00, "USD")], 0.90, 11.90, 0),
    # 19 - 06:03 CF $14.70 - Pago Movil Bs 536.55
    ("06:03a", "CF", 14.70, 7, "VENTA", [("pago_movil", 536.55, "BS")], 0, 0, 0),
    # 20 - 05:56 Jose Rodriguez $4.68 - FIADO (descuento $0.52)
    ("05:56", "JR", 4.68, 5, "VENTA_FIADA", [], 0.52, 0, 0),
    # 21 - 02:46 CF $1.25 - Pago Movil Bs 45.63
    ("02:46", "CF", 1.25, 1, "VENTA", [("pago_movil", 45.63, "BS")], 0, 0, 0),
    # 22 - 06:50 CF $18.85 - Efectivo $50.00, vuelto $31.15
    ("06:50", "CF", 18.85, 8, "VENTA", [("efectivo_usd", 50.00, "USD")], 0, 31.15, 0),
    # 23 - 07:13 CF $8.40 - Pago Movil Bs 306.60
    ("07:13a", "CF", 8.40, 3, "VENTA", [("pago_movil", 306.60, "BS")], 0, 0, 0),
    # 24 - 01:07 CF $18.90 - Pago Movil Bs 689.85
    ("01:07", "CF", 18.90, 12, "VENTA", [("pago_movil", 689.85, "BS")], 0, 0, 0),
    # 25 - 08:08 CF $11.65 - Efectivo $20.00, vuelto $8.35
    ("08:08", "CF", 11.65, 9, "VENTA", [("efectivo_usd", 20.00, "USD")], 0, 8.35, 0),
    # 26 - 03:16 CF $3.60 - Pago Movil Bs 131.40
    ("03:16", "CF", 3.60, 2, "VENTA", [("pago_movil", 131.40, "BS")], 0, 0, 0),
    # 27 - 04:21 CF $16.20 - Pago Movil Bs 591.30
    ("04:21", "CF", 16.20, 9, "VENTA", [("pago_movil", 591.30, "BS")], 0, 0, 0),
    # 28 - 04:06 CF $21.00 - Efectivo $50.00, vuelto $29.00
    ("04:06", "CF", 21.00, 6, "VENTA", [("efectivo_usd", 50.00, "USD")], 0, 29.00, 0),
    # 29 - 05:28 CF $7.40 - Pago Movil Bs 270.10
    ("05:28", "CF", 7.40, 6, "VENTA", [("pago_movil", 270.10, "BS")], 0, 0, 0),
    # 30 - 06:18 CF $11.80 - Efectivo $20.00, vuelto $8.20
    ("06:18", "CF", 11.80, 5, "VENTA", [("efectivo_usd", 20.00, "USD")], 0, 8.20, 0),
    # 31 - 02:49 CF $8.45 - Pago Movil Bs 308.42
    ("02:49", "CF", 8.45, 3, "VENTA", [("pago_movil", 308.42, "BS")], 0, 0, 0),
    # 32 - 02:50 CF $0.95 - Efectivo $0.48 + Pago Movil Bs 17.15
    ("02:50", "CF", 0.95, 1, "VENTA", [("efectivo_usd", 0.48, "USD"), ("pago_movil", 17.15, "BS")], 0, 0, 0),
    # 33 - 12:21 Maria Garcia $4.50 - FIADO
    ("12:21", "MG", 4.50, 3, "VENTA_FIADA", [], 0, 0, 0),
    # 34 - 01:14 CF $15.50 - Pago Movil Bs 565.75
    ("01:14b", "CF", 15.50, 4, "VENTA", [("pago_movil", 565.75, "BS")], 0, 0, 0),
    # 35 - 08:17 Jose Rodriguez $10.85 - FIADO
    ("08:17", "JR", 10.85, 5, "VENTA_FIADA", [], 0, 0, 0),
    # 36 - 01:25 CF $14.55 - Pago Movil Bs 531.08
    ("01:25", "CF", 14.55, 7, "VENTA", [("pago_movil", 531.08, "BS")], 0, 0, 0),
    # 37 - 08:16 CF $7.50 - Pago Movil Bs 273.75
    ("08:16", "CF", 7.50, 2, "VENTA", [("pago_movil", 273.75, "BS")], 0, 0, 0),
    # 38 - 08:49 CF $8.65 - Efectivo $20.00, vuelto $11.35
    ("08:49", "CF", 8.65, 9, "VENTA", [("efectivo_usd", 20.00, "USD")], 0, 11.35, 0),
    # 39 - 11:47 CF $23.70 - Pago Movil Bs 865.05
    ("11:47", "CF", 23.70, 9, "VENTA", [("pago_movil", 865.05, "BS")], 0, 0, 0),
    # 40 - 11:21 CF $16.75 - Pago Movil Bs 611.38
    ("11:21", "CF", 16.75, 8, "VENTA", [("pago_movil", 611.38, "BS")], 0, 0, 0),
    # 41 - 01:19 CF $9.72 - Pago Movil Bs 354.78 (descuento $1.08)
    ("01:19", "CF", 9.72, 6, "VENTA", [("pago_movil", 354.78, "BS")], 1.08, 0, 0),
    # 42 - 04:42 ANULADA
    ("04:42", "CF", 0, 0, "ANULADA", [], 0, 0, 0),
    # 43 - 09:47 CF $8.40 - Pago Movil Bs 306.60
    ("09:47a", "CF", 8.40, 3, "VENTA", [("pago_movil", 306.60, "BS")], 0, 0, 0),
    # 44 - 05:50 CF $19.00 - Pago Movil Bs 693.50
    ("05:50", "CF", 19.00, 10, "VENTA", [("pago_movil", 693.50, "BS")], 0, 0, 0),
    # 45 - 09:35 CF $10.40 - Efectivo $20.00, vuelto $9.60
    ("09:35a", "CF", 10.40, 3, "VENTA", [("efectivo_usd", 20.00, "USD")], 0, 9.60, 0),
    # 46 - 07:41 Maria Garcia $22.20 - FIADO
    ("07:41", "MG", 22.20, 9, "VENTA_FIADA", [], 0, 0, 0),
    # 47 - 08:28 CF $1.90 - Pago Movil Bs 69.35
    ("08:28", "CF", 1.90, 2, "VENTA", [("pago_movil", 69.35, "BS")], 0, 0, 0),
    # 48 - 01:51 CF $9.60 - Pago Movil Bs 350.40
    ("01:51", "CF", 9.60, 3, "VENTA", [("pago_movil", 350.40, "BS")], 0, 0, 0),
    # 49 - 01:40 CF $8.10 - Efectivo $4.05 + Pago Movil Bs 147.82
    ("01:40", "CF", 8.10, 7, "VENTA", [("efectivo_usd", 4.05, "USD"), ("pago_movil", 147.82, "BS")], 0, 0, 0),
    # 50 - 05:54 CF $7.75 - Pago Movil Bs 282.88
    ("05:54", "CF", 7.75, 6, "VENTA", [("pago_movil", 282.88, "BS")], 0, 0, 0),
    # 51 - 01:12 CF $10.50 - Efectivo $5.25 + Pago Movil Bs 191.63
    ("01:12", "CF", 10.50, 3, "VENTA", [("efectivo_usd", 5.25, "USD"), ("pago_movil", 191.63, "BS")], 0, 0, 0),
    # 52 - 10:52 CF $14.95 - Pago Movil Bs 545.67
    ("10:52", "CF", 14.95, 7, "VENTA", [("pago_movil", 545.67, "BS")], 0, 0, 0),
    # 53 - 10:46 CF $6.40 - Pago Movil Bs 233.60
    ("10:46", "CF", 6.40, 2, "VENTA", [("pago_movil", 233.60, "BS")], 0, 0, 0),
    # 54 - 02:31 Maria Garcia $2.20 - FIADO
    ("02:31", "MG", 2.20, 2, "VENTA_FIADA", [], 0, 0, 0),
    # 55 - 03:42 CF $16.05 - Pago Movil Bs 585.83
    ("03:42", "CF", 16.05, 9, "VENTA", [("pago_movil", 585.83, "BS")], 0, 0, 0),
    # 56 - 07:50 CF $18.60 - Efectivo $9.30 + Pago Movil Bs 339.45
    ("07:50a", "CF", 18.60, 7, "VENTA", [("efectivo_usd", 9.30, "USD"), ("pago_movil", 339.45, "BS")], 0, 0, 0),
    # 57 - 12:54 CF $3.30 - Pago Movil Bs 120.45
    ("12:54", "CF", 3.30, 3, "VENTA", [("pago_movil", 120.45, "BS")], 0, 0, 0),
    # 58 - 05:52 CF $9.35 - Pago Movil Bs 341.28
    ("05:52a", "CF", 9.35, 6, "VENTA", [("pago_movil", 341.28, "BS")], 0, 0, 0),
    # 59 - 01:09 CF $0.95 - Pago Movil Bs 34.67
    ("01:09", "CF", 0.95, 1, "VENTA", [("pago_movil", 34.67, "BS")], 0, 0, 0),
    # 60 - 06:10 CF $16.55 - Pago Movil Bs 604.08
    ("06:10", "CF", 16.55, 7, "VENTA", [("pago_movil", 604.08, "BS")], 0, 0, 0),
    # 61 - 09:35 CF $11.60 - Pago Movil Bs 423.40
    ("09:35b", "CF", 11.60, 7, "VENTA", [("pago_movil", 423.40, "BS")], 0, 0, 0),
    # 62 - 02:05 CF $5.00 - Efectivo $20.00, vuelto $15.00
    ("02:05", "CF", 5.00, 2, "VENTA", [("efectivo_usd", 20.00, "USD")], 0, 15.00, 0),
    # 63 - 02:59 CF $9.20 - Pago Movil Bs 335.80
    ("02:59", "CF", 9.20, 4, "VENTA", [("pago_movil", 335.80, "BS")], 0, 0, 0),
    # 64 - 09:38 CF $3.95 - Pago Movil Bs 144.18
    ("09:38", "CF", 3.95, 3, "VENTA", [("pago_movil", 144.18, "BS")], 0, 0, 0),
    # 65 - 09:42 CF $9.05 - Efectivo $4.53 + Pago Movil Bs 164.98
    ("09:42", "CF", 9.05, 6, "VENTA", [("efectivo_usd", 4.53, "USD"), ("pago_movil", 164.98, "BS")], 0, 0, 0),
    # 66 - 05:59 CF $11.80 - Pago Movil Bs 430.70
    ("05:59", "CF", 11.80, 7, "VENTA", [("pago_movil", 430.70, "BS")], 0, 0, 0),
    # 67 - 08:54 CF $9.60 - Efectivo $20.00, vuelto $10.40
    ("08:54a", "CF", 9.60, 3, "VENTA", [("efectivo_usd", 20.00, "USD")], 0, 10.40, 0),
    # 68 - 12:57 CF $1.80 - Pago Movil Bs 65.70
    ("12:57", "CF", 1.80, 1, "VENTA", [("pago_movil", 65.70, "BS")], 0, 0, 0),
    # 69 - 08:47 CF $4.00 - Pago Movil Bs 146.00
    ("08:47", "CF", 4.00, 1, "VENTA", [("pago_movil", 146.00, "BS")], 0, 0, 0),
    # 70 - 01:44 CF $18.50 - Pago Movil Bs 675.25
    ("01:44", "CF", 18.50, 5, "VENTA", [("pago_movil", 675.25, "BS")], 0, 0, 0),
    # 71 - 05:52 CF $14.30 - Efectivo $20.00, vuelto $5.70
    ("05:52b", "CF", 14.30, 5, "VENTA", [("efectivo_usd", 20.00, "USD")], 0, 5.70, 0),
    # 72 - 08:54 Maria Garcia $4.00 - FIADO
    ("08:54b", "MG", 4.00, 1, "VENTA_FIADA", [], 0, 0, 0),
    # 73 - 12:40 CF $4.70 - Efectivo $2.35 + Pago Movil Bs 85.78
    ("12:40", "CF", 4.70, 3, "VENTA", [("efectivo_usd", 2.35, "USD"), ("pago_movil", 85.78, "BS")], 0, 0, 0),
    # 74 - 08:24 CF $10.93 - Pago Movil Bs 398.95 (descuento $1.22)
    ("08:24", "CF", 10.93, 6, "VENTA", [("pago_movil", 398.95, "BS")], 1.22, 0, 0),
    # 75 - 09:47 CF $11.10 - Pago Movil Bs 405.15
    ("09:47b", "CF", 11.10, 4, "VENTA", [("pago_movil", 405.15, "BS")], 0, 0, 0),
    # 76 - 04:09 Ana Martinez $25.55 - FIADO
    ("04:09", "AM", 25.55, 8, "VENTA_FIADA", [], 0, 0, 0),
    # 77 - 03:18 CF $1.50 - Efectivo $20.00, vuelto $18.50
    ("03:18", "CF", 1.50, 2, "VENTA", [("efectivo_usd", 20.00, "USD")], 0, 18.50, 0),
    # 78 - 06:03 CF $10.50 - Efectivo $5.25 + Pago Movil Bs 191.63
    ("06:03b", "CF", 10.50, 7, "VENTA", [("efectivo_usd", 5.25, "USD"), ("pago_movil", 191.63, "BS")], 0, 0, 0),
    # 79 - 09:41 CF $1.50 - Pago Movil Bs 54.75
    ("09:41", "CF", 1.50, 1, "VENTA", [("pago_movil", 54.75, "BS")], 0, 0, 0),
    # 80 - 05:40 CF $7.00 - Efectivo $3.50 + Pago Movil Bs 127.75
    ("05:40", "CF", 7.00, 3, "VENTA", [("efectivo_usd", 3.50, "USD"), ("pago_movil", 127.75, "BS")], 0, 0, 0),
    # 81 - 06:13 CF $10.20 - Efectivo $5.10 + Pago Movil Bs 186.15
    ("06:13", "CF", 10.20, 3, "VENTA", [("efectivo_usd", 5.10, "USD"), ("pago_movil", 186.15, "BS")], 0, 0, 0),
    # 82 - 03:51 CF $5.75 - Pago Movil Bs 209.88
    ("03:51", "CF", 5.75, 4, "VENTA", [("pago_movil", 209.88, "BS")], 0, 0, 0),
    # 83 - 07:18 Ana Martinez $2.50 - FIADO
    ("07:18", "AM", 2.50, 2, "VENTA_FIADA", [], 0, 0, 0),
    # 84 - 07:10 CF $16.35 - Pago Movil Bs 596.78
    ("07:10", "CF", 16.35, 10, "VENTA", [("pago_movil", 596.78, "BS")], 0, 0, 0),
    # 85 - 03:25 CF $21.30 - Pago Movil Bs 777.45
    ("03:25", "CF", 21.30, 8, "VENTA", [("pago_movil", 777.45, "BS")], 0, 0, 0),
    # 86 - 01:24 CF $7.85 - Pago Movil Bs 286.52
    ("01:24", "CF", 7.85, 5, "VENTA", [("pago_movil", 286.52, "BS")], 0, 0, 0),
    # 87 - 07:47 CF $5.20 - Efectivo $20.00, vuelto $14.80
    ("07:47", "CF", 5.20, 3, "VENTA", [("efectivo_usd", 20.00, "USD")], 0, 14.80, 0),
    # 88 - 07:50 CF $2.20 - Pago Movil Bs 80.30
    ("07:50b", "CF", 2.20, 2, "VENTA", [("pago_movil", 80.30, "BS")], 0, 0, 0),
    # 89 - 04:00 CF $1.25 - Pago Movil Bs 45.63
    ("04:00", "CF", 1.25, 1, "VENTA", [("pago_movil", 45.63, "BS")], 0, 0, 0),
    # 90 - 07:13 CF $13.50 - Efectivo $20.00, vuelto $6.50
    ("07:13b", "CF", 13.50, 7, "VENTA", [("efectivo_usd", 20.00, "USD")], 0, 6.50, 0),
    # 91 - 07:34 Maria Garcia $1.80 - FIADO
    ("07:34", "MG", 1.80, 1, "VENTA_FIADA", [], 0, 0, 0),
    # 92 - 07:03 CF $5.55 - Pago Movil Bs 202.58
    ("07:03", "CF", 5.55, 4, "VENTA", [("pago_movil", 202.58, "BS")], 0, 0, 0),
    # 93 - 09:08 CF $3.75 - Pago Movil Bs 136.88
    ("09:08", "CF", 3.75, 3, "VENTA", [("pago_movil", 136.88, "BS")], 0, 0, 0),
    # 94 - 04:57 CF $11.30 - Pago Movil Bs 412.45
    ("04:57", "CF", 11.30, 8, "VENTA", [("pago_movil", 412.45, "BS")], 0, 0, 0),
    # 95 - 06:01 CF $23.80 - Pago Movil Bs 868.70
    ("06:01", "CF", 23.80, 8, "VENTA", [("pago_movil", 868.70, "BS")], 0, 0, 0),
    # 96 - 11:25 CF $8.10 - Efectivo $4.05 + Pago Movil Bs 147.82
    ("11:25", "CF", 8.10, 5, "VENTA", [("efectivo_usd", 4.05, "USD"), ("pago_movil", 147.82, "BS")], 0, 0, 0),
    # 97 - 06:32 CF $6.00 - Pago Movil Bs 219.00
    ("06:32", "CF", 6.00, 4, "VENTA", [("pago_movil", 219.00, "BS")], 0, 0, 0),
    # 98 - 09:59 CF $6.10 - Pago Movil Bs 222.65
    ("09:59", "CF", 6.10, 4, "VENTA", [("pago_movil", 222.65, "BS")], 0, 0, 0),
    # 99 - 10:01 Maria Garcia $11.05 - FIADO
    ("10:01", "MG", 11.05, 6, "VENTA_FIADA", [], 0, 0, 0),
    # 100 - 12:52 CF $8.00 - Efectivo $4.00 + Pago Movil Bs 146.00
    ("12:52", "CF", 8.00, 2, "VENTA", [("efectivo_usd", 4.00, "USD"), ("pago_movil", 146.00, "BS")], 0, 0, 0),
    # 101 - 08:21 CF $19.85 - Pago Movil Bs 724.53
    ("08:21", "CF", 19.85, 9, "VENTA", [("pago_movil", 724.53, "BS")], 0, 0, 0),
    # 102 - 07:56 CF $2.80 - Pago Movil Bs 102.20
    ("07:56", "CF", 2.80, 1, "VENTA", [("pago_movil", 102.20, "BS")], 0, 0, 0),
]

print("=" * 60)
print("VERIFICADOR FINANCIERO — PRECIOS AL DÍA")
print("=" * 60)

# ─── 1. VENTAS Y ARTÍCULOS ───
valid_sales   = [s for s in sales if s[4] != "ANULADA"]
ventas_count  = len(valid_sales)
articulos     = sum(s[3] for s in valid_sales)

print(f"\n[1] VENTAS Y ARTÍCULOS")
print(f"  Ventas válidas:     {ventas_count}  → Reportado: 99  {'✅' if ventas_count == 99 else '❌ DISCREPANCIA'}")
print(f"  Artículos vendidos: {articulos}  → Reportado: 491 {'✅' if articulos == 491 else '❌ DISCREPANCIA'}")

# ─── 2. INGRESOS BRUTOS ───
ingresos_usd = r2(sum(s[2] for s in valid_sales))
ingresos_bs  = r2(ingresos_usd * BCV)
print(f"\n[2] INGRESOS BRUTOS")
print(f"  Calculado USD:  ${ingresos_usd:,.2f}  → Reportado: $1,031.39  {'✅' if ingresos_usd == 1031.39 else '❌ DISCREPANCIA'}")
print(f"  Calculado Bs:   Bs {ingresos_bs:,.2f}  → Reportado: Bs 37,645.81  {'✅' if ingresos_bs == 37645.81 else '❌ DISCREPANCIA'}")

# ─── 3. MÉTODOS DE PAGO ───
print(f"\n[3] MÉTODOS DE PAGO")

# Add apertura (opening float)
efectivo_usd_total = APERTURA_USD
efectivo_bs_total  = APERTURA_BS
pago_movil_total   = 0.0
fiado_total        = 0.0

payment_errors = []

for s in valid_sales:
    hora, cliente, total_usd, qty, tipo, pagos, descuento, vuelto_usd, vuelto_bs = s

    if tipo == "VENTA_FIADA":
        fiado_total = r2(fiado_total + total_usd)
        continue

    # Sum payments
    sum_usd = 0.0
    sum_bs  = 0.0
    for method, amount, currency in pagos:
        if currency == "USD":
            sum_usd = r2(sum_usd + amount)
            efectivo_usd_total = r2(efectivo_usd_total + amount)
        elif currency == "BS":
            sum_bs = r2(sum_bs + amount)
            pago_movil_total = r2(pago_movil_total + amount)

    # Deduct change
    if vuelto_usd > 0:
        efectivo_usd_total = r2(efectivo_usd_total - vuelto_usd)
    if vuelto_bs > 0:
        efectivo_bs_total = r2(efectivo_bs_total - vuelto_bs)

    # Verify payment covers total
    total_received_usd = r2(sum_usd - vuelto_usd + sum_bs / BCV)
    expected_usd = total_usd
    diff = abs(r2(total_received_usd - expected_usd))
    if diff > 0.02:
        payment_errors.append(f"  ⚠️  {hora}: Recibido ${total_received_usd:.2f} vs Total ${expected_usd:.2f} (diff ${diff:.2f})")

print(f"  Efectivo $ (c/apertura $100): ${efectivo_usd_total:,.2f}  → Reportado: $327.49  {'✅' if efectivo_usd_total == 327.49 else f'❌ DISCREPANCIA (diff ${abs(efectivo_usd_total-327.49):.2f})'}")
print(f"  Efectivo Bs (c/apertura Bs3650): Bs {efectivo_bs_total:,.2f}  → Reportado: Bs 3,650.00  {'✅' if efectivo_bs_total == 3650.00 else f'❌ DISCREPANCIA'}")
print(f"  Pago Móvil: Bs {pago_movil_total:,.2f}  → Reportado: Bs 24,258.67  {'✅' if pago_movil_total == 24258.67 else f'❌ DISCREPANCIA (diff Bs {abs(pago_movil_total-24258.67):.2f})'}")
print(f"  Fiado (USD): ${fiado_total:,.2f}  → Reportado: $139.28  {'✅' if fiado_total == 139.28 else f'❌ DISCREPANCIA (diff ${abs(fiado_total-139.28):.2f})'}")

# ─── 4. CONSISTENCIA: Suma de métodos = Ingresos ───
print(f"\n[4] CONSISTENCIA TOTAL")
# Net efectivo usd from sales (excl apertura) = efectivo_usd_total - 100
usd_from_sales = r2(efectivo_usd_total - APERTURA_USD)
bs_from_sales_in_usd = r2(pago_movil_total / BCV)
fiado_usd = fiado_total
total_check = r2(usd_from_sales + bs_from_sales_in_usd + fiado_usd)
print(f"  USD efectivo (neto ventas): ${usd_from_sales:.2f}")
print(f"  Pago Movil en USD:          ${bs_from_sales_in_usd:.2f}")
print(f"  Fiado (USD):                ${fiado_usd:.2f}")
print(f"  Suma total:                 ${total_check:.2f}  → Reportado: $1,031.39  {'✅' if abs(total_check - 1031.39) < 0.02 else f'❌ DISCREPANCIA (diff ${abs(total_check-1031.39):.2f})'}")

# ─── 5. CUADRE DE CAJA ───
print(f"\n[5] CUADRE DE CAJA")
# Physical drawer: apertura_usd + gross_usd_received - vuelto_usd
gross_usd = r2(sum(amount for s in valid_sales if s[4] != "VENTA_FIADA" for method, amount, currency in s[5] if currency == "USD"))
total_vuelto_usd = r2(sum(s[7] for s in valid_sales))
cajero_esperado_usd = r2(APERTURA_USD + gross_usd - total_vuelto_usd)
declarado = 327.90
diferencia = r2(declarado - r2(cajero_esperado_usd - APERTURA_USD))
print(f"  Apertura USD:        ${APERTURA_USD:.2f}")
print(f"  Recibido USD bruto:  ${gross_usd:.2f}")
print(f"  Vuelto entregado:    ${total_vuelto_usd:.2f}")
print(f"  Caja esperada USD:   ${cajero_esperado_usd:.2f}")
print(f"  Declarado por cajero: ${declarado:.2f}")
print(f"  Diferencia:          ${r2(declarado - r2(efectivo_usd_total)):.2f}  → Reportado: $0.41  {'✅' if r2(declarado - r2(efectivo_usd_total)) == 0.41 else '❌ DISCREPANCIA'}")

# ─── 6. ERRORES DE PAGO ───
if payment_errors:
    print(f"\n[6] ⚠️  INCONSISTENCIAS DE PAGO ({len(payment_errors)} ventas):")
    for e in payment_errors:
        print(e)
else:
    print(f"\n[6] PAGOS: Todas las ventas cuadran internamente ✅")

print("\n" + "=" * 60)
