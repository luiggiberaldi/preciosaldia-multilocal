import { useState, useEffect } from 'react';

/**
 * useClientWallet — Portado de Listo POS ModalPago.
 * Calcula la proyección de saldo del cliente cuando hay vuelto acreditado.
 */
export const useClientWallet = (clienteSeleccionado, clientes, modo, cambioUSD, isChangeCredited, distVueltoUSD, distVueltoBS, tasaSegura, cashKeptUsd = 0) => {
    const [proyeccion, setProyeccion] = useState(null);

    useEffect(() => {
        const clienteObj = Array.isArray(clientes)
            ? clientes.find(c => c.id === clienteSeleccionado)
            : null;
        const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

        let montoAbonarCuenta = 0;
        const sumaDistribucion = (parseFloat(distVueltoUSD) || 0) + ((parseFloat(distVueltoBS) || 0) / tasaSegura);

        if (modo === 'contado' && cambioUSD > 0 && isChangeCredited) {
            montoAbonarCuenta = Math.max(0, cambioUSD - cashKeptUsd - sumaDistribucion);
        }

        if (clienteObj && montoAbonarCuenta > 0.001) {
            let nuevaDeuda = clienteObj.deuda || 0;
            let nuevoFavor = clienteObj.favor || 0;

            if (nuevaDeuda > 0) {
                if (nuevaDeuda >= montoAbonarCuenta) {
                    nuevaDeuda = round2(nuevaDeuda - montoAbonarCuenta);
                } else {
                    const sobrante = montoAbonarCuenta - nuevaDeuda;
                    nuevaDeuda = 0;
                    nuevoFavor = round2(nuevoFavor + sobrante);
                }
            } else {
                nuevoFavor = round2(nuevoFavor + montoAbonarCuenta);
            }
            setProyeccion({ deuda: nuevaDeuda, favor: nuevoFavor, abono: montoAbonarCuenta });
        } else {
            setProyeccion(null);
        }
    }, [clienteSeleccionado, isChangeCredited, cambioUSD, distVueltoUSD, distVueltoBS, modo, clientes, tasaSegura, cashKeptUsd]);

    return { proyeccion };
};
