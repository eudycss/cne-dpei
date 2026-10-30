-- Cargos CDA/CPE: de enum fijo (grupo_cda) a tabla que el administrador
-- gestiona desde la web. Las 9 claves se conservan tal cual: ninguna fila de
-- personal, hora de entrada o historial cambia de valor, solo de tipo.

CREATE TABLE "cargos_cda" (
    "clave" VARCHAR(40) NOT NULL,
    "nombre" VARCHAR(80) NOT NULL,
    "centro" VARCHAR(3) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cargos_cda_pkey" PRIMARY KEY ("clave"),
    CONSTRAINT "ck_cargos_cda_centro" CHECK ("centro" IN ('CDA', 'CPE')),
    CONSTRAINT "ck_cargos_cda_clave" CHECK ("clave" ~ '^[A-Z][A-Z0-9_]{0,39}$')
);

-- Dos cargos no pueden llamarse igual (sin importar mayúsculas).
CREATE UNIQUE INDEX "uq_cargos_cda_nombre" ON "cargos_cda" (lower("nombre"));

INSERT INTO "cargos_cda" ("clave", "nombre", "centro", "orden") VALUES
    ('OPERADOR', 'Operadores CDA', 'CDA', 1),
    ('ASISTENTE', 'Asistentes CDA', 'CDA', 2),
    ('DIGITADOR', 'Digitadores', 'CPE', 3),
    ('ASISTENTE_ARCHIVOS', 'Asistentes de Archivos', 'CPE', 4),
    ('ASISTENTE_FIRMAS', 'Asistentes de firmas', 'CPE', 5),
    ('RECEPTOR_ACTAS', 'Receptores de actas', 'CPE', 6),
    ('ARCHIVADOR_ACTAS', 'Archivadores de actas', 'CPE', 7),
    ('SUPERVISOR', 'Supervisores', 'CPE', 8),
    ('OPERADOR_ESCANER_CPE', 'Operadores de escáner CPE', 'CPE', 9);

-- Columnas que usaban el enum: pasan a texto con llave foránea a la tabla.
ALTER TABLE "operadores_cda" ALTER COLUMN "grupo" DROP DEFAULT;
ALTER TABLE "operadores_cda" ALTER COLUMN "grupo" TYPE VARCHAR(40) USING "grupo"::text;
ALTER TABLE "operadores_cda" ALTER COLUMN "grupo" SET DEFAULT 'OPERADOR';

ALTER TABLE "config_asistencia_cda" ALTER COLUMN "grupo" TYPE VARCHAR(40) USING "grupo"::text;

-- El CHECK "anterior <> nuevo" compara valores del enum: se quita y se vuelve a crear con texto.
ALTER TABLE "cambios_cargo_cda" DROP CONSTRAINT "ck_cambios_cargo_cda_distinto";
ALTER TABLE "cambios_cargo_cda" ALTER COLUMN "grupo_anterior" TYPE VARCHAR(40) USING "grupo_anterior"::text;
ALTER TABLE "cambios_cargo_cda" ALTER COLUMN "grupo_nuevo" TYPE VARCHAR(40) USING "grupo_nuevo"::text;
ALTER TABLE "cambios_cargo_cda" ADD CONSTRAINT "ck_cambios_cargo_cda_distinto" CHECK ("grupo_anterior" <> "grupo_nuevo");

ALTER TABLE "actas_entrega_cda" ALTER COLUMN "grupo" TYPE VARCHAR(40) USING "grupo"::text;

ALTER TABLE "operadores_cda" ADD CONSTRAINT "operadores_cda_grupo_fkey"
    FOREIGN KEY ("grupo") REFERENCES "cargos_cda"("clave") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "config_asistencia_cda" ADD CONSTRAINT "config_asistencia_cda_grupo_fkey"
    FOREIGN KEY ("grupo") REFERENCES "cargos_cda"("clave") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cambios_cargo_cda" ADD CONSTRAINT "cambios_cargo_cda_grupo_anterior_fkey"
    FOREIGN KEY ("grupo_anterior") REFERENCES "cargos_cda"("clave") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cambios_cargo_cda" ADD CONSTRAINT "cambios_cargo_cda_grupo_nuevo_fkey"
    FOREIGN KEY ("grupo_nuevo") REFERENCES "cargos_cda"("clave") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "actas_entrega_cda" ADD CONSTRAINT "actas_entrega_cda_grupo_fkey"
    FOREIGN KEY ("grupo") REFERENCES "cargos_cda"("clave") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TYPE "grupo_cda";
