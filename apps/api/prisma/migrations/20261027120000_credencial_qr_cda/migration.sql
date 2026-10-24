-- Credencial QR de los operadores CDA (solo el SHA-256 del token) y origen de cada marca de asistencia.
CREATE TABLE "credenciales_qr_cda" (
    "id" UUID NOT NULL,
    "operador_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "emitida_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emitida_por_id" UUID,
    "revocada_en" TIMESTAMPTZ(6),
    "motivo_revocacion" VARCHAR(20),

    CONSTRAINT "credenciales_qr_cda_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_credenciales_qr_cda_hash" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ck_credenciales_qr_cda_motivo" CHECK ("motivo_revocacion" IN ('REEMITIDA', 'REVOCADA')),
    CONSTRAINT "ck_credenciales_qr_cda_revocacion" CHECK (("revocada_en" IS NULL) = ("motivo_revocacion" IS NULL))
);

CREATE UNIQUE INDEX "credenciales_qr_cda_token_hash_key" ON "credenciales_qr_cda"("token_hash");
CREATE INDEX "idx_credenciales_qr_cda_operador" ON "credenciales_qr_cda"("operador_id");
-- Una sola credencial vigente por operador: emitir otra exige revocar la anterior en la misma transacción.
CREATE UNIQUE INDEX "uq_credenciales_qr_cda_vigente" ON "credenciales_qr_cda"("operador_id") WHERE "revocada_en" IS NULL;

ALTER TABLE "credenciales_qr_cda" ADD CONSTRAINT "credenciales_qr_cda_operador_id_fkey"
    FOREIGN KEY ("operador_id") REFERENCES "operadores_cda"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credenciales_qr_cda" ADD CONSTRAINT "credenciales_qr_cda_emitida_por_id_fkey"
    FOREIGN KEY ("emitida_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "asistencias_cda"
    ADD COLUMN "entrada_origen" VARCHAR(10),
    ADD COLUMN "salida_origen" VARCHAR(10),
    ADD CONSTRAINT "ck_asistencias_cda_entrada_origen" CHECK ("entrada_origen" IN ('MANUAL', 'MASIVA', 'QR')),
    ADD CONSTRAINT "ck_asistencias_cda_salida_origen" CHECK ("salida_origen" IN ('MANUAL', 'MASIVA', 'QR'));
