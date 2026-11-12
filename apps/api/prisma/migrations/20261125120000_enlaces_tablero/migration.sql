-- Tablero fijado del bot de enlaces: id del mensaje que se edita en cada ciclo.
-- NULL = aún no se publicó (o se borró): el siguiente ciclo publica uno nuevo y lo fija.
ALTER TABLE "config_enlaces" ADD COLUMN "tablero_mensaje_id" INTEGER;
