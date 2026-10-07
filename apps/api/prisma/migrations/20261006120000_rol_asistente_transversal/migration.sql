-- Rol del Asistente Electoral Transversal: custodia de los kits en el DPEI
-- (entrega al militar y verificación al retorno). Se inserta aquí y no solo en
-- el seed para que producción lo tenga al aplicar las migraciones.
INSERT INTO "roles" ("id", "nombre")
VALUES (gen_random_uuid(), 'ASISTENTE_TRANSVERSAL')
ON CONFLICT ("nombre") DO NOTHING;
