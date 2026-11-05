-- Cada cuánto manda el bot el resumen automático del grupo Jornada (antes fijo en 15 min).
ALTER TABLE "config_enlaces" ADD COLUMN "minutos_resumen_jornada" INTEGER NOT NULL DEFAULT 15;
