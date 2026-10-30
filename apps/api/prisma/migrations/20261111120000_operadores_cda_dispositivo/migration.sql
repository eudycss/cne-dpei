-- Celular de cada operador/asistente CDA (ANDROID o IPHONE): se muestra en
-- Parejas para saber quién puede instalar la APK. Columna nueva y vacía.

-- AlterTable
ALTER TABLE "operadores_cda" ADD COLUMN     "dispositivo" VARCHAR(10);

ALTER TABLE "operadores_cda" ADD CONSTRAINT "ck_operadores_cda_dispositivo"
  CHECK ("dispositivo" IS NULL OR "dispositivo" IN ('ANDROID', 'IPHONE'));
