-- Llegada registrada sin señal fuera del margen: el servidor la acepta (el
-- operador sí estuvo en el lugar a esa hora según su GPS, pero lo confirmó
-- más tarde) y deja una alerta para que el supervisor la revise.
ALTER TYPE "tipo_alerta" ADD VALUE IF NOT EXISTS 'LLEGADA_RECINTO_FUERA_DE_RANGO';
ALTER TYPE "tipo_alerta" ADD VALUE IF NOT EXISTS 'LLEGADA_DPI_FUERA_DE_RANGO';
