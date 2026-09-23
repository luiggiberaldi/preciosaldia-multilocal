/**
 * PrinterSerial — WebSerial ESC/POS thermal printer service
 * Compatible with 58mm and 80mm thermal printers.
 * Browser support: Chrome/Edge desktop only (Web Serial API).
 */

// ESC/POS command set
const CMD = {
    INIT:           [0x1B, 0x40],
    ALIGN_LEFT:     [0x1B, 0x61, 0x00],
    ALIGN_CENTER:   [0x1B, 0x61, 0x01],
    ALIGN_RIGHT:    [0x1B, 0x61, 0x02],
    BOLD_ON:        [0x1B, 0x45, 0x01],
    BOLD_OFF:       [0x1B, 0x45, 0x00],
    SIZE_NORMAL:    [0x1D, 0x21, 0x00],
    SIZE_DOUBLE:    [0x1D, 0x21, 0x11],
    SIZE_WIDE:      [0x1D, 0x21, 0x10],
    UNDERLINE_ON:   [0x1B, 0x2D, 0x01],
    UNDERLINE_OFF:  [0x1B, 0x2D, 0x00],
    FEED_LINE:      [0x0A],
    FEED_3:         [0x1B, 0x64, 0x03],
    FEED_5:         [0x1B, 0x64, 0x05],
    CUT:            [0x1D, 0x56, 0x41, 0x03],
    OPEN_DRAWER:    [0x1B, 0x70, 0x00, 0x19, 0xFA],
};

const encoder = new TextEncoder();

function encode(text) {
    return encoder.encode(text);
}

