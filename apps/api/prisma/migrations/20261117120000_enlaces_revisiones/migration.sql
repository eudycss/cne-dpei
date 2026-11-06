-- Enlaces: una fila por ciclo del cron (cada 5 min) para análisis de datos.
-- Tabla nueva: ninguna fila existente cambia.
CREATE TABLE "enlaces_revisiones" (
    "id" BIGSERIAL NOT NULL,
    "revisado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hoja_ok" BOOLEAN NOT NULL,
    "historial_ok" BOOLEAN,
    "enlaces" INTEGER NOT NULL DEFAULT 0,
    "activos" INTEGER NOT NULL DEFAULT 0,
    "caidos" INTEGER NOT NULL DEFAULT 0,
    "duracion_ms" INTEGER NOT NULL,
    "error" VARCHAR(300),

    CONSTRAINT "enlaces_revisiones_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_enlaces_revisiones_revisado_en" ON "enlaces_revisiones"("revisado_en");

-- Igual que en Supabase (trigger ensure_rls): sin políticas, la API de datos (anon) no la ve.
ALTER TABLE "enlaces_revisiones" ENABLE ROW LEVEL SECURITY;
