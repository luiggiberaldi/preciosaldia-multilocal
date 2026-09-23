const FIXTURE_BASE = '2026-08-09T10:00:00.000Z';

export function createSupervisorReadonlyFixture() {
    const closeOne = 'close-fixture-1';
    const closeTwo = 'close-fixture-2';

    return {
        deviceId: 'e2e-primary-device',
        monitorDeviceId: 'e2e-monitor-device',
        copEnabled: true,
        rate: 870,
        products: [
            { id: 'product-rice', name: 'Arroz Premium con nombre largo para responsive', stock: 58, priceUsd: 1.5, costPrice: 1.1 },
            { id: 'product-pasta', name: 'Pasta', stock: 12, priceUsd: 2, costPrice: 1.4 },
        ],
        records: [
            {
                id: 'opening-1',
                tipo: 'APERTURA_CAJA',
                cierreId: closeOne,
                timestamp: FIXTURE_BASE,
                openingUsd: 20,
                openingBs: 500,
                openingCop: 0,
            },
            {
                id: 'sale-1',
                tipo: 'VENTA',
                cierreId: closeOne,
                timestamp: '2026-08-09T10:15:00.000Z',
                status: 'COMPLETADA',
                totalUsd: 3,
                totalBs: 2610,
                payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 3 }],
                items: [{ id: 'product-rice', name: 'Arroz Premium con nombre largo para responsive', qty: 2, priceUsd: 1.5 }],
            },
            {
                id: 'inventory-batch-1',
                tipo: 'AJUSTE_ENTRADA',
                cierreId: closeOne,
                timestamp: '2026-08-09T10:30:00.000Z',
                inputUnit: 'bultos',
                unitsPerPackage: 24,
                reason: 'Mercancía recibida',
                supplierName: 'Proveedor Sintético',
                lotReference: 'LOTE-E2E-001',
                items: [
                    { id: 'product-rice', name: 'Arroz Premium con nombre largo para responsive', qty: 24, unitsDelta: 24 },
                    { id: 'product-pasta', name: 'Pasta', qty: 12, unitsDelta: 12 },
                ],
            },
            {
                id: 'expense-1',
                tipo: 'GASTO_INTERNO',
                cierreId: closeOne,
                timestamp: '2026-08-09T10:45:00.000Z',
                description: 'Transporte sintético',
                category: 'logística',
                totalUsd: 1,
                totalBs: 870,
                afectaCaja: true,
                payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: -1 }],
            },
            {
                id: 'opening-2',
                tipo: 'APERTURA_CAJA',
                cierreId: closeTwo,
                timestamp: '2026-08-08T10:00:00.000Z',
                openingUsd: 15,
                openingBs: 300,
                openingCop: 0,
            },
            {
                id: 'sale-2',
                tipo: 'VENTA',
                cierreId: closeTwo,
                timestamp: '2026-08-08T11:00:00.000Z',
                status: 'COMPLETADA',
                totalUsd: 2,
                totalBs: 1740,
                payments: [{ methodId: 'efectivo_bs', currency: 'BS', amountBs: 1740 }],
                items: [{ id: 'product-pasta', name: 'Pasta', qty: 1, priceUsd: 2 }],
            },
            {
                id: 'inventory-batch-2',
                tipo: 'AJUSTE_SALIDA',
                cierreId: closeTwo,
                timestamp: '2026-08-08T11:30:00.000Z',
                reason: 'Merma sintética',
                inputUnit: 'unidades',
                items: [{ id: 'product-pasta', name: 'Pasta', qty: 2, unitsDelta: 2 }],
            },
            {
                id: 'legacy-inventory',
                tipo: 'AJUSTE_ENTRADA',
                items: [{ id: 'product-rice', name: 'Arroz Premium con nombre largo para responsive', qty: 1 }],
            },
        ],
    };
}

export default { createSupervisorReadonlyFixture };
