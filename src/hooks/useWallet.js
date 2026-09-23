import { useState, useEffect, useCallback, useRef } from 'react';
import { storageService } from '../utils/storageService';

const STORAGE_KEY = 'bodega_accounts_v2';

export function useWallet() {
  const [accounts, setAccounts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const hasLoaded = useRef(false);

  // 1. Cargar datos iniciales asíncronamente
  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      try {
        const saved = await storageService.getItem(STORAGE_KEY, []);
        // Normalize: WalletView creates accounts with `id_gen`, useWallet expects `id`.
        const normalized = (saved || []).map(acc => ({
          ...acc,
          id: acc.id || String(acc.id_gen || crypto.randomUUID()),
          id_gen: acc.id_gen || acc.id || Date.now(),
        }));
        if (isMounted) {
          setAccounts(normalized);
          hasLoaded.current = true;
        }
      } catch (error) {
        console.error("Error cargando billetera:", error);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadData();
    return () => { isMounted = false; };
  }, []);

  // 2. Guardar automáticamente cada vez que cambien (sólo si ya cargó)
  useEffect(() => {
    if (!isLoading && hasLoaded.current) {
      storageService.setItem(STORAGE_KEY, accounts);
    }
  }, [accounts, isLoading]);

  // --- ACCIONES ---

  /**
   * Agrega una nueva cuenta.
   * @param {string} type - 'pago_movil' | 'transfer' | 'binance'
   * @param {string} alias - Nombre corto (Ej: "Mercantil Tienda")
   * @param {string} currency - VES o USDT
   * @param {object} data - Datos específicos (banco, telefono, email, etc)
   */
  const addAccount = useCallback((type, alias, currency, data) => {
    const newAccount = {
      id: crypto.randomUUID(), // ID único para cada cuenta
      createdAt: new Date().toISOString(),
      type,      // Tipo de método
      alias,     // Nombre para mostrar
      currency,  // VES o USDT
      data       // Objeto flexible con los datos
    };

    setAccounts(prev => [...prev, newAccount]);
    return newAccount;
  }, []);

  const removeAccount = useCallback((id) => {
    setAccounts(prev => prev.filter(account => account.id !== id));
  }, []);

  const updateAccount = useCallback((id, updatedFields) => {
    setAccounts(prev => prev.map(acc =>
      acc.id === id ? { ...acc, ...updatedFields } : acc
    ));
  }, []);

  return {
    accounts,
    isLoading,
    addAccount,
    removeAccount,
    updateAccount
  };
}
