# Bitácora — PreciosAlDía Multi

Registro de cambios del proyecto. Cada commit lleva su entrada: qué cambió y por qué.

---

## 2026-09-29 — Nace el proyecto
- Se crea el repo privado `luiggiberaldi/preciosaldia-multi` como clon de
  `luiggiberaldi/preciosaldia2026` (commit base `09b5b6e`).
- Decisión: repo nuevo + proyecto Supabase nuevo, separados del producto original.
  El cliente (dueño de 2 negocios: bodega + cosméticos) no comparte infraestructura
  con PreciosAlDía.
- Se escribe `ROADMAP.md` con las fases: Fundación → Multi-negocio core →
  Experiencia del dueño → Futuro (vertical cosméticos, sucursales).
- Alcance Fase 1 fijado con luigi: mismo vertical BODEGA en ambos negocios;
  el requerimiento es puro multi-negocio con datos aislados.
- `BRIEF-FASE1.md` (guía de implementación, temporal, no se pushea).
- Estado: en pausa por luigi antes de iniciar la implementación.
