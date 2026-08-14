-- HU5: geocerca de "llegada al DPI" (Delegación Provincial Electoral de Imbabura).
-- margen_llegada_dpi_metros sigue el mismo patrón que margen_llegada_metros
-- (HU3, migración 20260619000001). delegacion_ubicacion queda NULL hasta que
-- se cargue la coordenada real de la Delegación; mientras sea NULL,
-- registrarLlegadaDpi no bloquea nada (ver tracking.service.ts).
ALTER TABLE "config_alertas" ADD COLUMN "margen_llegada_dpi_metros" INTEGER NOT NULL DEFAULT 150;
ALTER TABLE "config_alertas" ADD COLUMN "delegacion_ubicacion" geography(Point,4326);
