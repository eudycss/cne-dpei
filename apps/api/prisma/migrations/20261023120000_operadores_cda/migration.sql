-- Operadores CDA: personal de los Centros de Digitalización de Actas,
-- su asistencia diaria, enlaces de foto y actas de entrega de indumentaria.
-- CreateEnum
CREATE TYPE "estado_prenda" AS ENUM ('NUEVO', 'BUENO', 'REGULAR', 'MALO');

-- CreateEnum
CREATE TYPE "estado_acta_cda" AS ENUM ('GENERADA', 'FIRMADA');

-- CreateTable
CREATE TABLE "operadores_cda" (
    "id" UUID NOT NULL,
    "numero" INTEGER,
    "apellidos_nombres" VARCHAR(200) NOT NULL,
    "cedula" VARCHAR(10) NOT NULL,
    "telefono" VARCHAR(20),
    "cargo" VARCHAR(160) NOT NULL,
    "unidad" VARCHAR(200),
    "fecha_inicio" DATE,
    "foto_key" VARCHAR(255),
    "foto_subida_en" TIMESTAMPTZ(6),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operadores_cda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asistencias_cda" (
    "id" UUID NOT NULL,
    "operador_id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "entrada_en" TIMESTAMPTZ(6),
    "entrada_por_id" UUID,
    "salida_en" TIMESTAMPTZ(6),
    "salida_por_id" UUID,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asistencias_cda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enlaces_foto_cda" (
    "id" UUID NOT NULL,
    "operador_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expira_en" TIMESTAMPTZ(6) NOT NULL,
    "usado_en" TIMESTAMPTZ(6),
    "creado_por_id" UUID,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enlaces_foto_cda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "actas_entrega_cda" (
    "id" UUID NOT NULL,
    "operador_id" UUID NOT NULL,
    "entrega_por_id" UUID,
    "entrega_nombre" VARCHAR(200) NOT NULL,
    "entrega_cedula" VARCHAR(10) NOT NULL,
    "entrega_cargo" VARCHAR(160) NOT NULL,
    "lugar" VARCHAR(80) NOT NULL DEFAULT 'Ibarra',
    "fecha" DATE NOT NULL,
    "estado_peto" "estado_prenda" NOT NULL,
    "estado_credencial" "estado_prenda" NOT NULL,
    "estado_cordon" "estado_prenda" NOT NULL,
    "estado" "estado_acta_cda" NOT NULL DEFAULT 'GENERADA',
    "firmada_en" TIMESTAMPTZ(6),
    "creado_por_id" UUID,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "actas_entrega_cda_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "operadores_cda_cedula_key" ON "operadores_cda"("cedula");

-- CreateIndex
CREATE INDEX "idx_asistencias_cda_fecha" ON "asistencias_cda"("fecha");

-- CreateIndex
CREATE UNIQUE INDEX "uq_asistencias_cda_operador_fecha" ON "asistencias_cda"("operador_id", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "enlaces_foto_cda_token_hash_key" ON "enlaces_foto_cda"("token_hash");

-- CreateIndex
CREATE INDEX "idx_enlaces_foto_cda_operador" ON "enlaces_foto_cda"("operador_id");

-- CreateIndex
CREATE INDEX "idx_actas_entrega_cda_operador" ON "actas_entrega_cda"("operador_id");

-- AddForeignKey
ALTER TABLE "asistencias_cda" ADD CONSTRAINT "asistencias_cda_operador_id_fkey" FOREIGN KEY ("operador_id") REFERENCES "operadores_cda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asistencias_cda" ADD CONSTRAINT "asistencias_cda_entrada_por_id_fkey" FOREIGN KEY ("entrada_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asistencias_cda" ADD CONSTRAINT "asistencias_cda_salida_por_id_fkey" FOREIGN KEY ("salida_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enlaces_foto_cda" ADD CONSTRAINT "enlaces_foto_cda_operador_id_fkey" FOREIGN KEY ("operador_id") REFERENCES "operadores_cda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enlaces_foto_cda" ADD CONSTRAINT "enlaces_foto_cda_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actas_entrega_cda" ADD CONSTRAINT "actas_entrega_cda_operador_id_fkey" FOREIGN KEY ("operador_id") REFERENCES "operadores_cda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actas_entrega_cda" ADD CONSTRAINT "actas_entrega_cda_entrega_por_id_fkey" FOREIGN KEY ("entrega_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actas_entrega_cda" ADD CONSTRAINT "actas_entrega_cda_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

