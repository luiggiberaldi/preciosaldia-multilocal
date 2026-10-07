// tests/chatSystemPrompt.test.js — Tests de contrato del system prompt del asistente.
//
// Garantizan que el prompt nunca pierda sus reglas de verdad (anti-invención de rutas),
// los hechos verificados del POS ni la política de formato corto. Si editas
// src/services/chatSystemPrompt.js, estos tests corren en el pre-commit.

import { describe, it, expect } from 'vitest';
import { CHAT_SYSTEM_PROMPT } from '../src/services/chatSystemPrompt';

describe('chatSystemPrompt — contrato de veracidad', () => {
  it('prohíbe inventar rutas, pantallas y botones', () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/NUNCA inventes rutas/);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/Cita únicamente las rutas que aparecen en este prompt/);
  });

  it('obliga a admitir el desconocimiento en vez de improvisar', () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/dilo con franqueza/);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/No inventes datos del negocio/);
  });

  it('describe los estados reales de la barra de cobro (Resta/Vuelto/Cubierto, sin negativos)', () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/"Resta" siempre es un valor positivo/);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/Jamás describas restas negativas/);
    expect(CHAT_SYSTEM_PROMPT).toContain('Cubierto');
  });

  it('aclara que solo el efectivo genera vuelto físico', () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/SOLO los métodos de efectivo generan vuelto/);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/Pago móvil, punto de venta y transferencias no generan vuelto/);
  });

  it('documenta el redondeo real (Bs entero con techo, no configurable)', () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/Redondeo \(NO configurable\)/);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/hacia arriba al entero/);
  });

  it('cuenta las opciones reales de sobrepago (donar, acreditar, propina)', () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/donarlo a la caja/);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/billetera del cliente/);
  });

  it('lista las 5 pestañas reales de Configuración (rutas verificadas en SettingsView)', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('Negocio, Ventas, Usuarios, Licencia y Sistema');
  });

  it('cita el cierre de caja en Dashboard (no en Ventas)', () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/módulo Dashboard \(no desde Ventas\)/);
  });

  it('lista los 6 métodos de pago por defecto', () => {
    for (const method of ['Efectivo en Bolívares', 'Pago Móvil', 'Punto de Venta', 'Efectivo en Dólares', 'Efectivo en Pesos', 'Transferencia COP']) {
      expect(CHAT_SYSTEM_PROMPT).toContain(method);
    }
  });

  it('mantiene la voz venezolana del comercio', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('bodega');
    expect(CHAT_SYSTEM_PROMPT).toContain('vuelto');
  });
});

describe('chatSystemPrompt — contrato de formato', () => {
  it('impone presupuesto de palabras (~180) en las respuestas', () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/Máximo ~180 palabras/);
  });

  it('prohíbe preguntas de cortesía al cerrar', () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/NUNCA cierres con preguntas de cortesía/);
  });

  it('restringe tablas a comparaciones de 3+ elementos', () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/Tablas SOLO si comparas 3 o más/);
  });

  it('obliga a usar los datos reales del contexto en ejemplos numéricos', () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/CONTEXTO EN TIEMPO REAL DEL POS/);
  });
});

describe('chatSystemPrompt — tamaño razonable', () => {
  it('el prompt completo no supera 900 palabras', () => {
    const words = CHAT_SYSTEM_PROMPT.trim().split(/\s+/).length;
    expect(words).toBeLessThanOrEqual(900);
  });

  it('no contiene rutas de navegación inventadas conocidas', () => {
    // Rutas/alucinaciones detectadas en auditoría previa — jamás deben volver al prompt.
    const blacklistedRoutes = ['Nuevo Ticket', 'Ventas -> Tasas', 'Configuración -> Tasas', 'Configuración -> Ventas -> Redondeo'];
    for (const route of blacklistedRoutes) {
      expect(CHAT_SYSTEM_PROMPT).not.toContain(route);
    }
  });
});
