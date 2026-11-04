-- Parejas de reserva: registradas el día pero sin recinto (no reciben kit ni
-- salen en la app hasta que se les asigna uno). Ninguna fila existente cambia.
ALTER TABLE "parejas_cda" ALTER COLUMN "recinto_id" DROP NOT NULL;
ALTER TABLE "parejas_cda" ADD CONSTRAINT "ck_parejas_cda_reserva_sin_kit"
    CHECK ("recinto_id" IS NOT NULL OR "kit_id" IS NULL);
