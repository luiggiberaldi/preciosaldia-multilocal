import { LockIcon } from 'lucide-react';
import EmptyState from '../EmptyState';
import CierreHistoryCard from './CierreHistoryCard';

/**
 * History tab — displays grouped "cierre de caja" cards for the selected
 * date range, or an empty state when there are none.
 */
export default function ReportsHistoryTab({ groupedClosings, bcvRate, products, copEnabled, copPrimary, tasaCop }) {
    return (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            {groupedClosings.length > 0 ? (
                groupedClosings.map((cierre, idx) => (
                    <CierreHistoryCard
                        key={cierre.cierreId}
                        cierre={cierre}
                        correlativo={groupedClosings.length - idx}
                        bcvRate={bcvRate}
                        products={products}
                        copEnabled={copEnabled}
                        copPrimary={copPrimary}
                        tasaCop={tasaCop}
                    />
                ))
            ) : (
                <div className="mt-8">
                    <EmptyState
                        icon={LockIcon}
                        title="Sin cierres de caja registrados"
                        description="No se encontraron operaciones de cierre en el rango de fechas seleccionado."
                    />
                </div>
            )}
        </div>
    );
}
