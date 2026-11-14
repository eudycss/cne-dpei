-- Contactos del rector y de los conserjes (hasta 2) de cada CDA, para el reporte de
-- Recintos y el bot. Texto libre; la sincronización con el Google Sheet no toca estas columnas.
ALTER TABLE "recintos" ADD COLUMN "rector_nombre" VARCHAR(120);
ALTER TABLE "recintos" ADD COLUMN "rector_telefono" VARCHAR(40);
ALTER TABLE "recintos" ADD COLUMN "conserje_nombre" VARCHAR(120);
ALTER TABLE "recintos" ADD COLUMN "conserje_telefono" VARCHAR(40);
ALTER TABLE "recintos" ADD COLUMN "conserje2_nombre" VARCHAR(120);
ALTER TABLE "recintos" ADD COLUMN "conserje2_telefono" VARCHAR(40);
