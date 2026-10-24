-- Hora oficial de entrada de los operadores CDA y minutos de gracia (singleton id = 1).
CREATE TABLE "config_asistencia_cda" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "hora_entrada" VARCHAR(5) NOT NULL DEFAULT '08:00',
    "minutos_gracia" INTEGER NOT NULL DEFAULT 10,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "config_asistencia_cda_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_config_asistencia_cda_singleton" CHECK ("id" = 1),
    CONSTRAINT "ck_config_asistencia_cda_hora" CHECK ("hora_entrada" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    CONSTRAINT "ck_config_asistencia_cda_gracia" CHECK ("minutos_gracia" BETWEEN 0 AND 120)
);
