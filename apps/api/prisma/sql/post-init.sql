-- =====================================================================
-- SQL complementario que Prisma no puede generar desde schema.prisma:
--  - DEFAULT uuid_generate_v4() a nivel DB para todas las PK UUID
--    (Prisma usa @default(uuid()) a nivel cliente; lo necesitamos a nivel
--    DB para que seeds e inserts SQL crudo funcionen)
--  - Constraint CHECK chk_cda_destino
--  - Índice único parcial: solo un evento ACTIVO a la vez
--  - Índices GIST para columnas GEOGRAPHY
--  - Trigger de inmutabilidad de la bitácora (HU17-CA3)
--
-- Se aplica después de la migración inicial generada por Prisma.
-- =====================================================================

-- DEFAULT uuid_generate_v4() para todas las tablas con PK UUID
ALTER TABLE usuarios               ALTER COLUMN id SET DEFAULT uuid_generate_v4();
ALTER TABLE roles                  ALTER COLUMN id SET DEFAULT uuid_generate_v4();
ALTER TABLE password_reset_tokens  ALTER COLUMN id SET DEFAULT uuid_generate_v4();
ALTER TABLE refresh_tokens         ALTER COLUMN id SET DEFAULT uuid_generate_v4();
ALTER TABLE dispositivos           ALTER COLUMN id SET DEFAULT uuid_generate_v4();
ALTER TABLE recintos               ALTER COLUMN id SET DEFAULT uuid_generate_v4();
ALTER TABLE militares              ALTER COLUMN id SET DEFAULT uuid_generate_v4();
ALTER TABLE eventos_electorales    ALTER COLUMN id SET DEFAULT uuid_generate_v4();
ALTER TABLE kits_electorales       ALTER COLUMN id SET DEFAULT uuid_generate_v4();
ALTER TABLE asignaciones_supervisor ALTER COLUMN id SET DEFAULT uuid_generate_v4();
ALTER TABLE eventos_tracking       ALTER COLUMN id SET DEFAULT uuid_generate_v4();
ALTER TABLE recepciones_kit        ALTER COLUMN id SET DEFAULT uuid_generate_v4();
ALTER TABLE incidencias            ALTER COLUMN id SET DEFAULT uuid_generate_v4();
ALTER TABLE incidencia_comentarios ALTER COLUMN id SET DEFAULT uuid_generate_v4();
ALTER TABLE alertas                ALTER COLUMN id SET DEFAULT uuid_generate_v4();
ALTER TABLE notificaciones         ALTER COLUMN id SET DEFAULT uuid_generate_v4();

-- HU20-CA2: Solo un evento electoral ACTIVO a la vez
CREATE UNIQUE INDEX IF NOT EXISTS uq_evento_activo
    ON eventos_electorales(estado)
    WHERE estado = 'ACTIVO';

-- Recintos NO_CDA pueden tener destino CDA; CDA nunca debe tener destino
ALTER TABLE recintos
    DROP CONSTRAINT IF EXISTS chk_cda_destino;
ALTER TABLE recintos
    ADD CONSTRAINT chk_cda_destino
    CHECK (tipo = 'NO_CDA' OR cda_destino_id IS NULL);

-- Índices GIST para consultas geoespaciales
CREATE INDEX IF NOT EXISTS idx_recintos_ubicacion
    ON recintos USING GIST (ubicacion);
CREATE INDEX IF NOT EXISTS idx_posiciones_ubicacion
    ON posiciones_gps USING GIST (ubicacion);

-- HU17-CA3: la bitácora es append-only
CREATE OR REPLACE FUNCTION fn_bitacora_inmutable() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'La bitácora de auditoría es inmutable: no se permite %', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bitacora_no_update ON bitacora_auditoria;
CREATE TRIGGER trg_bitacora_no_update
    BEFORE UPDATE OR DELETE ON bitacora_auditoria
    FOR EACH ROW EXECUTE FUNCTION fn_bitacora_inmutable();
