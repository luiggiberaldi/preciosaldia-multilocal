import React from 'react';
import { ManualMode } from '../components/calculator/ManualMode';
import { useWallet } from '../hooks/useWallet';

const SAFE_RATES = { bcv: { price: 0 }, euro: { price: 0 } };

export default function CalculatorView({ rates, theme, triggerHaptic, isKeyboardOpen }) {
  const currentRates = rates || SAFE_RATES;
  const { accounts } = useWallet();

  // State for initial loading skeleton
  const isInitialLoading = !rates?.bcv?.price;

  if (isInitialLoading) {
    return (
      // v1.2.0: surface tokens (warm cream) + ring-surface-200 en vez de slate.
      <div className="flex flex-col h-full bg-surface-50 dark:bg-surface-950 rounded-[2.5rem] p-6 animate-pulse border border-surface-200 dark:border-surface-800">
        <div className="h-20 bg-surface-200 dark:bg-surface-800 rounded-xl mb-4"></div>
        <div className="flex-1 bg-surface-200 dark:bg-surface-800 rounded-xl"></div>
      </div>
    );
  }

  return (
    // v1.2.0: surface tokens + ring-surface-100 (warm). El resultado principal (número grande) y las tasas destacadas se renderizan dentro de <ManualMode/>, ya migrado por separado.
    <div className="flex flex-col h-full bg-surface-50 dark:bg-surface-950 rounded-[2.5rem] shadow-tone-lg border border-surface-200 dark:border-surface-800 relative ring-4 ring-surface-100 dark:ring-surface-900/50">
      <div className="flex-1 relative bg-surface-50/50 dark:bg-surface-900/50">
        <ManualMode
          rates={currentRates}
          accounts={accounts}
          theme={theme}
          triggerHaptic={triggerHaptic}
          isKeyboardOpen={isKeyboardOpen}
        />
      </div>
    </div>
  );
}
