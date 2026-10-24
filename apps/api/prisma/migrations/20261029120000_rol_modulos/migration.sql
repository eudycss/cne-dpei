-- Módulos de la web visibles por rol, configurables por el administrador.
-- CreateTable
CREATE TABLE "rol_modulos" (
    "rol_id" UUID NOT NULL,
    "modulo" VARCHAR(40) NOT NULL,

    CONSTRAINT "rol_modulos_pkey" PRIMARY KEY ("rol_id","modulo")
);

-- AddForeignKey
ALTER TABLE "rol_modulos" ADD CONSTRAINT "rol_modulos_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Los roles configurables deben existir para cargarles su visibilidad de
-- fábrica, aun en una base nueva donde el seed todavía no corrió.
INSERT INTO "roles" ("id", "nombre")
VALUES
    (gen_random_uuid(), 'TECNICO_SUPERVISOR'),
    (gen_random_uuid(), 'LECTOR'),
    (gen_random_uuid(), 'ASISTENTE_TRANSVERSAL')
ON CONFLICT ("nombre") DO NOTHING;

-- Visibilidad de fábrica (la que estaba fija en el código), para que nada
-- cambie al desplegar. Debe coincidir con `rolesPorDefecto` de MODULOS_WEB.
INSERT INTO "rol_modulos" ("rol_id", "modulo")
SELECT r."id", d."modulo"
FROM (VALUES
    ('TECNICO_SUPERVISOR', 'inicio'),
    ('TECNICO_SUPERVISOR', 'recintos'),
    ('TECNICO_SUPERVISOR', 'usuarios'),
    ('TECNICO_SUPERVISOR', 'militares'),
    ('TECNICO_SUPERVISOR', 'eventos'),
    ('TECNICO_SUPERVISOR', 'asignaciones'),
    ('TECNICO_SUPERVISOR', 'kits'),
    ('TECNICO_SUPERVISOR', 'monitoreo'),
    ('TECNICO_SUPERVISOR', 'incidencias'),
    ('TECNICO_SUPERVISOR', 'alertas'),
    ('TECNICO_SUPERVISOR', 'operadores-cda'),
    ('TECNICO_SUPERVISOR', 'powerbi-cdas'),
    ('LECTOR', 'inicio'),
    ('LECTOR', 'recintos'),
    ('LECTOR', 'usuarios'),
    ('LECTOR', 'militares'),
    ('LECTOR', 'eventos'),
    ('LECTOR', 'asignaciones'),
    ('LECTOR', 'kits'),
    ('LECTOR', 'monitoreo'),
    ('LECTOR', 'incidencias'),
    ('LECTOR', 'cadena-custodia'),
    ('LECTOR', 'reportes'),
    ('LECTOR', 'powerbi-cdas'),
    ('ASISTENTE_TRANSVERSAL', 'operadores-cda'),
    ('ASISTENTE_TRANSVERSAL', 'cadena-custodia')
) AS d("rol", "modulo")
JOIN "roles" r ON r."nombre" = d."rol"
ON CONFLICT DO NOTHING;
