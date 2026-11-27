-- Acción nueva: descargar el reporte del personal CDA/CPE (lleva cédulas).
-- De fábrica, los mismos roles que ven el listado. Debe coincidir con
-- `rolesPorDefecto` de PERMISOS (el analista provincial tiene todas).
INSERT INTO "rol_permisos" ("rol_id", "permiso")
SELECT r."id", d."permiso"
FROM (VALUES
    ('TECNICO_SUPERVISOR', 'cda.personal.exportar'),
    ('ASISTENTE_TRANSVERSAL', 'cda.personal.exportar'),
    ('ANALISTA_PROVINCIAL', 'cda.personal.exportar')
) AS d("rol", "permiso")
JOIN "roles" r ON r."nombre" = d."rol"
ON CONFLICT DO NOTHING;
