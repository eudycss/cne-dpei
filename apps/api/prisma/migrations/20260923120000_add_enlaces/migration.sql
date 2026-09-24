-- CreateEnum
CREATE TYPE "estado_enlace" AS ENUM ('ACTIVO', 'FALLO');

-- CreateTable
CREATE TABLE "enlaces_recinto" (
    "codigo_recinto" VARCHAR(20) NOT NULL,
    "nombre_recinto" VARCHAR(255) NOT NULL,
    "estado" "estado_enlace" NOT NULL DEFAULT 'ACTIVO',
    "estado_anterior" "estado_enlace",
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "enlaces_recinto_pkey" PRIMARY KEY ("codigo_recinto")
);

-- CreateTable
CREATE TABLE "config_enlaces" (
    "id" INTEGER NOT NULL,
    "correos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "config_enlaces_pkey" PRIMARY KEY ("id")
);
