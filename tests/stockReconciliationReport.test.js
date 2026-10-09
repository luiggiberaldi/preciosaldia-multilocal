import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolve } from 'node:path';
const script = resolve(process.cwd(), 'scripts/reconcile-stock-report.mjs');
let temp;
async function inputFile(value) {
    temp ||= await mkdtemp(join(tmpdir(), 'stock-report-test-'));
    const path = join(temp, 'scenario.json');
    await writeFile(path, JSON.stringify(value));
    return path;
}
function run(args = []) {
    return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}
const op = (operationId, deltaUnits, deviceId) => ({ version: 1, businessId: 'bodega', epochId: 'epoch',
    operationId, deviceId, actorId: 'test', productId: 'p', kind: 'SALE', deltaUnits });
const baseline = { version: 1, businessId: 'bodega', epochId: 'epoch', stockUnits: { p: '10000000' } };

afterEach(async () => { if (temp) { await rm(temp, { recursive: true, force: true }); temp = undefined; } });

describe('read-only stock reconciliation report CLI', () => {
    it('prints an explicit synthetic demonstration and flags last-stock oversell', () => {
        const result = run([]);
        expect(result.status).toBe(2);
        expect(result.stdout).toContain('solo lectura');
        expect(result.stdout).toContain('NEGATIVO / CONCILIAR');
        expect(result.stdout).toContain('No modifica stock');
    });

    it('accepts JSON input, emits machine-readable JSON, and leaves input bytes unchanged', async () => {
        const scenario = { baseline, replicas: [
            { replicaId: 'pc-a', deliveries: [op('a', '-2000000', 'pc-a'), op('b', '-3000000', 'pc-b')] },
            { replicaId: 'pc-b', deliveries: [op('a', '-2000000', 'pc-a'), op('b', '-3000000', 'pc-b')] },
        ] };
        const file = await inputFile(scenario); const before = await readFile(file, 'utf8');
        const result = run(['--input', file, '--format', 'json']);
        expect(result.status).toBe(0);
        const report = JSON.parse(result.stdout);
        expect(report).toMatchObject({ reportVersion: 1, mode: 'input', readOnly: true,
            converged: true, complete: true, globalProjection: { stockUnits: { p: '5000000' } } });
        expect(await readFile(file, 'utf8')).toBe(before);
    });

    it('returns a nonzero diagnostic status for incomplete event delivery', async () => {
        const scenario = { baseline, replicas: [
            { replicaId: 'pc-a', deliveries: [op('a', '-2000000', 'pc-a'), op('b', '-3000000', 'pc-b')] },
            { replicaId: 'pc-b', deliveries: [op('a', '-2000000', 'pc-a')] },
        ] };
        const result = run(['--input', await inputFile(scenario), '--format', 'json']);
        expect(result.status).toBe(2);
        expect(JSON.parse(result.stdout).unresolvedReplicas).toEqual(['pc-b']);
    });

    it.each([
        [['--format', 'xml'], 'INVALID_FORMAT'],
        [['--bogus'], 'INVALID_ARGUMENTS'],
        [['--input', 'missing-scenario.json'], 'ENOENT'],
        [['--input'], 'INVALID_ARGUMENTS'],
    ])('rejects invalid CLI request %j', (args, message) => {
        const result = run(args);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(message);
    });
});
