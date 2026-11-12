-- Anti-parpadeo del bot de enlaces: último estado confirmado (dos lecturas
-- iguales seguidas) de cada recinto. NULL = aún sin confirmar.
ALTER TABLE "enlaces_recinto" ADD COLUMN "estado_confirmado" "estado_enlace";

-- Lo que ya está en la tabla se da por confirmado: si no, el primer ciclo tras el
-- despliegue avisaría como "recién caídos" todos los enlaces que ya estaban caídos.
UPDATE "enlaces_recinto" SET "estado_confirmado" = "estado";
