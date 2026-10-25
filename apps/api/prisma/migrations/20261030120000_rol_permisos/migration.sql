-- Acciones dentro de los módulos de la web, configurables por el administrador.
-- CreateTable
CREATE TABLE "rol_permisos" (
    "rol_id" UUID NOT NULL,
    "permiso" VARCHAR(40) NOT NULL,

    CONSTRAINT "rol_permisos_pkey" PRIMARY KEY ("rol_id","permiso")
);

-- AddForeignKey
ALTER TABLE "rol_permisos" ADD CONSTRAINT "rol_permisos_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Acciones de fábrica (lo que cada rol ya podía hacer), para que nada cambie
-- al desplegar. Debe coincidir con `rolesPorDefecto` de PERMISOS. Los roles
-- ya los asegura la migración rol_modulos.
INSERT INTO "rol_permisos" ("rol_id", "permiso")
SELECT r."id", d."permiso"
FROM (VALUES
    ('TECNICO_SUPERVISOR', 'cda.asistencia.marcar'),
    ('TECNICO_SUPERVISOR', 'cda.asistencia.qr'),
    ('TECNICO_SUPERVISOR', 'cda.asistencia.exportar'),
    ('TECNICO_SUPERVISOR', 'cda.actas.gestionar'),
    ('TECNICO_SUPERVISOR', 'cda.fotos.enlace'),
    ('ASISTENTE_TRANSVERSAL', 'cda.asistencia.marcar'),
    ('ASISTENTE_TRANSVERSAL', 'cda.asistencia.qr'),
    ('ASISTENTE_TRANSVERSAL', 'cda.asistencia.exportar'),
    ('ASISTENTE_TRANSVERSAL', 'cda.actas.gestionar'),
    ('ASISTENTE_TRANSVERSAL', 'cda.fotos.enlace')
) AS d("rol", "permiso")
JOIN "roles" r ON r."nombre" = d."rol"
ON CONFLICT DO NOTHING;
