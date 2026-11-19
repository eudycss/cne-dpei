-- Distribución del personal CDA/CPE por días (cada persona un solo día,
-- equitativo entre hombres y mujeres). Tablas nuevas: no cambia ninguna fila existente.
CREATE TABLE "distribuciones_dias" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "fechas" DATE[],
    "excluir_cargos" VARCHAR(40)[],
    "canton_cpe" VARCHAR(100),
    "encargado_cpe" VARCHAR(200),
    "creado_por_id" UUID,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "distribuciones_dias_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_distribuciones_dias_fechas" CHECK (cardinality("fechas") BETWEEN 1 AND 7)
);
ALTER TABLE "distribuciones_dias" ADD CONSTRAINT "distribuciones_dias_creado_por_id_fkey"
    FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "distribucion_dias_personas" (
    "id" UUID NOT NULL,
    "distribucion_id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "operador_id" UUID,
    "cedula" VARCHAR(10) NOT NULL,
    "nombres" VARCHAR(200),
    "telefono" VARCHAR(20),
    "sexo" VARCHAR(1),
    "cargo" VARCHAR(160),
    "canton" VARCHAR(100),
    "encargado" VARCHAR(200),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "distribucion_dias_personas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_distribucion_dias_personas_sexo" CHECK ("sexo" IS NULL OR "sexo" IN ('M', 'F')),
    -- Externa (sin ficha): nombre y sexo son obligatorios.
    CONSTRAINT "ck_distribucion_dias_personas_externa" CHECK ("operador_id" IS NOT NULL OR ("nombres" IS NOT NULL AND "sexo" IS NOT NULL))
);
CREATE UNIQUE INDEX "uq_distribucion_dias_personas_cedula" ON "distribucion_dias_personas" ("distribucion_id", "cedula");
CREATE INDEX "idx_distribucion_dias_personas_fecha" ON "distribucion_dias_personas" ("distribucion_id", "fecha");
CREATE INDEX "idx_distribucion_dias_personas_operador" ON "distribucion_dias_personas" ("operador_id");
ALTER TABLE "distribucion_dias_personas" ADD CONSTRAINT "distribucion_dias_personas_distribucion_id_fkey"
    FOREIGN KEY ("distribucion_id") REFERENCES "distribuciones_dias"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "distribucion_dias_personas" ADD CONSTRAINT "distribucion_dias_personas_operador_id_fkey"
    FOREIGN KEY ("operador_id") REFERENCES "operadores_cda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- De fábrica: armar y editar la distribución, como el resto de acciones del
-- módulo (técnico supervisor, asistente transversal y analista provincial).
INSERT INTO "rol_permisos" ("rol_id", "permiso")
SELECT r."id", d."permiso"
FROM (VALUES
    ('TECNICO_SUPERVISOR', 'cda.distribucion.gestionar'),
    ('ASISTENTE_TRANSVERSAL', 'cda.distribucion.gestionar'),
    ('ANALISTA_PROVINCIAL', 'cda.distribucion.gestionar')
) AS d("rol", "permiso")
JOIN "roles" r ON r."nombre" = d."rol"
ON CONFLICT DO NOTHING;
