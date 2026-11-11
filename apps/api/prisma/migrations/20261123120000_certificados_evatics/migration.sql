-- Certificados Evatics: tablas nuevas (certificado por cédula y configuración
-- con la fecha límite) y el permiso nuevo cda.evatics.revisar de fábrica para
-- el técnico supervisor. No cambia ni borra datos existentes.

-- CreateTable
CREATE TABLE "certificados_evatics" (
    "id" UUID NOT NULL,
    "cedula" VARCHAR(10) NOT NULL,
    "foto_key" VARCHAR(255) NOT NULL,
    "subido_en" TIMESTAMPTZ(6) NOT NULL,
    "consentimiento_version" VARCHAR(40) NOT NULL,
    "estado" VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE',
    "motivo_rechazo" VARCHAR(300),
    "revisado_por_id" UUID,
    "revisado_en" TIMESTAMPTZ(6),
    "foto_anterior_key" VARCHAR(255),
    "foto_anterior_subida_en" TIMESTAMPTZ(6),
    "reemplazos" INTEGER NOT NULL DEFAULT 0,
    "subidas_dia" VARCHAR(10),
    "subidas_hoy" INTEGER NOT NULL DEFAULT 0,
    "analisis_estado" VARCHAR(14) NOT NULL DEFAULT 'EN_COLA',
    "analisis_intentos" INTEGER NOT NULL DEFAULT 0,
    "analisis_siguiente" TIMESTAMPTZ(6),
    "nombre_leido" VARCHAR(200),
    "nombre_coincide" BOOLEAN,
    "es_certificado" BOOLEAN,
    "legible" BOOLEAN,
    "analizado_en" TIMESTAMPTZ(6),
    "analisis_proveedor" VARCHAR(20),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificados_evatics_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_certificados_evatics_estado" CHECK ("estado" IN ('PENDIENTE', 'APROBADO', 'RECHAZADO')),
    CONSTRAINT "ck_certificados_evatics_analisis" CHECK ("analisis_estado" IN ('EN_COLA', 'LISTO', 'NO_DISPONIBLE'))
);

-- CreateTable
CREATE TABLE "config_evatics" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "fecha_limite" DATE,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "config_evatics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "certificados_evatics_cedula_key" ON "certificados_evatics"("cedula");

-- CreateIndex
CREATE INDEX "idx_certificados_evatics_analisis" ON "certificados_evatics"("analisis_estado", "analisis_siguiente");

-- AddForeignKey
ALTER TABLE "certificados_evatics" ADD CONSTRAINT "certificados_evatics_revisado_por_id_fkey" FOREIGN KEY ("revisado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Fila única de configuración (sin plazo hasta que el administrador lo fije).
INSERT INTO "config_evatics" ("id") VALUES (1) ON CONFLICT DO NOTHING;

-- Permiso nuevo, de fábrica para el técnico supervisor (el administrador puede quitarlo).
INSERT INTO "rol_permisos" ("rol_id", "permiso")
SELECT r."id", d."permiso"
FROM (VALUES
    ('TECNICO_SUPERVISOR', 'cda.evatics.revisar')
) AS d("rol", "permiso")
JOIN "roles" r ON r."nombre" = d."rol"
ON CONFLICT DO NOTHING;
