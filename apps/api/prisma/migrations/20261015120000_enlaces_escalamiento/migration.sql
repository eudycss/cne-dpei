-- Escalamiento de enlaces caídos: aviso al encargado a los 30 min de caído y
-- recordatorio cada 30 min. Columnas nuevas con valor por defecto: no bloquea
-- la tabla ni toca las filas existentes.
ALTER TABLE "enlaces_caidas"
    ADD COLUMN "ultimo_aviso" TIMESTAMPTZ(6),
    ADD COLUMN "avisos" INTEGER NOT NULL DEFAULT 0;
