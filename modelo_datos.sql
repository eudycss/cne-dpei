-- =====================================================================
--  Sistema de Gestión de Trazabilidad y Logística Electoral
--  CNE — Delegación Provincial de Imbabura
--  Modelo de datos — PostgreSQL 16 + PostGIS 3.4
--  Versión 1.0
-- =====================================================================

-- Extensiones requeridas
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- =====================================================================
--  TIPOS ENUMERADOS (máquinas de estado del dominio)
-- =====================================================================
CREATE TYPE tipo_recinto         AS ENUM ('CDA', 'NO_CDA');
CREATE TYPE estado_evento        AS ENUM ('BORRADOR', 'ACTIVO', 'CERRADO');
CREATE TYPE tipo_evento_electoral AS ENUM ('ELECCION_GENERAL', 'SEGUNDA_VUELTA', 'CONSULTA_POPULAR', 'REFERENDUM', 'OTRO');
CREATE TYPE estado_kit           AS ENUM ('EN_BODEGA', 'ASIGNADO', 'ENTREGADO', 'EN_RECINTO', 'EN_RETORNO', 'RETORNADO');
CREATE TYPE tipo_tracking        AS ENUM ('SALIDA_DPI', 'LLEGADA_RECINTO', 'SALIDA_RECINTO', 'LLEGADA_DPI');
CREATE TYPE tipo_incidencia      AS ENUM ('KIT_DANADO', 'KIT_FALTANTE', 'PROBLEMA_RECINTO', 'RETRASO', 'PROBLEMA_SEGURIDAD', 'OTRO');
CREATE TYPE estado_incidencia    AS ENUM ('ABIERTA', 'ATENDIDA', 'CERRADA');
CREATE TYPE tipo_alerta          AS ENUM ('NO_LLEGO_RECINTO', 'NO_LLEGO_DPI', 'SIN_SINCRONIZAR', 'KIT_NO_CORRESPONDE');
CREATE TYPE estado_alerta        AS ENUM ('GENERADA', 'VISTA', 'ATENDIDA');
CREATE TYPE canal_notificacion   AS ENUM ('PUSH', 'EMAIL');
CREATE TYPE estado_notificacion  AS ENUM ('ENCOLADA', 'ENVIADA', 'ENTREGADA', 'FALLIDA');
CREATE TYPE plataforma_disp      AS ENUM ('ANDROID', 'IOS');

