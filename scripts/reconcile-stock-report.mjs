#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { simulateStockSync } from '../src/utils/stockSyncSimulator.js';

const demo = {
    baseline: { version: 1, businessId: 'bodega-demo', epochId: 'corte-demo', stockUnits: { arroz: '10000000' } },
    replicas: [
        { replicaId: 'caja-a', deliveries: [
            { version: 1, businessId: 'bodega-demo', epochId: 'corte-demo', operationId: 'venta-a', deviceId: 'caja-a', actorId: 'demo', productId: 'arroz', kind: 'SALE', deltaUnits: '-7000000' },
        ] },
        { replicaId: 'caja-b', deliveries: [
            { version: 1, businessId: 'bodega-demo', epochId: 'corte-demo', operationId: 'venta-b', deviceId: 'caja-b', actorId: 'demo', productId: 'arroz', kind: 'SALE', deltaUnits: '-5000000' },
        ] },
    ],
};

function usage() {
    console.log('Uso: node scripts/reconcile-stock-report.mjs [--input escenario.json] [--format json|text]');
    console.log('Sin --input genera un ejemplo sintético; no lee ni modifica datos del POS.');
}
function parseArgs(args) {
    const options = { format: 'text' };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--help' || args[i] === '-h') { options.help = true; continue; }
        if (args[i] === '--input') {
            if (options.input || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('INVALID_ARGUMENTS');
            options.input = args[++i]; continue;
        }
        if (args[i] === '--format') {
            const format = args[++i];
            if (!['json', 'text'].includes(format)) throw new Error('INVALID_FORMAT');
            options.format = format; continue;
        }
        throw new Error('INVALID_ARGUMENTS');
    }
    return options;
}
function textReport(result, source) {
    const output = [
        `Conciliación de stock (solo lectura) — ${source}`,
        `Entregas: ${result.deliveryCount} | Réplicas: ${result.replicas.length}`,
        `Convergencia actual: ${result.converged ? 'sí' : 'no'} | Proyección completa: ${result.complete ? 'sí' : 'no'}`,
        '', 'Existencia proyectada (micro-unidades):',
    ];
    for (const [productId, units] of Object.entries(result.globalProjection.stockUnits)) {
        output.push(`- ${productId}: ${units}${BigInt(units) < 0n ? '  ALERTA: NEGATIVO / CONCILIAR' : ''}`);
    }
    output.push('', `Conflictos de ID: ${result.globalProjection.conflicts.length}`,
        `Pendientes: ${result.globalProjection.pending.length}`,
        `Rechazadas: ${result.globalProjection.rejected.length}`,
        `Réplicas divergentes: ${result.unresolvedReplicas.length ? result.unresolvedReplicas.join(', ') : 'ninguna'}`,
        `Productos negativos: ${result.oversoldProducts.length ? result.oversoldProducts.map(row => row.productId).join(', ') : 'ninguno'}`,
        '', 'No modifica stock. No usar esta proyección como inventario autoritativo ni corregir snapshots automáticamente.');
    for (const replica of result.replicas) {
        output.push('', `Réplica ${replica.replicaId}: ${replica.deliveryCount} entregas; stock=${JSON.stringify(replica.projection.stockUnits)}; `
            + `pendientes=${replica.projection.pending.length}; conflictos=${replica.projection.conflicts.length}`);
    }
    return output.join('\n');
}

try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) { usage(); process.exitCode = 0; }
    else {
        const input = options.input ? JSON.parse(await readFile(options.input, 'utf8')) : demo;
        const result = simulateStockSync(input);
        const report = { reportVersion: 1, mode: options.input ? 'input' : 'synthetic-demo', readOnly: true,
            warning: 'Diagnostic projection only; not authoritative stock and no writes performed.', ...result };
        console.log(options.format === 'json' ? JSON.stringify(report, null, 2) : textReport(report, report.mode));
        if (!result.complete || !result.converged || result.oversoldProducts.length) process.exitCode = 2;
    }
} catch (error) {
    console.error(`No se pudo generar el informe: ${error.message}`);
    usage();
    process.exitCode = 1;
}
