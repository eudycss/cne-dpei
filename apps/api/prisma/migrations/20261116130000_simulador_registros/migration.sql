-- Simulador: además de actas, se cuentan los registros (filas) digitados y
-- correctos; el borrador del acta abierta cuenta si el tiempo se acaba.
-- Solo columnas nuevas con valor por defecto: ninguna fila existente cambia.
ALTER TABLE "intentos_digitacion"
    ADD COLUMN "filas_digitadas" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "filas_correctas" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "actas_digitacion"
    ADD COLUMN "borrador" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    ADD COLUMN "borrador_en" TIMESTAMPTZ(6);