-- =====================================================================
--  IDENTIDAD Y ACCESO  (HU1, HU7, HU9, HU16)
-- =====================================================================
CREATE TABLE usuarios (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cedula           VARCHAR(10)  NOT NULL UNIQUE,
    email            VARCHAR(255) NOT NULL UNIQUE,
    nombres          VARCHAR(120) NOT NULL,
    apellidos        VARCHAR(120) NOT NULL,
    telefono         VARCHAR(20),
    password_hash    VARCHAR(255) NOT NULL,
    debe_cambiar_pwd BOOLEAN      NOT NULL DEFAULT TRUE,   -- HU1-CA3
    activo           BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    actualizado_en   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE roles (
    id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre VARCHAR(40) NOT NULL UNIQUE   -- ADMINISTRADOR, TECNICO_SUPERVISOR, OPERADOR_CDA
);

CREATE TABLE usuario_roles (
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    rol_id     UUID NOT NULL REFERENCES roles(id)    ON DELETE CASCADE,
    PRIMARY KEY (usuario_id, rol_id)
);

-- Tokens de recuperación de contraseña (HU16)
CREATE TABLE password_reset_tokens (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    token_hash  VARCHAR(255) NOT NULL,
    expira_en   TIMESTAMPTZ  NOT NULL,         -- vigencia 1 hora (HU16-CA3)
    usado       BOOLEAN      NOT NULL DEFAULT FALSE,
    creado_en   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_reset_tokens_usuario ON password_reset_tokens(usuario_id);

-- Dispositivos para push notifications (HU19)
CREATE TABLE dispositivos (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    fcm_token   VARCHAR(512) NOT NULL,
    plataforma  plataforma_disp NOT NULL,
    activo      BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (fcm_token)
);

-- =====================================================================
--  GEOGRAFÍA ELECTORAL  (datos precargados desde Excel oficial del CNE)
-- =====================================================================
CREATE TABLE cantones (
    id     SERIAL PRIMARY KEY,
    codigo VARCHAR(10) NOT NULL UNIQUE,
    nombre VARCHAR(80) NOT NULL
);

CREATE TABLE recintos (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo_recinto   VARCHAR(20)  NOT NULL UNIQUE,
    nombre           VARCHAR(255) NOT NULL,
    direccion        VARCHAR(255),
    canton_id        INT          NOT NULL REFERENCES cantones(id),
    parroquia        VARCHAR(120),
    zona             VARCHAR(120),
    tipo             tipo_recinto NOT NULL,
    -- Auto-referencia: un recinto NO_CDA traslada sus actas a un recinto CDA
    cda_destino_id   UUID         REFERENCES recintos(id),
    ubicacion        GEOGRAPHY(POINT, 4326) NOT NULL,   -- lat/long del Excel
    tiene_internet   BOOLEAN      NOT NULL DEFAULT FALSE,
    cobertura_movil  BOOLEAN      NOT NULL DEFAULT FALSE,
    distancia_dpi_km NUMERIC(6,2),                       -- alimenta umbrales HU18
    tiempo_dpi_min   INT,
    numero_electores INT,
    es_dificil_acceso BOOLEAN     NOT NULL DEFAULT FALSE,
    -- Un recinto CDA no traslada (destino NULL). Un NO_CDA traslada a un
    -- recinto CDA, o excepcionalmente directo al DPI (destino NULL).
    CONSTRAINT chk_cda_destino CHECK (
        tipo = 'NO_CDA' OR cda_destino_id IS NULL
    )
);
CREATE INDEX idx_recintos_canton    ON recintos(canton_id);
CREATE INDEX idx_recintos_tipo      ON recintos(tipo);
CREATE INDEX idx_recintos_ubicacion ON recintos USING GIST (ubicacion);

-- Militares: registro únicamente referencial (no operan la app)  (HU8)
CREATE TABLE militares (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cedula      VARCHAR(10)  NOT NULL,
    nombres     VARCHAR(120) NOT NULL,
    apellidos   VARCHAR(120) NOT NULL,
    recinto_id  UUID NOT NULL REFERENCES recintos(id),
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_militares_recinto ON militares(recinto_id);

-- =====================================================================
--  EVENTOS ELECTORALES  (HU20)
-- =====================================================================
CREATE TABLE eventos_electorales (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre        VARCHAR(160) NOT NULL,
    tipo          tipo_evento_electoral NOT NULL,
    fecha_jornada DATE         NOT NULL,
    descripcion   TEXT,
    estado        estado_evento NOT NULL DEFAULT 'BORRADOR',
    creado_en     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    cerrado_en    TIMESTAMPTZ
);
-- Solo un evento ACTIVO a la vez (HU20-CA2)
CREATE UNIQUE INDEX uq_evento_activo ON eventos_electorales(estado) WHERE estado = 'ACTIVO';

-- Configuración de umbrales de alertas por evento (HU18-CA6)
CREATE TABLE config_alertas (
    evento_id                 UUID PRIMARY KEY REFERENCES eventos_electorales(id) ON DELETE CASCADE,
    umbral_llegada_recinto_min INT NOT NULL DEFAULT 120,
    umbral_llegada_dpi_min     INT NOT NULL DEFAULT 120,
    umbral_sin_sync_min        INT NOT NULL DEFAULT 30
);

-- =====================================================================
--  KITS ELECTORALES  (HU11, HU12)
-- =====================================================================
CREATE TABLE kits_electorales (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    evento_id     UUID NOT NULL REFERENCES eventos_electorales(id),
    codigo_unico  VARCHAR(40)  NOT NULL,
    qr_payload    VARCHAR(255) NOT NULL,
    nombre        VARCHAR(160) NOT NULL,
    contenidos    TEXT,
    -- Asignaciones (HU12): un kit pertenece a un recinto y a un operador
    recinto_id    UUID REFERENCES recintos(id),
    operador_id   UUID REFERENCES usuarios(id),
    estado        estado_kit NOT NULL DEFAULT 'EN_BODEGA',
    creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Código único dentro de un evento (HU11-CA5)
    UNIQUE (evento_id, codigo_unico)
);
CREATE INDEX idx_kits_evento   ON kits_electorales(evento_id);
CREATE INDEX idx_kits_recinto  ON kits_electorales(recinto_id);
CREATE INDEX idx_kits_operador ON kits_electorales(operador_id);

-- =====================================================================
--  ASIGNACIONES OPERADOR ↔ SUPERVISOR  (HU10)
-- =====================================================================
CREATE TABLE asignaciones_supervisor (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    evento_id     UUID NOT NULL REFERENCES eventos_electorales(id),
    operador_id   UUID NOT NULL REFERENCES usuarios(id),
    supervisor_id UUID NOT NULL REFERENCES usuarios(id),
    creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Un operador no puede tener dos supervisores en el mismo evento (HU10-CA2)
    UNIQUE (evento_id, operador_id)
);

-- =====================================================================
--  TRACKING DEL DÍA ELECTORAL  (HU2-HU6)
-- =====================================================================
-- Eventos discretos de salida/llegada (4 hitos del recorrido)
CREATE TABLE eventos_tracking (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    evento_id     UUID NOT NULL REFERENCES eventos_electorales(id),
    operador_id   UUID NOT NULL REFERENCES usuarios(id),
    tipo          tipo_tracking NOT NULL,
    recinto_id    UUID REFERENCES recintos(id),
    ubicacion     GEOGRAPHY(POINT, 4326),
    ocurrido_en   TIMESTAMPTZ NOT NULL,
    desde_offline BOOLEAN NOT NULL DEFAULT FALSE,   -- sincronizado offline (HU13)
    registrado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tracking_operador ON eventos_tracking(operador_id, evento_id);
CREATE INDEX idx_tracking_tipo     ON eventos_tracking(tipo);

-- Recepción de kits en el recinto (HU3): foto del militar + escaneo
CREATE TABLE recepciones_kit (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kit_id        UUID NOT NULL REFERENCES kits_electorales(id),
    operador_id   UUID NOT NULL REFERENCES usuarios(id),
    militar_id    UUID REFERENCES militares(id),
    foto_militar_url VARCHAR(512),                  -- evidencia cifrada (HU3-CA2)
    ubicacion     GEOGRAPHY(POINT, 4326),
    confirmado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    desde_offline BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_recepciones_kit ON recepciones_kit(kit_id);

-- Rastreo GPS continuo (solo en retorno recinto → DPI, HU4/HU6)
-- Tabla append-only de alta frecuencia
CREATE TABLE posiciones_gps (
    id           BIGSERIAL PRIMARY KEY,
    operador_id  UUID NOT NULL REFERENCES usuarios(id),
    evento_id    UUID NOT NULL REFERENCES eventos_electorales(id),
    ubicacion    GEOGRAPHY(POINT, 4326) NOT NULL,
    capturado_en TIMESTAMPTZ NOT NULL,
    recibido_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_posiciones_operador ON posiciones_gps(operador_id, capturado_en);
CREATE INDEX idx_posiciones_ubicacion ON posiciones_gps USING GIST (ubicacion);

-- =====================================================================
--  INCIDENCIAS  (HU14)
-- =====================================================================
CREATE TABLE incidencias (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    evento_id     UUID NOT NULL REFERENCES eventos_electorales(id),
    operador_id   UUID NOT NULL REFERENCES usuarios(id),
    recinto_id    UUID REFERENCES recintos(id),
    kit_id        UUID REFERENCES kits_electorales(id),
    tipo          tipo_incidencia NOT NULL,
    descripcion   TEXT,
    foto_url      VARCHAR(512),
    ubicacion     GEOGRAPHY(POINT, 4326),
    estado        estado_incidencia NOT NULL DEFAULT 'ABIERTA',
    reportado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    desde_offline BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_incidencias_evento ON incidencias(evento_id);
CREATE INDEX idx_incidencias_estado ON incidencias(estado);

CREATE TABLE incidencia_comentarios (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incidencia_id UUID NOT NULL REFERENCES incidencias(id) ON DELETE CASCADE,
    usuario_id    UUID NOT NULL REFERENCES usuarios(id),
    comentario    TEXT NOT NULL,
    creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
--  ALERTAS AUTOMÁTICAS  (HU18)
-- =====================================================================
CREATE TABLE alertas (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    evento_id    UUID NOT NULL REFERENCES eventos_electorales(id),
    operador_id  UUID REFERENCES usuarios(id),
    kit_id       UUID REFERENCES kits_electorales(id),
    tipo         tipo_alerta  NOT NULL,
    mensaje      VARCHAR(255) NOT NULL,
    estado       estado_alerta NOT NULL DEFAULT 'GENERADA',
    generada_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_alertas_evento ON alertas(evento_id, estado);

-- =====================================================================
--  NOTIFICACIONES  (HU19)
-- =====================================================================
CREATE TABLE preferencias_notificacion (
    usuario_id   UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo_evento  VARCHAR(60) NOT NULL,   -- SALIDA_DPI, LLEGADA_RECINTO, INCIDENCIA, ALERTA, ...
    por_push     BOOLEAN NOT NULL DEFAULT TRUE,
    por_email    BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (usuario_id, tipo_evento)
);

CREATE TABLE notificaciones (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id   UUID NOT NULL REFERENCES usuarios(id),
    tipo_evento  VARCHAR(60) NOT NULL,
    canal        canal_notificacion NOT NULL,
    estado       estado_notificacion NOT NULL DEFAULT 'ENCOLADA',
    intentos     INT NOT NULL DEFAULT 0,           -- hasta 3 reintentos (HU19-CA7)
    payload      JSONB,
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
    enviado_en   TIMESTAMPTZ
);
CREATE INDEX idx_notificaciones_usuario ON notificaciones(usuario_id);

-- =====================================================================
--  BITÁCORA DE AUDITORÍA  (HU17) — tabla append-only, inmutable
-- =====================================================================
CREATE TABLE bitacora_auditoria (
    id            BIGSERIAL PRIMARY KEY,
    usuario_id    UUID REFERENCES usuarios(id),
    accion        VARCHAR(80) NOT NULL,
    entidad       VARCHAR(60),
    entidad_id    VARCHAR(60),
    datos_antes   JSONB,
    datos_despues JSONB,
    dispositivo   VARCHAR(160),
    ip            INET,
    ubicacion     GEOGRAPHY(POINT, 4326),
    ocurrido_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bitacora_usuario  ON bitacora_auditoria(usuario_id);
CREATE INDEX idx_bitacora_entidad  ON bitacora_auditoria(entidad, entidad_id);
CREATE INDEX idx_bitacora_fecha    ON bitacora_auditoria(ocurrido_en);

-- Trigger que impide UPDATE/DELETE sobre la bitácora (inmutabilidad, HU17-CA3)
CREATE OR REPLACE FUNCTION fn_bitacora_inmutable() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'La bitácora de auditoría es inmutable: no se permite % ', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bitacora_no_update
    BEFORE UPDATE OR DELETE ON bitacora_auditoria
    FOR EACH ROW EXECUTE FUNCTION fn_bitacora_inmutable();

-- =====================================================================
--  DATOS SEMILLA: roles base
-- =====================================================================
INSERT INTO roles (nombre) VALUES
    ('ADMINISTRADOR'),
    ('TECNICO_SUPERVISOR'),
    ('OPERADOR_CDA');

-- Cantones de Imbabura (precargados desde el Excel oficial)
INSERT INTO cantones (codigo, nombre) VALUES
    ('30', 'IBARRA'),
    ('35', 'OTAVALO'),
    ('40', 'COTACACHI'),
    ('45', 'ANTONIO ANTE'),
    ('50', 'PIMAMPIRO'),
    ('55', 'URCUQUI');

-- Nota: los 137 recintos se cargan mediante el seed generado a partir
-- del archivo RECINTOS_Y_RUTAS_2026.xlsx (ver seed_recintos.sql).
