-- Simulador de digitación de actas (práctica tipo SIER). Solo tablas nuevas:
-- ninguna fila existente cambia.
-- CreateTable
CREATE TABLE "practicas_digitacion" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "filas_por_acta" INTEGER NOT NULL,
    "voto_min" INTEGER NOT NULL,
    "voto_max" INTEGER NOT NULL,
    "meta_actas" INTEGER NOT NULL,
    "plazo_minutos" INTEGER NOT NULL,
    "inicio" TIMESTAMPTZ(6) NOT NULL,
    "fin" TIMESTAMPTZ(6) NOT NULL,
    "pct_digitos_distintos" INTEGER NOT NULL DEFAULT 0,
    "intentos_max" INTEGER NOT NULL DEFAULT 1,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practicas_digitacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practica_digitacion_cargos" (
    "practica_id" UUID NOT NULL,
    "cargo" VARCHAR(40) NOT NULL,

    CONSTRAINT "practica_digitacion_cargos_pkey" PRIMARY KEY ("practica_id","cargo")
);

-- CreateTable
CREATE TABLE "practica_digitacion_personas" (
    "practica_id" UUID NOT NULL,
    "operador_id" UUID NOT NULL,
    "incluida" BOOLEAN NOT NULL,

    CONSTRAINT "practica_digitacion_personas_pkey" PRIMARY KEY ("practica_id","operador_id")
);

-- CreateTable
CREATE TABLE "intentos_digitacion" (
    "id" UUID NOT NULL,
    "practica_id" UUID NOT NULL,
    "operador_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "cargo" VARCHAR(80) NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "iniciado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vence_en" TIMESTAMPTZ(6) NOT NULL,
    "terminado_en" TIMESTAMPTZ(6),
    "ultima_actividad_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actas_completadas" INTEGER NOT NULL DEFAULT 0,
    "actas_perfectas" INTEGER NOT NULL DEFAULT 0,
    "filas_fallidas" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "intentos_digitacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "actas_digitacion" (
    "id" UUID NOT NULL,
    "intento_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "valores" INTEGER[],
    "digitos" INTEGER[],
    "primer_guardado" INTEGER[],
    "filas_fallidas" INTEGER,
    "guardados" INTEGER NOT NULL DEFAULT 0,
    "entregada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completada_en" TIMESTAMPTZ(6),

    CONSTRAINT "actas_digitacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "novedades_digitacion" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL,

    CONSTRAINT "novedades_digitacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "practica_digitacion_personas_operador_id_idx" ON "practica_digitacion_personas"("operador_id");

-- CreateIndex
CREATE UNIQUE INDEX "intentos_digitacion_token_hash_key" ON "intentos_digitacion"("token_hash");

-- CreateIndex
CREATE INDEX "intentos_digitacion_operador_id_idx" ON "intentos_digitacion"("operador_id");

-- CreateIndex
CREATE UNIQUE INDEX "intentos_digitacion_practica_id_operador_id_numero_key" ON "intentos_digitacion"("practica_id", "operador_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "actas_digitacion_intento_id_numero_key" ON "actas_digitacion"("intento_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "novedades_digitacion_nombre_key" ON "novedades_digitacion"("nombre");

-- AddForeignKey
ALTER TABLE "practica_digitacion_cargos" ADD CONSTRAINT "practica_digitacion_cargos_practica_id_fkey" FOREIGN KEY ("practica_id") REFERENCES "practicas_digitacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practica_digitacion_cargos" ADD CONSTRAINT "practica_digitacion_cargos_cargo_fkey" FOREIGN KEY ("cargo") REFERENCES "cargos_cda"("clave") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practica_digitacion_personas" ADD CONSTRAINT "practica_digitacion_personas_practica_id_fkey" FOREIGN KEY ("practica_id") REFERENCES "practicas_digitacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practica_digitacion_personas" ADD CONSTRAINT "practica_digitacion_personas_operador_id_fkey" FOREIGN KEY ("operador_id") REFERENCES "operadores_cda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intentos_digitacion" ADD CONSTRAINT "intentos_digitacion_practica_id_fkey" FOREIGN KEY ("practica_id") REFERENCES "practicas_digitacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intentos_digitacion" ADD CONSTRAINT "intentos_digitacion_operador_id_fkey" FOREIGN KEY ("operador_id") REFERENCES "operadores_cda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actas_digitacion" ADD CONSTRAINT "actas_digitacion_intento_id_fkey" FOREIGN KEY ("intento_id") REFERENCES "intentos_digitacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Los id se pueden insertar también a mano (SQL) sin generar el uuid afuera.
ALTER TABLE "practicas_digitacion" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "intentos_digitacion" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "actas_digitacion" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "novedades_digitacion" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- Mismos límites que el esquema Zod (@cne/shared-validation).
ALTER TABLE "practicas_digitacion" ADD CONSTRAINT "ck_practicas_digitacion_rangos" CHECK (
    "filas_por_acta" BETWEEN 1 AND 40
    AND "voto_min" BETWEEN 0 AND 999
    AND "voto_max" BETWEEN "voto_min" AND 999
    AND "meta_actas" BETWEEN 1 AND 5000
    AND "plazo_minutos" BETWEEN 1 AND 1440
    AND "pct_digitos_distintos" BETWEEN 0 AND 100
    AND "intentos_max" BETWEEN 1 AND 20
    AND "fin" > "inicio"
);
