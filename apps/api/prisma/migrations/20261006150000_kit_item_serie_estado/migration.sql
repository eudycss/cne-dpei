-- Serie y estado de cada artículo del kit, para el acta de cadena de custodia.
CREATE TYPE "estado_item_kit" AS ENUM ('BUENO', 'REGULAR', 'MALO');

ALTER TABLE "kit_items_contenido"
  ADD COLUMN "serie" VARCHAR(60),
  ADD COLUMN "estado" "estado_item_kit" NOT NULL DEFAULT 'BUENO';
