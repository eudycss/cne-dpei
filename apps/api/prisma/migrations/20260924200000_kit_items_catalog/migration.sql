-- CreateTable
CREATE TABLE "items_kit_catalog" (
    "id" UUID NOT NULL,
    "codigo" VARCHAR(50) NOT NULL,
    "etiqueta" VARCHAR(120) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "items_kit_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kit_items_contenido" (
    "kit_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,

    CONSTRAINT "kit_items_contenido_pkey" PRIMARY KEY ("kit_id","item_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "items_kit_catalog_codigo_key" ON "items_kit_catalog"("codigo");

-- CreateIndex
CREATE INDEX "idx_kit_items_item" ON "kit_items_contenido"("item_id");

-- AddForeignKey
ALTER TABLE "kit_items_contenido" ADD CONSTRAINT "kit_items_contenido_kit_id_fkey" FOREIGN KEY ("kit_id") REFERENCES "kits_electorales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kit_items_contenido" ADD CONSTRAINT "kit_items_contenido_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items_kit_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed: catálogo inicial de ítems estándar de un kit electoral (checklist por defecto)
INSERT INTO "items_kit_catalog" ("id", "codigo", "etiqueta") VALUES
  (gen_random_uuid(), 'COMPUTADOR', 'Computador'),
  (gen_random_uuid(), 'IMPRESORA', 'Impresora'),
  (gen_random_uuid(), 'CARGADOR', 'Cargador'),
  (gen_random_uuid(), 'MOUSE', 'Mouse'),
  (gen_random_uuid(), 'CORTAPICO', 'Cortapico/Cortapapel')
ON CONFLICT ("codigo") DO NOTHING;
