-- Rol ANALISTA_PROVINCIAL: como el administrador de fábrica (ve y hace todo,
-- salvo lo exclusivo del administrador: cuentas, roles y permisos). El
-- administrador le quita módulos y acciones en "Módulos por rol". No mueve a
-- nadie de rol: asignarlo a las cuentas es un paso aparte.
INSERT INTO "roles" ("id", "nombre")
SELECT gen_random_uuid(), 'ANALISTA_PROVINCIAL'
WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE "nombre" = 'ANALISTA_PROVINCIAL');

-- Todos los módulos y todas las acciones de fábrica.
INSERT INTO "rol_modulos" ("rol_id", "modulo")
SELECT r."id", d."modulo"
FROM (VALUES
    ('ANALISTA_PROVINCIAL', 'inicio'),
    ('ANALISTA_PROVINCIAL', 'recintos'),
    ('ANALISTA_PROVINCIAL', 'usuarios'),
    ('ANALISTA_PROVINCIAL', 'militares'),
    ('ANALISTA_PROVINCIAL', 'eventos'),
    ('ANALISTA_PROVINCIAL', 'asignaciones'),
    ('ANALISTA_PROVINCIAL', 'kits'),
    ('ANALISTA_PROVINCIAL', 'monitoreo'),
    ('ANALISTA_PROVINCIAL', 'incidencias'),
    ('ANALISTA_PROVINCIAL', 'alertas'),
    ('ANALISTA_PROVINCIAL', 'operadores-cda'),
    ('ANALISTA_PROVINCIAL', 'simulador-digitacion'),
    ('ANALISTA_PROVINCIAL', 'cadena-custodia'),
    ('ANALISTA_PROVINCIAL', 'reportes'),
    ('ANALISTA_PROVINCIAL', 'powerbi-cdas')
) AS d("rol", "modulo")
JOIN "roles" r ON r."nombre" = d."rol"
ON CONFLICT DO NOTHING;

INSERT INTO "rol_permisos" ("rol_id", "permiso")
SELECT r."id", d."permiso"
FROM (VALUES
    ('ANALISTA_PROVINCIAL', 'cda.asistencia.marcar'),
    ('ANALISTA_PROVINCIAL', 'cda.asistencia.qr'),
    ('ANALISTA_PROVINCIAL', 'cda.asistencia.exportar'),
    ('ANALISTA_PROVINCIAL', 'cda.asistencia.corregir'),
    ('ANALISTA_PROVINCIAL', 'cda.actas.gestionar'),
    ('ANALISTA_PROVINCIAL', 'cda.fotos.enlace'),
    ('ANALISTA_PROVINCIAL', 'cda.carnets.emitir'),
    ('ANALISTA_PROVINCIAL', 'cda.carnets.reimprimir'),
    ('ANALISTA_PROVINCIAL', 'cda.convocatoria.gestionar'),
    ('ANALISTA_PROVINCIAL', 'cda.evatics.ver'),
    ('ANALISTA_PROVINCIAL', 'cda.evatics.revisar')
) AS d("rol", "permiso")
JOIN "roles" r ON r."nombre" = d."rol"
ON CONFLICT DO NOTHING;
