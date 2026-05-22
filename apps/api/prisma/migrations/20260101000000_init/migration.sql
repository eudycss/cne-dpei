-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateEnum
CREATE TYPE "tipo_recinto" AS ENUM ('CDA', 'NO_CDA');

-- CreateEnum
CREATE TYPE "estado_evento" AS ENUM ('BORRADOR', 'ACTIVO', 'CERRADO');

-- CreateEnum
CREATE TYPE "tipo_evento_electoral" AS ENUM ('ELECCION_GENERAL', 'SEGUNDA_VUELTA', 'CONSULTA_POPULAR', 'REFERENDUM', 'OTRO');

-- CreateEnum
CREATE TYPE "estado_kit" AS ENUM ('EN_BODEGA', 'ASIGNADO', 'ENTREGADO', 'EN_RECINTO', 'EN_RETORNO', 'RETORNADO');

-- CreateEnum
CREATE TYPE "tipo_tracking" AS ENUM ('SALIDA_DPI', 'LLEGADA_RECINTO', 'SALIDA_RECINTO', 'LLEGADA_DPI');

-- CreateEnum
CREATE TYPE "tipo_incidencia" AS ENUM ('KIT_DANADO', 'KIT_FALTANTE', 'PROBLEMA_RECINTO', 'RETRASO', 'PROBLEMA_SEGURIDAD', 'OTRO');

-- CreateEnum
CREATE TYPE "estado_incidencia" AS ENUM ('ABIERTA', 'ATENDIDA', 'CERRADA');

-- CreateEnum
CREATE TYPE "tipo_alerta" AS ENUM ('NO_LLEGO_RECINTO', 'NO_LLEGO_DPI', 'SIN_SINCRONIZAR', 'KIT_NO_CORRESPONDE');

-- CreateEnum
CREATE TYPE "estado_alerta" AS ENUM ('GENERADA', 'VISTA', 'ATENDIDA');

-- CreateEnum
CREATE TYPE "canal_notificacion" AS ENUM ('PUSH', 'EMAIL');

-- CreateEnum
CREATE TYPE "estado_notificacion" AS ENUM ('ENCOLADA', 'ENVIADA', 'ENTREGADA', 'FALLIDA');

