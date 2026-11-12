-- Permiso nuevo cda.evatics.ver (ver las fotos de los certificados sin poder
-- decidir). De fábrica, el técnico supervisor, solo si todavía puede aprobar o
-- rechazar (no se amplía lo que el administrador ya le quitó). No borra datos.
INSERT INTO "rol_permisos" ("rol_id", "permiso")
SELECT r."id", d."permiso"
FROM (VALUES
    ('TECNICO_SUPERVISOR', 'cda.evatics.ver')
) AS d("rol", "permiso")
JOIN "roles" r ON r."nombre" = d."rol"
WHERE EXISTS (
    SELECT 1 FROM "rol_permisos" rp WHERE rp."rol_id" = r."id" AND rp."permiso" = 'cda.evatics.revisar'
)
ON CONFLICT DO NOTHING;

-- Quien ya podía aprobar o rechazar (el administrador se lo dio a otro rol)
-- sigue viendo las fotos.
INSERT INTO "rol_permisos" ("rol_id", "permiso")
SELECT "rol_id", 'cda.evatics.ver' FROM "rol_permisos" WHERE "permiso" = 'cda.evatics.revisar'
ON CONFLICT DO NOTHING;
