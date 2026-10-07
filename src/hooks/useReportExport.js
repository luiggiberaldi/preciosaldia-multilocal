/**
 * Hook that encapsulates PDF / WhatsApp export logic for the Reports view.
 * Extracted from ReportsView to keep the view lean.
 */
export function useReportExport({ triggerHaptic }) {
    /**
     * Generate and download a daily-close PDF.
     *
     * @param {Object} opts
     * @param {Array}  opts.salesForCashFlow
     * @param {Array}  opts.salesForStats
     * @param {number} opts.bcvRate
     * @param {Object} opts.paymentBreakdown
     * @param {Array}  opts.topProducts
     * @param {number} opts.totalUsd
     * @param {number} opts.totalBs
     * @param {number} opts.profit
     * @param {number} opts.totalItems
     */
    const handleExportPDF = async ({
        salesForCashFlow,
        salesForStats,
        bcvRate,
        paymentBreakdown,
        topProducts,
        totalUsd,
        totalBs,
        profit,
        totalItems,
    }) => {
        triggerHaptic && triggerHaptic();
        try {
            const { generateDailyClosePDF } = await import('../utils/dailyCloseGenerator');
            await generateDailyClosePDF({
                sales: salesForCashFlow,
                allSales: salesForStats,
                bcvRate,
                paymentBreakdown,
                topProducts,
                todayTotalUsd: totalUsd,
                todayTotalBs: totalBs,
                todayProfit: profit,
                todayItemsSold: totalItems,
            });
        } catch (e) {
            console.error('Error generando PDF:', e);
        }
    };

    return { handleExportPDF };
}
