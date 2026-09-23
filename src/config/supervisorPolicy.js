// Política temporal de seguridad del Modo Supervisor.
//
// Las mutaciones remotas generales permanecen deshabilitadas. Ingreso, tasas y
// egreso se habilitan por separado solo después de validar pairing, RLS, ACK e
// idempotencia. El POS local y el monitor de solo lectura no dependen de este flag.
export const SUPERVISOR_REMOTE_MUTATIONS_ENABLED = false;
export const SUPERVISOR_REMOTE_INCOME_ENABLED = import.meta.env.VITE_SUPERVISOR_REMOTE_INCOME_ENABLED === 'true';
export const SUPERVISOR_REMOTE_RATE_ENABLED = import.meta.env.VITE_SUPERVISOR_REMOTE_RATE_ENABLED === 'true';
export const SUPERVISOR_REMOTE_EGRESS_ENABLED = import.meta.env.VITE_SUPERVISOR_REMOTE_EGRESS_ENABLED === 'true';

export default {
    SUPERVISOR_REMOTE_MUTATIONS_ENABLED,
    SUPERVISOR_REMOTE_INCOME_ENABLED,
    SUPERVISOR_REMOTE_RATE_ENABLED,
    SUPERVISOR_REMOTE_EGRESS_ENABLED,
};
