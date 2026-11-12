-- Certificados Evatics: si la IA vio "100 % completado" en la imagen. Solo informa al
-- supervisor; nunca aprueba. NULL = sin dato (filas anteriores o foto aún sin leer).
-- Columna nueva y nula: no cambia ni borra datos existentes.
ALTER TABLE "certificados_evatics" ADD COLUMN "curso_completo" BOOLEAN;
