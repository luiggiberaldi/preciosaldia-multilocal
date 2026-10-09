/**
 * payroll.js — Lógica PURA de nómina (v1) de PreciosAlDía Pro.
 *
 * Sin JSX, sin React, sin storage ni Supabase: solo cálculo. Node puede
 * importarlo directo para tests deterministas.
 *
 * Todo se computa en America/Caracas. La zona no tiene horario de verano
 * desde 2016 (UTC-4 fijo); aun así las partes de fecha se obtienen vía Intl
 * con la zona explícita para no depender del TZ del entorno.
 */
import { round2 } from './dinero.js';

export const FRECUENCIAS = ['semanal', 'quincenal', 'mensual'];

const TZ = 'America/Caracas';
const MS_DAY = 86400000;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const pad2 = (n) => String(n).padStart(2, '0');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Normaliza la frecuencia; desconocida → 'mensual' (la más conservadora). */
function normFrecuencia(f) {
    return FRECUENCIAS.includes(f) ? f : 'mensual';
}

/** Partes Y/M/D de un Date en America/Caracas. */
function ccsParts(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
}

/** Instante ISO de las 00:00 Caracas de una fecha Y/M/D (CCS = UTC-4). */
function ccsMidnightISO(y, m, d) {
    return new Date(Date.UTC(y, m - 1, d, 4, 0, 0)).toISOString();
}

/** { isoYear, week } (semana ISO) para una fecha calendario Y/M/D. */
function isoWeekOf(y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    const dayNum = (dt.getUTCDay() + 6) % 7; // lunes=0 … domingo=6
    dt.setUTCDate(dt.getUTCDate() - dayNum + 3); // jueves de esa semana manda
    const isoYear = dt.getUTCFullYear();
    const firstThu = new Date(Date.UTC(isoYear, 0, 4));
    const firstNum = (firstThu.getUTCDay() + 6) % 7;
    firstThu.setUTCDate(firstThu.getUTCDate() - firstNum + 3);
    const week = 1 + Math.round((dt.getTime() - firstThu.getTime()) / (7 * MS_DAY));
    return { isoYear, week };
}

/** Y/M/D del lunes de la semana ISO `week` del `isoYear`. */
function mondayOfIsoWeek(isoYear, week) {
    const jan4 = new Date(Date.UTC(isoYear, 0, 4));
    const jan4Num = (jan4.getUTCDay() + 6) % 7;
    const monday = new Date(jan4.getTime() - jan4Num * MS_DAY + (week - 1) * 7 * MS_DAY);
    return { y: monday.getUTCFullYear(), m: monday.getUTCMonth() + 1, d: monday.getUTCDate() };
}

/** 'Semanal' | 'Quincenal' | 'Mensual'. */
export function frecuenciaLabel(f) {
    const n = normFrecuencia(f);
    return n === 'quincenal' ? 'Quincenal' : n === 'mensual' ? 'Mensual' : 'Semanal';
}

/**
 * Key del período que contiene `date` para la frecuencia dada.
 * Semanal → '2026-W40' · Quincenal → '2026-10-Q1'/'2026-10-Q2' · Mensual → '2026-10'.
 */
export function periodKeyFor(date, frecuencia) {
    const f = normFrecuencia(frecuencia);
    const dt = date instanceof Date ? date : new Date(date);
    const { y, m, d } = ccsParts(dt);
    if (f === 'semanal') {
        const { isoYear, week } = isoWeekOf(y, m, d);
        return `${isoYear}-W${week}`;
    }
    if (f === 'quincenal') {
        return `${y}-${pad2(m)}-Q${d <= 15 ? 1 : 2}`;
    }
    return `${y}-${pad2(m)}`;
}

/**
 * Límites del período a partir de su key.
 * → { inicioISO, finISO, frecuencia, label } (ISOs = 00:00 Caracas del día).
 * Soporta las 3 formas: '2026-W40', '2026-10-Q1', '2026-10'.
 * También acepta sufijo de reapertura ('2026-W40-2'): los límites son los de la key base.
 */
export function basePeriodKey(periodKey) {
    const key = String(periodKey || '');
    // Una clave base válida (incluida la mensual '2026-10', cuyo '-10' parece un sufijo) se devuelve tal cual.
    if (/^\d{4}-W\d{1,2}$/.test(key) || /^\d{4}-\d{2}-Q[12]$/.test(key) || /^\d{4}-\d{2}$/.test(key)) {
        return key;
    }
    return key.replace(/-\d+$/, '');
}

