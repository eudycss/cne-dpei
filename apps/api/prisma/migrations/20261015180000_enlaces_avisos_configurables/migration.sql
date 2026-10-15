-- Frecuencia de los avisos por Telegram de enlaces caídos, configurable desde la web.
ALTER TABLE "config_enlaces"
  ADD COLUMN "minutos_primer_aviso" INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN "minutos_repetir_aviso" INTEGER NOT NULL DEFAULT 120;
