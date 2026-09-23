import { describe, expect, it } from 'vitest';
import {
    SUPERVISOR_REMOTE_MUTATIONS_ENABLED,
    SUPERVISOR_REMOTE_RATE_ENABLED,
    SUPERVISOR_REMOTE_EGRESS_ENABLED,
} from '../src/config/supervisorPolicy';

describe('Supervisor remote mutation guardrail', () => {
    it('mantiene deshabilitadas las mutaciones remotas durante la contención', () => {
        expect(SUPERVISOR_REMOTE_MUTATIONS_ENABLED).toBe(false);
        expect(SUPERVISOR_REMOTE_RATE_ENABLED).toBe(false);
        expect(SUPERVISOR_REMOTE_EGRESS_ENABLED).toBe(false);
    });
});
