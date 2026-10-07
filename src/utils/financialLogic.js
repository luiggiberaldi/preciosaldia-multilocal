// FIN-015: Toda operación aritmética con dinero pasa por dinero.js (subR/sumR/round2).
import { round2, subR, sumR } from './dinero';

export function procesarImpactoCliente(clienteInicial, transaccion) {
    // CLONAR PARA INMUTABILIDAD
    let cliente = { ...clienteInicial };

    // INPUTS INTERMEDIOS
    const { usaSaldoFavor = 0, esCredito = false, deudaGenerada = 0, vueltoParaMonedero = 0, esCashea = false } = transaccion;

    // 0. Q0: CONSUMO DE SALDO A FAVOR
    if (usaSaldoFavor > 0) {
        // FIN-015: subR garantiza 2 decimales en cada paso intermedio.
        const nuevoFavor = subR(cliente.favor || 0, usaSaldoFavor);
        cliente.favor = nuevoFavor > 0 ? nuevoFavor : 0;
    }

    // 1. Q1: GENERACIÓN DE DEUDA
    if (esCredito) {
        if (esCashea) {
            cliente.casheaDeuda = sumR(cliente.casheaDeuda || 0, deudaGenerada);
        } else {
            cliente.deuda = sumR(cliente.deuda || 0, deudaGenerada);
        }
    }

    // 2. Q2 & Q3: VUELTO (ABONO A DEUDA O MONEDERO)
    // El "vuelto" digital es lo que sobra que NO se entregó en efectivo.
    if (vueltoParaMonedero > 0) {
        const deudaActual = round2(cliente.deuda || 0);

        if (deudaActual > 0.001) {
            // PRIORITY: DEBT FIRST
            if (deudaActual >= vueltoParaMonedero) {
                // Paga parte de la deuda
                cliente.deuda = subR(deudaActual, vueltoParaMonedero);
                // Nada al favor real, todo se consumió en deuda
            } else {
                // Paga toda la deuda y sobra
                const sobra = subR(vueltoParaMonedero, deudaActual);
                cliente.deuda = 0;
                cliente.favor = sumR(cliente.favor || 0, sobra); // Q3
            }
        } else {
            // No deuda, todo a favor
            cliente.favor = sumR(cliente.favor || 0, vueltoParaMonedero);
        }
    }

    // 3. NORMALIZACIÓN ESTRICTA (The Golden Rule)
    const saldoNeto = subR(cliente.favor || 0, cliente.deuda || 0);

    if (saldoNeto >= 0) {
        cliente.favor = round2(saldoNeto);
        cliente.deuda = 0;
    } else {
        cliente.favor = 0;
        cliente.deuda = round2(Math.abs(saldoNeto));
    }

    return cliente;
}
