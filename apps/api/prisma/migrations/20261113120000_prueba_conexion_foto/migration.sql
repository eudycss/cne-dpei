-- Foto de la computadora donde se hizo el test de conexión (fila PRUEBA_CONEXION).
-- Nullable: las APK anteriores registran la prueba sin foto.
ALTER TABLE "eventos_tracking" ADD COLUMN "foto_prueba_conexion_url" VARCHAR(512);
