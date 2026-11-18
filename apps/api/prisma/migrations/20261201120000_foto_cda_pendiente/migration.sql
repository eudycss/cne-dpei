-- Foto nueva del personal CDA/CPE que espera aprobación (enlace único por cédula
-- cuando ya tenía foto). La credencial sigue usando foto_key hasta que se apruebe.
ALTER TABLE "operadores_cda" ADD COLUMN "foto_pendiente_key" VARCHAR(255);
ALTER TABLE "operadores_cda" ADD COLUMN "foto_pendiente_en" TIMESTAMPTZ(6);
