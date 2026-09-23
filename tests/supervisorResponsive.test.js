import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ownerMonitor = readFileSync('src/views/OwnerMonitorView.jsx', 'utf8');
const remoteUsers = readFileSync('src/components/Monitor/RemoteUsersManager.jsx', 'utf8');
const supervisorSelect = readFileSync('src/components/Monitor/SupervisorSelect.jsx', 'utf8');
const inventoryBatchModal = readFileSync('src/components/Monitor/SupervisorInventoryBatchModal.jsx', 'utf8');
const rateModal = readFileSync('src/components/Monitor/SupervisorRateModal.jsx', 'utf8');
const remoteProductModal = readFileSync('src/components/Monitor/RemoteProductFormModal.jsx', 'utf8');

describe('Supervisor responsive controls', () => {
    it('mantiene el header sticky y preparado para móviles con safe-area', () => {
        expect(ownerMonitor).toContain('sticky top-0');
        expect(ownerMonitor).toContain('safe-area-inset-top');
        expect(ownerMonitor).toContain('flex-col');
        expect(ownerMonitor).toContain('sm:flex-row');
        expect(ownerMonitor).toContain('w-full sm:w-auto');
    });

    it('oculta la zona de terminales del panel Supervisor', () => {
        expect(ownerMonitor).not.toContain('setViewTab(\'terminales\')');
        expect(ownerMonitor).not.toContain('TERMINALES Y DISPOSITIVOS');
        expect(ownerMonitor).not.toContain("<DevicesManager");
    });

    it('usa el icono oficial de la PWA en el header del Supervisor', () => {
        expect(ownerMonitor).toContain('src="/pwa-192x192.png"');
        expect(ownerMonitor).toContain('aria-hidden="true"');
    });

    it('no deja selects nativos cuadrados en las vistas del Supervisor', () => {
        expect(ownerMonitor).not.toContain('<select');
        expect(remoteUsers).not.toContain('<select');
        expect(ownerMonitor).toContain('SupervisorSelect');
        expect(remoteUsers).toContain('SupervisorSelect');
    });

    it('usa menú redondeado, tamaño táctil y roles accesibles', () => {
        expect(supervisorSelect).toContain('rounded-2xl');
        expect(supervisorSelect).toContain('rounded-xl');
        expect(supervisorSelect).toContain('min-h-11');
        expect(supervisorSelect).toContain('role="listbox"');
        expect(supervisorSelect).toContain('role="option"');
        expect(supervisorSelect).toContain("event.key === 'Escape'");
    });

    it('muestra el valor actual de cada tasa en el selector remoto', () => {
        expect(rateModal).toContain('rateValues');
        expect(rateModal).toContain('formatRate');
        expect(rateModal).toContain('Bs/$');
        expect(rateModal).toContain('Bs/€');
        expect(rateModal).toContain('Bs/₮');
    });

    it('permite consultar ventas por producto y fechas específicas', () => {
        expect(ownerMonitor).toContain('supervisor-report-product-select');
        expect(ownerMonitor).toContain('Fechas específicas');
        expect(ownerMonitor).toContain('supervisor-product-sales-summary');
        expect(ownerMonitor).toContain('Fecha inicial del reporte');
        expect(ownerMonitor).toContain('Fecha final del reporte');
    });

    it('guía el ajuste por lote con acciones claras, resumen y flags separados', () => {
        expect(inventoryBatchModal).toContain('solo se aplicará cuando la caja lo confirme');
        expect(inventoryBatchModal).toContain('¿Qué quieres hacer?');
        expect(inventoryBatchModal).toContain('Stock después del movimiento');
        expect(inventoryBatchModal).toContain('role="radiogroup"');
        expect(inventoryBatchModal).toContain('SUPERVISOR_REMOTE_EGRESS_ENABLED');
        expect(inventoryBatchModal).not.toContain('<select');
    });

    it('permite buscar y seleccionar fotos sin mezclar el flujo de egreso', () => {
        expect(remoteProductModal).toContain('/api/search-image');
        expect(remoteProductModal).toContain('setImageMatches(data.matches)');
        expect(remoteProductModal).toContain('setImage(imageUrl)');
        expect(remoteProductModal).not.toContain("direction: 'egreso'");
    });
});
