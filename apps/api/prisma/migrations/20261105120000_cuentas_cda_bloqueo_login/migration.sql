-- Cuentas de la app para Operadores/Asistentes CDA (entran con cédula, sin correo)
-- y bloqueo temporal por contraseñas erróneas seguidas. Solo agrega columnas:
-- no modifica datos existentes.
ALTER TABLE "usuarios"
    ALTER COLUMN "email" DROP NOT NULL,
    ADD COLUMN "intentos_fallidos" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "bloqueado_hasta" TIMESTAMPTZ(6);

ALTER TABLE "operadores_cda" ADD COLUMN "usuario_id" UUID;
CREATE UNIQUE INDEX "operadores_cda_usuario_id_key" ON "operadores_cda"("usuario_id");
ALTER TABLE "operadores_cda" ADD CONSTRAINT "operadores_cda_usuario_id_fkey"
    FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
