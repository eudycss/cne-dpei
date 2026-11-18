-- Plan de perímetro: despliegue de puestos (personal CDA/CPE), vallas y zonas
-- sobre el mapa de un evento. Tablas nuevas: no cambia ninguna fila existente.
CREATE TABLE "planes_perimetro" (
    "id" UUID NOT NULL,
    "evento_id" UUID NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "lugar" VARCHAR(200),
    "perimetro" JSONB,
    "zonas" JSONB NOT NULL DEFAULT '[]',
    "vallas" JSONB NOT NULL DEFAULT '[]',
    "ajustes" JSONB NOT NULL,
    "vista" JSONB,
    "version" INTEGER NOT NULL DEFAULT 0,
    "creado_por_id" UUID,
    "actualizado_por_id" UUID,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "planes_perimetro_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_planes_perimetro_evento" ON "planes_perimetro" ("evento_id");
ALTER TABLE "planes_perimetro" ADD CONSTRAINT "planes_perimetro_evento_id_fkey"
    FOREIGN KEY ("evento_id") REFERENCES "eventos_electorales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "planes_perimetro" ADD CONSTRAINT "planes_perimetro_creado_por_id_fkey"
    FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "planes_perimetro" ADD CONSTRAINT "planes_perimetro_actualizado_por_id_fkey"
    FOREIGN KEY ("actualizado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "puestos_perimetro" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "orden" INTEGER NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "operador_cda_id" UUID,
    "etiqueta" VARCHAR(60),
    CONSTRAINT "puestos_perimetro_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_puestos_perimetro_coords" CHECK ("lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180)
);
-- Varios NULL no chocan: muchos puestos pueden estar sin persona.
CREATE UNIQUE INDEX "uq_puestos_perimetro_plan_operador" ON "puestos_perimetro" ("plan_id", "operador_cda_id");
CREATE UNIQUE INDEX "uq_puestos_perimetro_plan_orden" ON "puestos_perimetro" ("plan_id", "orden");
CREATE INDEX "idx_puestos_perimetro_operador" ON "puestos_perimetro" ("operador_cda_id");
ALTER TABLE "puestos_perimetro" ADD CONSTRAINT "puestos_perimetro_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "planes_perimetro"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "puestos_perimetro" ADD CONSTRAINT "puestos_perimetro_operador_cda_id_fkey"
    FOREIGN KEY ("operador_cda_id") REFERENCES "operadores_cda"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- De fábrica: el módulo y la acción de editar para el técnico supervisor y el
-- analista provincial (como el resto del catálogo). El administrador los ajusta
-- después en "Módulos por rol".
INSERT INTO "rol_modulos" ("rol_id", "modulo")
SELECT r."id", d."modulo"
FROM (VALUES
    ('TECNICO_SUPERVISOR', 'plan-perimetro'),
    ('ANALISTA_PROVINCIAL', 'plan-perimetro')
) AS d("rol", "modulo")
JOIN "roles" r ON r."nombre" = d."rol"
ON CONFLICT DO NOTHING;
INSERT INTO "rol_permisos" ("rol_id", "permiso")
SELECT r."id", d."permiso"
FROM (VALUES
    ('TECNICO_SUPERVISOR', 'perimetro.planes.editar'),
    ('ANALISTA_PROVINCIAL', 'perimetro.planes.editar')
) AS d("rol", "permiso")
JOIN "roles" r ON r."nombre" = d."rol"
ON CONFLICT DO NOTHING;
