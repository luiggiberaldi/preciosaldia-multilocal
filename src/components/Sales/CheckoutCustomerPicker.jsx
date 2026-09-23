import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, UserPlus, Check, Search, X, User } from 'lucide-react';
import { formatBs } from '../../utils/calculatorUtils';

const AVATAR_COLORS = [
    'bg-brand-light text-brand-dark dark:bg-surface-800/40 dark:text-brand',
    'bg-brand-dark text-white dark:bg-brand-dark/40 dark:text-brand',
    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300',
    'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
    'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
];

function CustomerAvatar({ name, size = 'md' }) {
    const initial = name ? name.trim()[0].toUpperCase() : '?';
    const colorClass = AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
    const sizeClass = size === 'sm' ? 'w-7 h-7 text-[11px]' : 'w-8 h-8 text-xs';
    return (
        <div className={`${sizeClass} ${colorClass} rounded-full flex items-center justify-center font-black shrink-0`}>
            {initial}
        </div>
    );
}

export default function CheckoutCustomerPicker({
    customers,
    selectedCustomerId,
    setSelectedCustomerId,
    effectiveRate,
    onCreateCustomer,
}) {
    const [showCustomerPicker, setShowCustomerPicker] = useState(false);
    const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
    const [search, setSearch] = useState('');
    const [newClientName, setNewClientName] = useState('');
    const [newClientDocument, setNewClientDocument] = useState('');
    const [newClientPhone, setNewClientPhone] = useState('');
    const [savingClient, setSavingClient] = useState(false);
    const searchRef = useRef(null);
    const nameRef = useRef(null);

    const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

    const filteredCustomers = customers.filter(c =>
        !search ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.documentId && c.documentId.toLowerCase().includes(search.toLowerCase()))
    );

    useEffect(() => {
        if (showCustomerPicker && !showNewCustomerForm) {
            setTimeout(() => searchRef.current?.focus(), 60);
        }
    }, [showCustomerPicker, showNewCustomerForm]);

    const handleTogglePicker = () => {
        if (showCustomerPicker) {
            setShowCustomerPicker(false);
            setSearch('');
            setShowNewCustomerForm(false);
            setNewClientName(''); setNewClientDocument(''); setNewClientPhone('');
        } else {
            setShowCustomerPicker(true);
        }
    };

    const selectCustomer = (id) => {
        setSelectedCustomerId(id);
        setShowCustomerPicker(false);
        setSearch('');
        setShowNewCustomerForm(false);
    };

    const openNewForm = (prefill = '') => {
        setNewClientName(prefill);
        setShowNewCustomerForm(true);
        setTimeout(() => nameRef.current?.focus(), 60);
    };

    const cancelNewForm = () => {
        setShowNewCustomerForm(false);
        setNewClientName(''); setNewClientDocument(''); setNewClientPhone('');
        setTimeout(() => searchRef.current?.focus(), 60);
    };

    const handleCreateClient = async () => {
        if (!newClientName.trim() || !onCreateCustomer) return;
        setSavingClient(true);
        try {
            const newCustomer = await onCreateCustomer(newClientName.trim(), newClientDocument.trim(), newClientPhone.trim());
            setSelectedCustomerId(newCustomer.id);
            setNewClientName(''); setNewClientDocument(''); setNewClientPhone('');
            setShowNewCustomerForm(false);
            setShowCustomerPicker(false);
            setSearch('');
        } finally {
            setSavingClient(false);
        }
    };

    return (
        <div className="px-3 py-2">

            {/* ── Trigger button ── */}
            <button
                onClick={handleTogglePicker}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border-2 transition-all ${
                    showCustomerPicker
                        ? 'border-emerald-400 dark:border-emerald-600 bg-white dark:bg-slate-900 shadow-sm shadow-emerald-500/10'
                        : selectedCustomer
                            ? 'border-emerald-200 dark:border-emerald-800 bg-white dark:bg-slate-900'
                            : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900'
                }`}
            >
                <div className="flex items-center gap-2.5 min-w-0">
                    {selectedCustomer ? (
                        <CustomerAvatar name={selectedCustomer.name} size="sm" />
                    ) : (
                        <div className="w-7 h-7 bg-slate-200 dark:bg-slate-800 rounded-full flex items-center justify-center shrink-0">
                            <User size={13} className="text-slate-400" />
                        </div>
                    )}
                    <div className="min-w-0 text-left">
                        <p className={`text-sm font-bold truncate leading-tight capitalize ${selectedCustomer ? 'text-slate-800 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
                            {selectedCustomer ? selectedCustomer.name : 'Consumidor Final'}
                        </p>
                        {selectedCustomer && (
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                {selectedCustomer.code && (
                                    <span className="font-mono text-[8px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/50 dark:border-slate-800/50 px-1.5 py-0.5 rounded leading-none shrink-0">
                                        {selectedCustomer.code}
                                    </span>
                                )}
                                {selectedCustomer.documentId && (
                                    <span className="font-mono text-[8px] font-black text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-950/20 border border-cyan-100 dark:border-cyan-900/30 px-1.5 py-0.5 rounded leading-none shrink-0">
                                        C.I: {selectedCustomer.documentId}
                                    </span>
                                )}
                        {(selectedCustomer.deuda > 0.01 || selectedCustomer.favor > 0.01) && (
                            <span className={`text-[8px] font-black px-1.5 py-0.5 rounded leading-none border shrink-0 ${
                                selectedCustomer.deuda > 0
                                    ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border-red-100 dark:border-red-900/30'
                                    : 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/30'
                            }`}>
                                {selectedCustomer.deuda > 0
                                    ? `Debe $${selectedCustomer.deuda.toFixed(2)}`
                                    : `Favor $${selectedCustomer.favor.toFixed(2)}`}
                            </span>
                        )}
                            </div>
                        )}
                    </div>
                </div>
                <ChevronDown size={15} className={`text-slate-400 transition-transform shrink-0 ${showCustomerPicker ? 'rotate-180' : ''}`} />
            </button>

            {/* ── Expanded panel ── */}
            {showCustomerPicker && (
                <div className="mt-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xl">

                    {/* ── New customer form ── */}
                    {showNewCustomerForm ? (
                        <div className="p-4 space-y-3">
                            {/* Form header */}
                            <div className="flex items-center gap-2.5">
                                <div className="w-9 h-9 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center shrink-0">
                                    <UserPlus size={16} className="text-emerald-600 dark:text-emerald-400" />
                                </div>
                                <div>
                                    <p className="text-sm font-black text-slate-800 dark:text-white leading-tight">Nuevo Cliente</p>
                                    <p className="text-[10px] text-slate-400 leading-tight">Solo el nombre es obligatorio</p>
                                </div>
                            </div>

                            {/* Nombre */}
                            <div>
                                <label className="block text-[10px] font-black text-emerald-700 dark:text-emerald-500 uppercase tracking-wider mb-1">
                                    Nombre *
                                </label>
                                <input
                                    ref={nameRef}
                                    type="text"
                                    placeholder="Ej: Juan Pérez"
                                    value={newClientName}
                                    onChange={e => setNewClientName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleCreateClient()}
                                    className="w-full text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                                />
                            </div>

                            {/* Cédula + Teléfono en grid */}
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                                        Cédula / RIF
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="V-12345678"
                                        value={newClientDocument}
                                        onChange={e => setNewClientDocument(e.target.value.toUpperCase())}
                                        onKeyDown={e => e.key === 'Enter' && handleCreateClient()}
                                        className="w-full text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all uppercase"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                                        Teléfono
                                    </label>
                                    <div className="w-full flex items-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus-within:ring-2 focus-within:ring-emerald-500/50 transition-all overflow-hidden">
                                        <span className="px-2 py-2.5 text-[10px] font-black text-brand border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 shrink-0 select-none">+58</span>
                                        <input
                                            type="tel"
                                            placeholder="0412…"
                                            value={newClientPhone}
                                            onChange={e => setNewClientPhone(e.target.value.replace(/^\+?58/, ''))}
                                            onKeyDown={e => e.key === 'Enter' && handleCreateClient()}
                                            className="flex-1 bg-transparent px-2 py-2.5 text-sm text-slate-700 dark:text-white outline-none placeholder:text-slate-400 min-w-0"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2 pt-0.5">
                                <button
                                    onClick={cancelNewForm}
                                    className="flex-1 py-2.5 text-sm font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleCreateClient}
                                    disabled={!newClientName.trim() || savingClient}
                                    className="flex-1 py-2.5 text-sm font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl disabled:opacity-40 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-sm"
                                >
                                    <Check size={15} />
                                    {savingClient ? 'Guardando…' : 'Crear y Usar'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* ── Search bar ── */}
                            <div className="p-2 border-b border-slate-100 dark:border-slate-800">
                                <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2">
                                    <Search size={13} className="text-slate-400 shrink-0" />
                                    <input
                                        ref={searchRef}
                                        type="text"
                                        placeholder="Buscar cliente..."
                                        value={search}
                                        onChange={e => setSearch(e.target.value)}
                                        className="flex-1 bg-transparent text-sm text-slate-700 dark:text-white outline-none placeholder:text-slate-400"
                                    />
                                    {search && (
                                        <button onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                                            <X size={12} />
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div>

                                {/* Consumidor Final */}
                                {!search && (
                                    <button
                                        onClick={() => selectCustomer('')}
                                        className={`w-full flex items-center gap-3 px-4 py-3 transition-colors ${!selectedCustomerId ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}
                                    >
                                        <div className="w-8 h-8 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center shrink-0">
                                            <User size={14} className="text-slate-400" />
                                        </div>
                                        <span className={`flex-1 text-sm font-bold text-left ${!selectedCustomerId ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}`}>
                                            Consumidor Final
                                        </span>
                                        {!selectedCustomerId && <Check size={14} className="text-emerald-500 shrink-0" />}
                                    </button>
                                )}

                                {/* Nuevo cliente */}
                                {!search && (
                                    <button
                                        onClick={() => openNewForm()}
                                        className="w-full flex items-center gap-3 px-4 py-3 border-t border-slate-100 dark:border-slate-800 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
                                    >
                                        <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center shrink-0">
                                            <UserPlus size={14} className="text-emerald-600 dark:text-emerald-400" />
                                        </div>
                                        <span className="text-sm font-bold">Nuevo cliente...</span>
                                    </button>
                                )}

                                {/* Customer list */}
                                {filteredCustomers.length > 0 && (
                                    <div className={!search ? 'border-t border-slate-100 dark:border-slate-800' : ''}>
                                        {filteredCustomers.map(c => (
                                            <button
                                                key={c.id}
                                                onClick={() => selectCustomer(c.id)}
                                                className={`w-full flex items-center gap-3 px-4 py-3 border-t border-slate-100/50 dark:border-slate-800/50 first:border-t-0 transition-colors ${selectedCustomerId === c.id ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}
                                            >
                                                <CustomerAvatar name={c.name} />
                                                <div className="flex-1 min-w-0 text-left">
                                                    <p className={`text-sm font-bold truncate leading-tight capitalize ${selectedCustomerId === c.id ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-200'}`}>
                                                        {c.name}
                                                    </p>
                                                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                                        {c.code && (
                                                            <span className="font-mono text-[8px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/50 dark:border-slate-800/50 px-1.5 py-0.5 rounded leading-none shrink-0">
                                                                {c.code}
                                                            </span>
                                                        )}
                                                        {c.documentId && (
                                                            <span className="font-mono text-[8px] font-black text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-950/20 border border-cyan-100 dark:border-cyan-900/30 px-1.5 py-0.5 rounded leading-none shrink-0">
                                                                C.I: {c.documentId}
                                                            </span>
                                                        )}
                                                        {(c.deuda > 0.01 || c.favor > 0.01) && (
                                                            <span className={`text-[8px] font-black px-1.5 py-0.5 rounded leading-none border shrink-0 ${
                                                                c.deuda > 0
                                                                    ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border-red-100 dark:border-red-900/30'
                                                                    : 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/30'
                                                            }`}>
                                                                {c.deuda > 0 ? `Debe $${c.deuda.toFixed(2)}` : `Favor $${c.favor.toFixed(2)}`}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                {selectedCustomerId === c.id && <Check size={14} className="text-emerald-500 shrink-0" />}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {/* Empty search state */}
                                {search && filteredCustomers.length === 0 && (
                                    <div className="px-4 py-5 text-center">
                                        <p className="text-sm text-slate-400 font-medium">
                                            Sin resultados para <span className="font-bold text-slate-600 dark:text-slate-300">"{search}"</span>
                                        </p>
                                        <button
                                            onClick={() => openNewForm(search)}
                                            className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                                        >
                                            <UserPlus size={12} />
                                            Crear "{search}" como nuevo cliente
                                        </button>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
