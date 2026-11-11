-- Bot Jornada: avisos con sonido ya enviados al grupo (retrasos, "llegó",
-- sin GPS, alertas reenviadas), para no repetirlos tras un reinicio del
-- servidor. Una fila por aviso, día de jornada y evento. Solo tabla nueva.
CREATE TABLE "avisos_jornada" (
    "id" UUID NOT NULL,
    "evento_id" UUID NOT NULL,
    "dia" VARCHAR(10) NOT NULL,
    "clave" VARCHAR(120) NOT NULL,
    "enviado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avisos_jornada_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "avisos_jornada_evento_id_dia_clave_key" ON "avisos_jornada"("evento_id", "dia", "clave");