-- CreateEnum
CREATE TYPE "plataforma_disp" AS ENUM ('ANDROID', 'IOS');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL,
    "cedula" VARCHAR(10) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "nombres" VARCHAR(120) NOT NULL,
    "apellidos" VARCHAR(120) NOT NULL,
    "telefono" VARCHAR(20),
    "password_hash" VARCHAR(255) NOT NULL,
    "debe_cambiar_pwd" BOOLEAN NOT NULL DEFAULT true,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(40) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario_roles" (
    "usuario_id" UUID NOT NULL,
    "rol_id" UUID NOT NULL,

    CONSTRAINT "usuario_roles_pkey" PRIMARY KEY ("usuario_id","rol_id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expira_en" TIMESTAMPTZ(6) NOT NULL,
    "usado" BOOLEAN NOT NULL DEFAULT false,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "jti" VARCHAR(64) NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expira_en" TIMESTAMPTZ(6) NOT NULL,
    "revocado_en" TIMESTAMPTZ(6),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispositivos" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "fcm_token" VARCHAR(512) NOT NULL,
    "plataforma" "plataforma_disp" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispositivos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cantones" (
    "id" SERIAL NOT NULL,
    "codigo" VARCHAR(10) NOT NULL,
    "nombre" VARCHAR(80) NOT NULL,

    CONSTRAINT "cantones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recintos" (
    "id" UUID NOT NULL,
    "codigo_recinto" VARCHAR(20) NOT NULL,
    "nombre" VARCHAR(255) NOT NULL,
    "direccion" VARCHAR(255),
    "canton_id" INTEGER NOT NULL,
    "parroquia" VARCHAR(120),
    "zona" VARCHAR(120),
    "tipo" "tipo_recinto" NOT NULL,
    "cda_destino_id" UUID,
    "ubicacion" geography(Point,4326) NOT NULL,
    "tiene_internet" BOOLEAN NOT NULL DEFAULT false,
    "cobertura_movil" BOOLEAN NOT NULL DEFAULT false,
    "distancia_dpi_km" DECIMAL(6,2),
    "tiempo_dpi_min" INTEGER,
    "numero_electores" INTEGER,
    "es_dificil_acceso" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "recintos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "militares" (
    "id" UUID NOT NULL,
    "cedula" VARCHAR(10) NOT NULL,
    "nombres" VARCHAR(120) NOT NULL,
    "apellidos" VARCHAR(120) NOT NULL,
    "recinto_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "militares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_electorales" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(160) NOT NULL,
    "tipo" "tipo_evento_electoral" NOT NULL,
    "fecha_jornada" DATE NOT NULL,
    "descripcion" TEXT,
    "estado" "estado_evento" NOT NULL DEFAULT 'BORRADOR',
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerrado_en" TIMESTAMPTZ(6),

    CONSTRAINT "eventos_electorales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_alertas" (
    "evento_id" UUID NOT NULL,
    "umbral_llegada_recinto_min" INTEGER NOT NULL DEFAULT 120,
    "umbral_llegada_dpi_min" INTEGER NOT NULL DEFAULT 120,
    "umbral_sin_sync_min" INTEGER NOT NULL DEFAULT 30,

    CONSTRAINT "config_alertas_pkey" PRIMARY KEY ("evento_id")
);

-- CreateTable
CREATE TABLE "kits_electorales" (
    "id" UUID NOT NULL,
    "evento_id" UUID NOT NULL,
    "codigo_unico" VARCHAR(40) NOT NULL,
    "qr_payload" VARCHAR(255) NOT NULL,
    "nombre" VARCHAR(160) NOT NULL,
    "contenidos" TEXT,
    "recinto_id" UUID,
    "operador_id" UUID,
    "estado" "estado_kit" NOT NULL DEFAULT 'EN_BODEGA',
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kits_electorales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asignaciones_supervisor" (
    "id" UUID NOT NULL,
    "evento_id" UUID NOT NULL,
    "operador_id" UUID NOT NULL,
    "supervisor_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asignaciones_supervisor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_tracking" (
    "id" UUID NOT NULL,
    "evento_id" UUID NOT NULL,
    "operador_id" UUID NOT NULL,
    "tipo" "tipo_tracking" NOT NULL,
    "recinto_id" UUID,
    "ubicacion" geography(Point,4326),
    "ocurrido_en" TIMESTAMPTZ(6) NOT NULL,
    "desde_offline" BOOLEAN NOT NULL DEFAULT false,
    "registrado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recepciones_kit" (
    "id" UUID NOT NULL,
    "kit_id" UUID NOT NULL,
    "operador_id" UUID NOT NULL,
    "militar_id" UUID,
    "foto_militar_url" VARCHAR(512),
    "ubicacion" geography(Point,4326),
    "confirmado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "desde_offline" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "recepciones_kit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posiciones_gps" (
    "id" BIGSERIAL NOT NULL,
    "operador_id" UUID NOT NULL,
    "evento_id" UUID NOT NULL,
    "ubicacion" geography(Point,4326) NOT NULL,
    "capturado_en" TIMESTAMPTZ(6) NOT NULL,
    "recibido_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posiciones_gps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidencias" (
    "id" UUID NOT NULL,
    "evento_id" UUID NOT NULL,
    "operador_id" UUID NOT NULL,
    "recinto_id" UUID,
    "kit_id" UUID,
    "tipo" "tipo_incidencia" NOT NULL,
    "descripcion" TEXT,
    "foto_url" VARCHAR(512),
    "ubicacion" geography(Point,4326),
    "estado" "estado_incidencia" NOT NULL DEFAULT 'ABIERTA',
    "reportado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "desde_offline" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "incidencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidencia_comentarios" (
    "id" UUID NOT NULL,
    "incidencia_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "comentario" TEXT NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incidencia_comentarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alertas" (
    "id" UUID NOT NULL,
    "evento_id" UUID NOT NULL,
    "operador_id" UUID,
    "kit_id" UUID,
    "tipo" "tipo_alerta" NOT NULL,
    "mensaje" VARCHAR(255) NOT NULL,
    "estado" "estado_alerta" NOT NULL DEFAULT 'GENERADA',
    "generada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alertas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preferencias_notificacion" (
    "usuario_id" UUID NOT NULL,
    "tipo_evento" VARCHAR(60) NOT NULL,
    "por_push" BOOLEAN NOT NULL DEFAULT true,
    "por_email" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "preferencias_notificacion_pkey" PRIMARY KEY ("usuario_id","tipo_evento")
);

-- CreateTable
CREATE TABLE "notificaciones" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "tipo_evento" VARCHAR(60) NOT NULL,
    "canal" "canal_notificacion" NOT NULL,
    "estado" "estado_notificacion" NOT NULL DEFAULT 'ENCOLADA',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviado_en" TIMESTAMPTZ(6),

    CONSTRAINT "notificaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bitacora_auditoria" (
    "id" BIGSERIAL NOT NULL,
    "usuario_id" UUID,
    "accion" VARCHAR(80) NOT NULL,
    "entidad" VARCHAR(60),
    "entidad_id" VARCHAR(60),
    "datos_antes" JSONB,
    "datos_despues" JSONB,
    "dispositivo" VARCHAR(160),
    "ip" INET,
    "ubicacion" geography(Point,4326),
    "ocurrido_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bitacora_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_cedula_key" ON "usuarios"("cedula");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_nombre_key" ON "roles"("nombre");

-- CreateIndex
CREATE INDEX "idx_reset_tokens_usuario" ON "password_reset_tokens"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_jti_key" ON "refresh_tokens"("jti");

-- CreateIndex
CREATE INDEX "refresh_tokens_usuario_id_idx" ON "refresh_tokens"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "dispositivos_fcm_token_key" ON "dispositivos"("fcm_token");

-- CreateIndex
CREATE UNIQUE INDEX "cantones_codigo_key" ON "cantones"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "recintos_codigo_recinto_key" ON "recintos"("codigo_recinto");

-- CreateIndex
CREATE INDEX "idx_recintos_canton" ON "recintos"("canton_id");

-- CreateIndex
CREATE INDEX "idx_recintos_tipo" ON "recintos"("tipo");

-- CreateIndex
CREATE INDEX "idx_militares_recinto" ON "militares"("recinto_id");

-- CreateIndex
CREATE INDEX "idx_kits_evento" ON "kits_electorales"("evento_id");

-- CreateIndex
CREATE INDEX "idx_kits_recinto" ON "kits_electorales"("recinto_id");

-- CreateIndex
CREATE INDEX "idx_kits_operador" ON "kits_electorales"("operador_id");

-- CreateIndex
CREATE UNIQUE INDEX "kits_electorales_evento_id_codigo_unico_key" ON "kits_electorales"("evento_id", "codigo_unico");

-- CreateIndex
CREATE UNIQUE INDEX "asignaciones_supervisor_evento_id_operador_id_key" ON "asignaciones_supervisor"("evento_id", "operador_id");

-- CreateIndex
CREATE INDEX "idx_tracking_operador" ON "eventos_tracking"("operador_id", "evento_id");

-- CreateIndex
CREATE INDEX "idx_tracking_tipo" ON "eventos_tracking"("tipo");

-- CreateIndex
CREATE INDEX "idx_recepciones_kit" ON "recepciones_kit"("kit_id");

-- CreateIndex
CREATE INDEX "idx_posiciones_operador" ON "posiciones_gps"("operador_id", "capturado_en");

-- CreateIndex
CREATE INDEX "idx_incidencias_evento" ON "incidencias"("evento_id");

-- CreateIndex
CREATE INDEX "idx_incidencias_estado" ON "incidencias"("estado");

-- CreateIndex
CREATE INDEX "idx_alertas_evento" ON "alertas"("evento_id", "estado");

-- CreateIndex
CREATE INDEX "idx_notificaciones_usuario" ON "notificaciones"("usuario_id");

-- CreateIndex
CREATE INDEX "idx_bitacora_usuario" ON "bitacora_auditoria"("usuario_id");

-- CreateIndex
CREATE INDEX "idx_bitacora_entidad" ON "bitacora_auditoria"("entidad", "entidad_id");

-- CreateIndex
CREATE INDEX "idx_bitacora_fecha" ON "bitacora_auditoria"("ocurrido_en");

-- AddForeignKey
ALTER TABLE "usuario_roles" ADD CONSTRAINT "usuario_roles_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_roles" ADD CONSTRAINT "usuario_roles_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispositivos" ADD CONSTRAINT "dispositivos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recintos" ADD CONSTRAINT "recintos_canton_id_fkey" FOREIGN KEY ("canton_id") REFERENCES "cantones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recintos" ADD CONSTRAINT "recintos_cda_destino_id_fkey" FOREIGN KEY ("cda_destino_id") REFERENCES "recintos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "militares" ADD CONSTRAINT "militares_recinto_id_fkey" FOREIGN KEY ("recinto_id") REFERENCES "recintos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidencia_comentarios" ADD CONSTRAINT "incidencia_comentarios_incidencia_id_fkey" FOREIGN KEY ("incidencia_id") REFERENCES "incidencias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
