-- Sexo del personal CDA/CPE (M/F, como en la cédula). Nullable: se completa
-- a mano o desde el Excel; nadie queda bloqueado por no tenerlo.
ALTER TABLE "operadores_cda" ADD COLUMN "sexo" VARCHAR(1);
ALTER TABLE "operadores_cda"
  ADD CONSTRAINT "operadores_cda_sexo_check" CHECK ("sexo" IS NULL OR "sexo" IN ('M', 'F'));
