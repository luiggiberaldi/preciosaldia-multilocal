// Consolidador histórico deshabilitado: sus reglas y decisiones quedaron obsoletas.
// Este archivo se conserva para impedir que una referencia antigua vuelva a
// sobrescribir la matriz y las decisiones actuales del Plan Maestro.

console.error(
  [
    "Este consolidador está deshabilitado porque contiene decisiones obsoletas.",
    "No se modificó ningún archivo. La hoja de decisiones y el plan maestro actuales son la referencia.",
    "Actualiza la matriz manualmente y verifica sus reflejos antes de consolidar nuevas decisiones.",
  ].join("\n"),
);
process.exitCode = 1;