function concat(...parts) {
    const arrays = parts.map(p => p instanceof Uint8Array ? p : new Uint8Array(p));
    const total = arrays.reduce((n, a) => n + a.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}

function pad(str, len, right = false) {
    const s = String(str ?? '');
    if (right) return s.padStart(len, ' ').substring(0, len);
    return s.padEnd(len, ' ').substring(0, len);
}

function twoCol(left, right, width) {
    const rightStr = String(right ?? '');
    const leftStr = String(left ?? '');
    const space = Math.max(1, width - leftStr.length - rightStr.length);
    return leftStr + ' '.repeat(space) + rightStr;
}

function line(width) {
    return '-'.repeat(width) + '\n';
}

class PrinterSerial {
    constructor() {
        this._port = null;
        this._writer = null;
        // HOOK-010: Callback de desconexión y listener registrado para cleanup.
        this.onDisconnect = null;
        this._disconnectBound = null;
    }

    isSupported() {
        return 'serial' in navigator;
    }

    isConnected() {
        return this._port !== null && this._writer !== null;
    }

    /**
     * HOOK-010: Handler interno para `navigator.serial` 'disconnect'.
     * Limpia `_port`/`_writer` y notifica al caller vía `onDisconnect`.
     * @param {SerialConnectionEvent} e
     */
    _handleSerialDisconnect(e) {
        const disconnectedPort = e?.target || e?.port;
        if (disconnectedPort && this._port !== disconnectedPort) {
            // Otra impresora se desconectó; no afecta a la nuestra.
            return;
        }
        try {
            if (this._writer) {
                // releaseLock es síncrono y seguro llamarlo múltiples veces.
                this._writer.releaseLock?.();
            }
        } catch (_) { /* ya liberado */ }
        this._writer = null;
        this._port = null;
        console.warn('[PrinterSerial] Impresora desconectada (evento navigator.serial.disconnect).');
        try {
            if (typeof this.onDisconnect === 'function') this.onDisconnect();
        } catch (cbErr) {
            console.warn('[PrinterSerial] onDisconnect callback lanzó:', cbErr);
        }
    }

    async connect() {
        if (!this.isSupported()) {
            throw new Error('WebSerial no está disponible en este navegador. Usa Chrome o Edge en escritorio.');
        }
        try {
            const port = await navigator.serial.requestPort();
            await port.open({ baudRate: 9600 });
            this._port = port;
            this._writer = port.writable.getWriter();

            // HOOK-010: Registrar listener de desconexión global (idempotente).
            if (!this._disconnectBound) {
                this._disconnectBound = this._handleSerialDisconnect.bind(this);
                try {
                    navigator.serial.addEventListener('disconnect', this._disconnectBound);
                } catch (e) {
                    console.warn('[PrinterSerial] No se pudo registrar listener disconnect:', e);
                }
            }

            return true;
        } catch (e) {
            if (e.name === 'NotFoundError') return false; // User cancelled
            throw e;
        }
    }

    async disconnect() {
        try {
            if (this._writer) {
                await this._writer.releaseLock();
                this._writer = null;
            }
            if (this._port) {
                await this._port.close();
                this._port = null;
            }
        } catch (_e) {
            this._port = null;
            this._writer = null;
        }
        // HOOK-010: Quitar el listener global al desconectar manualmente.
        this._unregisterDisconnectListener();
    }

    /**
     * HOOK-010: Quita el listener global de desconexión. Seguro llamar múltiples veces.
     */
    _unregisterDisconnectListener() {
        if (this._disconnectBound) {
            try {
                navigator.serial.removeEventListener('disconnect', this._disconnectBound);
            } catch (_) { /* noop */ }
            this._disconnectBound = null;
        }
    }

    /**
     * HOOK-010: Escribe al writer con timeout de 5s (Promise.race).
     * Si el buffer se llena o la impresora se colgó, no colgamos el flujo.
     * @param {Uint8Array} data
     * @param {number} [timeoutMs=5000]
     */
    async _write(data, timeoutMs = 5000) {
        if (!this._writer) throw new Error('Impresora no conectada');

        const writePromise = this._writer.write(data);

        // Si writePromise no resuelve en timeoutMs, rechazamos.
        let timer;
        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => {
                reject(new Error(`[PrinterSerial] Timeout de escritura (${timeoutMs}ms). La impresora puede estar desconectada o con buffer lleno.`));
            }, timeoutMs);
        });

        try {
            await Promise.race([writePromise, timeoutPromise]);
        } catch (err) {
            // Si fue timeout o error de writer, asumir desconexión y limpiar estado.
            try { this._writer.releaseLock?.(); } catch (_) {}
            this._writer = null;
            this._port = null;
            try {
                if (typeof this.onDisconnect === 'function') this.onDisconnect();
            } catch (_) {}
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    _getWidth() {
        const saved = localStorage.getItem('printer_paper_width');
        return saved === '80' ? 48 : 32; // chars per line
    }

    async openDrawer() {
        await this._write(concat(CMD.OPEN_DRAWER));
    }

    async testPrint() {
        const w = this._getWidth();
        const businessName = localStorage.getItem('business_name') || 'Mi Bodega';
        const chunks = [
            CMD.INIT,
            CMD.ALIGN_CENTER,
            CMD.SIZE_DOUBLE, CMD.BOLD_ON,
            encode(businessName + '\n'),
            CMD.SIZE_NORMAL, CMD.BOLD_OFF,
            CMD.ALIGN_CENTER,
            encode('--- PRUEBA DE IMPRESORA ---\n'),
            encode(new Date().toLocaleString('es-VE') + '\n'),
            CMD.FEED_3,
            CMD.ALIGN_CENTER,
            encode('Impresora configurada OK\n'),
            CMD.FEED_5,
            CMD.CUT,
        ];
        await this._write(concat(...chunks));
    }

    async printTicket(sale, rate) {
        const w = this._getWidth();
        const businessName = localStorage.getItem('business_name') || 'Mi Bodega';
        const businessRif  = localStorage.getItem('business_rif')  || '';
        const d = new Date(sale.timestamp);
        const dateStr = d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const timeStr = d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
        const saleNum = sale.saleNumber
            ? String(sale.saleNumber).padStart(7, '0')
            : sale.id.substring(0, 8).toUpperCase();

        const formatBsLocal = (n) =>
            new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

        const isCop = sale.copEnabled && sale.tasaCop > 0;
        const fmtUsd = (v) => isCop ? `USD ${parseFloat(v).toFixed(2)}` : `$${parseFloat(v).toFixed(2)}`;
        const fmtCopLocal = (v) => Math.round(v).toLocaleString('es-CO');

        const chunks = [CMD.INIT];

        // ── Header ────────────────────────────────────────────────
        chunks.push(CMD.ALIGN_CENTER, CMD.SIZE_DOUBLE, CMD.BOLD_ON);
        chunks.push(encode(businessName.substring(0, w) + '\n'));
        chunks.push(CMD.SIZE_NORMAL, CMD.BOLD_OFF);
        if (businessRif) chunks.push(encode(`RIF: ${businessRif}\n`));
        chunks.push(encode(`Fecha: ${dateStr}  ${timeStr}\n`));
        chunks.push(encode(`Orden: #${saleNum}\n`));
        if (sale.customerName && sale.customerName !== 'Consumidor Final') {
            chunks.push(encode(`Cliente: ${sale.customerName}\n`));
        }
        chunks.push(CMD.ALIGN_LEFT);
        chunks.push(encode(line(w)));

        // ── Items ──────────────────────────────────────────────────
        if (sale.items && sale.items.length > 0) {
            for (const item of sale.items) {
                const qtyLabel = item.isWeight
                    ? `${item.qty.toFixed(3)}kg`
                    : `${item.qty}u`;
                const lineTotal = fmtUsd(item.priceUsd * item.qty);
                const nameLine = `${qtyLabel} ${item.name}`;
                // Truncate name if too long
                const maxNameLen = w - lineTotal.length - 1;
                const nameShort = nameLine.length > maxNameLen
                    ? nameLine.substring(0, maxNameLen - 1) + '…'
                    : nameLine;
                chunks.push(encode(twoCol(nameShort, lineTotal, w) + '\n'));
                // Price per unit line (indented)
                chunks.push(encode(`  @ ${fmtUsd(item.priceUsd)}/u\n`));
            }
        }
        chunks.push(encode(line(w)));

        // ── Totals ────────────────────────────────────────────────
        if (sale.discountAmountUsd > 0) {
            chunks.push(encode(twoCol('Subtotal:', fmtUsd(sale.cartSubtotalUsd || sale.totalUsd), w) + '\n'));
            const discLabel = sale.discountType === 'percentage'
                ? `Descuento (${sale.discountValue}%):`
                : 'Descuento:';
            chunks.push(encode(twoCol(discLabel, `-${fmtUsd(sale.discountAmountUsd)}`, w) + '\n'));
        }

        chunks.push(CMD.BOLD_ON);
        chunks.push(encode(twoCol('TOTAL:', fmtUsd(sale.totalUsd || 0), w) + '\n'));
        chunks.push(CMD.BOLD_OFF);
        if (isCop) {
            chunks.push(encode(twoCol('COP:', `${fmtCopLocal((sale.totalUsd || 0) * sale.tasaCop)} COP`, w) + '\n'));
        }
        const effectiveRate = sale.rate || rate;
        if (effectiveRate > 0) {
            chunks.push(encode(twoCol('Bs:', formatBsLocal(sale.totalBs), w) + '\n'));
            chunks.push(encode(`  @ ${formatBsLocal(effectiveRate)} Bs/${isCop ? 'USD' : '$'}\n`));
        }

        // ── Payment methods ────────────────────────────────────────
        if (sale.payments && sale.payments.length > 0) {
            chunks.push(encode(line(w)));
            chunks.push(encode('Pagos:\n'));
            for (const p of sale.payments) {
                let pmtLabel = p.methodLabel || p.methodId || 'Efectivo';
                let pmtAmount = '';
                if (p.methodId === 'saldo_favor' || p.currency === 'INTERNAL_CREDIT' || p.isInternalCredit) {
                    pmtLabel = 'Saldo a favor utilizado';
                    pmtAmount = `-USD ${(p.amountUsd || 0).toFixed(2)}`;
                } else if (p.currency === 'USD' || (!p.currency && p.amountUsd)) {
                    pmtAmount = `USD ${(p.amountUsd || 0).toFixed(2)}`;
                } else if (p.currency === 'BS') {
                    pmtAmount = `${formatBsLocal(p.amountBs || 0)} Bs`;
                } else if (p.currency === 'COP') {
                    pmtAmount = `${(p.amountCop || 0).toLocaleString('es-CO', { minimumFractionDigits: 2 })} COP`;
                } else {
                    pmtAmount = `USD ${(p.amountUsd || 0).toFixed(2)}`;
                }
                chunks.push(encode(twoCol(`  ${pmtLabel}:`, pmtAmount, w) + '\n'));
            }
        }

        // ── Change ─────────────────────────────────────────────────
        if (sale.changeUsd > 0) {
            chunks.push(encode(twoCol('Vuelto:', fmtUsd(sale.changeUsd), w) + '\n'));
        }
        if (sale.changeBs > 0) {
            chunks.push(encode(twoCol('Vuelto Bs:', `${formatBsLocal(sale.changeBs)} Bs`, w) + '\n'));
        }

        // ── Cambio dejado en caja ─────────────────────────────────
        const tipDonatedUsd = Math.max(0, Number(sale.tipDonated?.amountUsd) || 0);
        if (tipDonatedUsd > 0) {
            chunks.push(encode(twoCol('Cambio dejado en caja:', `+USD ${tipDonatedUsd.toFixed(2)}`, w) + '\n'));
        }

        // ── Cartera del cliente ────────────────────────────────────
        const walletCreditUsd = sale.tipo === 'COBRO_DEUDA'
            ? Math.max(0, Number(sale.saldoFavorGeneradoUsd) || 0)
            : ['VENTA', 'VENTA_CASHEA'].includes(sale.tipo)
                ? Math.max(0, Number(sale.vueltoParaMonedero) || 0)
                : 0;
        if (walletCreditUsd > 0) {
            const walletCreditLabel = sale.tipo === 'COBRO_DEUDA'
                ? 'Saldo a favor generado (sobrante de abono):'
                : 'Saldo a favor acreditado:';
            chunks.push(encode(twoCol(walletCreditLabel, `+USD ${walletCreditUsd.toFixed(2)}`, w) + '\n'));
        }

        // ── Footer ─────────────────────────────────────────────────
        chunks.push(encode(line(w)));
        chunks.push(CMD.ALIGN_CENTER);
        chunks.push(encode('Gracias por su compra!\n'));
        chunks.push(encode('PreciosAlDia Bodega\n'));
        chunks.push(CMD.FEED_5);
        chunks.push(CMD.CUT);

        await this._write(concat(...chunks));
    }

    async printDailyClose(cierre, rate, correlativo) {
        const w = this._getWidth();
        const businessName = localStorage.getItem('business_name') || 'Mi Bodega';
        const businessRif  = localStorage.getItem('business_rif')  || '';
        const d = new Date(cierre.cierreId);
        const dateStr = d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const timeStr = d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });

        const formatBsLocal = (n) =>
            new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
        const fmtUsd = (v) => `$${parseFloat(v || 0).toFixed(2)}`;
        const fmtCop = (v) => Math.round(v || 0).toLocaleString('es-CO');

        const chunks = [CMD.INIT];

        // ── Header ────────────────────────────────────────────────
        chunks.push(CMD.ALIGN_CENTER, CMD.SIZE_DOUBLE, CMD.BOLD_ON);
        chunks.push(encode(businessName.substring(0, w) + '\n'));
        chunks.push(CMD.SIZE_NORMAL, CMD.BOLD_OFF);
        if (businessRif) chunks.push(encode(`RIF: ${businessRif}\n`));
        chunks.push(encode('*** CIERRE DE CAJA ***\n'));
        if (correlativo != null) chunks.push(encode(`Cierre #${correlativo}\n`));
        chunks.push(encode(`Fecha: ${dateStr}  ${timeStr}\n`));
        chunks.push(CMD.ALIGN_LEFT);
        chunks.push(encode(line(w)));

        // ── Fondo de apertura ─────────────────────────────────────
        if (cierre.apertura) {
            const aperturaUsd = cierre.apertura.openingUsd || 0;
            const aperturaBs  = cierre.apertura.openingBs  || 0;
            chunks.push(encode(twoCol('Fondo apertura:', fmtUsd(aperturaUsd), w) + '\n'));
            if (aperturaBs > 0) chunks.push(encode(twoCol('  Bs:', formatBsLocal(aperturaBs) + ' Bs', w) + '\n'));
            chunks.push(encode(line(w)));
        }

        // ── Desglose de ingresos ──────────────────────────────────
        chunks.push(CMD.BOLD_ON);
        chunks.push(encode('DESGLOSE DE INGRESOS\n'));
        chunks.push(CMD.BOLD_OFF);
        for (const [method, data] of Object.entries(cierre.paymentBreakdown || {})) {
            const label = (data.label || method).substring(0, w - 14);
            let displayAmount = '';
            if (data.currency === 'INTERNAL_CREDIT' || data.isInternalCredit) {
                displayAmount = `${fmtUsd(data.total)} crédito interno`;
            } else if (data.currency === 'USD' || data.currency === 'FIADO') {
                displayAmount = fmtUsd(data.total);
            } else if (data.currency === 'COP') {
                displayAmount = `${fmtCop(data.total)} COP`;
            } else {
                displayAmount = `${formatBsLocal(data.total)} Bs`;
            }
            chunks.push(encode(twoCol(`  ${label}:`, displayAmount, w) + '\n'));
        }
        chunks.push(encode(line(w)));

        // ── Totales ───────────────────────────────────────────────
        chunks.push(CMD.BOLD_ON);
        chunks.push(encode(twoCol('TOTAL USD:', fmtUsd(cierre.totalUsd), w) + '\n'));
        chunks.push(CMD.BOLD_OFF);
        if (rate > 0) chunks.push(encode(twoCol('TOTAL Bs:', formatBsLocal(cierre.totalBs) + ' Bs', w) + '\n'));
        if (cierre.totalCop > 0) chunks.push(encode(twoCol('TOTAL COP:', fmtCop(cierre.totalCop) + ' COP', w) + '\n'));
        chunks.push(encode(twoCol('Operaciones:', String(cierre.salesCount || 0), w) + '\n'));
        chunks.push(encode(line(w)));

        // ── Footer ─────────────────────────────────────────────────
        chunks.push(CMD.ALIGN_CENTER);
        chunks.push(encode('PreciosAlDia Bodega\n'));
        chunks.push(CMD.FEED_5);
        chunks.push(CMD.CUT);

        await this._write(concat(...chunks));
    }
}

// Singleton
export const printerSerial = new PrinterSerial();
