-- Margen de gracia del refresh: marca qué token reemplazó a cada uno al rotar.
ALTER TABLE "refresh_tokens" ADD COLUMN "reemplazado_por_jti" VARCHAR(64);