export function periodBounds(periodKey) {
    const base = basePeriodKey(periodKey);
    let m;
    if ((m = /^(\d{4})-W(\d{1,2})$/.exec(base))) {
        const isoYear = Number(m[1]);
        const week = Number(m[2]);
        const mon = mondayOfIsoWeek(isoYear, week);
        const next = new Date(Date.UTC(mon.y, mon.m - 1, mon.d) + 7 * MS_DAY);
        return {
            inicioISO: ccsMidnightISO(mon.y, mon.m, mon.d),
            finISO: ccsMidnightISO(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()),
            frecuencia: 'semanal',
            label: `Semana ${week} · ${isoYear}`,
        };
    }
    if ((m = /^(\d{4})-(\d{2})-Q([12])$/.exec(base))) {
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const q = m[3];
        // Q1: 1–15 · Q2: 16–fin de mes (el fin es el día 1 del mes siguiente).
        const startD = q === '1' ? 1 : 16;
        const end = q === '1'
            ? { y, m: mo, d: 16 }
            : mo === 12 ? { y: y + 1, m: 1, d: 1 } : { y, m: mo + 1, d: 1 };
        return {
            inicioISO: ccsMidnightISO(y, mo, startD),
            finISO: ccsMidnightISO(end.y, end.m, end.d),
            frecuencia: 'quincenal',
            label: `Quincena ${q} · ${MESES[mo - 1]} ${y}`,
        };
    }
    if ((m = /^(\d{4})-(\d{2})$/.exec(base))) {
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const end = mo === 12 ? { y: y + 1, m: 1 } : { y, m: mo + 1 };
        return {
            inicioISO: ccsMidnightISO(y, mo, 1),
            finISO: ccsMidnightISO(end.y, end.m, 1),
            frecuencia: 'mensual',
            label: `${cap(MESES[mo - 1])} ${y}`,
        };
    }
    throw new Error(`periodKey inválido: ${periodKey}`);
}

/** Key del período corriente para la frecuencia dada. */
export function currentPeriodKey(frecuencia, now = new Date()) {
    return periodKeyFor(now, frecuencia);
}

/**
 * Suma consumos en estado APPLIED (los VOIDED no descuentan).
 * → { totalUsd, count }
 */
export function summarizeConsumos(consumos) {
    let total = 0;
    let count = 0;
    for (const c of (Array.isArray(consumos) ? consumos : [])) {
        if (c && c.status === 'APPLIED') {
            total += Number(c.totalUsd) || 0;
            count += 1;
        }
    }
    return { totalUsd: round2(total), count };
}

/** neto = salario − Σ consumos aplicados. → { totalConsumosUsd, netoUsd, count } */
export function calculateNeto(salarioUsd, consumos) {
    const { totalUsd, count } = summarizeConsumos(consumos);
    return {
        totalConsumosUsd: totalUsd,
        netoUsd: round2((Number(salarioUsd) || 0) - totalUsd),
        count,
    };
}

/**
 * ¿(consumos acumulados + nuevo) supera el tope? tope = salario × limitePorc / 100.
 * Comparación estricta: justo en el tope NO excede.
 */
export function consumoExcedeLimite(salarioUsd, consumosUsd, nuevoUsd, limitePorc) {
    const tope = round2((Number(salarioUsd) || 0) * (Number(limitePorc) || 0) / 100);
    const acumulado = round2((Number(consumosUsd) || 0) + (Number(nuevoUsd) || 0));
    return acumulado > tope;
}

/** Convierte un monto a USD. 'Bs' usa la tasa BCV (tasa ≤ 0 → 0, no NaN). */
export function toUsd(monto, moneda, tasaBcv) {
    const v = Number(monto) || 0;
    if (moneda === 'Bs') {
        const tasa = Number(tasaBcv) || 0;
        return tasa > 0 ? round2(v / tasa) : 0;
    }
    return round2(v); // 'USD' (u otra): se asume USD
}

/** Folio del recibo: 'NOM-2026-10-Q1-ABC123' (6 chars alfanuméricos del id). */
export function payrollFolio(periodKey, liquidacionId) {
    const clean = String(liquidacionId ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
    return `NOM-${periodKey}-${clean}`;
}
