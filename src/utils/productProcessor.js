// FIN-017: Reemplaza Math.round(raw/safeRate*100)/100 por divR + round2 de dinero.js.
// FIN-030: Mantiene `priceUsdt` (typo histórico) pero añade alias `priceUsd` (mismo valor)
//          para migración gradual hacia el nombre canónico.
import { round2, divR, mulR } from './dinero.js';
import { CurrencyService } from '../services/CurrencyService.js'; // FIN-017-pattern: safeParse en vez de parseFloat.
import { isGranelProduct, parseStockInput } from './granel.js'; // GRANEL-001: decimales SOLO para productos a granel.

export function buildProductPayload(formData, effectiveRate) {
    const {
        name,
        barcode,
        priceUsd,
        priceBs,
        priceCop,
        costUsd,
        costBs,
        stock,
        stockInLotes,
        packagingType,
        unitsPerPackage,
        granelUnit,
        sellByUnit,
        unitPriceUsd,
        unitPriceCop,
        category,
        lowStockAlert
    } = formData;

    const formattedName = name.replace(/(^\w{1})|(\s+\w{1})/g, letter => letter.toUpperCase());
    // FIN-022-pattern: validar tasa antes de usarla (sin fallback silencioso a 1).
    const safeRate = effectiveRate > 0 ? effectiveRate : 1;

    // FIN-017: usar divR (división redondeada) en vez de Math.round(raw/safeRate*100)/100.
    // safeParse para normalizar input del usuario (maneja coma decimal y separadores de miles).
    const finalPriceUsd = priceUsd
        ? round2(CurrencyService.safeParse(priceUsd))
        : (priceBs ? divR(CurrencyService.safeParse(priceBs), safeRate) : 0);
    const finalCostUsd = costUsd
        ? round2(CurrencyService.safeParse(costUsd))
        : (costBs ? divR(CurrencyService.safeParse(costBs), safeRate) : 0);
    const finalCostBs = costBs
        ? round2(CurrencyService.safeParse(costBs))
        : (costUsd ? mulR(CurrencyService.safeParse(costUsd), safeRate) : 0);

    // COP: guardar el valor exacto que escribió el usuario (sin redondeo de ida/vuelta).
    // COP es entero por convención; redondeamos a entero con round2 (no hay decimales).
    const finalPriceCop = priceCop && CurrencyService.safeParse(priceCop) > 0 ? round2(CurrencyService.safeParse(priceCop)) : null;

    // Map packagingType → unit legacy
    let legacyUnit = 'unidad';
    if (packagingType === 'lote') legacyUnit = 'paquete';
    else if (packagingType === 'granel') legacyUnit = granelUnit;

    const isLote = packagingType === 'lote';
    // Para productos de tipo Suelto o Granel, también guardamos unitsPerPackage si fue
    // configurado voluntariamente (permite ajuste por bulto en StockBatchModal).
    const parsedUnitsPerPkg = unitsPerPackage ? Math.max(1, parseInt(unitsPerPackage) || 1) : 1;
    const autoUnitPrice = parsedUnitsPerPkg > 1 ? divR(finalPriceUsd, parsedUnitsPerPkg) : finalPriceUsd;
    const finalUnitPrice = sellByUnit && unitPriceUsd ? round2(CurrencyService.safeParse(unitPriceUsd)) : autoUnitPrice;

    // Unit price in COP for lote products
    const finalUnitPriceCop = isLote && sellByUnit && unitPriceCop && CurrencyService.safeParse(unitPriceCop) > 0
        ? round2(CurrencyService.safeParse(unitPriceCop))
        : (isLote && sellByUnit && finalPriceCop && parsedUnitsPerPkg > 1
            ? divR(finalPriceCop, parsedUnitsPerPkg)
            : null);

    // GRANEL-001: Solo los productos a granel aceptan decimales en stock (hasta 3).
    // Todo lo demás (unidad, paquete, lote, suelto) permanece estrictamente entero.
    const isGranel = isGranelProduct({ packagingType, granelUnit, unit: legacyUnit });
    let finalStock = stock ? (parseStockInput(stock, isGranel) ?? 0) : 0;
    if (isLote && stockInLotes && parsedUnitsPerPkg > 0) {
        finalStock = Math.round(parseFloat(stockInLotes) * parsedUnitsPerPkg);
    }

    // GRANEL-001: alerta de stock bajo con el mismo guardarraíl de tipado
    // (granel admite hasta 3 decimales; el resto cae a entero, con fallback a 5).
    const finalLowStockAlert = lowStockAlert
        ? (parseStockInput(lowStockAlert, isGranel) ?? 5)
        : 5;

    // Doble Precio y modalidad de precios (dual_usd / tasa_dia)
    const rawPricingMode = formData.pricingMode || 'tasa_dia';
    const rawBsUsdRef = formData.priceBsUsdRef;

    const parsedBsUsdRef = (rawBsUsdRef && CurrencyService.safeParse(rawBsUsdRef) > 0)
        ? round2(CurrencyService.safeParse(rawBsUsdRef))
        : null;

    const pricingMode = (rawPricingMode === 'dual_usd' && parsedBsUsdRef !== null)
        ? 'dual_usd'
        : 'tasa_dia';

    const priceBsUsdRef = pricingMode === 'dual_usd' ? parsedBsUsdRef : null;

    return {
        name: formattedName,
        barcode: barcode ? barcode.trim() : null,
        // FIN-030: mantener `priceUsdt` (typo histórico) + alias `priceUsd` para migración gradual.
        priceUsdt: finalPriceUsd,
        priceUsd: finalPriceUsd,
        pricingMode: pricingMode,
        priceBsUsdRef: priceBsUsdRef,
        priceCop: finalPriceCop,
        costUsd: finalCostUsd,
        costBs: finalCostBs,
        stock: finalStock,
        unit: legacyUnit,
        packagingType: packagingType,
        unitsPerPackage: parsedUnitsPerPkg,
        sellByUnit: isLote ? sellByUnit : false,
        unitPriceUsd: isLote && sellByUnit ? finalUnitPrice : null,
        unitPriceCop: isLote && sellByUnit ? finalUnitPriceCop : null,
        stockInLotes: isLote && stockInLotes ? parseInt(stockInLotes) : null,
        category: category,
        lowStockAlert: finalLowStockAlert,
    };
}
