-- Recintos que ya no están en el Google Sheet: se ocultan sin borrarlos,
-- para conservar el historial de kits, tracking y actas.
ALTER TABLE "recintos" ADD COLUMN "activo" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX "idx_recintos_activo" ON "recintos"("activo");
