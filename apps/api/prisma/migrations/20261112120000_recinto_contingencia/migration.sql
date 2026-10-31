-- Unidad de contingencia del CDA: a dónde dirigirse si hay un problema con el
-- kit técnico. Texto libre (a veces es el CPE o un GAD, sin código de recinto).
-- La sincronización con el Google Sheet de recintos no toca estas columnas.
ALTER TABLE "recintos" ADD COLUMN "contingencia_nombre" VARCHAR(255);
ALTER TABLE "recintos" ADD COLUMN "contingencia_direccion" VARCHAR(255);
