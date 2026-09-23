// systemConsciousnessService.js — Servicio seguro de contexto de salud operativa del POS
// Fase 4 & 5: Filtrado estricto por rol (Cajero vs Admin/Supervisor) y modularización de indicadores.

import { storageService } from '../utils/storageService';
import { getActivePaymentMethods } from '../config/paymentMethods';

export async function compileSystemConsciousnessContext({ effectiveRate, tasaCop, products, cart, usuarioActivo, isOnline }) {
    const role = usuarioActivo?.rol || 'CAJERO';
    const isCajero = role === 'CAJERO';
    const timestampStr = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });

    // 1. NEGOCIO & CONEXIÓN
    const businessName = localStorage.getItem('business_name') || 'Bodega / Comercio POS';
    const connection = isOnline ? 'Online (Sincronizado)' : 'Offline (Modo local sin internet)';

    // 2. INVENTARIO & SALUD DE STOCK
    const totalProducts = products?.length || 0;
    const lowStockItems = products ? products.filter(p => (p.stock ?? 0) <= (p.lowStockAlert ?? 5) && (p.stock ?? 0) >= 0) : [];
    const outOfStockItems = products ? products.filter(p => (p.stock ?? 0) <= 0) : [];

    const criticalStockSummary = lowStockItems
        .sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0))
        .slice(0, 5)
        .map(p => `${p.name} (stock actual: ${p.stock ?? 0})`)
        .join(', ') || 'Ninguno';

    // 3. CARRITO DE VENTA ACTIVO
    const cartCount = cart?.length || 0;
    const cartSummary = cart?.length > 0
        ? cart.map(i => `${i.name} x${i.qty}`).join(', ')
        : 'Vacío';

    // 4. METRICAS DE VENTAS DEL TURNO
    let salesCount = 0;
    let totalSalesUsd = 0;
    let totalSalesBs = 0;
    let paymentSummary = 'Sin ventas registradas hoy';
    let lastSalesDetail = 'Sin transacciones recientes';

    try {
        const sales = await storageService.getItem('bodega_sales_v1', []);
        const todayStr = new Date().toISOString().split('T')[0];
        const todaySales = sales
            .filter(s => s.timestamp?.startsWith(todayStr) && s.status !== 'ANULADA')
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        salesCount = todaySales.length;
        totalSalesUsd = todaySales.reduce((acc, s) => acc + (s.totalUsd || 0), 0);
        totalSalesBs = todaySales.reduce((acc, s) => acc + (s.totalBs || 0), 0);

        if (!isCajero && todaySales.length > 0) {
            let breakdown = {};
            todaySales.forEach(s => {
                const method = s.payments?.length > 0
                    ? s.payments.map(p => p.methodLabel || p.methodId).join('+')
                    : (s.paymentMethod || 'Efectivo/Otro');
                breakdown[method] = (breakdown[method] || 0) + (s.totalUsd || 0);
            });
            paymentSummary = Object.entries(breakdown)
                .map(([m, val]) => `${m}: $${val.toFixed(2)}`)
                .join(' | ');
        }
    } catch {}

    // 5. SALUD DE BACKUP & SINCRONIZACION
    let backupStatus = 'No registrado en este equipo';
    let syncQueueStatus = 'Sincronizado sin pendientes';
    try {
        const lastBackupDate = localStorage.getItem('pda_last_backup_timestamp');
        if (lastBackupDate) {
            backupStatus = `Último respaldo exitoso: ${new Date(lastBackupDate).toLocaleString('es-VE', { timeZone: 'America/Caracas' })}`;
        } else {
            backupStatus = '⚠️ ATENCIÓN: No hay respaldo de seguridad reciente registrado.';
        }

        const pendingQueue = JSON.parse(localStorage.getItem('pda_offline_queue_v1') || '[]');
        if (pendingQueue.length > 0) {
            syncQueueStatus = `⚠️ ${pendingQueue.length} operaciones locales pendientes de sincronizar con la nube.`;
        }
    } catch {}

    // 6. CLIENTES & DEUDAS (SOLO ADMIN / SUPERVISOR)
    let debtSummary = 'No autorizado para el rol Cajero';
    if (!isCajero) {
        try {
            const customers = await storageService.getItem('bodega_customers_v1', []);
            const debtors = customers.filter(c => (c.deuda || 0) > 0.01);
            const totalDebt = debtors.reduce((acc, c) => acc + (c.deuda || 0), 0);
            debtSummary = `${debtors.length} clientes con saldo pendiente | Total deudas por cobrar: $${totalDebt.toFixed(2)} USD`;
        } catch {
            debtSummary = 'Sin datos de deudores';
        }
    }

    // 7. CONSTRUCCION DE PAYLOAD DE CONTEXTO SEGUN EL ROL ACTIVO
    if (isCajero) {
        return `
[CONTEXTO DEL POS — CONCIENCIA DEL SISTEMA]
- Fecha y Hora de Servidor: ${timestampStr} (Hora Venezuela)
- Rol Activo: CAJERO (${usuarioActivo?.nombre || 'Operador'})
- Estado de Conexión: ${connection}

## CONTEXTO OPERATIVO DE CAJERO
- Tasa BCV Oficial: Bs. ${(effectiveRate || 0).toFixed(2)} / USD
- Tasa COP: ${tasaCop > 0 ? `${tasaCop.toFixed(2)} COP / USD` : 'No configurada'}
- Carrito de Venta Activo: ${cartCount} ítems (${cartSummary})
- Inventario: ${totalProducts} registrados | ${lowStockItems.length} bajos de stock (${outOfStockItems.length} agotados)
- Productos Críticos: ${criticalStockSummary}
- Ventas de tu turno hoy: ${salesCount} ventas procesadas
- Estado de Respaldo: ${backupStatus}
- Estado de Sincronización: ${syncQueueStatus}

RESTRICCIÓN DE SEGURIDAD (SEC-ROLE-CAJERO):
No tienes permitido consultar ni revelar costos de compra, márgenes de ganancia del negocio, deudas totales de clientes, RIF institucional ni usuarios administradores.
`.trim();
    }

    // CONTEXTO COMPLETO PARA ADMINISTRADOR / SUPERVISOR
    return `
[CONTEXTO DEL POS — CONCIENCIA DEL SISTEMA (ADMIN/SUPERVISOR)]
- Fecha y Hora de Servidor: ${timestampStr} (Hora Venezuela)
- Rol Activo: ${role} (${usuarioActivo?.nombre || 'Administrador'})
- Negocio: ${businessName}
- Estado de Conexión: ${connection}

## SALUD DEL SISTEMA Y OPERACIONES
- Tasa BCV Oficial: Bs. ${(effectiveRate || 0).toFixed(2)} / USD
- Tasa COP: ${tasaCop > 0 ? `${tasaCop.toFixed(2)} COP / USD` : 'No configurada'}
- Ventas del Día: ${salesCount} transacciones | Total USD: $${totalSalesUsd.toFixed(2)} / Total Bs: Bs.${totalSalesBs.toFixed(2)}
- Desglose por Método de Pago: ${paymentSummary}
- Carrito de Venta Activo: ${cartCount} ítems (${cartSummary})
- Salud de Inventario: ${totalProducts} productos | ${lowStockItems.length} bajo stock crítico | ${outOfStockItems.length} agotados
- Productos Críticos: ${criticalStockSummary}
- Salud de Deudas / Cuentas por Cobrar: ${debtSummary}
- Salud de Copias de Seguridad (Backup): ${backupStatus}
- Salud de Sincronización Nube: ${syncQueueStatus}
`.trim();
}
