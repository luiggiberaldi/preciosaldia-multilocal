import React from 'react';
import { Smartphone, Bitcoin, DollarSign, Building2, Wallet } from 'lucide-react';

export const AccountSelector = ({ accounts, onSelect }) => {
    const getIcon = (t) => { 
        if(t === 'pago_movil') return <Smartphone size={18} className="text-emerald-500"/>; 
        if(t === 'binance') return <Bitcoin size={18} className="text-amber-500"/>; 
        if(t === 'zelle') return <DollarSign size={18} className="text-brand"/>; 
        return <Building2 size={18} className="text-brand"/>; 
    };
    
    const getBg = (t) => { 
        if(t === 'pago_movil') return 'bg-emerald-100'; 
        if(t === 'binance') return 'bg-amber-100'; 
        if(t === 'zelle') return 'bg-brand-dark'; 
        return 'bg-brand-light'; 
    };

    if (accounts.length === 0) return (
        <div className="text-center py-8 text-slate-400">
            <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-3">
                <Wallet size={32} className="opacity-50"/>
            </div>
            <p className="text-sm font-medium">No hay cuentas guardadas</p>
        </div>
    );

    return (
        <div className="grid gap-3 max-h-[50vh] overflow-y-auto px-1">
            {accounts.map(acc => (
                <button key={acc.id_gen} onClick={() => onSelect(acc)} className="flex items-center gap-4 bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 hover:border-brand dark:hover:border-brand hover:bg-brand/5 transition-all text-left group">
                    <div className={`p-3 rounded-2xl shrink-0 ${getBg(acc.type)} shadow-sm`}>
                        {getIcon(acc.type)}
                    </div>
                    <div>
                        <h4 className="font-bold text-slate-800 dark:text-white text-sm group-hover:text-brand-dark transition-colors">{acc.alias}</h4>
                        <p className="text-xs text-slate-500 font-mono mt-0.5 capitalize">{acc.type.replace('_', ' ')}</p>
                    </div>
                </button>
            ))}
        </div>
    );
};
