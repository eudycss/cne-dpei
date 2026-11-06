-- Reserva incompleta: una pareja de reserva puede quedar con solo el asistente
-- (el espacio del operador vacío). En un recinto el operador sigue siendo
-- obligatorio (el kit va a su nombre) y nunca queda una pareja sin nadie.
-- Ninguna fila existente cambia.
ALTER TABLE "parejas_cda" ALTER COLUMN "operador_cda_id" DROP NOT NULL;
ALTER TABLE "parejas_cda" ADD CONSTRAINT "ck_parejas_cda_operador_o_reserva"
    CHECK ("operador_cda_id" IS NOT NULL OR ("recinto_id" IS NULL AND "asistente_cda_id" IS NOT NULL));
