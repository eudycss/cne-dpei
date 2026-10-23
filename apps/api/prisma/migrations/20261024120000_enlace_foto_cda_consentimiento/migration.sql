-- Enlace de foto de operador CDA: revocación, intentos y prueba del consentimiento LOPDP.
ALTER TABLE "enlaces_foto_cda"
  ADD COLUMN "revocado_en" TIMESTAMPTZ(6),
  ADD COLUMN "intentos" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "consentido_en" TIMESTAMPTZ(6),
  ADD COLUMN "consentimiento_version" VARCHAR(20);
