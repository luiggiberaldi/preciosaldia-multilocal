// Shared primitive components used across all Settings tabs.
// Extracted from SettingsView.jsx.

export function Toggle({ enabled, onChange, color = 'emerald', 'aria-label': ariaLabel = 'Interruptor de ajuste' }) {
    const colors = {
        emerald: enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600',
        amber: enabled ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600',
        indigo: enabled ? 'bg-brand' : 'bg-slate-300 dark:bg-slate-600',
        rose: enabled ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-600',
    };
    return (
        <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={ariaLabel}
            onClick={onChange}
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-1 cursor-pointer select-none shrink-0 active:scale-95 transition-transform"
        >
            <span className={`relative inline-flex h-6 w-11 items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out ${colors[color]}`}>
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 ease-in-out ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </span>
        </button>
    );
}

export function SectionCard({ icon: Icon, title, subtitle, iconColor = 'text-slate-500', children }) {
    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-50 dark:border-slate-800/50 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center ${iconColor}`}>
                    <Icon size={18} />
                </div>
                <div>
                    <h3 className="text-base font-black text-slate-800 dark:text-white">{title}</h3>
                    {subtitle && <p className="text-xs text-slate-500 dark:text-slate-450 mt-0.5">{subtitle}</p>}
                </div>
            </div>
            <div className="p-5 space-y-4">{children}</div>
        </div>
    );
}
